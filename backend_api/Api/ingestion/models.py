# backend_api/Api/ingestion/models.py
"""
Modelos de Memória Semântica (RAG) do boilerplate PGBA.

Arquitetura (Camada 4 do harness de IA — ver CLAUDE.md na raiz do repo):

    KnowledgeSource  ->  Document  ->  DocumentChunk (com embedding pgvector)

- KnowledgeSource: de onde o conhecimento vem (vault do Obsidian, upload,
  URL, API externa). Isolado por tenant.
- Document: uma unidade de conteúdo (uma nota do Obsidian, um PDF, etc).
  Guarda o texto bruto e metadados (frontmatter, tags), nunca dado pessoal
  sensível — isso é responsabilidade do módulo User/core.utils.lgpd.
- DocumentChunk: pedaço indexável do documento, com vetor de embedding.
  É aqui que a busca semântica (cosine distance) acontece.

Todos os modelos usam TenantMixin: nenhuma query de RAG pode vazar contexto
de um tenant para outro — isso é tão crítico em IA quanto em qualquer outro
domínio, pois o LLM pode "vazar" dados de um cliente na resposta de outro.
"""
import json
import uuid

from django.db import models
from django.conf import settings
from django.utils import timezone
from pgvector.django import VectorField, HnswIndex

from core.mixins import TenantMixin, AuditMixin, SoftDeleteMixin


def get_embedding_dimensions() -> int:
    return getattr(settings, "EMBEDDING_DIMENSIONS", 768)


class KnowledgeSource(TenantMixin, AuditMixin, SoftDeleteMixin, models.Model):
    """Uma origem de conhecimento configurada por um tenant."""

    class SourceType(models.TextChoices):
        OBSIDIAN = "obsidian", "Vault do Obsidian"
        UPLOAD = "upload", "Upload manual"
        MANUAL = "manual", "Base manual"
        URL = "url", "URL / Web"
        API = "api", "API externa"
        REST_API = "rest_api", "REST API"
        SQL = "sql", "Banco SQL"
        GOOGLE_SHEETS = "google_sheets", "Google Sheets"
        SLACK = "slack", "Slack"
        WEBHOOK = "webhook", "Webhook"
        EMAIL = "email", "E-mail (IMAP)"
        NOTION = "notion", "Notion"
        HUBSPOT = "hubspot", "HubSpot"
        SALESFORCE = "salesforce", "Salesforce"

    class SyncStatus(models.TextChoices):
        NEVER = "", "Nunca sincronizado"
        RUNNING = "running", "Sincronizando"
        OK = "ok", "OK"
        ERROR = "error", "Erro"

    name = models.CharField(max_length=150)
    source_type = models.CharField(max_length=20, choices=SourceType.choices)
    # Só o que NÃO é segredo. Ex: {"vault_path": "/vaults/x", "include_tags": ["#publico"]}
    config = models.JSONField(default=dict, blank=True)
    # Segredos (token, senha, chave) num JSON cifrado com Fernet (ENCRYPTION_KEY)
    # — nunca no `config`, nunca devolvidos pela API (ver ingestion.connectors.secrets).
    secret_config = models.TextField(blank=True, default="")
    # Identificador público (URL do webhook) — o id inteiro é adivinhável.
    public_id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    # Sincronização automática: a cada N minutos (vazio = só manual).
    sync_interval_minutes = models.PositiveIntegerField(null=True, blank=True)
    last_sync_status = models.CharField(
        max_length=10, choices=SyncStatus.choices, default=SyncStatus.NEVER, blank=True
    )
    last_sync_message = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(default=timezone.now)
    last_synced_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["name"]
        indexes = [models.Index(fields=["tenant_id", "source_type"])]

    def __str__(self):
        return f"{self.name} ({self.get_source_type_display()})"

    # Segredos: sempre por aqui, nunca lendo `secret_config` direto.
    def get_secrets(self) -> dict:
        from harness.crypto import decrypt_secret

        if not self.secret_config:
            return {}
        return json.loads(decrypt_secret(self.secret_config))

    def set_secrets(self, secrets: dict) -> None:
        from harness.crypto import encrypt_secret

        clean = {k: v for k, v in (secrets or {}).items() if v not in (None, "")}
        self.secret_config = encrypt_secret(json.dumps(clean)) if clean else ""

    def full_config(self) -> dict:
        """Config + segredos decifrados — só pra quem vai conectar de verdade."""
        # `_plain_secrets`: fonte montada em memória pra testar antes de salvar
        secrets = getattr(self, "_plain_secrets", None)
        return {**(self.config or {}), **(secrets if secrets is not None else self.get_secrets())}


class SourceSyncRun(TenantMixin, models.Model):
    """Uma execução de sincronização de um conector — o histórico do painel."""

    class Status(models.TextChoices):
        RUNNING = "running", "Rodando"
        OK = "ok", "OK"
        ERROR = "error", "Erro"

    class Trigger(models.TextChoices):
        MANUAL = "manual", "Manual"
        SCHEDULE = "schedule", "Agendado"
        WEBHOOK = "webhook", "Webhook"

    source = models.ForeignKey(KnowledgeSource, on_delete=models.CASCADE, related_name="sync_runs")
    trigger = models.CharField(max_length=10, choices=Trigger.choices, default=Trigger.MANUAL)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.RUNNING)
    started_at = models.DateTimeField(default=timezone.now)
    finished_at = models.DateTimeField(null=True, blank=True)
    created = models.PositiveIntegerField(default=0)
    updated = models.PositiveIntegerField(default=0)
    unchanged = models.PositiveIntegerField(default=0)
    removed = models.PositiveIntegerField(default=0)
    message = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["-started_at"]
        indexes = [models.Index(fields=["tenant_id", "source", "-started_at"])]

    def __str__(self):
        return f"{self.source_id} {self.status} {self.started_at:%Y-%m-%d %H:%M}"


class Document(TenantMixin, AuditMixin, SoftDeleteMixin, models.Model):
    """Uma unidade de conteúdo original (uma nota, um arquivo, uma página)."""

    class Status(models.TextChoices):
        PENDING = "pending", "Aguardando processamento"
        PROCESSING = "processing", "Processando"
        INDEXED = "indexed", "Indexado"
        ERROR = "error", "Erro no processamento"

    source = models.ForeignKey(
        KnowledgeSource, on_delete=models.CASCADE, related_name="documents"
    )
    # Caminho relativo no vault, URL, ou identificador externo
    external_id = models.CharField(max_length=1024)
    title = models.CharField(max_length=500, blank=True)
    content = models.TextField(blank=True)
    # SHA-256 do conteúdo — evita reprocessar/reembeddar arquivo sem mudança
    content_hash = models.CharField(max_length=64, db_index=True, blank=True)
    # Frontmatter do Obsidian, tags, links [[wiki-links]], etc.
    metadata = models.JSONField(default=dict, blank=True)
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.PENDING
    )
    error_message = models.TextField(blank=True)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)
    indexed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-updated_at"]
        indexes = [
            models.Index(fields=["tenant_id", "status"]),
            models.Index(fields=["source", "external_id"]),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["source", "external_id"], name="uniq_source_external_id"
            )
        ]

    def __str__(self):
        return self.title or self.external_id


class DocumentChunk(TenantMixin, models.Model):
    """
    Pedaço indexável de um Document, com embedding vetorial.

    tenant_id é denormalizado aqui (já vem do TenantMixin) de propósito:
    permite filtrar a busca semântica SEM precisar de JOIN em Document,
    o que é crítico para performance e para reforçar isolamento mesmo se
    uma query esquecer de fazer select_related.
    """

    document = models.ForeignKey(
        Document, on_delete=models.CASCADE, related_name="chunks"
    )
    chunk_index = models.PositiveIntegerField()
    content = models.TextField()
    token_count = models.PositiveIntegerField(default=0)
    embedding = VectorField(dimensions=get_embedding_dimensions())
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["document", "chunk_index"]
        constraints = [
            models.UniqueConstraint(
                fields=["document", "chunk_index"], name="uniq_document_chunk_index"
            )
        ]
        indexes = [
            models.Index(fields=["tenant_id"]),
            # Índice HNSW para busca por similaridade de cosseno em escala.
            # Requer a extensão `vector` ativa (ver migration 0001).
            HnswIndex(
                name="ingestion_chunk_embedding_hnsw",
                fields=["embedding"],
                m=16,
                ef_construction=64,
                opclasses=["vector_cosine_ops"],
            ),
        ]

    def __str__(self):
        return f"{self.document_id}#{self.chunk_index}"

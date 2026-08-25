# backend_api/Api/ingestion/services.py
"""
Serviços de ingestão, embedding e RAG.

Segue o "Princípio Akita" descrito em CLAUDE.md: nunca confiar cegamente
na primeira resposta do LLM/embedding. Toda chamada externa (mesmo local,
ao Ollama) é validada e falha de forma explícita e auditável.

Local-First por padrão: EMBEDDING_PROVIDER=ollama usa um modelo rodando
na própria infraestrutura (nenhum dado do tenant sai para nuvem de
terceiros). Trocar para "openai" (ou outro compatível) é uma decisão
explícita via variável de ambiente, nunca o default.
"""
from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from django.conf import settings
from django.utils import timezone

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Chunking
# ---------------------------------------------------------------------------

def chunk_text(
    text: str, chunk_size: int = 800, overlap: int = 120
) -> list[str]:
    """
    Divide texto em pedaços por parágrafo, respeitando um tamanho-alvo em
    caracteres com sobreposição. Simples de propósito: robustez > esperteza
    para um boilerplate que vai lidar com Markdown de qualquer formato.
    """
    text = (text or "").strip()
    if not text:
        return []

    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    chunks: list[str] = []
    current = ""

    for para in paragraphs:
        if len(current) + len(para) + 2 <= chunk_size:
            current = f"{current}\n\n{para}".strip()
            continue

        if current:
            chunks.append(current)
        if len(para) <= chunk_size:
            current = para
        else:
            # Parágrafo gigante (ex: tabela) — corta em fatias fixas
            for i in range(0, len(para), chunk_size - overlap):
                chunks.append(para[i : i + chunk_size])
            current = ""

    if current:
        chunks.append(current)

    # Overlap simples entre chunks consecutivos para preservar contexto
    if overlap and len(chunks) > 1:
        overlapped = [chunks[0]]
        for i in range(1, len(chunks)):
            tail = chunks[i - 1][-overlap:]
            overlapped.append(f"{tail}\n{chunks[i]}")
        return overlapped

    return chunks


def sha256_of(text: str) -> str:
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Embeddings
# ---------------------------------------------------------------------------

class EmbeddingError(Exception):
    pass


class EmbeddingClient:
    """
    Cliente de embeddings. Delega a resolução de credencial e a chamada
    HTTP de verdade para `harness.providers` — este cliente só decide QUAL
    provider/modelo usar (via settings, sobrescrevível por tenant através
    de `AIProviderCredential`) e trata os erros no vocabulário de
    `ingestion` (`EmbeddingError`).
    """

    def __init__(self):
        self.provider = getattr(settings, "EMBEDDING_PROVIDER", "ollama")
        self.model = getattr(settings, "EMBEDDING_MODEL", "nomic-embed-text")
        self.dimensions = getattr(settings, "EMBEDDING_DIMENSIONS", 768)

    def embed(self, text: str, tenant_id=None) -> list[float]:
        text = (text or "").strip()
        if not text:
            raise EmbeddingError("Não é possível gerar embedding de texto vazio.")

        from harness.providers import embed as harness_embed, ProviderConfigError

        try:
            return harness_embed(tenant_id, self.provider, self.model, text)
        except ProviderConfigError as exc:
            logger.error("Falha ao gerar embedding via %s: %s", self.provider, exc)
            raise EmbeddingError(str(exc)) from exc


# ---------------------------------------------------------------------------
# Indexação de documentos
# ---------------------------------------------------------------------------

def index_document(document) -> None:
    """
    Quebra `document.content` em chunks, gera embeddings e persiste.
    Idempotente: apaga chunks antigos do documento antes de recriar.
    """
    from ingestion.models import Document, DocumentChunk  # evita import circular

    client = EmbeddingClient()
    document.status = Document.Status.PROCESSING
    document.save(update_fields=["status"])

    try:
        pieces = chunk_text(document.content)
        if not pieces:
            document.status = Document.Status.ERROR
            document.error_message = "Documento sem conteúdo indexável."
            document.save(update_fields=["status", "error_message"])
            return

        DocumentChunk.objects.filter(document=document).delete()
        new_chunks = []
        for idx, piece in enumerate(pieces):
            vector = client.embed(piece, tenant_id=document.tenant_id)
            new_chunks.append(
                DocumentChunk(
                    tenant_id=document.tenant_id,
                    document=document,
                    chunk_index=idx,
                    content=piece,
                    token_count=len(piece.split()),
                    embedding=vector,
                )
            )
        DocumentChunk.objects.bulk_create(new_chunks)

        document.status = Document.Status.INDEXED
        document.indexed_at = timezone.now()
        document.error_message = ""
        document.save(update_fields=["status", "indexed_at", "error_message"])

    except EmbeddingError as exc:
        document.status = Document.Status.ERROR
        document.error_message = str(exc)
        document.save(update_fields=["status", "error_message"])
        logger.error("Falha ao indexar documento %s: %s", document.id, exc)


# ---------------------------------------------------------------------------
# Busca semântica (RAG)
# ---------------------------------------------------------------------------

@dataclass
class RetrievedChunk:
    content: str
    document_title: str
    source_name: str
    distance: float


def semantic_search(
    query: str, tenant_id, top_k: int = 5, source_ids: list[int] | None = None,
) -> list[RetrievedChunk]:
    """
    Busca os chunks mais similares à query, SEMPRE escopados por tenant_id.
    Nunca aceite tenant_id=None aqui — isso vazaria a base inteira.

    `source_ids`: filtro opcional para restringir a busca a
    KnowledgeSource(s) específicas — usado por verticais que precisam de
    "cérebros" segmentados (ex: `agency`, onde um agente operacional só
    deveria buscar na base de conhecimento do próprio setor, enquanto um
    agente com acesso total busca em tudo). `None` = busca em todas as
    fontes do tenant, comportamento original.
    """
    from ingestion.models import DocumentChunk

    if not tenant_id:
        raise ValueError("semantic_search requer tenant_id explícito.")

    client = EmbeddingClient()
    query_vector = client.embed(query, tenant_id=tenant_id)

    # pgvector-django: CosineDistance anota a distância e permite ordenar
    from pgvector.django import CosineDistance

    queryset = DocumentChunk.objects.filter(tenant_id=tenant_id)
    if source_ids is not None:
        queryset = queryset.filter(document__source_id__in=source_ids)

    queryset = (
        queryset
        .select_related("document", "document__source")
        .annotate(distance=CosineDistance("embedding", query_vector))
        .order_by("distance")[:top_k]
    )

    return [
        RetrievedChunk(
            content=chunk.content,
            document_title=chunk.document.title or chunk.document.external_id,
            source_name=chunk.document.source.name,
            distance=float(chunk.distance),
        )
        for chunk in queryset
    ]


def build_context_prompt(chunks: Iterable[RetrievedChunk]) -> str:
    """Monta o bloco de contexto a injetar no prompt do LLM, com citação da fonte."""
    parts = []
    for i, chunk in enumerate(chunks, start=1):
        parts.append(
            f"[Fonte {i}: {chunk.source_name} / {chunk.document_title}]\n{chunk.content}"
        )
    return "\n\n---\n\n".join(parts)


# ---------------------------------------------------------------------------
# Sincronização do Obsidian
# ---------------------------------------------------------------------------

def sync_obsidian_source(source) -> dict:
    """
    Varre o vault do Obsidian configurado em `source.config['vault_path']`,
    cria/atualiza um Document por nota (.md) e enfileira a indexação.

    Regras:
    - Só processa arquivo se o hash do conteúdo mudou (evita reembeddar
      o vault inteiro a cada sync).
    - Respeita `config['include_tags']` se definido: só indexa notas que
      contenham pelo menos uma das tags no frontmatter ou corpo.
    - Ignora a pasta `.obsidian/` (configuração interna do app) e
      qualquer nota marcada com `private: true` no frontmatter.
    """
    import frontmatter  # python-frontmatter
    from ingestion.models import Document

    vault_path = source.config.get("vault_path")
    if not vault_path or not Path(vault_path).is_dir():
        raise ValueError(f"vault_path inválido ou inacessível: {vault_path}")

    include_tags = set(source.config.get("include_tags", []))
    stats = {"created": 0, "updated": 0, "skipped": 0, "unchanged": 0}

    vault = Path(vault_path)
    for md_file in vault.rglob("*.md"):
        if ".obsidian" in md_file.parts:
            continue

        try:
            post = frontmatter.load(md_file)
        except Exception as exc:
            logger.warning("Não foi possível ler %s: %s", md_file, exc)
            stats["skipped"] += 1
            continue

        if post.metadata.get("private") is True:
            stats["skipped"] += 1
            continue

        note_tags = set(post.metadata.get("tags", []) or [])
        if include_tags and not (note_tags & include_tags):
            stats["skipped"] += 1
            continue

        relative_path = str(md_file.relative_to(vault))
        content_hash = sha256_of(post.content)

        document, created = Document.objects.get_or_create(
            tenant_id=source.tenant_id,
            source=source,
            external_id=relative_path,
            defaults={
                "title": post.metadata.get("title") or md_file.stem,
                "content": post.content,
                "content_hash": content_hash,
                "metadata": {"frontmatter": post.metadata, "tags": list(note_tags)},
                "status": Document.Status.PENDING,
            },
        )

        if created:
            stats["created"] += 1
            index_document(document)
            continue

        if document.content_hash == content_hash:
            stats["unchanged"] += 1
            continue

        document.title = post.metadata.get("title") or md_file.stem
        document.content = post.content
        document.content_hash = content_hash
        document.metadata = {"frontmatter": post.metadata, "tags": list(note_tags)}
        document.status = Document.Status.PENDING
        document.save()
        index_document(document)
        stats["updated"] += 1

    source.last_synced_at = timezone.now()
    source.save(update_fields=["last_synced_at"])
    return stats


# ---------------------------------------------------------------------------
# Geração de resposta (LLM local, opcional)
# ---------------------------------------------------------------------------

def generate_answer(query: str, context: str, tenant_id=None) -> str:
    """
    Gera uma resposta usando o LLM de chat (via `harness.providers`, com o
    contexto recuperado do RAG injetado no prompt). Não substitui
    `semantic_search`: é uma camada opcional acima dela — a API sempre
    retorna os chunks brutos também, para que o frontend possa exibir a
    fonte.

    Guardrail (`harness.guardrails.require_grounded_context`): se o
    contexto vier vazio ou curto demais, NEM CHAMAMOS o modelo — é
    exatamente a situação em que ele tenderia a inventar uma resposta
    plausível porém falsa. Devolvemos `NoAnswer.TEXT` em vez disso.
    """
    from harness.guardrails import require_grounded_context, GroundingError, NoAnswer
    from harness.providers import chat_completion, ProviderConfigError

    try:
        require_grounded_context(context)
    except GroundingError:
        return NoAnswer.TEXT

    provider = getattr(settings, "CHAT_PROVIDER", "ollama")
    model = getattr(settings, "OLLAMA_CHAT_MODEL", "llama3")

    system_prompt = (
        "Você é um assistente que responde exclusivamente com base no "
        "CONTEXTO fornecido. Se a resposta não estiver no contexto, diga "
        "claramente que não encontrou essa informação na base de conhecimento. "
        "Nunca invente fatos. Cite a fonte quando possível."
    )
    user_prompt = f"CONTEXTO:\n{context}\n\nPERGUNTA:\n{query}"

    try:
        return chat_completion(
            tenant_id, provider, model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.2,
        )
    except ProviderConfigError as exc:
        logger.error("Falha ao gerar resposta via %s: %s", provider, exc)
        raise EmbeddingError(f"Falha ao gerar resposta: {exc}") from exc

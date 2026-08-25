# backend_api/Api/agency/models.py
"""
Modelo organizacional hierárquico: CEO -> Orquestrador-geral ->
Orquestrador de setor -> Agentes operacionais.

Regras de negócio (ver `agency/services.py` para o enforcement real):

- Agente OPERACIONAL só acessa o conhecimento/dado do próprio setor.
- Orquestrador DE SETOR também só acessa o próprio setor diretamente,
  mas pode MEDIAR (repassar) uma mensagem desse setor para outro.
- Orquestrador-GERAL e CEO enxergam e acessam qualquer setor —
  são os únicos com `sector=None` (não pertencem a uma unidade
  operacional específica).
- Setor nunca fala com outro setor diretamente: sempre passa por um
  `SectorMessage`, mediado por um orquestrador (de setor ou geral) ou
  pelo CEO.

"Cérebro principal vs. secundário": cada `Sector` pode ter seu próprio
`KnowledgeSource` (`ingestion`) — o "cérebro secundário" daquele setor.
Um agente operacional, ao perguntar algo, só busca no cérebro do próprio
setor (`ingestion.semantic_search(..., source_ids=[...])`); CEO e
orquestrador-geral buscam em todos os cérebros do tenant (sem filtro) —
esse é o "cérebro principal" na prática: não é uma tabela separada, é o
acesso irrestrito a todas as fontes.
"""
from django.db import models
from django.utils import timezone
from django.utils.text import slugify

from core.mixins import TenantMixin, AuditMixin, SoftDeleteMixin


class Sector(TenantMixin, AuditMixin, SoftDeleteMixin, models.Model):
    """Um setor da empresa (ex: Jurídico, Financeiro, Desenvolvimento)."""

    name = models.CharField(max_length=100)
    slug = models.SlugField(max_length=110, blank=True)
    description = models.TextField(blank=True)
    monthly_budget_usd = models.DecimalField(
        max_digits=10, decimal_places=2, default=0,
        help_text="Orçamento mensal do setor, em USD. 0 = sem limite definido.",
    )
    # O "cérebro secundário" deste setor. Opcional: um setor sem fonte
    # própria não tem RAG restrito (cai para "sem contexto adicional" nas
    # perguntas de agentes operacionais, nunca vaza para outro setor).
    knowledge_source = models.ForeignKey(
        "ingestion.KnowledgeSource", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="agency_sectors",
        help_text="Base de conhecimento própria deste setor (o 'cérebro secundário').",
    )
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["name"]
        indexes = [models.Index(fields=["tenant_id", "slug"])]
        constraints = [
            models.UniqueConstraint(fields=["tenant_id", "slug"], name="uniq_sector_slug_per_tenant")
        ]

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = slugify(self.name)
        super().save(*args, **kwargs)

    def __str__(self):
        return self.name


class Agent(TenantMixin, AuditMixin, SoftDeleteMixin, models.Model):
    """
    Um agente de IA. Representa um PAPEL/PERSONA configurada (não uma
    sessão de chat individual) — ex: "Orquestrador de Backend", "CEO",
    "Analista de Suporte Nível 1".
    """

    class AccessLevel(models.TextChoices):
        OPERATIONAL = "operational", "Operacional (só o próprio setor)"
        SECTOR_ORCHESTRATOR = "sector_orchestrator", "Orquestrador de Setor (medeia o próprio setor)"
        GENERAL_ORCHESTRATOR = "general_orchestrator", "Orquestrador-Geral (acesso total, medeia entre setores)"
        CEO = "ceo", "CEO (acesso total)"

    class WorkStatus(models.TextChoices):
        IDLE = "idle", "Ocioso"
        WORKING = "working", "Trabalhando"
        PAUSED = "paused", "Pausado"

    # Nulo apenas para CEO / Orquestrador-Geral — papéis que não
    # pertencem a um setor operacional específico.
    sector = models.ForeignKey(
        Sector, on_delete=models.CASCADE, related_name="agents", null=True, blank=True,
    )
    name = models.CharField(max_length=100)
    role = models.CharField(max_length=150, help_text="Ex: 'Orquestrador de Backend', 'CEO', 'Analista de Suporte'.")
    access_level = models.CharField(
        max_length=25, choices=AccessLevel.choices, default=AccessLevel.OPERATIONAL,
    )
    work_status = models.CharField(max_length=20, choices=WorkStatus.choices, default=WorkStatus.IDLE)
    current_task = models.CharField(max_length=255, blank=True)
    backlog_tasks = models.JSONField(
        default=list, blank=True,
        help_text="Tarefas pausadas (ex: por intervenção de um orquestrador/CEO), preservadas para retomada.",
    )

    default_provider = models.CharField(max_length=20, blank=True)
    default_model = models.CharField(max_length=100, blank=True)

    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["sector", "-access_level", "name"]
        indexes = [models.Index(fields=["tenant_id", "sector"]), models.Index(fields=["tenant_id", "access_level"])]
        constraints = [
            # CEO/Orquestrador-Geral não pertencem a um setor; os demais precisam de um.
            models.CheckConstraint(
                condition=(
                    models.Q(access_level__in=["general_orchestrator", "ceo"], sector__isnull=True)
                    | models.Q(access_level__in=["operational", "sector_orchestrator"], sector__isnull=False)
                ),
                name="agent_sector_matches_access_level",
            )
        ]

    def __str__(self):
        return f"{self.name} ({self.get_access_level_display()})"

    @property
    def has_full_access(self) -> bool:
        return self.access_level in (self.AccessLevel.GENERAL_ORCHESTRATOR, self.AccessLevel.CEO)

    @property
    def can_relay(self) -> bool:
        """Pode mediar uma mensagem entre setores (não necessariamente responder por eles)."""
        return self.access_level in (
            self.AccessLevel.SECTOR_ORCHESTRATOR,
            self.AccessLevel.GENERAL_ORCHESTRATOR,
            self.AccessLevel.CEO,
        )

    def pause(self, reason: str = "") -> None:
        """Pausa o agente, preservando a tarefa atual no backlog para retomada."""
        if self.current_task:
            self.backlog_tasks = [*self.backlog_tasks, self.current_task]
        self.work_status = self.WorkStatus.PAUSED
        self.current_task = ""
        self.save(update_fields=["work_status", "current_task", "backlog_tasks"])


class AgentInteraction(TenantMixin, models.Model):
    """
    Uma interação de um Agent com o `orchestration` (pergunta → resposta).

    Propositalmente NÃO é uma FK em `orchestration.QueryLog` apontando
    para cá — isso inverteria a camada (core/orchestration não deve
    depender de uma vertical). Em vez disso, `agency` (a vertical) chama
    `orchestration.answer_question()` e registra o resultado aqui, com
    `query_log_id` como referência fraca (id, não FK) só para quem quiser
    cruzar os dois logs manualmente.

    Isto é, na prática, o "cérebro principal": todo interação de todo
    agente de todo setor cai aqui, consultável pelo CEO/orquestrador-geral
    sem restrição (ver `agency.services.get_company_activity`).
    """

    agent = models.ForeignKey(Agent, on_delete=models.CASCADE, related_name="interactions")
    question = models.TextField()
    answer = models.TextField(blank=True)
    tokens_used = models.PositiveIntegerField(default=0)
    estimated_cost_usd = models.DecimalField(max_digits=10, decimal_places=6, default=0)
    query_log_id = models.PositiveIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["tenant_id", "agent", "created_at"]),
        ]

    def __str__(self):
        return f"{self.agent.name} • {self.created_at:%Y-%m-%d %H:%M}"


class SectorMessage(TenantMixin, models.Model):
    """
    Mensagem de um setor para outro — NUNCA um agente operacional fala
    direto com outro setor. Toda comunicação cruzada passa por aqui e
    precisa de um agente com `can_relay=True` para ser efetivamente
    encaminhada (`agency.services.relay_message`).
    """

    class Status(models.TextChoices):
        PENDING = "pending", "Aguardando um orquestrador mediar"
        ANSWERED = "answered", "Respondida"
        REJECTED = "rejected", "Rejeitada (sem orquestrador autorizado a mediar)"

    from_agent = models.ForeignKey(Agent, on_delete=models.CASCADE, related_name="sent_messages")
    to_sector = models.ForeignKey(Sector, on_delete=models.CASCADE, related_name="received_messages")
    relayed_by = models.ForeignKey(
        Agent, on_delete=models.SET_NULL, null=True, blank=True, related_name="relayed_messages",
        help_text="Orquestrador (de setor ou geral) ou CEO que mediou esta mensagem.",
    )
    content = models.TextField()
    response = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    rejection_reason = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(default=timezone.now, db_index=True)
    answered_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["tenant_id", "status"])]

    def __str__(self):
        origem = self.from_agent.sector.name if self.from_agent.sector else self.from_agent.name
        return f"{origem} → {self.to_sector.name} [{self.status}]"


class Project(TenantMixin, AuditMixin, SoftDeleteMixin, models.Model):
    """
    Um projeto comercial simples criado a pedido (ex: "setor de
    Desenvolvimento, crie um projeto X"). Deliberadamente separado do
    conceito de "vertical" do próprio PGBA: um Project aqui é um produto
    LEVE para o cliente comercializar (deploy em Vercel/Render/Supabase),
    não um novo módulo dentro desta plataforma. Ver
    `agency.services.create_project` e `templates/simple-commercial/`.
    """

    class Status(models.TextChoices):
        PENDING = "pending", "Criando"
        READY = "ready", "Repositório criado"
        FAILED = "failed", "Falhou"

    name = models.CharField(max_length=100)
    description = models.TextField(blank=True)
    requested_by = models.ForeignKey(
        Agent, on_delete=models.SET_NULL, null=True, blank=True, related_name="requested_projects",
        help_text="Agente (tipicamente do setor de Desenvolvimento) que processou o pedido.",
    )
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    github_repo_url = models.URLField(blank=True)
    github_full_name = models.CharField(max_length=255, blank=True)
    error_message = models.TextField(blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["tenant_id", "status"])]

    def __str__(self):
        return f"{self.name} [{self.status}]"

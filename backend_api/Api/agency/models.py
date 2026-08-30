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
from django.conf import settings
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

    class AutonomyLevel(models.IntegerChoices):
        """
        Dimensão INDEPENDENTE de `access_level` — aquela decide COM QUEM o
        agente pode falar; esta decide O QUANTO ele pode agir sozinho antes
        de precisar de aprovação humana. Um agente pode ter acesso total
        (CEO) e ainda assim autonomia zero (só observa), ou ser operacional
        de um setor só e ter autonomia total dentro dele.

        Ver `agency.policy.evaluate_policy()` — cada nível interage com o
        `risk` (orchestration.registry.RISK_LEVELS) da função que o agente
        tenta executar.
        """
        OBSERVER = 0, "Observador (só monitora/consulta risco baixo)"
        RECOMMENDER = 1, "Recomendador (analisa e sugere, nunca executa sozinho)"
        SUPERVISED_EXECUTOR = 2, "Executor Supervisionado (executa só com aprovação, exceto risco baixo)"
        POLICY_EXECUTOR = 3, "Executor por Política (auto-executa dentro de regras liberadas, nunca crítico)"
        AUTONOMOUS = 4, "Autônomo (auto-executa até risco crítico, se a política liberar)"

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
    # Default deliberadamente o mais seguro (OBSERVER) — autonomia maior é
    # opt-in explícito de quem administra o tenant, nunca o padrão.
    autonomy_level = models.IntegerField(choices=AutonomyLevel.choices, default=AutonomyLevel.OBSERVER)
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


class PolicyRule(TenantMixin, models.Model):
    """
    Regra configurável de governança (documento "Agentic Enterprise OS",
    §13 — "As regras devem ser configuráveis. Não hardcode essas regras.").

    Libera um agente com `autonomy_level` >= `POLICY_EXECUTOR` (3) a
    auto-executar uma função de um `risk` específico sem aprovação humana.
    Sem uma regra ativa cobrindo o risco, `agency.policy.evaluate_policy()`
    sempre exige aprovação para risco médio ou acima — a regra é a exceção
    explícita, nunca o padrão.

    `sector=None` = regra vale para o tenant inteiro; setor específico
    restringe só aos agentes daquele setor.
    """

    RISK_CHOICES = [("medium", "Médio"), ("high", "Alto"), ("critical", "Crítico")]

    sector = models.ForeignKey(
        Sector, on_delete=models.CASCADE, null=True, blank=True, related_name="policy_rules",
        help_text="Vazio = regra vale para o tenant inteiro.",
    )
    risk = models.CharField(max_length=10, choices=RISK_CHOICES)
    min_autonomy_level = models.IntegerField(
        choices=Agent.AutonomyLevel.choices, default=Agent.AutonomyLevel.POLICY_EXECUTOR,
        help_text="Nível mínimo de autonomia do agente para esta regra liberar execução automática.",
    )
    description = models.CharField(max_length=255, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["risk"]
        indexes = [models.Index(fields=["tenant_id", "risk", "is_active"])]

    def __str__(self):
        escopo = self.sector.name if self.sector else "tenant inteiro"
        return f"{self.get_risk_display()} → autonomia {self.min_autonomy_level}+ ({escopo})"


class PendingApproval(TenantMixin, models.Model):
    """
    Criado quando `agency.policy.evaluate_policy()` bloqueia a execução
    automática de uma função (autonomia insuficiente ou nenhuma
    `PolicyRule` liberando aquele risco). A ação fica congelada aqui —
    `params`/`function_name` guardados intactos — até um humano
    aprovar ou rejeitar via `agency.services.decide_pending_approval()`.

    Corresponde ao "Human-in-the-loop" do documento (§12) e é a peça que
    fecha a rastreabilidade do §31: toda ação de risco médio+ tem um
    registro de quem decidiu e quando, nunca só "a IA fez".
    """

    class Status(models.TextChoices):
        PENDING = "pending", "Aguardando decisão"
        APPROVED = "approved", "Aprovado"
        REJECTED = "rejected", "Rejeitado"

    agent = models.ForeignKey(Agent, on_delete=models.CASCADE, related_name="pending_approvals")
    function_name = models.CharField(max_length=100)
    params = models.JSONField(default=dict)
    risk = models.CharField(max_length=10)
    reason = models.CharField(max_length=255, help_text="Por que a política exigiu aprovação.")
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    result = models.JSONField(null=True, blank=True, help_text="Resultado da execução, preenchido só se aprovado.")
    decided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
    )
    created_at = models.DateTimeField(default=timezone.now)
    decided_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["tenant_id", "status"])]

    def __str__(self):
        return f"{self.function_name} ({self.risk}) — {self.get_status_display()}"


class Task(TenantMixin, AuditMixin, models.Model):
    """
    Unidade de trabalho de um agente, com ciclo de vida real — diferente
    de `Agent.current_task` (só uma string curta pra exibição). Permite o
    que `PendingApproval` não cobre: intervir NO MEIO da execução, não só
    bloquear antes dela começar.

    Fluxo (`agency.tasks`):
        CREATED → IN_PROGRESS → [CEO interrompe] → PAUSED_CEO
                              → [CEO dá nova instrução] → ADAPTED → (segue)
                              → APPROVED (opcionalmente dispara PR no GitHub)
                              → REJECTED

    `version` sobe a cada interrupção — cada versão tem um `TaskSnapshot`
    correspondente, então "adaptar" nunca perde o progresso anterior: o
    novo prompt é construído citando o snapshot da versão de onde parou.
    """

    class Status(models.TextChoices):
        CREATED = "created", "Criada"
        IN_PROGRESS = "in_progress", "Em andamento"
        PAUSED_CEO = "paused_ceo", "Pausada pelo CEO"
        ADAPTED = "adapted", "Adaptada (nova instrução, retomando)"
        APPROVED = "approved", "Aprovada"
        REJECTED = "rejected", "Rejeitada"

    agent = models.ForeignKey(Agent, on_delete=models.CASCADE, related_name="tasks")
    # Nulo = tarefa não tem relação com nenhum repositório (ex: só uma
    # análise/relatório). Preenchido = obrigatório pra approve_task poder
    # disparar PR de verdade (usa Project.github_full_name como destino).
    project = models.ForeignKey(
        Project, on_delete=models.SET_NULL, null=True, blank=True, related_name="tasks",
    )
    brief = models.TextField(help_text="O que a tarefa pede — o prompt original do agente.")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.CREATED)
    progress = models.FloatField(default=0.0, help_text="0.0 a 1.0 — só informativo, não trava nada.")
    current_files = models.JSONField(default=list, blank=True, help_text="Paths dos arquivos que a tarefa produziu até agora.")
    result = models.JSONField(default=dict, blank=True, help_text="Saída estruturada da execução (plan/steps/output/needs_review) ou {'error': ...}.")
    version = models.PositiveIntegerField(default=1)
    task_type = models.CharField(max_length=50, blank=True)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["tenant_id", "agent", "status"])]

    def __str__(self):
        return f"[{self.status}] {self.brief[:60]}"


class TaskSnapshot(models.Model):
    """
    Estado exato de uma Task no momento de uma interrupção — permite
    `adapt_and_resume` citar o progresso anterior sem perder trabalho já
    feito. Não é TenantMixin porque sempre se acessa via `task`, que já é
    tenant-scoped; evita duplicar o filtro.
    """

    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name="snapshots")
    version = models.PositiveIntegerField()
    context = models.JSONField(help_text="brief/progress/current_files/status no momento da interrupção.")
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-version"]
        unique_together = [("task", "version")]

    def __str__(self):
        return f"Snapshot v{self.version} de Task #{self.task_id}"
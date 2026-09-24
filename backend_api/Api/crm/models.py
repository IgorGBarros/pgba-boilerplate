from django.db import models
from django.utils import timezone
from core.mixins import TenantMixin, AuditMixin, SoftDeleteMixin


# ─── Pipeline & Stage (kanban configurável) ───────────────────────────────────

class Pipeline(TenantMixin, AuditMixin, models.Model):
    """Pipeline de vendas — um tenant pode ter múltiplos (ex: vendas, pós-venda)."""
    name = models.CharField(max_length=150, default="Pipeline Comercial")
    is_default = models.BooleanField(default=False)

    class Meta:
        ordering = ["name"]
        indexes = [models.Index(fields=["tenant_id"])]

    def __str__(self):
        return self.name


class Stage(TenantMixin, models.Model):
    """
    Sub-etapa configurável dentro de um Pipeline.

    Cada stage pertence a uma das 3 colunas principais:
    LEAD → DEAL → PROJECT
    A ordem dentro de cada coluna é definida por `position`.
    """
    class MainStage(models.TextChoices):
        LEAD = "lead", "Lead"
        DEAL = "deal", "Deal"
        PROJECT = "project", "Projeto"

    pipeline = models.ForeignKey(Pipeline, on_delete=models.CASCADE, related_name="stages")
    main_stage = models.CharField(max_length=20, choices=MainStage.choices)
    name = models.CharField(max_length=100)
    position = models.PositiveIntegerField(default=0)
    color = models.CharField(max_length=30, default="blue")
    is_won = models.BooleanField(default=False)
    is_lost = models.BooleanField(default=False)

    class Meta:
        ordering = ["main_stage", "position"]
        indexes = [models.Index(fields=["tenant_id", "pipeline", "main_stage"])]

    def __str__(self):
        return f"{self.get_main_stage_display()} → {self.name}"


# ─── Lead (card do kanban) ─────────────────────────────────────────────────────

class Lead(TenantMixin, AuditMixin, SoftDeleteMixin, models.Model):
    ORIGEM_CHOICES = [
        ("site", "Site"),
        ("indicacao", "Indicação"),
        ("social", "Redes sociais"),
        ("evento", "Evento"),
        ("cold_outreach", "Cold outreach"),
        ("outro", "Outro"),
    ]

    # Kanban
    pipeline = models.ForeignKey(
        Pipeline, on_delete=models.SET_NULL, null=True, blank=True, related_name="leads"
    )
    stage = models.ForeignKey(
        Stage, on_delete=models.SET_NULL, null=True, blank=True, related_name="leads"
    )
    position = models.PositiveIntegerField(default=0)

    # Dados do contato
    nome = models.CharField(max_length=200)
    empresa = models.CharField(max_length=200, blank=True)
    email = models.EmailField(blank=True)
    telefone = models.CharField(max_length=30, blank=True)
    cargo = models.CharField(max_length=100, blank=True)

    # Comercial
    valor_estimado = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    responsavel = models.CharField(max_length=200, blank=True)
    origem = models.CharField(max_length=20, choices=ORIGEM_CHOICES, default="outro")
    observacoes = models.TextField(blank=True)

    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["position", "-created_at"]
        indexes = [
            models.Index(fields=["tenant_id", "stage"]),
            models.Index(fields=["tenant_id", "pipeline"]),
            models.Index(fields=["tenant_id", "responsavel"]),
        ]

    def __str__(self):
        return f"{self.nome} ({self.empresa})"


# ─── Contato e Oportunidade (mantidos do modelo anterior) ─────────────────────

class Contato(TenantMixin, AuditMixin, SoftDeleteMixin, models.Model):
    nome = models.CharField(max_length=200)
    empresa = models.CharField(max_length=200, blank=True)
    cargo = models.CharField(max_length=100, blank=True)
    email = models.EmailField(blank=True)
    telefone = models.CharField(max_length=30, blank=True)
    lead = models.ForeignKey(
        Lead, on_delete=models.SET_NULL, null=True, blank=True, related_name="contatos"
    )
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["nome"]
        indexes = [models.Index(fields=["tenant_id"])]

    def __str__(self):
        return self.nome


class Oportunidade(TenantMixin, AuditMixin, SoftDeleteMixin, models.Model):
    STATUS_CHOICES = [
        ("prospeccao", "Prospecção"),
        ("qualificacao", "Qualificação"),
        ("proposta", "Proposta"),
        ("negociacao", "Negociação"),
        ("ganho", "Ganho"),
        ("perdido", "Perdido"),
    ]

    titulo = models.CharField(max_length=255)
    lead = models.ForeignKey(Lead, on_delete=models.CASCADE, related_name="oportunidades")
    valor = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    status = models.CharField(max_length=15, choices=STATUS_CHOICES, default="prospeccao")
    data_fechamento_previsto = models.DateField(null=True, blank=True)
    observacoes = models.TextField(blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["tenant_id", "status"])]

    def __str__(self):
        return self.titulo


class AtividadeCRM(TenantMixin, AuditMixin, SoftDeleteMixin, models.Model):
    TIPO_CHOICES = [
        ("ligacao", "Ligação"),
        ("email", "E-mail"),
        ("reuniao", "Reunião"),
        ("visita", "Visita"),
        ("proposta", "Proposta"),
        ("outro", "Outro"),
    ]

    titulo = models.CharField(max_length=255)
    tipo = models.CharField(max_length=15, choices=TIPO_CHOICES, default="ligacao")
    lead = models.ForeignKey(Lead, on_delete=models.CASCADE, related_name="atividades")
    responsavel = models.CharField(max_length=200, blank=True)
    data_hora = models.DateTimeField(default=timezone.now)
    resultado = models.TextField(blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-data_hora"]
        indexes = [
            models.Index(fields=["tenant_id", "data_hora"]),
            models.Index(fields=["tenant_id", "lead"]),
        ]

    def __str__(self):
        return self.titulo


# ─── Conversa do agente com o lead ────────────────────────────────────────────

class LeadMessage(TenantMixin, models.Model):
    """Histórico de conversa entre o agente comercial e o lead."""

    class Role(models.TextChoices):
        USER = "user", "Usuário / Lead"
        AGENT = "agent", "Agente"
        SYSTEM = "system", "Sistema"

    lead = models.ForeignKey(Lead, on_delete=models.CASCADE, related_name="messages")
    role = models.CharField(max_length=10, choices=Role.choices)
    content = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]
        indexes = [models.Index(fields=["tenant_id", "lead"])]

    def __str__(self):
        return f"[{self.role}] {self.content[:60]}"

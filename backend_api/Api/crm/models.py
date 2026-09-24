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
        ("whatsapp", "WhatsApp"),
        ("telegram", "Telegram"),
        ("landing_page", "Landing Page"),
        ("meta_ads", "Meta Ads (Facebook/Instagram)"),
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

    # Identificador externo do canal (ex: número WhatsApp, chat_id Telegram)
    channel_ref = models.CharField(
        max_length=200, blank=True,
        help_text="Identificador único do lead no canal de origem (ex: número WhatsApp, Telegram chat_id).",
    )

    # Desfecho — define a automação de transição entre colunas do kanban:
    # Lead → Deal: "vendido" ou "concluido"
    # Deal → Project: "contrato_assinado" ou "concluido"
    OUTCOME_CHOICES = [
        ("", "—"),
        ("vendido", "Vendido"),
        ("concluido", "Concluído"),
        ("perdido", "Perdido"),
        ("contrato_assinado", "Contrato Assinado"),
        ("cancelado", "Cancelado"),
    ]
    outcome = models.CharField(max_length=30, choices=OUTCOME_CHOICES, blank=True, default="")

    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["position", "-created_at"]
        indexes = [
            models.Index(fields=["tenant_id", "stage"]),
            models.Index(fields=["tenant_id", "pipeline"]),
            models.Index(fields=["tenant_id", "responsavel"]),
            models.Index(fields=["tenant_id", "channel_ref"]),
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


# ─── Configuração de canais de entrada de leads ────────────────────────────────

class ChannelConfig(TenantMixin, models.Model):
    """
    Configuração de um canal de entrada de leads (WhatsApp, Telegram, Landing Page, Meta Ads).

    O webhook_secret é usado para validar a autenticidade das requisições
    recebidas (HMAC no caso do Meta, token no caso do Telegram).
    """

    class Channel(models.TextChoices):
        WHATSAPP = "whatsapp", "WhatsApp (Evolution API)"
        TELEGRAM = "telegram", "Telegram Bot"
        LANDING_PAGE = "landing_page", "Landing Page"
        META_ADS = "meta_ads", "Meta Lead Ads (Facebook/Instagram)"

    channel = models.CharField(max_length=20, choices=Channel.choices)
    is_active = models.BooleanField(default=True)

    # Credenciais do canal (criptografadas via harness.crypto)
    _api_key = models.TextField(db_column="api_key_encrypted", blank=True)

    # Configurações específicas por canal (armazenadas como JSON)
    config = models.JSONField(
        default=dict, blank=True,
        help_text=(
            "WhatsApp: {\"instance\": \"...\", \"server_url\": \"http://...\"}. "
            "Telegram: {\"bot_username\": \"...\"}. "
            "Meta Ads: {\"page_id\": \"...\", \"verify_token\": \"...\"}."
        ),
    )

    # Webhook secret para validação de assinatura (HMAC-SHA256)
    webhook_secret = models.CharField(max_length=255, blank=True)

    # Mensagem de boas-vindas enviada automaticamente no primeiro contato
    welcome_message = models.TextField(
        blank=True,
        help_text="Mensagem enviada automaticamente quando o lead entra em contato pela primeira vez.",
    )

    # Sugestões de perguntas exibidas após a mensagem de boas-vindas
    quick_replies = models.JSONField(
        default=list, blank=True,
        help_text='Lista de sugestões de perguntas. Ex: ["Ver preços", "Falar com atendente", "Saber mais"]',
    )

    # Pipeline de destino para leads capturados por este canal
    target_pipeline = models.ForeignKey(
        Pipeline, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="channel_configs",
    )

    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Configuração de Canal"
        verbose_name_plural = "Configurações de Canais"
        indexes = [models.Index(fields=["tenant_id", "channel", "is_active"])]
        constraints = [
            models.UniqueConstraint(
                fields=["tenant_id", "channel"],
                condition=models.Q(is_active=True),
                name="uniq_active_channel_per_tenant",
            )
        ]

    def __str__(self):
        return f"{self.get_channel_display()} (tenant={self.tenant_id})"

    @property
    def api_key(self) -> str:
        from harness.crypto import decrypt_secret
        return decrypt_secret(self._api_key) if self._api_key else ""

    @api_key.setter
    def api_key(self, plaintext: str) -> None:
        from harness.crypto import encrypt_secret
        self._api_key = encrypt_secret(plaintext) if plaintext else ""

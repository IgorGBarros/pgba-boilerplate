from django.db import models
from django.utils import timezone
from core.mixins import TenantMixin, AuditMixin, SoftDeleteMixin


# ─── Pipeline & Stage (kanban configurável) ───────────────────────────────────

class Pipeline(TenantMixin, AuditMixin, models.Model):
    """Pipeline de vendas — um tenant pode ter múltiplos."""
    name = models.CharField(max_length=150, default="Pipeline Comercial")
    is_default = models.BooleanField(default=False)

    class Meta:
        ordering = ["name"]
        indexes = [models.Index(fields=["tenant_id"])]

    def __str__(self):
        return self.name


class Stage(TenantMixin, models.Model):
    """
    Etapa configurável dentro de um Pipeline.

    entity_type define a qual entidade esta etapa pertence:
    LEAD → DEAL → PROJECT
    """
    class EntityType(models.TextChoices):
        LEAD = "lead", "Lead"
        DEAL = "deal", "Deal"
        PROJECT = "project", "Projeto"

    pipeline = models.ForeignKey(Pipeline, on_delete=models.CASCADE, related_name="stages")
    main_stage = models.CharField(max_length=20, choices=EntityType.choices)  # alias: entity_type
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


# ─── Campos customizáveis por entidade ────────────────────────────────────────

class CustomFieldDefinition(TenantMixin, models.Model):
    """
    Define um campo customizado para Lead, Deal ou Project.
    Cada tenant pode adicionar quantos campos quiser por entidade,
    sem alterar o schema do banco — os valores são armazenados em
    CustomFieldValue como JSON.
    """
    class EntityType(models.TextChoices):
        LEAD = "lead", "Lead"
        DEAL = "deal", "Deal"
        PROJECT = "project", "Projeto"

    class FieldType(models.TextChoices):
        TEXT = "text", "Texto"
        TEXTAREA = "textarea", "Texto longo"
        NUMBER = "number", "Número"
        CURRENCY = "currency", "Moeda"
        DATE = "date", "Data"
        SELECT = "select", "Seleção"
        MULTISELECT = "multiselect", "Multi-seleção"
        CHECKBOX = "checkbox", "Checkbox"
        EMAIL = "email", "E-mail"
        PHONE = "phone", "Telefone"
        URL = "url", "URL"

    entity_type = models.CharField(max_length=20, choices=EntityType.choices)
    name = models.CharField(max_length=100)
    key = models.SlugField(max_length=100, help_text="Identificador único do campo (snake_case).")
    field_type = models.CharField(max_length=20, choices=FieldType.choices, default=FieldType.TEXT)
    options = models.JSONField(
        default=list, blank=True,
        help_text='Para select/multiselect: lista de strings. Ex: ["Opção A", "Opção B"]',
    )
    required = models.BooleanField(default=False)
    position = models.PositiveIntegerField(default=0)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["entity_type", "position"]
        indexes = [models.Index(fields=["tenant_id", "entity_type", "is_active"])]
        constraints = [
            models.UniqueConstraint(
                fields=["tenant_id", "entity_type", "key"],
                name="uniq_custom_field_key_per_entity_tenant",
            )
        ]

    def __str__(self):
        return f"[{self.entity_type}] {self.name}"


class CustomFieldValue(TenantMixin, models.Model):
    """Valor de um campo customizado para uma instância específica de Lead/Deal/Project."""
    field_def = models.ForeignKey(
        CustomFieldDefinition, on_delete=models.CASCADE, related_name="values"
    )
    entity_type = models.CharField(max_length=20)
    entity_id = models.PositiveIntegerField()
    value = models.JSONField(null=True, blank=True)

    class Meta:
        indexes = [
            models.Index(fields=["tenant_id", "entity_type", "entity_id"]),
            models.Index(fields=["tenant_id", "field_def"]),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["tenant_id", "field_def", "entity_type", "entity_id"],
                name="uniq_custom_field_value_per_entity",
            )
        ]

    def __str__(self):
        return f"{self.field_def.name}: {self.value}"


# ─── Lead ─────────────────────────────────────────────────────────────────────

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
    OUTCOME_CHOICES = [
        ("", "—"),
        ("convertido", "Convertido em Deal"),
        ("perdido", "Perdido"),
        ("cancelado", "Cancelado"),
    ]

    # Kanban
    pipeline = models.ForeignKey(
        Pipeline, on_delete=models.SET_NULL, null=True, blank=True, related_name="leads"
    )
    stage = models.ForeignKey(
        Stage, on_delete=models.SET_NULL, null=True, blank=True, related_name="leads"
    )
    position = models.PositiveIntegerField(default=0)

    # Dados de contato
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

    # Canal de origem (WhatsApp, Telegram, etc.)
    channel_ref = models.CharField(
        max_length=200, blank=True,
        help_text="Identificador único do lead no canal de origem.",
    )

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


# ─── Deal ─────────────────────────────────────────────────────────────────────

class Deal(TenantMixin, AuditMixin, SoftDeleteMixin, models.Model):
    """
    Oportunidade comercial qualificada, gerada a partir de um Lead ou diretamente.
    Referencia o Lead de origem via FK (rastreabilidade completa).
    """
    OUTCOME_CHOICES = [
        ("", "—"),
        ("ganho", "Ganho"),
        ("contrato_assinado", "Contrato Assinado"),
        ("perdido", "Perdido"),
        ("cancelado", "Cancelado"),
    ]

    # Referência ao lead de origem (opcional — pode ser criado sem lead)
    lead = models.ForeignKey(
        Lead, on_delete=models.SET_NULL, null=True, blank=True, related_name="deals"
    )

    # Kanban
    pipeline = models.ForeignKey(
        Pipeline, on_delete=models.SET_NULL, null=True, blank=True, related_name="deals"
    )
    stage = models.ForeignKey(
        Stage, on_delete=models.SET_NULL, null=True, blank=True, related_name="deals"
    )
    position = models.PositiveIntegerField(default=0)

    # Dados do deal
    titulo = models.CharField(max_length=255)
    empresa = models.CharField(max_length=200, blank=True)
    responsavel = models.CharField(max_length=200, blank=True)
    valor = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    moeda = models.CharField(max_length=10, default="BRL", blank=True)
    data_fechamento_previsto = models.DateField(null=True, blank=True)
    observacoes = models.TextField(blank=True)
    # Negócio vai virar contrato de serviço no ERP? Passa pro Project criado a partir dele.
    sera_contrato = models.BooleanField(default=False)
    contrato_com_material = models.BooleanField(default=False)

    outcome = models.CharField(max_length=30, choices=OUTCOME_CHOICES, blank=True, default="")
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["position", "-created_at"]
        indexes = [
            models.Index(fields=["tenant_id", "stage"]),
            models.Index(fields=["tenant_id", "pipeline"]),
            models.Index(fields=["tenant_id", "lead"]),
            models.Index(fields=["tenant_id", "responsavel"]),
        ]

    def __str__(self):
        return self.titulo


# ─── Project ──────────────────────────────────────────────────────────────────

class Project(TenantMixin, AuditMixin, SoftDeleteMixin, models.Model):
    """
    Projeto gerado a partir de um Deal ganho.
    Mantém referência ao Deal (e indiretamente ao Lead original).
    """
    OUTCOME_CHOICES = [
        ("", "—"),
        ("concluido", "Concluído"),
        ("pausado", "Pausado"),
        ("cancelado", "Cancelado"),
    ]

    # Referências de rastreabilidade
    deal = models.ForeignKey(
        Deal, on_delete=models.SET_NULL, null=True, blank=True, related_name="projects"
    )
    lead = models.ForeignKey(
        Lead, on_delete=models.SET_NULL, null=True, blank=True, related_name="projects"
    )

    # Kanban
    pipeline = models.ForeignKey(
        Pipeline, on_delete=models.SET_NULL, null=True, blank=True, related_name="projects"
    )
    stage = models.ForeignKey(
        Stage, on_delete=models.SET_NULL, null=True, blank=True, related_name="projects"
    )
    position = models.PositiveIntegerField(default=0)

    # Dados do projeto
    titulo = models.CharField(max_length=255)
    empresa = models.CharField(max_length=200, blank=True)
    responsavel = models.CharField(max_length=200, blank=True)
    data_inicio = models.DateField(null=True, blank=True)
    data_fim_previsto = models.DateField(null=True, blank=True)
    data_fim_realizado = models.DateField(null=True, blank=True)
    observacoes = models.TextField(blank=True)
    # Este projeto será faturado como contrato de serviço (erp.ContratoServico)?
    # Marcado, ele aparece no ERP → Contratos como "aguardando contrato".
    sera_contrato = models.BooleanField(default=False)
    contrato_com_material = models.BooleanField(default=False)

    outcome = models.CharField(max_length=30, choices=OUTCOME_CHOICES, blank=True, default="")
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["position", "-created_at"]
        indexes = [
            models.Index(fields=["tenant_id", "stage"]),
            models.Index(fields=["tenant_id", "pipeline"]),
            models.Index(fields=["tenant_id", "deal"]),
        ]

    def __str__(self):
        return self.titulo


# ─── Contato e Atividade ──────────────────────────────────────────────────────

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


# ─── Mensagens do agente com o lead ───────────────────────────────────────────

class LeadMessage(TenantMixin, models.Model):
    class Role(models.TextChoices):
        USER = "user", "Usuário / Lead"
        AGENT = "agent", "Agente"
        SYSTEM = "system", "Sistema"

    lead = models.ForeignKey(Lead, on_delete=models.CASCADE, related_name="messages")
    role = models.CharField(max_length=10, choices=Role.choices)
    content = models.TextField()
    tokens_in = models.PositiveIntegerField(default=0)
    tokens_out = models.PositiveIntegerField(default=0)
    cost_estimated_usd = models.DecimalField(max_digits=10, decimal_places=6, default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]
        indexes = [models.Index(fields=["tenant_id", "lead"])]

    def __str__(self):
        return f"[{self.role}] {self.content[:60]}"


# ─── Configuração de canais de entrada ────────────────────────────────────────

class ChannelConfig(TenantMixin, models.Model):
    class Channel(models.TextChoices):
        WHATSAPP = "whatsapp", "WhatsApp (Evolution API)"
        TELEGRAM = "telegram", "Telegram Bot"
        LANDING_PAGE = "landing_page", "Landing Page"
        META_ADS = "meta_ads", "Meta Lead Ads (Facebook/Instagram)"

    channel = models.CharField(max_length=20, choices=Channel.choices)
    is_active = models.BooleanField(default=True)
    _api_key = models.TextField(db_column="api_key_encrypted", blank=True)
    config = models.JSONField(default=dict, blank=True)
    webhook_secret = models.CharField(max_length=255, blank=True)
    welcome_message = models.TextField(blank=True)
    quick_replies = models.JSONField(default=list, blank=True)
    # Frases que precisam estar na PRIMEIRA mensagem para o contato virar lead.
    # Lista vazia = qualquer mensagem cria lead (comportamento padrão).
    trigger_phrases = models.JSONField(default=list, blank=True)
    target_pipeline = models.ForeignKey(
        Pipeline, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="channel_configs",
    )
    # Pausar/retomar execução sem remover a config
    is_paused = models.BooleanField(default=False)
    # Encerramento de sessão por inatividade
    session_timeout_minutes = models.PositiveIntegerField(
        default=20,
        help_text="Minutos sem resposta para encerrar a sessão. 0 = desativado.",
    )
    session_timeout_message = models.TextField(
        blank=True,
        default="Sua sessão foi encerrada por inatividade. Se precisar de ajuda, é só enviar uma mensagem!",
    )
    # Horário de funcionamento: {"enabled": true, "timezone": "America/Sao_Paulo",
    #   "schedule": {"mon": {"open": true, "start": "09:00", "end": "18:00"}, ...}}
    business_hours = models.JSONField(default=dict, blank=True)
    out_of_hours_message = models.TextField(
        blank=True,
        default="Olá! Nosso atendimento funciona em horário comercial. Em breve retornaremos!",
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


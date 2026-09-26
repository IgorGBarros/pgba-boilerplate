# backend_api/Api/integrations/models.py
from django.db import models
from django.utils import timezone

from core.mixins import AuditMixin, SoftDeleteMixin, TenantMixin
from harness.crypto import encrypt_secret, decrypt_secret, mask_secret


class ServiceCredential(TenantMixin, models.Model):
    """
    Token de um serviço externo de infraestrutura/deploy. Reaproveita a
    mesma criptografia (Fernet) de `harness.AIProviderCredential` — a
    diferença é só o domínio (deploy/infra, não IA).
    """

    class Provider(models.TextChoices):
        GITHUB = "github", "GitHub"
        VERCEL = "vercel", "Vercel"
        RENDER = "render", "Render"
        SUPABASE = "supabase", "Supabase"
        # account_ref = URL da instância (https://n8n.suaempresa.com); token = API key
        N8N = "n8n", "n8n"
        # token = API token do hPanel (VPS, domínios). E-mail da Hostinger é SMTP/IMAP
        # e fica em EmailAccount, não aqui.
        HOSTINGER = "hostinger", "Hostinger"

    provider = models.CharField(max_length=20, choices=Provider.choices)
    label = models.CharField(max_length=100, blank=True)
    # Para GitHub: organização/usuário onde os repositórios de projeto
    # serão criados. Para Supabase: URL do projeto. Livre por provider.
    account_ref = models.CharField(
        max_length=255, blank=True,
        help_text="GitHub: organização ou usuário. Supabase: URL do projeto. Vazio = conta pessoal do token.",
    )
    _encrypted_token = models.TextField(db_column="token_encrypted", blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Credencial de Serviço Externo"
        verbose_name_plural = "Credenciais de Serviços Externos"
        indexes = [models.Index(fields=["tenant_id", "provider", "is_active"])]
        constraints = [
            models.UniqueConstraint(
                fields=["tenant_id", "provider"],
                condition=models.Q(is_active=True),
                name="uniq_active_service_credential_per_tenant_provider",
            )
        ]

    def __str__(self):
        scope = f"tenant={self.tenant_id}" if self.tenant_id else "global"
        return f"{self.get_provider_display()} ({scope}) — {self.masked_token}"

    @property
    def token(self) -> str:
        return decrypt_secret(self._encrypted_token) if self._encrypted_token else ""

    @token.setter
    def token(self, plaintext: str) -> None:
        self._encrypted_token = encrypt_secret(plaintext) if plaintext else ""

    @property
    def masked_token(self) -> str:
        if not self._encrypted_token:
            return "(sem token)"
        try:
            return mask_secret(self.token)
        except Exception:
            return "(erro ao decifrar — verifique ENCRYPTION_KEY)"


class _SecretField:
    """Descriptor: guarda cifrado (Fernet) na coluna `<nome>_encrypted`."""

    def __init__(self, column: str):
        self.column = column

    def __get__(self, obj, owner=None):
        if obj is None:
            return self
        raw = getattr(obj, self.column)
        return decrypt_secret(raw) if raw else ""

    def __set__(self, obj, value):
        setattr(obj, self.column, encrypt_secret(value) if value else "")


class ServerConnection(TenantMixin, SoftDeleteMixin, models.Model):
    """
    Servidor (VPS) da empresa — Oracle Cloud (Always Free), Hostinger ou outro.
    Guarda como chegar (host, porta SSH, usuário, chave) cifrado. O sistema
    só TESTA o acesso (porta SSH responde); não executa comando remoto.
    """

    class Provider(models.TextChoices):
        ORACLE = "oracle", "Oracle Cloud"
        HOSTINGER = "hostinger", "Hostinger"
        OUTRO = "outro", "Outro"

    name = models.CharField(max_length=100)
    provider = models.CharField(max_length=20, choices=Provider.choices, default=Provider.ORACLE)
    host = models.CharField(max_length=255, blank=True)
    ssh_port = models.PositiveIntegerField(default=22)
    username = models.CharField(max_length=100, blank=True, default="ubuntu")
    region = models.CharField(max_length=100, blank=True)
    purpose = models.CharField(
        max_length=255, blank=True, help_text="Pra que serve (ex.: n8n, backend, banco)."
    )
    notes = models.TextField(blank=True)
    private_key_encrypted = models.TextField(blank=True)
    private_key = _SecretField("private_key_encrypted")
    last_check_at = models.DateTimeField(null=True, blank=True)
    last_check_ok = models.BooleanField(null=True)
    last_check_message = models.CharField(max_length=500, blank=True)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Servidor (VPS)"
        verbose_name_plural = "Servidores (VPS)"
        ordering = ["name"]

    def __str__(self):
        return f"{self.name} ({self.get_provider_display()})"


class EmailAccount(TenantMixin, SoftDeleteMixin, models.Model):
    """
    Caixa de e-mail de um setor (ex.: compras@empresa.com.br pro setor Compras).
    Pode nascer SEM endereço/senha ("aguardando configuração"): o setor já
    fica com a caixa reservada e os rascunhos esperam por ela.
    `sector` vazio = caixa padrão da empresa (usada quando o setor não tem a dele).
    """

    class Provider(models.TextChoices):
        HOSTINGER = "hostinger", "Hostinger"
        GMAIL = "gmail", "Gmail / Google Workspace"
        OUTLOOK = "outlook", "Outlook / Microsoft 365"
        CUSTOM = "custom", "Outro (SMTP próprio)"

    class Security(models.TextChoices):
        SSL = "ssl", "SSL/TLS"
        STARTTLS = "starttls", "STARTTLS"
        NONE = "none", "Nenhuma"

    class Status(models.TextChoices):
        PENDING = "pending", "Aguardando configuração"
        READY = "ready", "Pronta"
        ERROR = "error", "Com erro"

    sector = models.ForeignKey(
        "agency.Sector",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="email_accounts",
    )
    address = models.EmailField(blank=True)
    display_name = models.CharField(max_length=120, blank=True)
    provider = models.CharField(max_length=20, choices=Provider.choices, default=Provider.HOSTINGER)
    smtp_host = models.CharField(max_length=255, blank=True)
    smtp_port = models.PositiveIntegerField(default=465)
    smtp_security = models.CharField(max_length=10, choices=Security.choices, default=Security.SSL)
    imap_host = models.CharField(max_length=255, blank=True)
    imap_port = models.PositiveIntegerField(default=993)
    username = models.CharField(max_length=255, blank=True, help_text="Vazio = o próprio endereço.")
    password_encrypted = models.TextField(blank=True)
    password = _SecretField("password_encrypted")
    signature = models.TextField(blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    last_check_at = models.DateTimeField(null=True, blank=True)
    last_check_message = models.CharField(max_length=500, blank=True)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Caixa de e-mail"
        verbose_name_plural = "Caixas de e-mail"
        constraints = [
            models.UniqueConstraint(
                fields=["tenant_id", "sector"],
                condition=models.Q(is_active=True),
                name="uniq_active_email_account_per_sector",
            )
        ]

    def __str__(self):
        return self.address or f"(caixa sem endereço — setor {self.sector_id})"

    @property
    def login(self) -> str:
        return self.username or self.address

    @property
    def configured(self) -> bool:
        return bool(self.address and self.smtp_host and self.password_encrypted)


class OutboundEmail(TenantMixin, AuditMixin, models.Model):
    """
    E-mail de saída de um setor. Agente ou tela criam RASCUNHO; só uma pessoa
    manda enviar (§12: IA não age sozinha). Sem caixa pronta, o rascunho
    espera — nunca some nem sai por outra caixa sem avisar.
    """

    class Status(models.TextChoices):
        DRAFT = "draft", "Rascunho (aguardando aprovação)"
        SENDING = "sending", "Enviando"
        SENT = "sent", "Enviado"
        FAILED = "failed", "Falhou"
        CANCELLED = "cancelled", "Cancelado"

    sector = models.ForeignKey(
        "agency.Sector",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="outbound_emails",
    )
    account = models.ForeignKey(
        EmailAccount, on_delete=models.SET_NULL, null=True, blank=True, related_name="emails"
    )
    to = models.JSONField(default=list)
    cc = models.JSONField(default=list, blank=True)
    subject = models.CharField(max_length=255)
    body = models.TextField()
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.DRAFT)
    # De onde veio: "compras.orcamento:12", "compras.pedido:3", "agente:7"...
    origin = models.CharField(max_length=100, blank=True, db_index=True)
    requested_by = models.CharField(max_length=150, blank=True)
    approved_by = models.CharField(max_length=150, blank=True)
    sent_at = models.DateTimeField(null=True, blank=True)
    error = models.CharField(max_length=500, blank=True)
    message_id = models.CharField(max_length=255, blank=True)

    class Meta:
        verbose_name = "E-mail de saída"
        verbose_name_plural = "E-mails de saída"
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["tenant_id", "status"])]

    def __str__(self):
        return f"{self.subject} → {', '.join(self.to)} ({self.status})"

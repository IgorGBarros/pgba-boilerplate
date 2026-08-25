# backend_api/Api/integrations/models.py
from django.db import models
from django.utils import timezone

from core.mixins import TenantMixin
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

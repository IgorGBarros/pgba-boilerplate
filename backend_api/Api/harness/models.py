# backend_api/Api/harness/models.py
"""
Configuração de credenciais de IA — o ponto único de "onde configuro
tokens e API keys" do projeto inteiro.

Prioridade de resolução (ver `harness/providers.py`):
    1. AIProviderCredential específica do tenant (multi-cliente com chave própria)
    2. AIProviderCredential global do projeto (tenant_id nulo — "default do projeto")
    3. Variável de ambiente (.env) — fallback de desenvolvimento

Isso permite: em dev, só usar .env e nunca tocar nesta tabela; em produção
multi-tenant, cada cliente pode ter sua própria chave de OpenAI/Groq/etc
(ex: cliente paga o próprio uso), configurável por um admin **sem deploy**,
direto pelo Django admin ou por `python manage.py configure_ai_provider`.
"""
from django.db import models
from django.utils import timezone

from core.mixins import TenantMixin
from harness.crypto import encrypt_secret, decrypt_secret, mask_secret


class AIProviderCredential(TenantMixin, models.Model):
    class Provider(models.TextChoices):
        OLLAMA = "ollama", "Ollama (local, sem API key)"
        OPENAI = "openai", "OpenAI (ou compatível)"
        ANTHROPIC = "anthropic", "Anthropic (Claude)"
        GROQ = "groq", "Groq"
        OPENROUTER = "openrouter", "OpenRouter (gateway multi-modelo)"

    provider = models.CharField(max_length=20, choices=Provider.choices)
    # Nulo = credencial global do projeto (default quando o tenant não tem a própria)
    label = models.CharField(
        max_length=100, blank=True,
        help_text="Nome livre, ex: 'Groq produção' — só para organização no admin.",
    )
    base_url = models.URLField(
        blank=True,
        help_text="Sobrescreve a URL padrão do provedor (útil para proxies/self-host).",
    )
    _encrypted_api_key = models.TextField(db_column="api_key_encrypted", blank=True)
    default_model = models.CharField(max_length=100, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Credencial de Provedor de IA"
        verbose_name_plural = "Credenciais de Provedores de IA"
        indexes = [models.Index(fields=["tenant_id", "provider", "is_active"])]
        constraints = [
            # No máximo 1 credencial ativa por (tenant, provider) — evita
            # ambiguidade sobre qual chave usar.
            models.UniqueConstraint(
                fields=["tenant_id", "provider"],
                condition=models.Q(is_active=True),
                name="uniq_active_credential_per_tenant_provider",
            )
        ]

    def __str__(self):
        scope = f"tenant={self.tenant_id}" if self.tenant_id else "global"
        return f"{self.get_provider_display()} ({scope}) — {self.masked_api_key}"

    # API key nunca fica em texto puro no banco nem em memória mais tempo
    # que o necessário — só a property `api_key` decifra, sob demanda.
    @property
    def api_key(self) -> str:
        return decrypt_secret(self._encrypted_api_key) if self._encrypted_api_key else ""

    @api_key.setter
    def api_key(self, plaintext: str) -> None:
        self._encrypted_api_key = encrypt_secret(plaintext) if plaintext else ""

    @property
    def masked_api_key(self) -> str:
        if not self._encrypted_api_key:
            return "(sem chave — ok para Ollama local)"
        try:
            return mask_secret(self.api_key)
        except Exception:
            return "(erro ao decifrar — verifique ENCRYPTION_KEY)"
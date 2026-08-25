# backend_api/Api/core/models.py
"""
Models transversais, usados por qualquer módulo/vertical do projeto.

ConsentRecord generaliza o padrão de consentimento LGPD (Art. 8º e 12º)
para um contexto multi-tenant: aqui, "titular" pode ser um usuário de
QUALQUER tenant, e cada registro carrega o tenant_id para que auditorias
e exports de dados (Art. 18 - portabilidade/eliminação) sejam sempre
escopados corretamente.
"""
import hashlib

from django.conf import settings
from django.db import models
from django.utils import timezone

from core.mixins import TenantMixin


class ConsentRecord(TenantMixin, models.Model):
    """
    Registro de consentimento LGPD. Guarda a manifestação de vontade do
    titular, com versionamento do termo e suporte a titulares anônimos
    (ex: lead que ainda não criou conta).

    `purpose_flags` é deliberadamente uma lista aberta (JSONField), não um
    enum fixo no banco: cada projeto/vertical registra suas próprias
    finalidades (ex: "ai_features", "marketing", "behavior_tracking") sem
    precisar de migration. Sugestão de finalidades-base, documente as suas
    no README do projeto:

        essential, authentication, service_delivery, legal_compliance,
        analytics, marketing, ai_features, ai_training,
        data_commercialization (dados agregados/anonimizados vendidos a terceiros)
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="consent_records",
        help_text="Usuário autenticado (nulo para titular anônimo/pré-cadastro).",
    )
    email = models.EmailField(db_index=True, blank=True)
    session_id = models.CharField(max_length=100, blank=True)

    ip_hash = models.CharField(max_length=64, db_index=True, blank=True)
    purpose_flags = models.JSONField(default=list)
    term_version = models.CharField(max_length=20, db_index=True)
    accepted_at = models.DateTimeField(default=timezone.now, db_index=True)
    revoked_at = models.DateTimeField(null=True, blank=True)
    user_agent = models.TextField(blank=True)

    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-accepted_at"]
        verbose_name = "Registro de Consentimento LGPD"
        verbose_name_plural = "Registros de Consentimento LGPD"
        indexes = [
            models.Index(fields=["tenant_id", "email", "term_version"]),
            models.Index(fields=["tenant_id", "user", "term_version"]),
        ]

    def __str__(self):
        identifier = self.user.email if self.user_id else self.email
        status = "Revogado" if self.revoked_at else "Ativo"
        return f"[{status}] {identifier} • v{self.term_version}"

    def is_active(self) -> bool:
        return self.revoked_at is None

    def revoke(self, purpose: str | None = None) -> None:
        """Revoga o consentimento total, ou só uma finalidade específica."""
        if purpose and purpose in self.purpose_flags:
            self.purpose_flags = [p for p in self.purpose_flags if p != purpose]
            if not self.purpose_flags:
                self.revoked_at = timezone.now()
        else:
            self.revoked_at = timezone.now()
        self.save(update_fields=["purpose_flags", "revoked_at", "updated_at"])

    @staticmethod
    def hash_ip(ip_address: str, salt: str | None = None) -> str:
        """SHA-256 do IP + salt — nunca armazenar IP em texto puro (Art. 12)."""
        if salt is None:
            salt = getattr(settings, "LGPD_IP_SALT", "")
        return hashlib.sha256(f"{ip_address}{salt}".encode()).hexdigest()

    @classmethod
    def has_consent_for_purpose(cls, tenant_id, user_or_email, purpose: str) -> bool:
        """
        Checagem central usada por QUALQUER código (inclusive `orchestration`
        e `ingestion`) antes de usar dado do titular para uma finalidade
        específica — ex: antes de incluir dados de um usuário em treino de
        IA ou em agregados comerciais.
        """
        lookup = (
            {"user": user_or_email}
            if hasattr(user_or_email, "id")
            else {"email": user_or_email}
        )
        record = (
            cls.objects.filter(tenant_id=tenant_id, revoked_at__isnull=True, **lookup)
            .order_by("-accepted_at")
            .first()
        )
        return bool(record and purpose in record.purpose_flags)

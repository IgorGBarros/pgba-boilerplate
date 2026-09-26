# backend_api/Api/integrations/serializers.py
from rest_framework import serializers

from integrations.models import (
    EmailAccount,
    InboundEmail,
    OutboundEmail,
    ServerConnection,
    ServiceCredential,
)

MASK = "••••"


def _masked(value: str) -> str:
    return f"{MASK}{value[-4:]}" if value and len(value) > 8 else (MASK if value else "")


class _SectorInTenant:
    """Setor precisa ser do mesmo tenant (e não excluído)."""

    def validate_sector(self, sector):
        tenant_id = self.context["request"].tenant_id
        if sector and (sector.tenant_id != tenant_id or not sector.is_active):
            raise serializers.ValidationError("Setor inválido.")
        return sector


class ServiceCredentialSerializer(serializers.ModelSerializer):
    token = serializers.CharField(write_only=True, required=False, allow_blank=True)
    token_masked = serializers.SerializerMethodField()
    configured = serializers.SerializerMethodField()

    class Meta:
        model = ServiceCredential
        fields = [
            "id",
            "provider",
            "label",
            "account_ref",
            "token",
            "token_masked",
            "configured",
            "updated_at",
        ]
        read_only_fields = ["id", "updated_at"]

    def get_token_masked(self, obj):
        try:
            return _masked(obj.token)
        except Exception:
            return "(erro ao decifrar — confira ENCRYPTION_KEY)"

    def get_configured(self, obj):
        # MoneyPrinterTurbo pode rodar sem chave (rede confiável): a URL basta
        so_url = obj.provider == "moneyprinter" and bool(obj.account_ref)
        return bool(obj._encrypted_token) or so_url


class ServerConnectionSerializer(serializers.ModelSerializer):
    private_key = serializers.CharField(write_only=True, required=False, allow_blank=True)
    has_private_key = serializers.SerializerMethodField()

    class Meta:
        model = ServerConnection
        fields = [
            "id",
            "name",
            "provider",
            "host",
            "ssh_port",
            "username",
            "region",
            "purpose",
            "notes",
            "private_key",
            "has_private_key",
            "last_check_at",
            "last_check_ok",
            "last_check_message",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "last_check_at",
            "last_check_ok",
            "last_check_message",
            "created_at",
            "updated_at",
        ]

    def get_has_private_key(self, obj):
        return bool(obj.private_key_encrypted)

    def _save_key(self, instance, key):
        if key is not None and not key.startswith(MASK):
            instance.private_key = key.strip()

    def create(self, validated):
        key = validated.pop("private_key", None)
        instance = ServerConnection(**validated)
        self._save_key(instance, key)
        instance.save()
        return instance

    def update(self, instance, validated):
        key = validated.pop("private_key", None)
        for k, v in validated.items():
            setattr(instance, k, v)
        self._save_key(instance, key)
        instance.save()
        return instance


class EmailAccountSerializer(_SectorInTenant, serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, required=False, allow_blank=True)
    has_password = serializers.SerializerMethodField()
    configured = serializers.BooleanField(read_only=True)
    sector_name = serializers.CharField(source="sector.name", read_only=True, default="")

    class Meta:
        model = EmailAccount
        fields = [
            "id",
            "sector",
            "sector_name",
            "address",
            "display_name",
            "provider",
            "smtp_host",
            "smtp_port",
            "smtp_security",
            "imap_host",
            "imap_port",
            "username",
            "password",
            "has_password",
            "signature",
            "status",
            "configured",
            "last_check_at",
            "last_check_message",
            "last_fetch_at",
            "last_fetch_message",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "status",
            "last_check_at",
            "last_check_message",
            "last_fetch_at",
            "last_fetch_message",
            "created_at",
            "updated_at",
        ]

    def get_has_password(self, obj):
        return bool(obj.password_encrypted)

    def validate(self, attrs):
        tenant_id = self.context["request"].tenant_id
        sector = attrs.get("sector", getattr(self.instance, "sector", None))
        dup = EmailAccount.objects.filter(tenant_id=tenant_id, sector=sector, is_active=True)
        if self.instance:
            dup = dup.exclude(pk=self.instance.pk)
        if dup.exists():
            raise serializers.ValidationError(
                {
                    "sector": "Este setor já tem uma caixa."
                    if sector
                    else "Já existe a caixa padrão da empresa."
                }
            )
        return attrs

    def _apply(self, instance, validated):
        from integrations.email import apply_preset

        password = validated.pop("password", None)
        changed_connection = any(
            k in validated
            for k in ("address", "smtp_host", "smtp_port", "smtp_security", "username")
        )
        for k, v in validated.items():
            setattr(instance, k, v)
        if password is not None and password != "" and not password.startswith(MASK):
            instance.password = password
            changed_connection = True
        apply_preset(instance)
        if changed_connection or not instance.configured:
            instance.status = EmailAccount.Status.PENDING
        instance.save()
        return instance

    def create(self, validated):
        return self._apply(EmailAccount(tenant_id=self.context["request"].tenant_id), validated)

    def update(self, instance, validated):
        return self._apply(instance, validated)


class OutboundEmailSerializer(_SectorInTenant, serializers.ModelSerializer):
    sector_name = serializers.CharField(source="sector.name", read_only=True, default="")
    from_address = serializers.CharField(source="account.address", read_only=True, default="")

    class Meta:
        model = OutboundEmail
        fields = [
            "id",
            "sector",
            "sector_name",
            "to",
            "cc",
            "subject",
            "body",
            "status",
            "origin",
            "requested_by",
            "approved_by",
            "from_address",
            "sent_at",
            "error",
            "created_at",
            "updated_at",
            "in_reply_to",
            "written_by_ai",
        ]
        read_only_fields = [
            "written_by_ai",
            "status",
            "origin",
            "requested_by",
            "approved_by",
            "from_address",
            "sent_at",
            "error",
            "created_at",
            "updated_at",
        ]

    def validate_in_reply_to(self, inbound):
        if inbound and inbound.tenant_id != self.context["request"].tenant_id:
            raise serializers.ValidationError("E-mail inválido.")
        return inbound

    def validate_to(self, value):
        if not isinstance(value, list) or not value:
            raise serializers.ValidationError("Informe pelo menos um destinatário.")
        field = serializers.EmailField()
        return [field.run_validation(v) for v in value]

    def validate_cc(self, value):
        field = serializers.EmailField()
        return [field.run_validation(v) for v in (value or [])]


class InboundEmailSerializer(serializers.ModelSerializer):
    sector_name = serializers.CharField(source="sector.name", read_only=True, default="")
    to_address = serializers.CharField(source="account.address", read_only=True, default="")
    replies = serializers.SerializerMethodField()

    class Meta:
        model = InboundEmail
        fields = [
            "id",
            "sector",
            "sector_name",
            "to_address",
            "message_id",
            "from_address",
            "from_name",
            "to",
            "cc",
            "subject",
            "body",
            "received_at",
            "is_read",
            "replies",
        ]
        read_only_fields = [f for f in fields if f != "is_read"]

    def get_replies(self, obj):
        """Respostas a este e-mail (rascunho, enviada...) — quem escreveu e se foi a IA."""
        return [
            {
                "id": r.id,
                "status": r.status,
                "written_by_ai": r.written_by_ai,
                "requested_by": r.requested_by,
                "approved_by": r.approved_by,
                "sent_at": r.sent_at,
            }
            for r in obj.replies.all()
            if r.status != OutboundEmail.Status.CANCELLED
        ]

# backend_api/Api/ingestion/serializers.py
from rest_framework import serializers

from ingestion.models import Document, KnowledgeSource, SourceSyncRun


class KnowledgeSourceSerializer(serializers.ModelSerializer):
    """
    Segredos (token, senha, chave) nunca saem: `config` volta com eles
    mascarados ("••••1234") e `secrets_set` diz quais estão salvos. Na escrita,
    o que é segredo vai cifrado pra `secret_config`; mandar o valor mascarado
    de volta mantém o salvo (ver ingestion.connectors.secrets).
    """

    secrets_set = serializers.SerializerMethodField()
    mode = serializers.SerializerMethodField()
    webhook_url = serializers.SerializerMethodField()
    document_count = serializers.SerializerMethodField()

    class Meta:
        model = KnowledgeSource
        fields = [
            "id", "name", "source_type", "config", "secrets_set", "mode", "public_id",
            "webhook_url",
            "sync_interval_minutes", "last_sync_status", "last_sync_message", "document_count",
            "last_synced_at", "is_active", "created_at",
        ]
        read_only_fields = [
            "id", "public_id", "last_sync_status", "last_sync_message", "last_synced_at",
            "created_at",
        ]

    def to_representation(self, instance):
        from ingestion.connectors.secrets import masked_view

        data = super().to_representation(instance)
        data["config"], _ = masked_view(instance)
        return data

    def get_secrets_set(self, obj) -> list[str]:
        from ingestion.connectors.secrets import masked_view

        return masked_view(obj)[1]

    def get_mode(self, obj) -> str:
        from ingestion.connectors import get_connector_class

        if obj.source_type in ("obsidian", "upload", "manual", "api"):
            return "documents"
        cls = get_connector_class(obj.source_type)
        return cls.mode if cls else "documents"

    def get_webhook_url(self, obj) -> str:
        if obj.source_type != KnowledgeSource.SourceType.WEBHOOK:
            return ""
        request = self.context.get("request")
        path = f"/api/v1/ingestion/webhooks/{obj.public_id}/"
        return request.build_absolute_uri(path) if request else path

    def get_document_count(self, obj) -> int:
        annotated = getattr(obj, "active_documents", None)
        return annotated if annotated is not None else obj.documents.filter(is_active=True).count()

    def validate_config(self, value):
        if not isinstance(value, dict):
            raise serializers.ValidationError("config deve ser um objeto JSON.")
        return value

    def validate_sync_interval_minutes(self, value):
        if value in (None, 0):
            return None
        if value < 5:
            raise serializers.ValidationError("O intervalo mínimo é de 5 minutos.")
        return value

    def validate(self, attrs):
        from ingestion.connectors import ConnectorError
        from ingestion.connectors.structured import validate_queries

        source_type = attrs.get("source_type") or getattr(self.instance, "source_type", "")
        config = attrs.get("config")
        if config is not None and source_type in ("sql", "hubspot", "salesforce"):
            try:
                config["consultas"] = validate_queries(source_type, config.get("consultas") or [])
            except ConnectorError as exc:
                raise serializers.ValidationError({"config": str(exc)})
        return attrs

    def _apply_config(self, instance, config):
        from harness.crypto import CredentialEncryptionError
        from ingestion.connectors.secrets import SECRET_FIELDS, split_config

        try:
            current = instance.get_secrets() if instance.pk else {}
        except CredentialEncryptionError:
            current = {}
        # Segredo antigo ainda em texto puro no config (antes da cifra) conta como salvo
        for name in SECRET_FIELDS.get(instance.source_type, []):
            if (instance.config or {}).get(name) and name not in current:
                current[name] = instance.config[name]
        public, secrets = split_config(instance.source_type, config, current)
        instance.config = public
        try:
            instance.set_secrets(secrets)
        except CredentialEncryptionError:
            raise serializers.ValidationError(
                {"config": "ENCRYPTION_KEY não configurada no servidor — sem ela não dá "
                           "pra guardar tokens e senhas."}
            )

    def create(self, validated_data):
        config = validated_data.pop("config", {})
        instance = KnowledgeSource(**validated_data)
        self._apply_config(instance, config)
        instance.save()
        return instance

    def update(self, instance, validated_data):
        config = validated_data.pop("config", None)
        validated_data.pop("source_type", None)  # tipo não muda depois de criado
        for k, v in validated_data.items():
            setattr(instance, k, v)
        if config is not None:
            self._apply_config(instance, config)
        instance.save()
        return instance


class SourceSyncRunSerializer(serializers.ModelSerializer):
    class Meta:
        model = SourceSyncRun
        fields = [
            "id", "trigger", "status", "started_at", "finished_at",
            "created", "updated", "unchanged", "removed", "message",
        ]
        read_only_fields = fields


class DocumentSerializer(serializers.ModelSerializer):
    source_name = serializers.CharField(source="source.name", read_only=True)

    class Meta:
        model = Document
        fields = [
            "id", "source", "source_name", "external_id", "title",
            "status", "error_message", "metadata", "indexed_at", "updated_at",
        ]
        read_only_fields = fields


class DocumentUploadSerializer(serializers.Serializer):
    """Upload manual de um documento avulso (fora do Obsidian)."""

    source_id = serializers.IntegerField()
    title = serializers.CharField(max_length=500)
    content = serializers.CharField()
    metadata = serializers.JSONField(required=False, default=dict)

    def validate_content(self, value):
        value = (value or "").strip()
        if not value:
            raise serializers.ValidationError("content não pode ser vazio.")
        if len(value) > 500_000:
            raise serializers.ValidationError("content excede o limite de 500k caracteres.")
        return value


class DocumentFileUploadSerializer(serializers.Serializer):
    """
    Upload de arquivo de verdade (PDF/imagem/documento) — diferente de
    DocumentUploadSerializer, que recebe texto já extraído. Extração de
    texto acontece na view: PDF de verdade (pypdf); qualquer outro tipo
    vira um Document com aviso claro de que não foi extraído
    automaticamente, nunca falha silenciosamente fingindo que leu algo.
    """

    source_id = serializers.IntegerField()
    file = serializers.FileField(max_length=255)

    def validate_file(self, value):
        max_size = 20 * 1024 * 1024  # 20 MB
        if value.size > max_size:
            raise serializers.ValidationError(f"Arquivo excede o limite de 20 MB (tem {value.size / 1024 / 1024:.1f} MB).")
        return value


class RAGQuerySerializer(serializers.Serializer):
    query = serializers.CharField(max_length=2000)
    top_k = serializers.IntegerField(required=False, min_value=1, max_value=20, default=5)
    generate_answer = serializers.BooleanField(required=False, default=False)
    source_ids = serializers.ListField(
        child=serializers.IntegerField(), required=False, default=list
    )

    def validate_query(self, value):
        return (value or "").strip()

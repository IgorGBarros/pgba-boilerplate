# backend_api/Api/ingestion/serializers.py
from rest_framework import serializers

from ingestion.models import KnowledgeSource, Document


class KnowledgeSourceSerializer(serializers.ModelSerializer):
    class Meta:
        model = KnowledgeSource
        fields = [
            "id", "name", "source_type", "config",
            "last_synced_at", "is_active", "created_at",
        ]
        read_only_fields = ["id", "last_synced_at", "created_at"]

    def validate_config(self, value):
        # Sanitização mínima: nunca aceitar vault_path fora de um allowlist
        # em produção. Ajuste conforme a política de infraestrutura do projeto.
        if not isinstance(value, dict):
            raise serializers.ValidationError("config deve ser um objeto JSON.")
        return value


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


class RAGQuerySerializer(serializers.Serializer):
    query = serializers.CharField(max_length=2000)
    top_k = serializers.IntegerField(required=False, min_value=1, max_value=20, default=5)
    generate_answer = serializers.BooleanField(required=False, default=False)

    def validate_query(self, value):
        return (value or "").strip()

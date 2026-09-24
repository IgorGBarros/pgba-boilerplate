from rest_framework import serializers
from crm.models import (
    Lead, Deal, Project, Contato, AtividadeCRM,
    Pipeline, Stage, LeadMessage,
    CustomFieldDefinition, CustomFieldValue,
)


class StageSerializer(serializers.ModelSerializer):
    leads_count = serializers.IntegerField(source="leads.count", read_only=True)
    deals_count = serializers.IntegerField(source="deals.count", read_only=True)
    projects_count = serializers.IntegerField(source="projects.count", read_only=True)

    class Meta:
        model = Stage
        fields = [
            "id", "pipeline", "main_stage", "name", "position",
            "color", "is_won", "is_lost",
            "leads_count", "deals_count", "projects_count",
        ]
        read_only_fields = ["id", "leads_count", "deals_count", "projects_count"]


class PipelineSerializer(serializers.ModelSerializer):
    stages = StageSerializer(many=True, read_only=True)

    class Meta:
        model = Pipeline
        fields = ["id", "name", "is_default", "stages"]
        read_only_fields = ["id"]


# ─── Custom Fields ────────────────────────────────────────────────────────────

class CustomFieldDefinitionSerializer(serializers.ModelSerializer):
    class Meta:
        model = CustomFieldDefinition
        fields = [
            "id", "entity_type", "name", "key", "field_type",
            "options", "required", "position", "is_active", "created_at",
        ]
        read_only_fields = ["id", "created_at"]


class CustomFieldValueSerializer(serializers.ModelSerializer):
    field_name = serializers.CharField(source="field_def.name", read_only=True)
    field_type = serializers.CharField(source="field_def.field_type", read_only=True)
    field_key = serializers.CharField(source="field_def.key", read_only=True)

    class Meta:
        model = CustomFieldValue
        fields = ["id", "field_def", "field_name", "field_key", "field_type", "entity_type", "entity_id", "value"]
        read_only_fields = ["id", "field_name", "field_key", "field_type"]


# ─── Lead ─────────────────────────────────────────────────────────────────────

class LeadSerializer(serializers.ModelSerializer):
    messages_count = serializers.IntegerField(source="messages.count", read_only=True)
    atividades_count = serializers.IntegerField(source="atividades.count", read_only=True)
    deals_count = serializers.IntegerField(source="deals.count", read_only=True)
    stage_name = serializers.CharField(source="stage.name", read_only=True)
    stage_main = serializers.CharField(source="stage.main_stage", read_only=True)
    stage_color = serializers.CharField(source="stage.color", read_only=True)
    stage_is_won = serializers.BooleanField(source="stage.is_won", read_only=True)
    stage_is_lost = serializers.BooleanField(source="stage.is_lost", read_only=True)
    custom_fields = serializers.SerializerMethodField()

    def get_custom_fields(self, obj):
        values = CustomFieldValue.objects.filter(
            entity_type="lead", entity_id=obj.id, tenant_id=obj.tenant_id
        ).select_related("field_def")
        return CustomFieldValueSerializer(values, many=True).data

    class Meta:
        model = Lead
        fields = [
            "id", "nome", "empresa", "email", "telefone", "cargo",
            "valor_estimado", "responsavel", "origem", "observacoes", "outcome",
            "pipeline", "stage", "position",
            "stage_name", "stage_main", "stage_color", "stage_is_won", "stage_is_lost",
            "messages_count", "atividades_count", "deals_count",
            "custom_fields", "created_at",
        ]
        read_only_fields = [
            "id", "messages_count", "atividades_count", "deals_count",
            "stage_name", "stage_main", "stage_color", "stage_is_won", "stage_is_lost",
            "custom_fields", "created_at",
        ]


class LeadMoveSerializer(serializers.Serializer):
    stage_id = serializers.IntegerField()


class LeadMessageSerializer(serializers.ModelSerializer):
    class Meta:
        model = LeadMessage
        fields = ["id", "role", "content", "created_at"]
        read_only_fields = ["id", "created_at"]


class QualifyLeadSerializer(serializers.Serializer):
    message = serializers.CharField()


# ─── Deal ─────────────────────────────────────────────────────────────────────

class DealSerializer(serializers.ModelSerializer):
    stage_name = serializers.CharField(source="stage.name", read_only=True)
    stage_main = serializers.CharField(source="stage.main_stage", read_only=True)
    stage_color = serializers.CharField(source="stage.color", read_only=True)
    stage_is_won = serializers.BooleanField(source="stage.is_won", read_only=True)
    stage_is_lost = serializers.BooleanField(source="stage.is_lost", read_only=True)
    lead_nome = serializers.CharField(source="lead.nome", read_only=True)
    lead_empresa = serializers.CharField(source="lead.empresa", read_only=True)
    projects_count = serializers.IntegerField(source="projects.count", read_only=True)
    custom_fields = serializers.SerializerMethodField()

    def get_custom_fields(self, obj):
        values = CustomFieldValue.objects.filter(
            entity_type="deal", entity_id=obj.id, tenant_id=obj.tenant_id
        ).select_related("field_def")
        return CustomFieldValueSerializer(values, many=True).data

    class Meta:
        model = Deal
        fields = [
            "id", "titulo", "empresa", "responsavel",
            "valor", "moeda", "data_fechamento_previsto", "observacoes", "outcome",
            "lead", "lead_nome", "lead_empresa",
            "pipeline", "stage", "position",
            "stage_name", "stage_main", "stage_color", "stage_is_won", "stage_is_lost",
            "projects_count", "custom_fields", "created_at",
        ]
        read_only_fields = [
            "id", "lead_nome", "lead_empresa", "projects_count",
            "stage_name", "stage_main", "stage_color", "stage_is_won", "stage_is_lost",
            "custom_fields", "created_at",
        ]


class DealMoveSerializer(serializers.Serializer):
    stage_id = serializers.IntegerField()


# ─── Project ──────────────────────────────────────────────────────────────────

class ProjectSerializer(serializers.ModelSerializer):
    stage_name = serializers.CharField(source="stage.name", read_only=True)
    stage_main = serializers.CharField(source="stage.main_stage", read_only=True)
    stage_color = serializers.CharField(source="stage.color", read_only=True)
    stage_is_won = serializers.BooleanField(source="stage.is_won", read_only=True)
    stage_is_lost = serializers.BooleanField(source="stage.is_lost", read_only=True)
    deal_titulo = serializers.CharField(source="deal.titulo", read_only=True)
    lead_nome = serializers.CharField(source="lead.nome", read_only=True)
    custom_fields = serializers.SerializerMethodField()

    def get_custom_fields(self, obj):
        values = CustomFieldValue.objects.filter(
            entity_type="project", entity_id=obj.id, tenant_id=obj.tenant_id
        ).select_related("field_def")
        return CustomFieldValueSerializer(values, many=True).data

    class Meta:
        model = Project
        fields = [
            "id", "titulo", "empresa", "responsavel",
            "data_inicio", "data_fim_previsto", "data_fim_realizado",
            "observacoes", "outcome",
            "deal", "deal_titulo", "lead", "lead_nome",
            "pipeline", "stage", "position",
            "stage_name", "stage_main", "stage_color", "stage_is_won", "stage_is_lost",
            "custom_fields", "created_at",
        ]
        read_only_fields = [
            "id", "deal_titulo", "lead_nome",
            "stage_name", "stage_main", "stage_color", "stage_is_won", "stage_is_lost",
            "custom_fields", "created_at",
        ]


class ProjectMoveSerializer(serializers.Serializer):
    stage_id = serializers.IntegerField()


# ─── Contato e Atividade ──────────────────────────────────────────────────────

class ContatoSerializer(serializers.ModelSerializer):
    lead_nome = serializers.CharField(source="lead.nome", read_only=True)

    class Meta:
        model = Contato
        fields = ["id", "nome", "empresa", "cargo", "email", "telefone", "lead", "lead_nome", "created_at"]
        read_only_fields = ["id", "lead_nome", "created_at"]


class AtividadeCRMSerializer(serializers.ModelSerializer):
    lead_nome = serializers.CharField(source="lead.nome", read_only=True)

    class Meta:
        model = AtividadeCRM
        fields = [
            "id", "titulo", "tipo", "lead", "lead_nome", "responsavel",
            "data_hora", "resultado", "created_at",
        ]
        read_only_fields = ["id", "lead_nome", "created_at"]

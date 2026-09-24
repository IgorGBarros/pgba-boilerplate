from rest_framework import serializers
from crm.models import Lead, Contato, Oportunidade, AtividadeCRM, Pipeline, Stage, LeadMessage


class StageSerializer(serializers.ModelSerializer):
    leads_count = serializers.IntegerField(source="leads.count", read_only=True)

    class Meta:
        model = Stage
        fields = [
            "id", "pipeline", "main_stage", "name", "position",
            "color", "is_won", "is_lost", "leads_count",
        ]
        read_only_fields = ["id", "leads_count"]


class PipelineSerializer(serializers.ModelSerializer):
    stages = StageSerializer(many=True, read_only=True)

    class Meta:
        model = Pipeline
        fields = ["id", "name", "is_default", "stages"]
        read_only_fields = ["id"]


class LeadSerializer(serializers.ModelSerializer):
    oportunidades_count = serializers.IntegerField(source="oportunidades.count", read_only=True)
    atividades_count = serializers.IntegerField(source="atividades.count", read_only=True)
    messages_count = serializers.IntegerField(source="messages.count", read_only=True)
    stage_name = serializers.CharField(source="stage.name", read_only=True)
    stage_main = serializers.CharField(source="stage.main_stage", read_only=True)
    stage_color = serializers.CharField(source="stage.color", read_only=True)
    stage_is_won = serializers.BooleanField(source="stage.is_won", read_only=True)
    stage_is_lost = serializers.BooleanField(source="stage.is_lost", read_only=True)

    class Meta:
        model = Lead
        fields = [
            "id", "nome", "empresa", "email", "telefone", "cargo",
            "valor_estimado", "responsavel", "origem", "observacoes",
            "pipeline", "stage", "position",
            "stage_name", "stage_main", "stage_color", "stage_is_won", "stage_is_lost",
            "oportunidades_count", "atividades_count", "messages_count",
            "created_at",
        ]
        read_only_fields = [
            "id", "oportunidades_count", "atividades_count", "messages_count",
            "stage_name", "stage_main", "stage_color", "stage_is_won", "stage_is_lost",
            "created_at",
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


class ContatoSerializer(serializers.ModelSerializer):
    lead_nome = serializers.CharField(source="lead.nome", read_only=True)

    class Meta:
        model = Contato
        fields = ["id", "nome", "empresa", "cargo", "email", "telefone", "lead", "lead_nome", "created_at"]
        read_only_fields = ["id", "lead_nome", "created_at"]


class OportunidadeSerializer(serializers.ModelSerializer):
    lead_nome = serializers.CharField(source="lead.nome", read_only=True)
    lead_empresa = serializers.CharField(source="lead.empresa", read_only=True)

    class Meta:
        model = Oportunidade
        fields = [
            "id", "titulo", "lead", "lead_nome", "lead_empresa", "valor", "status",
            "data_fechamento_previsto", "observacoes", "created_at",
        ]
        read_only_fields = ["id", "lead_nome", "lead_empresa", "created_at"]


class AtividadeCRMSerializer(serializers.ModelSerializer):
    lead_nome = serializers.CharField(source="lead.nome", read_only=True)

    class Meta:
        model = AtividadeCRM
        fields = [
            "id", "titulo", "tipo", "lead", "lead_nome", "responsavel",
            "data_hora", "resultado", "created_at",
        ]
        read_only_fields = ["id", "lead_nome", "created_at"]

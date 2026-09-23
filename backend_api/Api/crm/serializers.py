from rest_framework import serializers
from crm.models import Lead, Contato, Oportunidade, AtividadeCRM


class LeadSerializer(serializers.ModelSerializer):
    oportunidades_count = serializers.IntegerField(source="oportunidades.count", read_only=True)
    atividades_count = serializers.IntegerField(source="atividades.count", read_only=True)

    class Meta:
        model = Lead
        fields = [
            "id", "nome", "empresa", "email", "telefone", "cargo",
            "valor_estimado", "status", "responsavel", "origem", "observacoes",
            "oportunidades_count", "atividades_count", "created_at",
        ]
        read_only_fields = ["id", "oportunidades_count", "atividades_count", "created_at"]


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

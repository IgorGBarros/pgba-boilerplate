from rest_framework import serializers
from controladoria.models import CentroCusto, EntradaAuditoria, AlertaConformidade


class CentroCustoSerializer(serializers.ModelSerializer):
    desvio = serializers.SerializerMethodField()
    pct_consumido = serializers.SerializerMethodField()

    class Meta:
        model = CentroCusto
        fields = [
            "id", "nome", "codigo", "budget", "realizado", "tendencia",
            "desvio", "pct_consumido", "created_at",
        ]
        read_only_fields = ["id", "desvio", "pct_consumido", "created_at"]

    def get_desvio(self, obj):
        return float(obj.budget - obj.realizado)

    def get_pct_consumido(self, obj):
        if not obj.budget:
            return 0.0
        return round(float(obj.realizado / obj.budget) * 100, 2)


class EntradaAuditoriaSerializer(serializers.ModelSerializer):
    class Meta:
        model = EntradaAuditoria
        fields = [
            "id", "usuario", "modulo", "acao", "recurso", "ip",
            "detalhes", "criticidade", "created_at",
        ]
        read_only_fields = ["id", "created_at"]


class AlertaConformidadeSerializer(serializers.ModelSerializer):
    class Meta:
        model = AlertaConformidade
        fields = [
            "id", "titulo", "severidade", "tags", "descricao",
            "prazo", "status", "created_at",
        ]
        read_only_fields = ["id", "created_at"]

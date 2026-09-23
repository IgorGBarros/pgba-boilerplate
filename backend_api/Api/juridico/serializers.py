from rest_framework import serializers
from juridico.models import Processo, Contrato, Prazo


class ProcessoSerializer(serializers.ModelSerializer):
    class Meta:
        model = Processo
        fields = [
            "id", "titulo", "tipo", "status", "parte", "advogado", "foro",
            "risco", "valor_causa", "prazo_proximo", "observacoes", "created_at",
        ]
        read_only_fields = ["id", "created_at"]


class ContratoSerializer(serializers.ModelSerializer):
    class Meta:
        model = Contrato
        fields = [
            "id", "titulo", "tipo", "partes", "data_inicio", "data_fim",
            "valor_anual", "status", "renovacao", "observacoes", "created_at",
        ]
        read_only_fields = ["id", "created_at"]


class PrazoSerializer(serializers.ModelSerializer):
    processo_titulo = serializers.CharField(source="processo.titulo", read_only=True)
    contrato_titulo = serializers.CharField(source="contrato.titulo", read_only=True)

    class Meta:
        model = Prazo
        fields = [
            "id", "titulo", "tipo", "prazo", "urgencia", "responsavel", "descricao",
            "processo", "processo_titulo", "contrato", "contrato_titulo",
            "concluido", "created_at",
        ]
        read_only_fields = ["id", "processo_titulo", "contrato_titulo", "created_at"]

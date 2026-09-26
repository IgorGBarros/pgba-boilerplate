from django.utils import timezone
from rest_framework import serializers

from helpdesk.models import EquipamentoTI, InteracaoChamado, Ticket


class TicketSerializer(serializers.ModelSerializer):
    setor_nome = serializers.CharField(source="setor.name", read_only=True, default="")
    agente_nome = serializers.CharField(source="agente.name", read_only=True, default="")
    agente_status = serializers.CharField(source="agente.work_status", read_only=True, default="")
    task_status = serializers.CharField(source="task.status", read_only=True, default="")
    task_progresso = serializers.FloatField(source="task.progress", read_only=True, default=None)
    sla_restante_min = serializers.SerializerMethodField()
    sla_estourado = serializers.SerializerMethodField()
    interacoes_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = Ticket
        fields = [
            "id",
            "titulo",
            "descricao",
            "solicitante",
            "categoria",
            "prioridade",
            "status",
            "sla_horas",
            "prazo_sla",
            "sla_restante_min",
            "sla_estourado",
            "atendente",
            "setor",
            "setor_nome",
            "agente",
            "agente_nome",
            "agente_status",
            "task",
            "task_status",
            "task_progresso",
            "origem",
            "incidente_id",
            "primeira_resposta_em",
            "solucao",
            "interacoes_count",
            "created_at",
            "resolvido_em",
        ]
        read_only_fields = [
            "id",
            "created_at",
            "sla_horas",
            "prazo_sla",
            "atendente",
            "agente",
            "task",
            "origem",
            "incidente_id",
            "primeira_resposta_em",
            "solucao",
            "resolvido_em",
            "status",
        ]
        extra_kwargs = {"solicitante": {"required": False, "allow_blank": True}}

    def _fim(self, obj):
        return obj.resolvido_em or timezone.now()

    def get_sla_restante_min(self, obj):
        if not obj.prazo_sla:
            return None
        return int((obj.prazo_sla - self._fim(obj)).total_seconds() // 60)

    def get_sla_estourado(self, obj):
        return bool(obj.prazo_sla and self._fim(obj) > obj.prazo_sla)

    def validate_setor(self, value):
        request = self.context.get("request")
        if value and value.tenant_id != getattr(request, "tenant_id", None):
            raise serializers.ValidationError("Setor não encontrado.")
        return value


class InteracaoSerializer(serializers.ModelSerializer):
    tipo_display = serializers.CharField(source="get_tipo_display", read_only=True)

    class Meta:
        model = InteracaoChamado
        fields = ["id", "ticket", "tipo", "tipo_display", "autor", "texto", "dados", "created_at"]


class EquipamentoTISerializer(serializers.ModelSerializer):
    class Meta:
        model = EquipamentoTI
        fields = [
            "id",
            "codigo",
            "nome",
            "tipo",
            "usuario",
            "setor",
            "status",
            "ultima_revisao",
            "observacoes",
            "created_at",
        ]
        read_only_fields = ["id", "created_at"]

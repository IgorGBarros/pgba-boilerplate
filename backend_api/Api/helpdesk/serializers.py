from rest_framework import serializers
from helpdesk.models import Ticket, EquipamentoTI


class TicketSerializer(serializers.ModelSerializer):
    class Meta:
        model = Ticket
        fields = [
            "id", "titulo", "descricao", "solicitante", "categoria", "prioridade",
            "status", "sla_horas", "atendente", "created_at", "resolvido_em",
        ]
        read_only_fields = ["id", "created_at"]


class EquipamentoTISerializer(serializers.ModelSerializer):
    class Meta:
        model = EquipamentoTI
        fields = [
            "id", "codigo", "nome", "tipo", "usuario", "setor", "status",
            "ultima_revisao", "observacoes", "created_at",
        ]
        read_only_fields = ["id", "created_at"]

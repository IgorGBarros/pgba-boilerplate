from rest_framework import viewsets, filters
from rest_framework.permissions import IsAuthenticated
from django_filters.rest_framework import DjangoFilterBackend
from core.mixins import TenantContextMixin
from agency.views import TenantScopedMixin
from helpdesk.models import Ticket, EquipamentoTI
from helpdesk.serializers import TicketSerializer, EquipamentoTISerializer


class TicketViewSet(TenantContextMixin, TenantScopedMixin, viewsets.ModelViewSet):
    queryset = Ticket.objects.all()
    serializer_class = TicketSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["status", "prioridade", "categoria"]
    search_fields = ["titulo", "solicitante", "atendente"]
    ordering_fields = ["created_at", "prioridade", "sla_horas"]


class EquipamentoTIViewSet(TenantContextMixin, TenantScopedMixin, viewsets.ModelViewSet):
    queryset = EquipamentoTI.objects.all()
    serializer_class = EquipamentoTISerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["status", "tipo"]
    search_fields = ["codigo", "nome", "usuario", "setor"]
    ordering_fields = ["codigo", "nome", "ultima_revisao"]

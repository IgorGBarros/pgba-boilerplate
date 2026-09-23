from rest_framework import viewsets, filters
from rest_framework.permissions import IsAuthenticated
from django_filters.rest_framework import DjangoFilterBackend
from core.mixins import TenantContextMixin
from agency.views import TenantScopedMixin
from juridico.models import Processo, Contrato, Prazo
from juridico.serializers import ProcessoSerializer, ContratoSerializer, PrazoSerializer


class ProcessoViewSet(TenantContextMixin, TenantScopedMixin, viewsets.ModelViewSet):
    queryset = Processo.objects.all()
    serializer_class = ProcessoSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["status", "tipo", "risco"]
    search_fields = ["titulo", "parte", "advogado"]
    ordering_fields = ["created_at", "prazo_proximo", "valor_causa"]


class ContratoViewSet(TenantContextMixin, TenantScopedMixin, viewsets.ModelViewSet):
    queryset = Contrato.objects.all()
    serializer_class = ContratoSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["status", "tipo", "renovacao"]
    search_fields = ["titulo", "partes"]
    ordering_fields = ["created_at", "data_fim", "valor_anual"]


class PrazoViewSet(TenantContextMixin, TenantScopedMixin, viewsets.ModelViewSet):
    queryset = Prazo.objects.select_related("processo", "contrato").all()
    serializer_class = PrazoSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["tipo", "urgencia", "concluido", "processo", "contrato"]
    search_fields = ["titulo", "responsavel"]
    ordering_fields = ["prazo", "urgencia"]

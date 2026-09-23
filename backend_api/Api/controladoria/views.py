from rest_framework import viewsets, filters
from rest_framework.permissions import IsAuthenticated
from django_filters.rest_framework import DjangoFilterBackend
from core.mixins import TenantContextMixin
from agency.views import TenantScopedMixin
from controladoria.models import CentroCusto, EntradaAuditoria, AlertaConformidade
from controladoria.serializers import (
    CentroCustoSerializer, EntradaAuditoriaSerializer, AlertaConformidadeSerializer,
)


class CentroCustoViewSet(TenantContextMixin, TenantScopedMixin, viewsets.ModelViewSet):
    queryset = CentroCusto.objects.all()
    serializer_class = CentroCustoSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["tendencia"]
    search_fields = ["nome", "codigo"]
    ordering_fields = ["nome", "budget", "realizado"]


class EntradaAuditoriaViewSet(TenantContextMixin, TenantScopedMixin, viewsets.ModelViewSet):
    queryset = EntradaAuditoria.objects.all()
    serializer_class = EntradaAuditoriaSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["modulo", "acao", "criticidade"]
    search_fields = ["usuario", "recurso", "detalhes"]
    ordering_fields = ["created_at"]


class AlertaConformidadeViewSet(TenantContextMixin, TenantScopedMixin, viewsets.ModelViewSet):
    queryset = AlertaConformidade.objects.all()
    serializer_class = AlertaConformidadeSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["severidade", "status"]
    search_fields = ["titulo", "descricao"]
    ordering_fields = ["created_at", "prazo", "severidade"]

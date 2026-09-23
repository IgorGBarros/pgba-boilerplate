from rest_framework import viewsets, filters
from rest_framework.permissions import IsAuthenticated
from django_filters.rest_framework import DjangoFilterBackend
from core.mixins import TenantContextMixin
from agency.views import TenantScopedMixin
from crm.models import Lead, Contato, Oportunidade, AtividadeCRM
from crm.serializers import LeadSerializer, ContatoSerializer, OportunidadeSerializer, AtividadeCRMSerializer


class LeadViewSet(TenantContextMixin, TenantScopedMixin, viewsets.ModelViewSet):
    queryset = Lead.objects.all()
    serializer_class = LeadSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["status", "origem", "responsavel"]
    search_fields = ["nome", "empresa", "email"]
    ordering_fields = ["created_at", "valor_estimado", "status"]


class ContatoViewSet(TenantContextMixin, TenantScopedMixin, viewsets.ModelViewSet):
    queryset = Contato.objects.select_related("lead").all()
    serializer_class = ContatoSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["lead"]
    search_fields = ["nome", "empresa", "email"]
    ordering_fields = ["nome", "created_at"]


class OportunidadeViewSet(TenantContextMixin, TenantScopedMixin, viewsets.ModelViewSet):
    queryset = Oportunidade.objects.select_related("lead").all()
    serializer_class = OportunidadeSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["status", "lead"]
    search_fields = ["titulo"]
    ordering_fields = ["created_at", "valor", "data_fechamento_previsto"]


class AtividadeCRMViewSet(TenantContextMixin, TenantScopedMixin, viewsets.ModelViewSet):
    queryset = AtividadeCRM.objects.select_related("lead").all()
    serializer_class = AtividadeCRMSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["tipo", "lead", "responsavel"]
    search_fields = ["titulo", "responsavel"]
    ordering_fields = ["data_hora", "created_at"]

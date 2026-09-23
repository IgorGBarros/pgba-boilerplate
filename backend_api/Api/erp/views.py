from rest_framework import viewsets, filters
from rest_framework.permissions import IsAuthenticated
from django_filters.rest_framework import DjangoFilterBackend
from core.mixins import TenantContextMixin
from agency.views import TenantScopedMixin
from erp.models import Fornecedor, OrdemCompra, ItemEstoque, LancamentoFinanceiro, Funcionario
from erp.serializers import (
    FornecedorSerializer, OrdemCompraSerializer, ItemEstoqueSerializer,
    LancamentoFinanceiroSerializer, FuncionarioSerializer,
)


class FornecedorViewSet(TenantContextMixin, TenantScopedMixin, viewsets.ModelViewSet):
    queryset = Fornecedor.objects.all()
    serializer_class = FornecedorSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["categoria"]
    search_fields = ["nome", "cnpj", "email"]
    ordering_fields = ["nome", "created_at"]


class OrdemCompraViewSet(TenantContextMixin, TenantScopedMixin, viewsets.ModelViewSet):
    queryset = OrdemCompra.objects.select_related("fornecedor").all()
    serializer_class = OrdemCompraSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["status", "fornecedor"]
    search_fields = ["numero"]
    ordering_fields = ["data_emissao", "valor_total"]


class ItemEstoqueViewSet(TenantContextMixin, TenantScopedMixin, viewsets.ModelViewSet):
    queryset = ItemEstoque.objects.select_related("fornecedor").all()
    serializer_class = ItemEstoqueSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["categoria", "fornecedor"]
    search_fields = ["nome", "codigo"]
    ordering_fields = ["nome", "quantidade", "custo_unitario"]


class LancamentoFinanceiroViewSet(TenantContextMixin, TenantScopedMixin, viewsets.ModelViewSet):
    queryset = LancamentoFinanceiro.objects.all()
    serializer_class = LancamentoFinanceiroSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["tipo", "status", "categoria"]
    search_fields = ["descricao", "cliente", "fornecedor_nome", "numero_documento"]
    ordering_fields = ["vencimento", "valor", "created_at"]


class FuncionarioViewSet(TenantContextMixin, TenantScopedMixin, viewsets.ModelViewSet):
    queryset = Funcionario.objects.all()
    serializer_class = FuncionarioSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["status", "departamento"]
    search_fields = ["nome", "cargo", "email"]
    ordering_fields = ["nome", "data_admissao", "salario"]

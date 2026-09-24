import os

import httpx
from django.conf import settings
from rest_framework import viewsets, filters
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from django_filters.rest_framework import DjangoFilterBackend
from core.mixins import TenantContextMixin
from agency.views import TenantScopedMixin
from erp.models import Fornecedor, OrdemCompra, ItemEstoque, LancamentoFinanceiro, Funcionario, NotaFiscal, ObrigacaoFiscal, LinhaDRE, BalancetePeriodo
from erp.serializers import (
    FornecedorSerializer, OrdemCompraSerializer, ItemEstoqueSerializer,
    LancamentoFinanceiroSerializer, FuncionarioSerializer,
    NotaFiscalSerializer, ObrigacaoFiscalSerializer,
    LinhaDRESerializer, BalancetePeriodoSerializer,
)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def brapi_quote_proxy(request, ticker: str):
    """Proxy para brapi.dev/api/quote/<ticker> — mantém o BRAPI_TOKEN server-side."""
    token = getattr(settings, "BRAPI_TOKEN", None) or os.environ.get("BRAPI_TOKEN", "")
    params = {k: v for k, v in request.GET.items()}
    if token:
        params["token"] = token
    try:
        r = httpx.get(
            f"https://brapi.dev/api/quote/{ticker}",
            params=params,
            timeout=10,
        )
        return Response(r.json(), status=r.status_code)
    except httpx.RequestError:
        return Response({"error": "upstream_unavailable"}, status=502)


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


class NotaFiscalViewSet(TenantContextMixin, TenantScopedMixin, viewsets.ModelViewSet):
    queryset = NotaFiscal.objects.all()
    serializer_class = NotaFiscalSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["status"]
    search_fields = ["numero", "cliente", "cfop"]
    ordering_fields = ["emissao", "valor"]


class ObrigacaoFiscalViewSet(TenantContextMixin, TenantScopedMixin, viewsets.ModelViewSet):
    queryset = ObrigacaoFiscal.objects.all()
    serializer_class = ObrigacaoFiscalSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["status"]
    search_fields = ["nome", "orgao", "competencia"]
    ordering_fields = ["vencimento"]


class LinhaDREViewSet(TenantContextMixin, TenantScopedMixin, viewsets.ModelViewSet):
    queryset = LinhaDRE.objects.all()
    serializer_class = LinhaDRESerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ["tipo", "competencia"]
    ordering_fields = ["competencia", "ordem"]


class BalancetePeriodoViewSet(TenantContextMixin, TenantScopedMixin, viewsets.ModelViewSet):
    queryset = BalancetePeriodo.objects.all()
    serializer_class = BalancetePeriodoSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ["competencia"]
    ordering_fields = ["competencia"]

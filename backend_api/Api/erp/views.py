import os

import httpx
from django.conf import settings
from rest_framework import viewsets, filters, status
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from django_filters.rest_framework import DjangoFilterBackend
from core.mixins import TenantContextMixin
from agency.views import TenantScopedMixin
from erp.models import Fornecedor, OrdemCompra, ItemEstoque, MovimentacaoEstoque, LancamentoFinanceiro, Funcionario, NotaFiscal, ObrigacaoFiscal, LinhaDRE, BalancetePeriodo
from erp.serializers import (
    FornecedorSerializer, OrdemCompraSerializer, ItemEstoqueSerializer,
    MovimentacaoEstoqueSerializer, RegistrarMovimentacaoSerializer,
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
    queryset = ItemEstoque.objects.select_related("fornecedor").filter(is_active=True)
    serializer_class = ItemEstoqueSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["categoria", "fornecedor"]
    search_fields = ["nome", "codigo"]
    ordering_fields = ["nome", "quantidade", "custo_unitario"]

    def perform_create(self, serializer):
        serializer.save(tenant_id=self.request.tenant_id)


class MovimentacaoEstoqueViewSet(TenantContextMixin, TenantScopedMixin, viewsets.ReadOnlyModelViewSet):
    queryset = MovimentacaoEstoque.objects.select_related("item").all()
    serializer_class = MovimentacaoEstoqueSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ["tipo", "item"]
    ordering_fields = ["created_at"]

    @action(detail=False, methods=["post"], url_path="registrar")
    def registrar(self, request):
        ser = RegistrarMovimentacaoSerializer(data=request.data)
        ser.is_valid(raise_exception=True)

        try:
            item = ItemEstoque.objects.get(
                id=ser.validated_data["item_id"],
                tenant_id=request.tenant_id,
                is_active=True,
            )
        except ItemEstoque.DoesNotExist:
            return Response({"detail": "Item não encontrado."}, status=status.HTTP_404_NOT_FOUND)

        from decimal import Decimal
        from django.utils import timezone as tz

        tipo = ser.validated_data["tipo"]
        qtd = ser.validated_data["quantidade"]
        valor_unitario = ser.validated_data.get("valor_unitario")
        qtd_anterior = item.quantidade

        if tipo == "entrada":
            if valor_unitario is not None and qtd_anterior >= 0:
                total_anterior = Decimal(qtd_anterior) * item.custo_medio
                total_novo = Decimal(qtd) * valor_unitario
                item.custo_medio = (total_anterior + total_novo) / Decimal(qtd_anterior + qtd)
                item.data_ultima_compra = tz.now().date()
            item.quantidade += qtd
        elif tipo == "saida":
            if item.quantidade < qtd:
                return Response(
                    {"detail": f"Estoque insuficiente. Disponível: {item.quantidade}."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            item.quantidade -= qtd
        elif tipo == "ajuste":
            item.quantidade = qtd
        elif tipo == "transferencia":
            item.quantidade -= qtd

        item.save()

        mov = MovimentacaoEstoque.objects.create(
            tenant_id=request.tenant_id,
            item=item,
            tipo=tipo,
            quantidade=qtd,
            quantidade_anterior=qtd_anterior,
            quantidade_posterior=item.quantidade,
            valor_unitario=valor_unitario,
            motivo=ser.validated_data["motivo"],
            referencia=ser.validated_data["referencia"],
            operador=ser.validated_data.get("operador", ""),
        )
        return Response(MovimentacaoEstoqueSerializer(mov).data, status=status.HTTP_201_CREATED)


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

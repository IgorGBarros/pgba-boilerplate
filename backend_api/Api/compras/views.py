from rest_framework import viewsets, filters, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from django_filters.rest_framework import DjangoFilterBackend

from core.mixins import TenantContextMixin
from agency.views import TenantScopedMixin
from compras.models import Fornecedor, ItemNecessario, Orcamento, PedidoCompra
from compras.serializers import (
    FornecedorSerializer,
    ItemNecessarioSerializer,
    OrcamentoSerializer,
    PedidoCompraSerializer,
    BuscarFornecedoresSerializer,
    CriarOrcamentoSerializer,
    AprovarOrcamentoSerializer,
    RegistrarRespostaSerializer,
    GerarPedidoSerializer,
)
from compras.services import (
    buscar_e_salvar_fornecedores,
    criar_orcamento,
    marcar_orcamento_enviado,
    registrar_resposta_orcamento,
    aprovar_orcamento,
    rejeitar_orcamento,
    gerar_pedido_compra,
)


class FornecedorViewSet(TenantContextMixin, TenantScopedMixin, viewsets.ModelViewSet):
    queryset = Fornecedor.objects.filter(is_active=True)
    serializer_class = FornecedorSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ["source", "cidade"]
    search_fields = ["nome", "categoria", "cidade"]

    def perform_create(self, serializer):
        serializer.save(tenant_id=self.request.tenant_id)

    @action(detail=False, methods=["post"], url_path="buscar-osm")
    def buscar_osm(self, request):
        """Busca fornecedores via OpenStreetMap e os salva no banco."""
        ser = BuscarFornecedoresSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        fornecedores = buscar_e_salvar_fornecedores(
            tenant_id=request.tenant_id,
            material=ser.validated_data["material"],
            cidade=ser.validated_data["cidade"],
            raio_km=ser.validated_data["raio_km"],
        )
        return Response(FornecedorSerializer(fornecedores, many=True).data)


class ItemNecessarioViewSet(TenantContextMixin, TenantScopedMixin, viewsets.ModelViewSet):
    queryset = ItemNecessario.objects.all()
    serializer_class = ItemNecessarioSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ["deal", "tem_estoque"]
    search_fields = ["nome", "categoria"]

    def perform_create(self, serializer):
        serializer.save(tenant_id=self.request.tenant_id)


class OrcamentoViewSet(TenantContextMixin, TenantScopedMixin, viewsets.ModelViewSet):
    queryset = Orcamento.objects.select_related("fornecedor", "deal").prefetch_related("itens")
    serializer_class = OrcamentoSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ["deal", "fornecedor", "status"]

    def perform_create(self, serializer):
        serializer.save(tenant_id=self.request.tenant_id)

    @action(detail=False, methods=["post"], url_path="criar-completo")
    def criar_completo(self, request):
        """Cria orçamento com itens em uma única chamada."""
        ser = CriarOrcamentoSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        deal_id = request.data.get("deal_id")
        if not deal_id:
            return Response({"detail": "deal_id é obrigatório."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            orc = criar_orcamento(
                tenant_id=request.tenant_id,
                deal_id=deal_id,
                fornecedor_id=ser.validated_data["fornecedor_id"],
                itens=ser.validated_data["itens"],
            )
        except Exception as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(OrcamentoSerializer(orc).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="enviar")
    def enviar(self, request, pk=None):
        try:
            orc = marcar_orcamento_enviado(pk, request.tenant_id)
        except Exception as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(OrcamentoSerializer(orc).data)

    @action(detail=True, methods=["post"], url_path="registrar-resposta")
    def registrar_resposta(self, request, pk=None):
        ser = RegistrarRespostaSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        try:
            orc = registrar_resposta_orcamento(
                orcamento_id=pk,
                tenant_id=request.tenant_id,
                valor_total=float(ser.validated_data["valor_total"]),
                prazo_entrega_dias=ser.validated_data["prazo_entrega_dias"],
                itens_precos=ser.validated_data["itens_precos"],
                observacoes=ser.validated_data["observacoes"],
            )
        except Exception as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(OrcamentoSerializer(orc).data)

    @action(detail=True, methods=["post"], url_path="aprovar")
    def aprovar(self, request, pk=None):
        ser = AprovarOrcamentoSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        try:
            orc = aprovar_orcamento(pk, request.tenant_id, ser.validated_data["aprovado_por"])
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(OrcamentoSerializer(orc).data)

    @action(detail=True, methods=["post"], url_path="rejeitar")
    def rejeitar(self, request, pk=None):
        try:
            orc = rejeitar_orcamento(pk, request.tenant_id)
        except Exception as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(OrcamentoSerializer(orc).data)

    @action(detail=True, methods=["post"], url_path="gerar-pedido")
    def gerar_pedido(self, request, pk=None):
        ser = GerarPedidoSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        try:
            pedido = gerar_pedido_compra(
                orcamento_id=pk,
                tenant_id=request.tenant_id,
                project_id=ser.validated_data.get("project_id"),
            )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(PedidoCompraSerializer(pedido).data, status=status.HTTP_201_CREATED)


class PedidoCompraViewSet(TenantContextMixin, TenantScopedMixin, viewsets.ModelViewSet):
    queryset = PedidoCompra.objects.select_related(
        "orcamento__fornecedor", "orcamento__deal", "project"
    ).filter(is_active=True)
    serializer_class = PedidoCompraSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ["status", "project"]

    def perform_create(self, serializer):
        serializer.save(tenant_id=self.request.tenant_id)

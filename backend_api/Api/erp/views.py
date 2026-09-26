import os

import httpx
from django.conf import settings
from rest_framework import viewsets, filters, status
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from django_filters.rest_framework import DjangoFilterBackend
from django.db.models import Prefetch
from core.mixins import SoftDeleteViewMixin, TenantContextMixin
from agency.views import TenantScopedMixin
from erp import services
from erp.models import (
    BalancetePeriodo,
    ContratoServico,
    Funcionario,
    ItemContrato,
    ItemEstoque,
    LancamentoFinanceiro,
    LinhaDRE,
    MovimentacaoEstoque,
    NotaFiscal,
    ObrigacaoFiscal,
    OrdemCompra,
    ParceiroNegocio,
)
from erp.serializers import (
    BalancetePeriodoSerializer,
    ContratoServicoSerializer,
    DadosEmpresaSerializer,
    FuncionarioSerializer,
    ItemContratoSerializer,
    ItemEstoqueSerializer,
    LancamentoFinanceiroSerializer,
    LinhaDRESerializer,
    MovimentacaoEstoqueSerializer,
    NotaFiscalSerializer,
    ObrigacaoFiscalSerializer,
    OrdemCompraSerializer,
    ParceiroNegocioSerializer,
    RegistrarMovimentacaoSerializer,
)
from rest_framework.pagination import PageNumberPagination
from rest_framework.views import APIView


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


class ErpPagination(PageNumberPagination):
    """20 por padrão (como o resto da API), mas a tela pode pedir até 500 com `?page_size=`."""

    page_size = 20
    page_size_query_param = "page_size"
    max_page_size = 500


class ErpViewSet(TenantContextMixin, SoftDeleteViewMixin, TenantScopedMixin, viewsets.ModelViewSet):
    """Base do ERP: filtra tenant, esconde excluído, DELETE é exclusão lógica."""

    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    pagination_class = ErpPagination


def _erro(exc):
    return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)


class ParceiroNegocioViewSet(ErpViewSet):
    """Parceiros de negócio (SAP B1): clientes, fornecedores e leads."""

    queryset = ParceiroNegocio.objects.all()
    serializer_class = ParceiroNegocioSerializer
    filterset_fields = ["tipo", "categoria", "uf"]
    search_fields = ["codigo", "nome", "nome_fantasia", "cpf_cnpj", "email", "municipio"]
    ordering_fields = ["nome", "codigo", "created_at"]


class FornecedorViewSet(ParceiroNegocioViewSet):
    """Rota antiga `/erp/fornecedores/` — os mesmos parceiros, só os fornecedores."""

    def get_queryset(self):
        return super().get_queryset().filter(tipo=ParceiroNegocio.Tipo.FORNECEDOR)

    def perform_create(self, serializer):
        serializer.save(tenant_id=self.request.tenant_id, tipo=ParceiroNegocio.Tipo.FORNECEDOR)


class OrdemCompraViewSet(ErpViewSet):
    queryset = OrdemCompra.objects.select_related("fornecedor").all()
    serializer_class = OrdemCompraSerializer
    filterset_fields = ["status", "fornecedor"]
    search_fields = ["numero"]
    ordering_fields = ["data_emissao", "valor_total"]


class ItemEstoqueViewSet(ErpViewSet):
    """Cadastro de itens: material (com estoque) e serviço (sem estoque)."""

    queryset = ItemEstoque.objects.select_related("fornecedor").all()
    serializer_class = ItemEstoqueSerializer
    filterset_fields = ["categoria", "fornecedor", "tipo_item"]
    search_fields = ["nome", "codigo"]
    ordering_fields = ["nome", "quantidade", "custo_unitario", "preco_venda"]


class MovimentacaoEstoqueViewSet(
    TenantContextMixin, TenantScopedMixin, viewsets.ReadOnlyModelViewSet
):
    queryset = MovimentacaoEstoque.objects.select_related("item").all()
    serializer_class = MovimentacaoEstoqueSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ["tipo", "item"]
    ordering_fields = ["created_at"]
    pagination_class = ErpPagination

    @action(detail=False, methods=["post"], url_path="registrar")
    def registrar(self, request):
        ser = RegistrarMovimentacaoSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        try:
            item = ItemEstoque.objects.get(
                id=data["item_id"], tenant_id=request.tenant_id, is_active=True
            )
        except ItemEstoque.DoesNotExist:
            return Response({"detail": "Item não encontrado."}, status=status.HTTP_404_NOT_FOUND)
        try:
            mov = services.registrar_movimentacao(
                request.tenant_id,
                item,
                data["tipo"],
                data["quantidade"],
                valor_unitario=data.get("valor_unitario"),
                motivo=data["motivo"],
                referencia=data["referencia"],
                operador=data.get("operador", ""),
            )
        except services.ErpError as exc:
            return _erro(exc)
        return Response(MovimentacaoEstoqueSerializer(mov).data, status=status.HTTP_201_CREATED)


class LancamentoFinanceiroViewSet(ErpViewSet):
    queryset = LancamentoFinanceiro.objects.select_related(
        "parceiro", "contrato", "projeto", "centro_custo", "setor"
    ).all()
    serializer_class = LancamentoFinanceiroSerializer
    filterset_fields = [
        "tipo",
        "status",
        "categoria",
        "parceiro",
        "contrato",
        "projeto",
        "centro_custo",
        "setor",
        "origem",
    ]
    search_fields = ["descricao", "cliente", "fornecedor_nome", "numero_documento"]
    ordering_fields = ["vencimento", "valor", "created_at"]


class FuncionarioViewSet(ErpViewSet):
    queryset = Funcionario.objects.select_related("setor", "centro_custo").all()
    serializer_class = FuncionarioSerializer
    filterset_fields = ["status", "departamento", "setor"]
    search_fields = ["nome", "cargo", "email"]
    ordering_fields = ["nome", "data_admissao", "salario"]


class NotaFiscalViewSet(ErpViewSet):
    queryset = NotaFiscal.objects.select_related("contrato", "parceiro").all()
    serializer_class = NotaFiscalSerializer
    filterset_fields = ["status", "tipo", "contrato", "parceiro"]
    search_fields = ["numero", "cliente", "cfop", "codigo_servico"]
    ordering_fields = ["emissao", "valor"]


class ObrigacaoFiscalViewSet(ErpViewSet):
    queryset = ObrigacaoFiscal.objects.all()
    serializer_class = ObrigacaoFiscalSerializer
    filterset_fields = ["status"]
    search_fields = ["nome", "orgao", "competencia"]
    ordering_fields = ["vencimento"]


class LinhaDREViewSet(ErpViewSet):
    queryset = LinhaDRE.objects.all()
    serializer_class = LinhaDRESerializer
    filterset_fields = ["tipo", "competencia"]
    ordering_fields = ["competencia", "ordem"]


class BalancetePeriodoViewSet(ErpViewSet):
    queryset = BalancetePeriodo.objects.all()
    serializer_class = BalancetePeriodoSerializer
    filterset_fields = ["competencia"]
    ordering_fields = ["competencia"]


# ─── Contratos de serviço ────────────────────────────────────────────────────


class ContratoServicoViewSet(ErpViewSet):
    """
    Contratos de serviço (com ou sem material). Ações: ativar/suspender/
    encerrar/cancelar, parcelas previstas, gerar faturas, baixar material,
    gerar NF (rascunho) e criar a partir de um projeto do CRM.
    """

    queryset = ContratoServico.objects.select_related(
        "parceiro", "projeto", "centro_custo", "setor"
    ).prefetch_related(
        Prefetch("itens", queryset=ItemContrato.objects.select_related("item")),
        "lancamentos",
        "notas_fiscais",
    )
    serializer_class = ContratoServicoSerializer
    filterset_fields = ["status", "parceiro", "projeto", "com_material", "setor", "centro_custo"]
    search_fields = ["numero", "nome_projeto", "descricao", "parceiro__nome"]
    ordering_fields = ["data_inicio", "data_fim", "valor_total", "numero"]

    def perform_destroy(self, instance):
        if instance.status in (ContratoServico.Status.ATIVO, ContratoServico.Status.SUSPENSO):
            from rest_framework.exceptions import ValidationError

            raise ValidationError(
                {"detail": "Contrato em vigor — cancele ou encerre antes de excluir."}
            )
        super().perform_destroy(instance)

    def _responder(self, contrato):
        contrato = self.get_queryset().get(pk=contrato.pk)
        return Response(self.get_serializer(contrato).data)

    def _mudar(self, request, novo):
        contrato = self.get_object()
        try:
            services.mudar_status(contrato, novo)
        except services.ErpError as exc:
            return _erro(exc)
        return self._responder(contrato)

    @action(detail=True, methods=["post"])
    def ativar(self, request, pk=None):
        return self._mudar(request, ContratoServico.Status.ATIVO)

    @action(detail=True, methods=["post"])
    def suspender(self, request, pk=None):
        return self._mudar(request, ContratoServico.Status.SUSPENSO)

    @action(detail=True, methods=["post"])
    def encerrar(self, request, pk=None):
        return self._mudar(request, ContratoServico.Status.ENCERRADO)

    @action(detail=True, methods=["post"])
    def cancelar(self, request, pk=None):
        return self._mudar(request, ContratoServico.Status.CANCELADO)

    @action(detail=True, methods=["get"], url_path="parcelas")
    def parcelas(self, request, pk=None):
        contrato = self.get_object()
        return Response(services.parcelas_previstas(contrato))

    @action(detail=True, methods=["post"], url_path="gerar-faturas")
    def gerar_faturas(self, request, pk=None):
        contrato = self.get_object()
        try:
            criadas = services.gerar_faturas(contrato)
        except services.ErpError as exc:
            return _erro(exc)
        return Response(
            {
                "criadas": LancamentoFinanceiroSerializer(criadas, many=True).data,
                "contrato": self.get_serializer(self.get_queryset().get(pk=contrato.pk)).data,
            },
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["post"], url_path="baixar-material")
    def baixar_material(self, request, pk=None):
        contrato = self.get_object()
        operador = getattr(request.user, "name", "") or getattr(request.user, "email", "")
        try:
            movs = services.baixar_material(contrato, operador=operador)
        except services.ErpError as exc:
            return _erro(exc)
        return Response(
            {
                "movimentacoes": MovimentacaoEstoqueSerializer(movs, many=True).data,
                "contrato": self.get_serializer(self.get_queryset().get(pk=contrato.pk)).data,
            }
        )

    @action(detail=True, methods=["post"], url_path="gerar-nota-fiscal")
    def gerar_nota_fiscal(self, request, pk=None):
        contrato = self.get_object()
        lancamento = None
        lanc_id = request.data.get("lancamento")
        if lanc_id:
            lancamento = LancamentoFinanceiro.objects.filter(
                id=lanc_id, tenant_id=request.tenant_id, is_active=True
            ).first()
            if lancamento is None:
                return Response(
                    {"detail": "Fatura não encontrada."}, status=status.HTTP_404_NOT_FOUND
                )
        try:
            nf = services.gerar_nota_fiscal(contrato, lancamento)
        except services.ErpError as exc:
            return _erro(exc)
        return Response(NotaFiscalSerializer(nf).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["get"], url_path="projetos-pendentes")
    def projetos_pendentes(self, request):
        projetos = services.projetos_aguardando_contrato(request.tenant_id)
        return Response(
            [
                {
                    "id": p.id,
                    "titulo": p.titulo,
                    "empresa": p.empresa,
                    "responsavel": p.responsavel,
                    "data_inicio": p.data_inicio,
                    "data_fim_previsto": p.data_fim_previsto,
                    "valor": float(p.deal.valor) if p.deal and p.deal.valor else None,
                    "contrato_com_material": p.contrato_com_material,
                    "observacoes": p.observacoes,
                }
                for p in projetos
            ]
        )

    @action(detail=False, methods=["post"], url_path="de-projeto")
    def de_projeto(self, request):
        project_id = request.data.get("projeto")
        if not project_id:
            return Response(
                {"projeto": "Informe o projeto do CRM."}, status=status.HTTP_400_BAD_REQUEST
            )
        try:
            contrato = services.contrato_de_projeto(request.tenant_id, int(project_id))
        except (services.ErpError, ValueError) as exc:
            return _erro(exc)
        return Response(
            self.get_serializer(self.get_queryset().get(pk=contrato.pk)).data,
            status=status.HTTP_201_CREATED,
        )


class ItemContratoViewSet(TenantContextMixin, TenantScopedMixin, viewsets.ModelViewSet):
    """Linhas do contrato — cada mudança recalcula o valor do contrato."""

    queryset = ItemContrato.objects.select_related("item", "contrato").filter(
        contrato__is_active=True
    )
    serializer_class = ItemContratoSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ["contrato", "tipo"]
    pagination_class = ErpPagination

    def perform_create(self, serializer):
        linha = serializer.save(tenant_id=self.request.tenant_id)
        services.recalcular_valor(linha.contrato)

    def perform_update(self, serializer):
        linha = serializer.save()
        services.recalcular_valor(linha.contrato)

    def perform_destroy(self, instance):
        # Linha é parte do documento (ItemContrato não tem soft delete próprio);
        # o histórico dela fica no simple_history. Linha já baixada do estoque não sai.
        from rest_framework.exceptions import ValidationError

        if instance.quantidade_baixada > 0:
            raise ValidationError(
                {"detail": "Material já baixado do estoque — a linha não pode sair."}
            )
        if instance.contrato.status not in (
            ContratoServico.Status.RASCUNHO,
            ContratoServico.Status.SUSPENSO,
        ):
            raise ValidationError(
                {"detail": "Só dá pra remover linha de contrato em rascunho ou suspenso."}
            )
        contrato = instance.contrato
        instance.delete()
        services.recalcular_valor(contrato)


class DadosEmpresaView(TenantContextMixin, APIView):
    """Dados da empresa emitente (um por tenant): GET e PUT/PATCH."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(DadosEmpresaSerializer(services.dados_empresa(request.tenant_id)).data)

    def put(self, request):
        ser = DadosEmpresaSerializer(
            services.dados_empresa(request.tenant_id), data=request.data, partial=True
        )
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(ser.data)

    patch = put


class ProntidaoNotaFiscalView(TenantContextMixin, APIView):
    """O que falta pra emitir NFS-e (só confere o banco — não chama emissor nenhum)."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(services.prontidao_nota_fiscal(request.tenant_id))

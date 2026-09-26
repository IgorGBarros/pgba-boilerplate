from django.urls import include, path
from rest_framework.routers import DefaultRouter

from erp.views import (
    BalancetePeriodoViewSet,
    ContratoServicoViewSet,
    DadosEmpresaView,
    FornecedorViewSet,
    FuncionarioViewSet,
    ItemContratoViewSet,
    ItemEstoqueViewSet,
    LancamentoFinanceiroViewSet,
    LinhaDREViewSet,
    MovimentacaoEstoqueViewSet,
    NotaFiscalViewSet,
    ObrigacaoFiscalViewSet,
    OrdemCompraViewSet,
    ParceiroNegocioViewSet,
    ProntidaoNotaFiscalView,
    brapi_quote_proxy,
)

router = DefaultRouter()
router.register("parceiros", ParceiroNegocioViewSet, basename="parceiro-negocio")
router.register("fornecedores", FornecedorViewSet, basename="fornecedor")
router.register("ordens-compra", OrdemCompraViewSet, basename="ordem-compra")
router.register("estoque", ItemEstoqueViewSet, basename="item-estoque")
router.register(
    "movimentacoes-estoque", MovimentacaoEstoqueViewSet, basename="movimentacao-estoque"
)
router.register("financeiro", LancamentoFinanceiroViewSet, basename="lancamento-financeiro")
router.register("funcionarios", FuncionarioViewSet, basename="funcionario")
router.register("notas-fiscais", NotaFiscalViewSet, basename="nota-fiscal")
router.register("obrigacoes-fiscais", ObrigacaoFiscalViewSet, basename="obrigacao-fiscal")
router.register("linhas-dre", LinhaDREViewSet, basename="linha-dre")
router.register("balancete", BalancetePeriodoViewSet, basename="balancete-periodo")
router.register("contratos", ContratoServicoViewSet, basename="contrato-servico")
router.register("contratos-itens", ItemContratoViewSet, basename="item-contrato")

urlpatterns = [
    path("", include(router.urls)),
    path("empresa/", DadosEmpresaView.as_view(), name="erp-dados-empresa"),
    path("fiscal/prontidao/", ProntidaoNotaFiscalView.as_view(), name="erp-prontidao-nf"),
    path("market/quote/<str:ticker>/", brapi_quote_proxy, name="brapi-quote-proxy"),
]

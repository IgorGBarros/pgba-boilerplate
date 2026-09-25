from django.urls import path, include
from rest_framework.routers import DefaultRouter
from erp.views import (
    FornecedorViewSet, OrdemCompraViewSet, ItemEstoqueViewSet, MovimentacaoEstoqueViewSet,
    LancamentoFinanceiroViewSet, FuncionarioViewSet,
    NotaFiscalViewSet, ObrigacaoFiscalViewSet,
    LinhaDREViewSet, BalancetePeriodoViewSet,
    brapi_quote_proxy,
)

router = DefaultRouter()
router.register("fornecedores", FornecedorViewSet, basename="fornecedor")
router.register("ordens-compra", OrdemCompraViewSet, basename="ordem-compra")
router.register("estoque", ItemEstoqueViewSet, basename="item-estoque")
router.register("movimentacoes-estoque", MovimentacaoEstoqueViewSet, basename="movimentacao-estoque")
router.register("financeiro", LancamentoFinanceiroViewSet, basename="lancamento-financeiro")
router.register("funcionarios", FuncionarioViewSet, basename="funcionario")
router.register("notas-fiscais", NotaFiscalViewSet, basename="nota-fiscal")
router.register("obrigacoes-fiscais", ObrigacaoFiscalViewSet, basename="obrigacao-fiscal")
router.register("linhas-dre", LinhaDREViewSet, basename="linha-dre")
router.register("balancete", BalancetePeriodoViewSet, basename="balancete-periodo")

urlpatterns = [
    path("", include(router.urls)),
    path("market/quote/<str:ticker>/", brapi_quote_proxy, name="brapi-quote-proxy"),
]

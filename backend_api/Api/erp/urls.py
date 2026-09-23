from django.urls import path, include
from rest_framework.routers import DefaultRouter
from erp.views import (
    FornecedorViewSet, OrdemCompraViewSet, ItemEstoqueViewSet,
    LancamentoFinanceiroViewSet, FuncionarioViewSet,
)

router = DefaultRouter()
router.register("fornecedores", FornecedorViewSet, basename="fornecedor")
router.register("ordens-compra", OrdemCompraViewSet, basename="ordem-compra")
router.register("estoque", ItemEstoqueViewSet, basename="item-estoque")
router.register("financeiro", LancamentoFinanceiroViewSet, basename="lancamento-financeiro")
router.register("funcionarios", FuncionarioViewSet, basename="funcionario")

urlpatterns = [path("", include(router.urls))]

from django.urls import path, include
from rest_framework.routers import DefaultRouter
from compras.views import (
    FornecedorViewSet,
    ItemNecessarioViewSet,
    OrcamentoViewSet,
    PedidoCompraViewSet,
)

router = DefaultRouter()
router.register("fornecedores", FornecedorViewSet, basename="fornecedor")
router.register("itens-necessarios", ItemNecessarioViewSet, basename="item-necessario")
router.register("orcamentos", OrcamentoViewSet, basename="orcamento")
router.register("pedidos", PedidoCompraViewSet, basename="pedido-compra")

urlpatterns = [
    path("", include(router.urls)),
]

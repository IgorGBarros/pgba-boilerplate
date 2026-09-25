from django.contrib import admin
from compras.models import Fornecedor, ItemNecessario, Orcamento, ItemOrcamento, PedidoCompra


@admin.register(Fornecedor)
class FornecedorAdmin(admin.ModelAdmin):
    list_display = ["nome", "categoria", "cidade", "telefone", "source", "is_active"]
    list_filter = ["source", "cidade", "is_active"]
    search_fields = ["nome", "categoria", "cidade"]


class ItemOrcamentoInline(admin.TabularInline):
    model = ItemOrcamento
    extra = 0


@admin.register(Orcamento)
class OrcamentoAdmin(admin.ModelAdmin):
    list_display = ["id", "deal", "fornecedor", "status", "valor_total", "aprovado_por"]
    list_filter = ["status"]
    inlines = [ItemOrcamentoInline]


@admin.register(ItemNecessario)
class ItemNecessarioAdmin(admin.ModelAdmin):
    list_display = ["nome", "deal", "quantidade", "unidade", "tem_estoque", "quantidade_estoque"]
    list_filter = ["tem_estoque"]


@admin.register(PedidoCompra)
class PedidoCompraAdmin(admin.ModelAdmin):
    list_display = ["id", "orcamento", "project", "status", "numero_pedido", "previsao_entrega"]
    list_filter = ["status"]

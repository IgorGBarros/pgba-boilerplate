from rest_framework import serializers
from compras.models import Fornecedor, ItemNecessario, Orcamento, ItemOrcamento, PedidoCompra


class FornecedorSerializer(serializers.ModelSerializer):
    class Meta:
        model = Fornecedor
        fields = [
            "id", "nome", "categoria", "telefone", "email", "endereco",
            "cidade", "estado", "latitude", "longitude", "source",
            "osm_id", "website", "observacoes", "created_at",
        ]
        read_only_fields = ["id", "created_at"]


class ItemNecessarioSerializer(serializers.ModelSerializer):
    quantidade_faltando = serializers.FloatField(read_only=True)

    class Meta:
        model = ItemNecessario
        fields = [
            "id", "deal", "nome", "descricao", "quantidade", "unidade",
            "tem_estoque", "quantidade_estoque", "categoria", "quantidade_faltando",
        ]
        read_only_fields = ["id"]


class ItemOrcamentoSerializer(serializers.ModelSerializer):
    subtotal = serializers.FloatField(read_only=True)

    class Meta:
        model = ItemOrcamento
        fields = [
            "id", "orcamento", "item_necessario", "nome", "quantidade",
            "unidade", "preco_unitario", "subtotal",
        ]
        read_only_fields = ["id", "subtotal"]


class OrcamentoSerializer(serializers.ModelSerializer):
    fornecedor_nome = serializers.CharField(source="fornecedor.nome", read_only=True)
    itens = ItemOrcamentoSerializer(many=True, read_only=True)

    class Meta:
        model = Orcamento
        fields = [
            "id", "deal", "fornecedor", "fornecedor_nome", "status",
            "valor_total", "prazo_entrega_dias", "observacoes",
            "aprovado_em", "aprovado_por", "enviado_em", "resposta_em",
            "itens", "created_at",
        ]
        read_only_fields = ["id", "fornecedor_nome", "itens", "created_at"]


class PedidoCompraSerializer(serializers.ModelSerializer):
    fornecedor_nome = serializers.CharField(
        source="orcamento.fornecedor.nome", read_only=True
    )
    deal_titulo = serializers.CharField(
        source="orcamento.deal.titulo", read_only=True
    )

    class Meta:
        model = PedidoCompra
        fields = [
            "id", "orcamento", "project", "status", "numero_pedido",
            "previsao_entrega", "observacoes", "entregue_em",
            "fornecedor_nome", "deal_titulo", "created_at",
        ]
        read_only_fields = ["id", "fornecedor_nome", "deal_titulo", "created_at"]


class BuscarFornecedoresSerializer(serializers.Serializer):
    material = serializers.CharField(max_length=200)
    cidade = serializers.CharField(max_length=200)
    raio_km = serializers.IntegerField(default=10, min_value=1, max_value=100)


class CriarOrcamentoSerializer(serializers.Serializer):
    fornecedor_id = serializers.IntegerField()
    itens = serializers.ListField(
        child=serializers.DictField(),
        min_length=1,
    )


class AprovarOrcamentoSerializer(serializers.Serializer):
    aprovado_por = serializers.CharField(max_length=200)


class RegistrarRespostaSerializer(serializers.Serializer):
    valor_total = serializers.DecimalField(max_digits=14, decimal_places=2)
    prazo_entrega_dias = serializers.IntegerField(min_value=0)
    itens_precos = serializers.ListField(child=serializers.DictField(), default=list)
    observacoes = serializers.CharField(default="", allow_blank=True)


class GerarPedidoSerializer(serializers.Serializer):
    project_id = serializers.IntegerField(required=False, allow_null=True)

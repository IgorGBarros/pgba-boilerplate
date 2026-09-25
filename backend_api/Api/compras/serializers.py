from rest_framework import serializers
from compras.models import Fornecedor, ItemNecessario, Orcamento, ItemOrcamento, PedidoCompra


class FornecedorSerializer(serializers.ModelSerializer):
    taxa_entrega_prazo = serializers.SerializerMethodField()

    class Meta:
        model = Fornecedor
        fields = [
            "id", "nome", "categoria", "telefone", "email", "endereco",
            "cidade", "estado", "latitude", "longitude", "source",
            "osm_id", "website", "observacoes",
            "nota_media", "prazo_medio_dias", "total_pedidos", "pedidos_no_prazo",
            "taxa_entrega_prazo", "created_at",
        ]
        read_only_fields = ["id", "nota_media", "prazo_medio_dias", "total_pedidos",
                            "pedidos_no_prazo", "taxa_entrega_prazo", "created_at"]

    def get_taxa_entrega_prazo(self, obj):
        if obj.total_pedidos == 0:
            return None
        return round(obj.pedidos_no_prazo / obj.total_pedidos * 100, 1)


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
    fornecedor_nota = serializers.DecimalField(source="fornecedor.nota_media", max_digits=4, decimal_places=2, read_only=True)
    itens = ItemOrcamentoSerializer(many=True, read_only=True)

    class Meta:
        model = Orcamento
        fields = [
            "id", "deal", "fornecedor", "fornecedor_nome", "fornecedor_nota", "status",
            "valor_total", "prazo_entrega_dias", "observacoes",
            "aprovado_em", "aprovado_por", "enviado_em", "resposta_em",
            "recomendacao_motivo", "score_recomendacao",
            "itens", "created_at",
        ]
        read_only_fields = ["id", "fornecedor_nome", "fornecedor_nota", "itens",
                            "recomendacao_motivo", "score_recomendacao", "created_at"]


class PedidoCompraSerializer(serializers.ModelSerializer):
    fornecedor_nome = serializers.CharField(source="orcamento.fornecedor.nome", read_only=True)
    deal_titulo = serializers.CharField(source="orcamento.deal.titulo", read_only=True)
    valor_total = serializers.DecimalField(source="orcamento.valor_total", max_digits=14, decimal_places=2, read_only=True)
    itens = ItemOrcamentoSerializer(source="orcamento.itens", many=True, read_only=True)
    em_atraso = serializers.BooleanField(read_only=True)
    proximo_status = serializers.SerializerMethodField()

    class Meta:
        model = PedidoCompra
        fields = [
            "id", "orcamento", "project", "status", "numero_pedido",
            "previsao_entrega", "observacoes",
            "confirmado_em", "em_transito_em", "entregue_em",
            "fornecedor_nome", "deal_titulo", "valor_total", "itens",
            "em_atraso", "proximo_status", "created_at",
        ]
        read_only_fields = [
            "id", "fornecedor_nome", "deal_titulo", "valor_total", "itens",
            "confirmado_em", "em_transito_em", "entregue_em",
            "em_atraso", "proximo_status", "created_at",
        ]

    def get_proximo_status(self, obj):
        flow = ["criado", "enviado", "confirmado", "em_transito", "entregue"]
        try:
            idx = flow.index(obj.status)
            return flow[idx + 1] if idx < len(flow) - 1 else None
        except ValueError:
            return None


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


class CentralSuprimentosSerializer(serializers.Serializer):
    criticos = PedidoCompraSerializer(many=True)
    pendentes_atencao = PedidoCompraSerializer(many=True)
    em_transito = PedidoCompraSerializer(many=True)
    entregues_mes = serializers.IntegerField()
    valor_em_andamento = serializers.DecimalField(max_digits=16, decimal_places=2)
    orcamentos_aguardando_resposta = OrcamentoSerializer(many=True)

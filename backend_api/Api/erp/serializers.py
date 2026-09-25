from rest_framework import serializers
from erp.models import Fornecedor, OrdemCompra, ItemEstoque, MovimentacaoEstoque, LancamentoFinanceiro, Funcionario, NotaFiscal, ObrigacaoFiscal, LinhaDRE, BalancetePeriodo


class FornecedorSerializer(serializers.ModelSerializer):
    class Meta:
        model = Fornecedor
        fields = ["id", "nome", "cnpj", "email", "telefone", "categoria", "observacoes", "created_at"]
        read_only_fields = ["id", "created_at"]


class OrdemCompraSerializer(serializers.ModelSerializer):
    fornecedor_nome = serializers.CharField(source="fornecedor.nome", read_only=True)

    class Meta:
        model = OrdemCompra
        fields = [
            "id", "numero", "fornecedor", "fornecedor_nome", "status",
            "valor_total", "data_emissao", "data_entrega_prevista", "observacoes", "created_at",
        ]
        read_only_fields = ["id", "fornecedor_nome", "created_at"]


class ItemEstoqueSerializer(serializers.ModelSerializer):
    fornecedor_nome = serializers.CharField(source="fornecedor.nome", read_only=True)
    valor_total = serializers.SerializerMethodField()
    abaixo_minimo = serializers.SerializerMethodField()

    class Meta:
        model = ItemEstoque
        fields = [
            "id", "codigo", "nome", "categoria", "quantidade", "quantidade_minima",
            "unidade", "custo_unitario", "fornecedor", "fornecedor_nome",
            "localizacao", "valor_total", "abaixo_minimo", "created_at",
        ]
        read_only_fields = ["id", "fornecedor_nome", "valor_total", "abaixo_minimo", "created_at"]

    def get_valor_total(self, obj):
        return float(obj.quantidade * obj.custo_unitario)

    def get_abaixo_minimo(self, obj):
        return obj.quantidade < obj.quantidade_minima


class MovimentacaoEstoqueSerializer(serializers.ModelSerializer):
    item_nome = serializers.CharField(source="item.nome", read_only=True)
    item_codigo = serializers.CharField(source="item.codigo", read_only=True)
    tipo_display = serializers.CharField(source="get_tipo_display", read_only=True)

    class Meta:
        model = MovimentacaoEstoque
        fields = [
            "id", "item", "item_nome", "item_codigo", "tipo", "tipo_display",
            "quantidade", "quantidade_anterior", "quantidade_posterior",
            "motivo", "referencia", "operador", "created_at",
        ]
        read_only_fields = ["id", "item_nome", "item_codigo", "tipo_display",
                            "quantidade_anterior", "quantidade_posterior", "created_at"]


class RegistrarMovimentacaoSerializer(serializers.Serializer):
    item_id = serializers.IntegerField()
    tipo = serializers.ChoiceField(choices=["entrada", "saida", "ajuste", "transferencia"])
    quantidade = serializers.IntegerField(min_value=1)
    motivo = serializers.CharField(required=False, allow_blank=True, default="")
    referencia = serializers.CharField(required=False, allow_blank=True, default="")
    operador = serializers.CharField(required=False, allow_blank=True, default="")


class LancamentoFinanceiroSerializer(serializers.ModelSerializer):
    class Meta:
        model = LancamentoFinanceiro
        fields = [
            "id", "descricao", "tipo", "valor", "vencimento", "status",
            "categoria", "cliente", "fornecedor_nome", "numero_documento", "created_at",
        ]
        read_only_fields = ["id", "created_at"]


class FuncionarioSerializer(serializers.ModelSerializer):
    class Meta:
        model = Funcionario
        fields = [
            "id", "nome", "cargo", "departamento", "salario", "data_admissao",
            "data_demissao", "status", "email", "cpf", "created_at",
        ]
        read_only_fields = ["id", "created_at"]


class NotaFiscalSerializer(serializers.ModelSerializer):
    class Meta:
        model = NotaFiscal
        fields = ["id", "numero", "cliente", "valor", "cfop", "status", "emissao", "created_at"]
        read_only_fields = ["id", "created_at"]


class ObrigacaoFiscalSerializer(serializers.ModelSerializer):
    class Meta:
        model = ObrigacaoFiscal
        fields = ["id", "nome", "orgao", "vencimento", "competencia", "status", "created_at"]
        read_only_fields = ["id", "created_at"]


class LinhaDRESerializer(serializers.ModelSerializer):
    class Meta:
        model = LinhaDRE
        fields = ["id", "conta", "valor_atual", "valor_anterior", "tipo", "competencia", "ordem"]
        read_only_fields = ["id"]


class BalancetePeriodoSerializer(serializers.ModelSerializer):
    class Meta:
        model = BalancetePeriodo
        fields = ["id", "competencia", "ativo_total", "passivo_total", "patrimonio_liquido"]
        read_only_fields = ["id"]

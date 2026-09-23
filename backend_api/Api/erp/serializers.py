from rest_framework import serializers
from erp.models import Fornecedor, OrdemCompra, ItemEstoque, LancamentoFinanceiro, Funcionario


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

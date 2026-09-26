from rest_framework import serializers

from core.utils.lgpd import mask_cpf
from erp.models import (
    BalancetePeriodo,
    ContratoServico,
    DadosEmpresa,
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


class TenantFKMixin:
    """
    Todo FK recebido no corpo da requisição tem que ser do MESMO tenant de
    quem chama — sem isso, mandar `"parceiro": 7` de outro tenant ligaria um
    contrato a um cliente alheio (e vazaria o nome dele na resposta).
    """

    def validate(self, attrs):
        attrs = super().validate(attrs)
        request = self.context.get("request")
        tenant_id = getattr(request, "tenant_id", None)
        for name, value in attrs.items():
            field = self.fields.get(name)
            if isinstance(field, serializers.PrimaryKeyRelatedField) and value is not None:
                if getattr(value, "tenant_id", tenant_id) != tenant_id:
                    raise serializers.ValidationError({name: "Registro não encontrado."})
                if getattr(value, "is_active", True) is False:
                    raise serializers.ValidationError({name: "Registro excluído."})
        return attrs


# ─── Parceiros de negócio ────────────────────────────────────────────────────


class ParceiroNegocioSerializer(TenantFKMixin, serializers.ModelSerializer):
    tipo_display = serializers.CharField(source="get_tipo_display", read_only=True)
    pessoa_fisica = serializers.BooleanField(read_only=True)

    class Meta:
        model = ParceiroNegocio
        fields = [
            "id",
            "tipo",
            "tipo_display",
            "codigo",
            "nome",
            "nome_fantasia",
            "cpf_cnpj",
            "pessoa_fisica",
            "inscricao_estadual",
            "inscricao_municipal",
            "email",
            "telefone",
            "categoria",
            "cep",
            "logradouro",
            "numero",
            "complemento",
            "bairro",
            "municipio",
            "uf",
            "codigo_municipio_ibge",
            "observacoes",
            "created_at",
        ]
        read_only_fields = ["id", "codigo", "tipo_display", "pessoa_fisica", "created_at"]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        # CPF é dado pessoal (LGPD) — nunca sai inteiro; CNPJ é da empresa
        if instance.pessoa_fisica:
            data["cpf_cnpj"] = mask_cpf(instance.cpf_cnpj)
        return data

    def validate_cpf_cnpj(self, value):
        digitos = "".join(c for c in value if c.isdigit())
        if value and "*" in value:
            return self.instance.cpf_cnpj if self.instance else ""  # veio mascarado de volta
        if digitos and len(digitos) not in (11, 14):
            raise serializers.ValidationError("CPF tem 11 dígitos e CNPJ tem 14.")
        return value

    def validate_uf(self, value):
        return value.upper()


# Compatibilidade: /erp/fornecedores/ continua existindo
FornecedorSerializer = ParceiroNegocioSerializer


class OrdemCompraSerializer(TenantFKMixin, serializers.ModelSerializer):
    fornecedor_nome = serializers.CharField(source="fornecedor.nome", read_only=True)

    class Meta:
        model = OrdemCompra
        fields = [
            "id",
            "numero",
            "fornecedor",
            "fornecedor_nome",
            "status",
            "valor_total",
            "data_emissao",
            "data_entrega_prevista",
            "observacoes",
            "created_at",
        ]
        read_only_fields = ["id", "fornecedor_nome", "created_at"]


# ─── Itens e estoque ─────────────────────────────────────────────────────────


class ItemEstoqueSerializer(TenantFKMixin, serializers.ModelSerializer):
    fornecedor_nome = serializers.CharField(source="fornecedor.nome", read_only=True)
    tipo_item_display = serializers.CharField(source="get_tipo_item_display", read_only=True)
    valor_total = serializers.SerializerMethodField()
    abaixo_minimo = serializers.SerializerMethodField()

    class Meta:
        model = ItemEstoque
        fields = [
            "id",
            "tipo_item",
            "tipo_item_display",
            "codigo",
            "nome",
            "categoria",
            "quantidade",
            "quantidade_minima",
            "unidade",
            "custo_unitario",
            "preco_venda",
            "ncm",
            "codigo_servico",
            "fornecedor",
            "fornecedor_nome",
            "localizacao",
            "data_ultima_compra",
            "custo_medio",
            "valor_total",
            "abaixo_minimo",
            "created_at",
        ]
        read_only_fields = [
            "id",
            "fornecedor_nome",
            "tipo_item_display",
            "valor_total",
            "abaixo_minimo",
            "created_at",
            "custo_medio",
            "data_ultima_compra",
        ]

    def get_valor_total(self, obj):
        return float(obj.quantidade * obj.custo_unitario)

    def get_abaixo_minimo(self, obj):
        return obj.controla_estoque and obj.quantidade < obj.quantidade_minima

    def validate(self, attrs):
        attrs = super().validate(attrs)
        tipo = attrs.get("tipo_item", getattr(self.instance, "tipo_item", "material"))
        if tipo == ItemEstoque.TipoItem.SERVICO:
            # Serviço não tem saldo: zera pra nunca aparecer "abaixo do mínimo"
            attrs["quantidade"] = 0
            attrs["quantidade_minima"] = 0
        return attrs


class MovimentacaoEstoqueSerializer(serializers.ModelSerializer):
    item_nome = serializers.CharField(source="item.nome", read_only=True)
    item_codigo = serializers.CharField(source="item.codigo", read_only=True)
    tipo_display = serializers.CharField(source="get_tipo_display", read_only=True)

    class Meta:
        model = MovimentacaoEstoque
        fields = [
            "id",
            "item",
            "item_nome",
            "item_codigo",
            "tipo",
            "tipo_display",
            "quantidade",
            "quantidade_anterior",
            "quantidade_posterior",
            "valor_unitario",
            "motivo",
            "referencia",
            "operador",
            "created_at",
        ]
        read_only_fields = [
            "id",
            "item_nome",
            "item_codigo",
            "tipo_display",
            "quantidade_anterior",
            "quantidade_posterior",
            "created_at",
        ]


class RegistrarMovimentacaoSerializer(serializers.Serializer):
    item_id = serializers.IntegerField()
    tipo = serializers.ChoiceField(choices=["entrada", "saida", "ajuste", "transferencia"])
    quantidade = serializers.IntegerField(min_value=1)
    valor_unitario = serializers.DecimalField(
        max_digits=14, decimal_places=2, required=False, allow_null=True
    )
    motivo = serializers.CharField(required=False, allow_blank=True, default="")
    referencia = serializers.CharField(required=False, allow_blank=True, default="")
    operador = serializers.CharField(required=False, allow_blank=True, default="")


# ─── Financeiro ──────────────────────────────────────────────────────────────


class LancamentoFinanceiroSerializer(TenantFKMixin, serializers.ModelSerializer):
    parceiro_nome = serializers.CharField(source="parceiro.nome", read_only=True, default="")
    contrato_numero = serializers.CharField(source="contrato.numero", read_only=True, default="")
    projeto_titulo = serializers.CharField(source="projeto.titulo", read_only=True, default="")
    centro_custo_nome = serializers.CharField(
        source="centro_custo.nome", read_only=True, default=""
    )
    setor_nome = serializers.CharField(source="setor.name", read_only=True, default="")

    class Meta:
        model = LancamentoFinanceiro
        fields = [
            "id",
            "descricao",
            "tipo",
            "valor",
            "vencimento",
            "status",
            "data_pagamento",
            "categoria",
            "cliente",
            "fornecedor_nome",
            "numero_documento",
            "parceiro",
            "parceiro_nome",
            "contrato",
            "contrato_numero",
            "projeto",
            "projeto_titulo",
            "centro_custo",
            "centro_custo_nome",
            "setor",
            "setor_nome",
            "origem",
            "referencia_origem",
            "created_at",
        ]
        read_only_fields = [
            "id",
            "parceiro_nome",
            "contrato_numero",
            "projeto_titulo",
            "centro_custo_nome",
            "setor_nome",
            "origem",
            "referencia_origem",
            "created_at",
        ]

    def validate(self, attrs):
        attrs = super().validate(attrs)
        parceiro = attrs.get("parceiro")
        if parceiro is not None:
            # O nome solto acompanha o parceiro (relatórios antigos leem daí)
            campo = (
                "cliente"
                if attrs.get("tipo", getattr(self.instance, "tipo", "")) == "receita"
                else "fornecedor_nome"
            )
            attrs.setdefault(campo, parceiro.nome)
        if attrs.get("status") == "pago" and not attrs.get("data_pagamento"):
            if not (self.instance and self.instance.data_pagamento):
                from django.utils import timezone

                attrs["data_pagamento"] = timezone.now().date()
        return attrs


# ─── RH ──────────────────────────────────────────────────────────────────────


class FuncionarioSerializer(TenantFKMixin, serializers.ModelSerializer):
    setor_nome = serializers.CharField(source="setor.name", read_only=True, default="")
    centro_custo_nome = serializers.CharField(
        source="centro_custo.nome", read_only=True, default=""
    )

    class Meta:
        model = Funcionario
        fields = [
            "id",
            "nome",
            "cargo",
            "departamento",
            "setor",
            "setor_nome",
            "centro_custo",
            "centro_custo_nome",
            "salario",
            "data_admissao",
            "data_demissao",
            "status",
            "email",
            "cpf",
            "created_at",
        ]
        read_only_fields = ["id", "setor_nome", "centro_custo_nome", "created_at"]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data["cpf"] = mask_cpf(instance.cpf) if instance.cpf else ""
        return data

    def validate_cpf(self, value):
        if value and "*" in value:
            return self.instance.cpf if self.instance else ""
        return value

    def validate(self, attrs):
        attrs = super().validate(attrs)
        setor = attrs.get("setor")
        if setor is not None and not attrs.get("departamento"):
            attrs["departamento"] = setor.name
        return attrs


# ─── Fiscal / contábil ───────────────────────────────────────────────────────


class NotaFiscalSerializer(TenantFKMixin, serializers.ModelSerializer):
    contrato_numero = serializers.CharField(source="contrato.numero", read_only=True, default="")
    tipo_display = serializers.CharField(source="get_tipo_display", read_only=True)

    class Meta:
        model = NotaFiscal
        fields = [
            "id",
            "tipo",
            "tipo_display",
            "numero",
            "serie",
            "cliente",
            "parceiro",
            "contrato",
            "contrato_numero",
            "lancamento",
            "valor",
            "cfop",
            "codigo_servico",
            "discriminacao",
            "aliquota_iss",
            "valor_iss",
            "chave_acesso",
            "status",
            "emissao",
            "created_at",
        ]
        read_only_fields = ["id", "contrato_numero", "tipo_display", "created_at"]


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


# ─── Contratos de serviço ────────────────────────────────────────────────────


class ItemContratoSerializer(TenantFKMixin, serializers.ModelSerializer):
    item_codigo = serializers.CharField(source="item.codigo", read_only=True, default="")
    valor_total = serializers.DecimalField(max_digits=16, decimal_places=2, read_only=True)

    class Meta:
        model = ItemContrato
        fields = [
            "id",
            "contrato",
            "item",
            "item_codigo",
            "tipo",
            "descricao",
            "quantidade",
            "valor_unitario",
            "valor_total",
            "quantidade_baixada",
        ]
        read_only_fields = ["id", "item_codigo", "valor_total", "quantidade_baixada"]
        extra_kwargs = {"descricao": {"required": False, "allow_blank": True}}

    def validate(self, attrs):
        attrs = super().validate(attrs)
        item = attrs.get("item")
        if item is not None:
            attrs["tipo"] = item.tipo_item  # o cadastro manda: serviço ou material
            if not attrs.get("descricao"):  # a tela manda "" quando escolhe um item
                attrs["descricao"] = item.nome
            if not attrs.get("valor_unitario") and item.preco_venda:
                attrs["valor_unitario"] = item.preco_venda
        if not attrs.get("descricao") and not (self.instance and self.instance.descricao):
            raise serializers.ValidationError({"descricao": "Descreva a linha ou escolha um item."})
        contrato = attrs.get("contrato") or (self.instance and self.instance.contrato)
        if contrato and contrato.status in (
            ContratoServico.Status.ENCERRADO,
            ContratoServico.Status.CANCELADO,
        ):
            raise serializers.ValidationError("Contrato encerrado/cancelado não muda de linhas.")
        return attrs


class ContratoServicoSerializer(TenantFKMixin, serializers.ModelSerializer):
    parceiro_nome = serializers.CharField(source="parceiro.nome", read_only=True)
    projeto_titulo = serializers.CharField(source="projeto.titulo", read_only=True, default="")
    centro_custo_nome = serializers.CharField(
        source="centro_custo.nome", read_only=True, default=""
    )
    setor_nome = serializers.CharField(source="setor.name", read_only=True, default="")
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    itens = ItemContratoSerializer(many=True, read_only=True)
    faturado = serializers.SerializerMethodField()
    recebido = serializers.SerializerMethodField()
    notas_fiscais = serializers.SerializerMethodField()

    class Meta:
        model = ContratoServico
        fields = [
            "id",
            "numero",
            "nome_projeto",
            "descricao",
            "parceiro",
            "parceiro_nome",
            "projeto",
            "projeto_titulo",
            "com_material",
            "data_inicio",
            "data_fim",
            "valor_total",
            "periodicidade",
            "dia_vencimento",
            "status",
            "status_display",
            "centro_custo",
            "centro_custo_nome",
            "setor",
            "setor_nome",
            "responsavel",
            "observacoes",
            "itens",
            "faturado",
            "recebido",
            "notas_fiscais",
            "created_at",
        ]
        read_only_fields = [
            "id",
            "numero",
            "status",
            "status_display",
            "parceiro_nome",
            "projeto_titulo",
            "centro_custo_nome",
            "setor_nome",
            "itens",
            "faturado",
            "recebido",
            "notas_fiscais",
            "created_at",
        ]

    def _lancamentos(self, obj):
        return [lanc for lanc in obj.lancamentos.all() if lanc.is_active]

    def get_faturado(self, obj):
        return float(
            sum(lanc.valor for lanc in self._lancamentos(obj) if lanc.status != "cancelado")
        )

    def get_recebido(self, obj):
        return float(sum(lanc.valor for lanc in self._lancamentos(obj) if lanc.status == "pago"))

    def get_notas_fiscais(self, obj):
        return [
            {"id": n.id, "numero": n.numero, "status": n.status, "valor": float(n.valor)}
            for n in obj.notas_fiscais.all()
            if n.is_active
        ]

    def validate(self, attrs):
        attrs = super().validate(attrs)
        inicio = attrs.get("data_inicio", getattr(self.instance, "data_inicio", None))
        fim = attrs.get("data_fim", getattr(self.instance, "data_fim", None))
        if inicio and fim and fim < inicio:
            raise serializers.ValidationError({"data_fim": "O fim não pode ser antes do início."})
        dia = attrs.get("dia_vencimento")
        if dia is not None and not 1 <= dia <= 28:
            raise serializers.ValidationError({"dia_vencimento": "Use um dia entre 1 e 28."})
        parceiro = attrs.get("parceiro")
        if parceiro is not None and parceiro.tipo == ParceiroNegocio.Tipo.FORNECEDOR:
            raise serializers.ValidationError({"parceiro": "Contrato de serviço é com um cliente."})
        if self.instance and self.instance.status in (
            ContratoServico.Status.ENCERRADO,
            ContratoServico.Status.CANCELADO,
        ):
            raise serializers.ValidationError("Contrato encerrado/cancelado não é mais editável.")
        return attrs


class DadosEmpresaSerializer(serializers.ModelSerializer):
    class Meta:
        model = DadosEmpresa
        fields = [
            "razao_social",
            "nome_fantasia",
            "cnpj",
            "inscricao_municipal",
            "inscricao_estadual",
            "regime_tributario",
            "cep",
            "logradouro",
            "numero",
            "bairro",
            "municipio",
            "uf",
            "codigo_municipio_ibge",
            "codigo_servico_padrao",
            "aliquota_iss_padrao",
            "serie_nfse",
            "email_fiscal",
        ]

    def validate_uf(self, value):
        return value.upper()

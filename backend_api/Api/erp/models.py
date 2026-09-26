from django.db import models
from django.utils import timezone
from core.mixins import TenantMixin, AuditMixin, SoftDeleteMixin


class ParceiroNegocio(TenantMixin, AuditMixin, SoftDeleteMixin, models.Model):
    """
    Parceiro de Negócio (Business Partner do SAP Business One): cliente,
    fornecedor e lead num cadastro só — um documento (contrato, fatura, NF,
    ordem de compra) sempre aponta pra um parceiro, nunca pra um nome solto.
    Era `Fornecedor` (migração 0007): os fornecedores existentes continuam
    aqui com `tipo="fornecedor"`.

    `compras.Fornecedor` é outra coisa: a descoberta de fornecedores pra
    cotação (OpenStreetMap, score de entrega) do módulo de Compras.
    """

    class Tipo(models.TextChoices):
        CLIENTE = "cliente", "Cliente"
        FORNECEDOR = "fornecedor", "Fornecedor"
        LEAD = "lead", "Lead"

    PREFIXO = {"cliente": "C", "fornecedor": "F", "lead": "L"}

    tipo = models.CharField(max_length=12, choices=Tipo.choices, default=Tipo.FORNECEDOR)
    codigo = models.CharField(max_length=20, blank=True)  # C00001 / F00001 / L00001
    nome = models.CharField(max_length=200)  # razão social / nome completo
    nome_fantasia = models.CharField(max_length=200, blank=True)
    # CPF (pessoa física, dado pessoal — sai mascarado na API) ou CNPJ
    cpf_cnpj = models.CharField(max_length=20, blank=True)
    inscricao_estadual = models.CharField(max_length=30, blank=True)
    inscricao_municipal = models.CharField(max_length=30, blank=True)
    email = models.EmailField(blank=True)
    telefone = models.CharField(max_length=30, blank=True)
    categoria = models.CharField(max_length=100, blank=True)
    # Endereço — obrigatório pro tomador numa NFS-e/NF-e
    cep = models.CharField(max_length=10, blank=True)
    logradouro = models.CharField(max_length=200, blank=True)
    numero = models.CharField(max_length=20, blank=True)
    complemento = models.CharField(max_length=100, blank=True)
    bairro = models.CharField(max_length=100, blank=True)
    municipio = models.CharField(max_length=100, blank=True)
    uf = models.CharField(max_length=2, blank=True)
    codigo_municipio_ibge = models.CharField(max_length=7, blank=True)
    observacoes = models.TextField(blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["nome"]
        verbose_name = "Parceiro de negócio"
        verbose_name_plural = "Parceiros de negócio"
        indexes = [
            models.Index(fields=["tenant_id"]),
            models.Index(fields=["tenant_id", "tipo"]),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["tenant_id", "codigo"],
                condition=~models.Q(codigo=""),
                name="uniq_parceiro_codigo_per_tenant",
            )
        ]

    def __str__(self):
        return f"{self.codigo} — {self.nome}" if self.codigo else self.nome

    @property
    def documento_digitos(self) -> str:
        return "".join(c for c in self.cpf_cnpj if c.isdigit())

    @property
    def pessoa_fisica(self) -> bool:
        return len(self.documento_digitos) == 11

    def save(self, *args, **kwargs):
        if not self.codigo:
            self.codigo = proximo_codigo(
                ParceiroNegocio, self.tenant_id, self.PREFIXO.get(self.tipo, "P"), "codigo", width=5
            )
        super().save(*args, **kwargs)


def proximo_codigo(model, tenant_id, prefixo: str, campo: str, width: int = 5) -> str:
    """Próximo código sequencial por tenant e prefixo (C00001, CT-2026-0001...)."""
    existentes = model.objects.filter(
        tenant_id=tenant_id, **{f"{campo}__startswith": prefixo}
    ).values_list(campo, flat=True)
    maior = 0
    for valor in existentes:
        sufixo = valor[len(prefixo):]
        if sufixo.isdigit():
            maior = max(maior, int(sufixo))
    return f"{prefixo}{maior + 1:0{width}d}"


# Nome antigo — mantido pra quem ainda importa `erp.models.Fornecedor`
Fornecedor = ParceiroNegocio


class OrdemCompra(TenantMixin, AuditMixin, SoftDeleteMixin, models.Model):
    STATUS_CHOICES = [
        ("rascunho", "Rascunho"),
        ("aprovado", "Aprovado"),
        ("enviado", "Enviado ao fornecedor"),
        ("recebido", "Recebido"),
        ("cancelado", "Cancelado"),
    ]

    numero = models.CharField(max_length=30)
    fornecedor = models.ForeignKey(
        ParceiroNegocio, on_delete=models.PROTECT, related_name="ordens_compra"
    )
    status = models.CharField(max_length=15, choices=STATUS_CHOICES, default="rascunho")
    valor_total = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    data_emissao = models.DateField(default=timezone.localdate)
    data_entrega_prevista = models.DateField(null=True, blank=True)
    observacoes = models.TextField(blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-data_emissao"]
        indexes = [
            models.Index(fields=["tenant_id", "status"]),
            models.Index(fields=["tenant_id", "fornecedor"]),
        ]
        constraints = [
            models.UniqueConstraint(fields=["tenant_id", "numero"], name="uniq_ordem_compra_numero_per_tenant")
        ]

    def __str__(self):
        return f"OC-{self.numero}"


class ItemEstoque(TenantMixin, AuditMixin, SoftDeleteMixin, models.Model):
    """
    Cadastro de itens (Item Master Data do SAP B1): material (controla
    estoque, NCM pra NF-e) ou serviço (sem estoque, código da LC 116 pra
    NFS-e). O nome da classe ficou por compatibilidade — a tela chama de "Itens".
    """

    class TipoItem(models.TextChoices):
        MATERIAL = "material", "Material"
        SERVICO = "servico", "Serviço"

    UNIDADE_CHOICES = [
        ("un", "Unidade"),
        ("kg", "Kg"),
        ("m", "Metro"),
        ("l", "Litro"),
        ("cx", "Caixa"),
        ("pc", "Peça"),
        ("h", "Hora"),
        ("mes", "Mês"),
        ("sv", "Serviço"),
    ]

    tipo_item = models.CharField(max_length=10, choices=TipoItem.choices, default=TipoItem.MATERIAL)
    codigo = models.CharField(max_length=50)
    nome = models.CharField(max_length=200)
    categoria = models.CharField(max_length=100, blank=True)
    quantidade = models.IntegerField(default=0)
    quantidade_minima = models.IntegerField(default=0)
    unidade = models.CharField(max_length=5, choices=UNIDADE_CHOICES, default="un")
    custo_unitario = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    fornecedor = models.ForeignKey(
        ParceiroNegocio,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="itens_estoque",
    )
    localizacao = models.CharField(max_length=100, blank=True)
    data_ultima_compra = models.DateField(null=True, blank=True)
    custo_medio = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    preco_venda = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    ncm = models.CharField(max_length=10, blank=True)  # material → NF-e
    codigo_servico = models.CharField(max_length=20, blank=True)  # serviço → NFS-e (LC 116)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["nome"]
        indexes = [
            models.Index(fields=["tenant_id", "categoria"]),
            models.Index(fields=["tenant_id", "codigo"]),
        ]
        constraints = [
            models.UniqueConstraint(fields=["tenant_id", "codigo"], name="uniq_item_estoque_codigo_per_tenant")
        ]

    def __str__(self):
        return f"{self.codigo} — {self.nome}"

    @property
    def controla_estoque(self) -> bool:
        return self.tipo_item == self.TipoItem.MATERIAL


class MovimentacaoEstoque(TenantMixin, AuditMixin, models.Model):
    TIPO_CHOICES = [
        ("entrada", "Entrada"),
        ("saida", "Saída"),
        ("ajuste", "Ajuste"),
        ("transferencia", "Transferência"),
    ]

    item = models.ForeignKey(
        ItemEstoque, on_delete=models.PROTECT, related_name="movimentacoes"
    )
    tipo = models.CharField(max_length=15, choices=TIPO_CHOICES)
    quantidade = models.IntegerField()
    quantidade_anterior = models.IntegerField()
    quantidade_posterior = models.IntegerField()
    valor_unitario = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    motivo = models.CharField(max_length=255, blank=True)
    referencia = models.CharField(max_length=100, blank=True)
    operador = models.CharField(max_length=200, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["tenant_id", "item"]),
            models.Index(fields=["tenant_id", "tipo"]),
        ]

    def __str__(self):
        return f"{self.get_tipo_display()} {self.quantidade}x {self.item.nome}"


class LancamentoFinanceiro(TenantMixin, AuditMixin, SoftDeleteMixin, models.Model):
    TIPO_CHOICES = [
        ("receita", "Receita"),
        ("despesa", "Despesa"),
    ]
    STATUS_CHOICES = [
        ("pendente", "Pendente"),
        ("pago", "Pago"),
        ("vencido", "Vencido"),
        ("cancelado", "Cancelado"),
    ]
    CATEGORIA_CHOICES = [
        ("operacional", "Operacional"),
        ("pessoal", "Pessoal"),
        ("impostos", "Impostos"),
        ("servicos", "Serviços"),
        ("vendas", "Vendas"),
        ("investimento", "Investimento"),
        ("outro", "Outro"),
    ]

    descricao = models.CharField(max_length=255)
    tipo = models.CharField(max_length=10, choices=TIPO_CHOICES)
    valor = models.DecimalField(max_digits=14, decimal_places=2)
    vencimento = models.DateField()
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="pendente")
    categoria = models.CharField(max_length=15, choices=CATEGORIA_CHOICES, default="outro")
    cliente = models.CharField(max_length=200, blank=True)
    fornecedor_nome = models.CharField(max_length=200, blank=True)
    numero_documento = models.CharField(max_length=50, blank=True)
    # Integração (SAP B1: todo documento carrega parceiro, projeto e centro de custo)
    parceiro = models.ForeignKey(
        ParceiroNegocio, on_delete=models.PROTECT, null=True, blank=True, related_name="lancamentos"
    )
    contrato = models.ForeignKey(
        "erp.ContratoServico",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="lancamentos",
    )
    projeto = models.ForeignKey(
        "crm.Project",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="lancamentos_erp",
    )
    centro_custo = models.ForeignKey(
        "controladoria.CentroCusto", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="lancamentos_erp",
    )
    setor = models.ForeignKey(
        "agency.Sector",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="lancamentos_erp",
    )
    origem = models.CharField(max_length=20, default="manual")  # manual | contrato | compra
    referencia_origem = models.CharField(max_length=60, blank=True)  # ex: CT-2026-0001#3, pedido:12
    data_pagamento = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["vencimento"]
        indexes = [
            models.Index(fields=["tenant_id", "tipo", "status"]),
            models.Index(fields=["tenant_id", "vencimento"]),
            models.Index(fields=["tenant_id", "contrato"]),
        ]
        constraints = [
            # Idempotência da integração: a mesma parcela/pedido nunca vira 2 lançamentos
            models.UniqueConstraint(
                fields=["tenant_id", "referencia_origem"],
                condition=~models.Q(referencia_origem=""),
                name="uniq_lancamento_referencia_origem",
            )
        ]

    def __str__(self):
        return f"{self.get_tipo_display()} — {self.descricao}"


class Funcionario(TenantMixin, AuditMixin, SoftDeleteMixin, models.Model):
    STATUS_CHOICES = [
        ("ativo", "Ativo"),
        ("ferias", "Férias"),
        ("afastado", "Afastado"),
        ("desligado", "Desligado"),
    ]

    nome = models.CharField(max_length=200)
    cargo = models.CharField(max_length=100)
    departamento = models.CharField(max_length=100, blank=True)
    salario = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    data_admissao = models.DateField()
    data_demissao = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="ativo")
    email = models.EmailField(blank=True)
    cpf = models.CharField(max_length=14, blank=True)
    setor = models.ForeignKey(
        "agency.Sector",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="funcionarios",
    )
    centro_custo = models.ForeignKey(
        "controladoria.CentroCusto", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="funcionarios",
    )
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["nome"]
        indexes = [
            models.Index(fields=["tenant_id", "status"]),
            models.Index(fields=["tenant_id", "departamento"]),
        ]

    def __str__(self):
        return self.nome


class NotaFiscal(TenantMixin, AuditMixin, SoftDeleteMixin, models.Model):
    """
    Nota fiscal registrada no ERP. `rascunho` = montada a partir de um
    contrato/fatura, ainda NÃO transmitida — este boilerplate não transmite
    NF (não fala com SEFAZ/prefeitura/Emissor Nacional). Ver
    docs/NOTA_FISCAL.md: o que falta e como integrar um emissor.
    """

    class Tipo(models.TextChoices):
        NFSE = "nfse", "NFS-e (serviço)"
        NFE = "nfe", "NF-e (produto)"

    STATUS_CHOICES = [
        ("rascunho", "Rascunho (não transmitida)"),
        ("autorizada", "Autorizada"),
        ("pendente", "Pendente"),
        ("cancelada", "Cancelada"),
        ("denegada", "Denegada"),
    ]

    tipo = models.CharField(max_length=5, choices=Tipo.choices, default=Tipo.NFSE)
    numero = models.CharField(max_length=50)
    serie = models.CharField(max_length=5, blank=True)
    cliente = models.CharField(max_length=200, blank=True)
    parceiro = models.ForeignKey(
        ParceiroNegocio,
        on_delete=models.PROTECT,
        null=True, blank=True,
        related_name="notas_fiscais",
    )
    contrato = models.ForeignKey(
        "erp.ContratoServico",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="notas_fiscais",
    )
    lancamento = models.ForeignKey(
        LancamentoFinanceiro,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="notas_fiscais",
    )
    valor = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    cfop = models.CharField(max_length=10, blank=True)
    codigo_servico = models.CharField(max_length=20, blank=True)
    discriminacao = models.TextField(blank=True)
    aliquota_iss = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    valor_iss = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    chave_acesso = models.CharField(max_length=60, blank=True)
    status = models.CharField(max_length=15, choices=STATUS_CHOICES, default="pendente")
    emissao = models.DateField(default=timezone.localdate)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-emissao"]
        indexes = [
            models.Index(fields=["tenant_id", "status"]),
            models.Index(fields=["tenant_id", "emissao"]),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["tenant_id", "numero"], name="uniq_nf_numero_per_tenant"
            )
        ]

    def __str__(self):
        return f"NF-{self.numero}"


class LinhaDRE(TenantMixin, AuditMixin, SoftDeleteMixin, models.Model):
    TIPO_CHOICES = [
        ("receita", "Receita"),
        ("deducao", "Dedução"),
        ("subtotal", "Subtotal"),
        ("custo", "Custo"),
        ("despesa", "Despesa"),
        ("imposto", "Imposto"),
        ("resultado", "Resultado"),
    ]

    conta = models.CharField(max_length=200)
    valor_atual = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    valor_anterior = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    tipo = models.CharField(max_length=20, choices=TIPO_CHOICES)
    competencia = models.CharField(max_length=7)  # "YYYY-MM"
    ordem = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["competencia", "ordem"]
        indexes = [models.Index(fields=["tenant_id", "competencia"])]

    def __str__(self):
        return f"{self.competencia} | {self.conta}"


class BalancetePeriodo(TenantMixin, AuditMixin, SoftDeleteMixin, models.Model):
    competencia = models.CharField(max_length=7)  # "YYYY-MM"
    ativo_total = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    passivo_total = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    patrimonio_liquido = models.DecimalField(max_digits=14, decimal_places=2, default=0)

    class Meta:
        ordering = ["-competencia"]
        indexes = [models.Index(fields=["tenant_id", "competencia"])]
        constraints = [
            models.UniqueConstraint(
                fields=["tenant_id", "competencia"],
                name="uniq_balancete_competencia_per_tenant",
            )
        ]

    def __str__(self):
        return f"Balancete {self.competencia}"


class ObrigacaoFiscal(TenantMixin, AuditMixin, SoftDeleteMixin, models.Model):
    STATUS_CHOICES = [
        ("pendente", "Pendente"),
        ("entregue", "Entregue"),
        ("vencida", "Vencida"),
        ("agendada", "Agendada"),
    ]

    nome = models.CharField(max_length=200)
    orgao = models.CharField(max_length=100, blank=True)
    vencimento = models.DateField()
    competencia = models.CharField(max_length=20, blank=True)
    status = models.CharField(max_length=15, choices=STATUS_CHOICES, default="pendente")
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["vencimento"]
        indexes = [
            models.Index(fields=["tenant_id", "status"]),
            models.Index(fields=["tenant_id", "vencimento"]),
        ]

    def __str__(self):
        return self.nome


# ─── Contratos de serviço ────────────────────────────────────────────────────


class ContratoServico(TenantMixin, AuditMixin, SoftDeleteMixin, models.Model):
    """
    Contrato de serviço (Service Contract do SAP B1), com ou sem material.

    Nasce de um projeto do CRM marcado "será contrato" (`crm.Project.sera_contrato`)
    ou direto no ERP. Tem início, fim, valor, o nome do projeto e uma breve
    descrição. As linhas (`ItemContrato`) são serviço ou material; material
    dá baixa no estoque (`baixar_material`) e o faturamento vira lançamentos
    de contas a receber (`gerar_faturas`) — ver erp/services.py.
    """

    class Status(models.TextChoices):
        RASCUNHO = "rascunho", "Rascunho"
        ATIVO = "ativo", "Ativo"
        SUSPENSO = "suspenso", "Suspenso"
        ENCERRADO = "encerrado", "Encerrado"
        CANCELADO = "cancelado", "Cancelado"

    class Periodicidade(models.TextChoices):
        UNICA = "unica", "Parcela única"
        MENSAL = "mensal", "Mensal"
        TRIMESTRAL = "trimestral", "Trimestral"
        ANUAL = "anual", "Anual"

    numero = models.CharField(max_length=30, blank=True)  # CT-2026-0001
    nome_projeto = models.CharField(max_length=255)
    descricao = models.TextField(blank=True)
    parceiro = models.ForeignKey(
        ParceiroNegocio, on_delete=models.PROTECT, related_name="contratos"
    )
    projeto = models.ForeignKey(
        "crm.Project",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="contratos_erp",
    )
    com_material = models.BooleanField(default=False)
    data_inicio = models.DateField()
    data_fim = models.DateField()
    valor_total = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    periodicidade = models.CharField(
        max_length=12, choices=Periodicidade.choices, default=Periodicidade.MENSAL
    )
    dia_vencimento = models.PositiveSmallIntegerField(default=10)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.RASCUNHO)
    centro_custo = models.ForeignKey(
        "controladoria.CentroCusto", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="contratos_erp",
    )
    setor = models.ForeignKey(
        "agency.Sector",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="contratos_erp",
    )
    responsavel = models.CharField(max_length=200, blank=True)
    observacoes = models.TextField(blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-data_inicio", "-id"]
        verbose_name = "Contrato de serviço"
        verbose_name_plural = "Contratos de serviço"
        indexes = [
            models.Index(fields=["tenant_id", "status"]),
            models.Index(fields=["tenant_id", "data_fim"]),
            models.Index(fields=["tenant_id", "projeto"]),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["tenant_id", "numero"],
                condition=~models.Q(numero=""),
                name="uniq_contrato_numero_per_tenant",
            ),
            models.CheckConstraint(
                condition=models.Q(data_fim__gte=models.F("data_inicio")),
                name="contrato_fim_depois_do_inicio",
            ),
            models.CheckConstraint(
                condition=models.Q(dia_vencimento__gte=1, dia_vencimento__lte=28),
                name="contrato_dia_vencimento_valido",
            ),
        ]

    def __str__(self):
        return f"{self.numero} — {self.nome_projeto}" if self.numero else self.nome_projeto

    def save(self, *args, **kwargs):
        if not self.numero:
            ano = (self.data_inicio or timezone.now().date()).year
            self.numero = proximo_codigo(
                ContratoServico, self.tenant_id, f"CT-{ano}-", "numero", width=4
            )
        super().save(*args, **kwargs)


class ItemContrato(TenantMixin, AuditMixin, models.Model):
    """Linha do contrato: um serviço ou um material (do cadastro de itens ou avulso)."""

    class Tipo(models.TextChoices):
        SERVICO = "servico", "Serviço"
        MATERIAL = "material", "Material"

    contrato = models.ForeignKey(ContratoServico, on_delete=models.CASCADE, related_name="itens")
    item = models.ForeignKey(
        ItemEstoque, on_delete=models.PROTECT, null=True, blank=True, related_name="itens_contrato"
    )
    tipo = models.CharField(max_length=10, choices=Tipo.choices, default=Tipo.SERVICO)
    descricao = models.CharField(max_length=255)
    quantidade = models.DecimalField(max_digits=12, decimal_places=3, default=1)
    valor_unitario = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    # Material já baixado do estoque (baixa parcial permitida)
    quantidade_baixada = models.DecimalField(max_digits=12, decimal_places=3, default=0)

    class Meta:
        ordering = ["id"]
        indexes = [models.Index(fields=["tenant_id", "contrato"])]

    def __str__(self):
        return f"{self.descricao} x{self.quantidade}"

    @property
    def valor_total(self):
        return self.quantidade * self.valor_unitario


class DadosEmpresa(TenantMixin, AuditMixin, models.Model):
    """
    Dados da empresa emitente (Company Details do SAP B1) — um por tenant.
    É o que uma NFS-e/NF-e exige do prestador; `erp.services.prontidao_nota_fiscal`
    confere o que falta.
    """

    class Regime(models.TextChoices):
        MEI = "mei", "MEI"
        SIMPLES = "simples", "Simples Nacional"
        PRESUMIDO = "presumido", "Lucro Presumido"
        REAL = "real", "Lucro Real"

    razao_social = models.CharField(max_length=200, blank=True)
    nome_fantasia = models.CharField(max_length=200, blank=True)
    cnpj = models.CharField(max_length=20, blank=True)
    inscricao_municipal = models.CharField(max_length=30, blank=True)
    inscricao_estadual = models.CharField(max_length=30, blank=True)
    regime_tributario = models.CharField(max_length=10, choices=Regime.choices, blank=True)
    cep = models.CharField(max_length=10, blank=True)
    logradouro = models.CharField(max_length=200, blank=True)
    numero = models.CharField(max_length=20, blank=True)
    bairro = models.CharField(max_length=100, blank=True)
    municipio = models.CharField(max_length=100, blank=True)
    uf = models.CharField(max_length=2, blank=True)
    codigo_municipio_ibge = models.CharField(max_length=7, blank=True)
    codigo_servico_padrao = models.CharField(max_length=20, blank=True)
    aliquota_iss_padrao = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    serie_nfse = models.CharField(max_length=5, default="1")
    email_fiscal = models.EmailField(blank=True)

    class Meta:
        verbose_name = "Dados da empresa"
        verbose_name_plural = "Dados da empresa"
        constraints = [
            models.UniqueConstraint(fields=["tenant_id"], name="uniq_dados_empresa_per_tenant")
        ]

    def __str__(self):
        return self.razao_social or "Dados da empresa"

from django.db import models
from django.utils import timezone
from core.mixins import TenantMixin, AuditMixin, SoftDeleteMixin


class Fornecedor(TenantMixin, AuditMixin, SoftDeleteMixin, models.Model):
    nome = models.CharField(max_length=200)
    cnpj = models.CharField(max_length=20, blank=True)
    email = models.EmailField(blank=True)
    telefone = models.CharField(max_length=30, blank=True)
    categoria = models.CharField(max_length=100, blank=True)
    observacoes = models.TextField(blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["nome"]
        indexes = [models.Index(fields=["tenant_id"])]

    def __str__(self):
        return self.nome


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
        Fornecedor, on_delete=models.PROTECT, related_name="ordens_compra"
    )
    status = models.CharField(max_length=15, choices=STATUS_CHOICES, default="rascunho")
    valor_total = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    data_emissao = models.DateField(default=timezone.now)
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
    UNIDADE_CHOICES = [
        ("un", "Unidade"),
        ("kg", "Kg"),
        ("m", "Metro"),
        ("l", "Litro"),
        ("cx", "Caixa"),
        ("pc", "Peça"),
    ]

    codigo = models.CharField(max_length=50)
    nome = models.CharField(max_length=200)
    categoria = models.CharField(max_length=100, blank=True)
    quantidade = models.IntegerField(default=0)
    quantidade_minima = models.IntegerField(default=0)
    unidade = models.CharField(max_length=5, choices=UNIDADE_CHOICES, default="un")
    custo_unitario = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    fornecedor = models.ForeignKey(
        Fornecedor, on_delete=models.SET_NULL, null=True, blank=True, related_name="itens_estoque"
    )
    localizacao = models.CharField(max_length=100, blank=True)
    data_ultima_compra = models.DateField(null=True, blank=True)
    custo_medio = models.DecimalField(max_digits=14, decimal_places=2, default=0)
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
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["vencimento"]
        indexes = [
            models.Index(fields=["tenant_id", "tipo", "status"]),
            models.Index(fields=["tenant_id", "vencimento"]),
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
    STATUS_CHOICES = [
        ("autorizada", "Autorizada"),
        ("pendente", "Pendente"),
        ("cancelada", "Cancelada"),
        ("denegada", "Denegada"),
    ]

    numero = models.CharField(max_length=50)
    cliente = models.CharField(max_length=200, blank=True)
    valor = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    cfop = models.CharField(max_length=10, blank=True)
    status = models.CharField(max_length=15, choices=STATUS_CHOICES, default="pendente")
    emissao = models.DateField(default=timezone.now)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-emissao"]
        indexes = [
            models.Index(fields=["tenant_id", "status"]),
            models.Index(fields=["tenant_id", "emissao"]),
        ]
        constraints = [
            models.UniqueConstraint(fields=["tenant_id", "numero"], name="uniq_nf_numero_per_tenant")
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

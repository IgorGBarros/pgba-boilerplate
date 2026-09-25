from django.db import models
from django.utils import timezone

from core.mixins import TenantMixin, AuditMixin, SoftDeleteMixin


class Fornecedor(TenantMixin, AuditMixin, SoftDeleteMixin, models.Model):
    class Source(models.TextChoices):
        MANUAL = "manual", "Cadastro Manual"
        OPENSTREETMAP = "openstreetmap", "OpenStreetMap"
        INDICADO = "indicado", "Indicado"

    nome = models.CharField(max_length=255)
    categoria = models.CharField(max_length=100, blank=True)
    telefone = models.CharField(max_length=30, blank=True)
    email = models.EmailField(blank=True)
    endereco = models.TextField(blank=True)
    cidade = models.CharField(max_length=100, blank=True)
    estado = models.CharField(max_length=2, blank=True)
    latitude = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True)
    longitude = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True)
    source = models.CharField(max_length=20, choices=Source.choices, default=Source.MANUAL)
    osm_id = models.CharField(max_length=50, blank=True)
    website = models.URLField(blank=True)
    observacoes = models.TextField(blank=True)

    class Meta:
        ordering = ["nome"]
        verbose_name = "Fornecedor"
        verbose_name_plural = "Fornecedores"

    def __str__(self):
        return self.nome


class ItemNecessario(TenantMixin, AuditMixin, models.Model):
    deal = models.ForeignKey(
        "crm.Deal", on_delete=models.CASCADE, related_name="itens_necessarios"
    )
    nome = models.CharField(max_length=255)
    descricao = models.TextField(blank=True)
    quantidade = models.DecimalField(max_digits=10, decimal_places=3, default=1)
    unidade = models.CharField(max_length=20, default="un")
    tem_estoque = models.BooleanField(default=False)
    quantidade_estoque = models.DecimalField(max_digits=10, decimal_places=3, default=0)
    categoria = models.CharField(max_length=100, blank=True)

    class Meta:
        ordering = ["nome"]
        verbose_name = "Item Necessário"
        verbose_name_plural = "Itens Necessários"

    def __str__(self):
        return f"{self.nome} ({self.quantidade} {self.unidade})"

    @property
    def quantidade_faltando(self):
        if self.tem_estoque:
            return max(0, float(self.quantidade) - float(self.quantidade_estoque))
        return float(self.quantidade)


class Orcamento(TenantMixin, AuditMixin, models.Model):
    class Status(models.TextChoices):
        RASCUNHO = "rascunho", "Rascunho"
        ENVIADO = "enviado", "Enviado ao Fornecedor"
        RECEBIDO = "recebido", "Resposta Recebida"
        APROVADO = "aprovado", "Aprovado"
        REJEITADO = "rejeitado", "Rejeitado"

    deal = models.ForeignKey(
        "crm.Deal", on_delete=models.CASCADE, related_name="orcamentos"
    )
    fornecedor = models.ForeignKey(
        Fornecedor, on_delete=models.PROTECT, related_name="orcamentos"
    )
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.RASCUNHO
    )
    valor_total = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    prazo_entrega_dias = models.PositiveIntegerField(null=True, blank=True)
    observacoes = models.TextField(blank=True)
    aprovado_em = models.DateTimeField(null=True, blank=True)
    aprovado_por = models.CharField(max_length=200, blank=True)
    enviado_em = models.DateTimeField(null=True, blank=True)
    resposta_em = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-id"]
        verbose_name = "Orçamento"
        verbose_name_plural = "Orçamentos"

    def __str__(self):
        return f"Orçamento {self.fornecedor.nome} — {self.deal.titulo}"


class ItemOrcamento(TenantMixin, AuditMixin, models.Model):
    orcamento = models.ForeignKey(
        Orcamento, on_delete=models.CASCADE, related_name="itens"
    )
    item_necessario = models.ForeignKey(
        ItemNecessario, on_delete=models.SET_NULL, null=True, blank=True
    )
    nome = models.CharField(max_length=255)
    quantidade = models.DecimalField(max_digits=10, decimal_places=3)
    unidade = models.CharField(max_length=20, default="un")
    preco_unitario = models.DecimalField(
        max_digits=12, decimal_places=4, null=True, blank=True
    )

    class Meta:
        ordering = ["nome"]
        verbose_name = "Item de Orçamento"
        verbose_name_plural = "Itens de Orçamento"

    def __str__(self):
        return f"{self.nome} x{self.quantidade}"

    @property
    def subtotal(self):
        if self.preco_unitario:
            return float(self.quantidade) * float(self.preco_unitario)
        return 0


class PedidoCompra(TenantMixin, AuditMixin, SoftDeleteMixin, models.Model):
    """Stub — lógica de diligenciamento a ser implementada."""

    class Status(models.TextChoices):
        CRIADO = "criado", "Criado"
        ENVIADO = "enviado", "Enviado ao Fornecedor"
        CONFIRMADO = "confirmado", "Confirmado"
        EM_TRANSITO = "em_transito", "Em Trânsito"
        ENTREGUE = "entregue", "Entregue"
        CANCELADO = "cancelado", "Cancelado"

    orcamento = models.OneToOneField(
        Orcamento, on_delete=models.PROTECT, related_name="pedido"
    )
    project = models.ForeignKey(
        "crm.Project",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="pedidos_compra",
    )
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.CRIADO
    )
    numero_pedido = models.CharField(max_length=50, blank=True)
    previsao_entrega = models.DateField(null=True, blank=True)
    observacoes = models.TextField(blank=True)
    entregue_em = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-id"]
        verbose_name = "Pedido de Compra"
        verbose_name_plural = "Pedidos de Compra"

    def __str__(self):
        return f"Pedido {self.numero_pedido or self.id} — {self.orcamento.fornecedor.nome}"

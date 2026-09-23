from django.db import models
from django.utils import timezone
from core.mixins import TenantMixin, AuditMixin, SoftDeleteMixin


class Processo(TenantMixin, AuditMixin, SoftDeleteMixin, models.Model):
    TIPO_CHOICES = [
        ("trabalhista", "Trabalhista"),
        ("civel", "Cível"),
        ("criminal", "Criminal"),
        ("tributario", "Tributário"),
        ("contratual", "Contratual"),
        ("regulatorio", "Regulatório"),
        ("outro", "Outro"),
    ]
    STATUS_CHOICES = [
        ("em_andamento", "Em andamento"),
        ("ganho", "Ganho"),
        ("perdido", "Perdido"),
        ("acordo", "Acordo"),
        ("arquivado", "Arquivado"),
    ]
    RISCO_CHOICES = [
        ("alto", "Alto"),
        ("medio", "Médio"),
        ("baixo", "Baixo"),
    ]

    titulo = models.CharField(max_length=255)
    tipo = models.CharField(max_length=30, choices=TIPO_CHOICES, default="civel")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="em_andamento")
    parte = models.CharField(max_length=200)
    advogado = models.CharField(max_length=200, blank=True)
    foro = models.CharField(max_length=100, blank=True)
    risco = models.CharField(max_length=10, choices=RISCO_CHOICES, default="medio")
    valor_causa = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    prazo_proximo = models.DateField(null=True, blank=True)
    observacoes = models.TextField(blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["tenant_id", "status"]),
            models.Index(fields=["tenant_id", "prazo_proximo"]),
        ]

    def __str__(self):
        return self.titulo


class Contrato(TenantMixin, AuditMixin, SoftDeleteMixin, models.Model):
    TIPO_CHOICES = [
        ("servico", "Serviço"),
        ("fornecimento", "Fornecimento"),
        ("locacao", "Locação"),
        ("parceria", "Parceria"),
        ("nda", "NDA"),
        ("trabalhista", "Trabalhista"),
        ("outro", "Outro"),
    ]
    STATUS_CHOICES = [
        ("vigente", "Vigente"),
        ("expirando", "Expirando"),
        ("vencido", "Vencido"),
        ("negociacao", "Em negociação"),
        ("cancelado", "Cancelado"),
    ]
    RENOVACAO_CHOICES = [
        ("automatica", "Automática"),
        ("negociacao", "Negociação"),
        ("nao_renovar", "Não renovar"),
    ]

    titulo = models.CharField(max_length=255)
    tipo = models.CharField(max_length=20, choices=TIPO_CHOICES, default="servico")
    partes = models.CharField(max_length=300)
    data_inicio = models.DateField()
    data_fim = models.DateField(null=True, blank=True)
    valor_anual = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="vigente")
    renovacao = models.CharField(max_length=20, choices=RENOVACAO_CHOICES, default="negociacao")
    observacoes = models.TextField(blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["tenant_id", "status"]),
            models.Index(fields=["tenant_id", "data_fim"]),
        ]

    def __str__(self):
        return self.titulo


class Prazo(TenantMixin, AuditMixin, SoftDeleteMixin, models.Model):
    TIPO_CHOICES = [
        ("audiencia", "Audiência"),
        ("peca_processual", "Peça processual"),
        ("contrato", "Contrato"),
        ("administrativo", "Administrativo"),
        ("outro", "Outro"),
    ]
    URGENCIA_CHOICES = [
        ("critica", "Crítica"),
        ("alta", "Alta"),
        ("media", "Média"),
        ("baixa", "Baixa"),
    ]

    titulo = models.CharField(max_length=255)
    tipo = models.CharField(max_length=20, choices=TIPO_CHOICES, default="administrativo")
    prazo = models.DateField()
    urgencia = models.CharField(max_length=10, choices=URGENCIA_CHOICES, default="media")
    responsavel = models.CharField(max_length=200, blank=True)
    descricao = models.TextField(blank=True)
    processo = models.ForeignKey(
        Processo, on_delete=models.SET_NULL, null=True, blank=True, related_name="prazos"
    )
    contrato = models.ForeignKey(
        Contrato, on_delete=models.SET_NULL, null=True, blank=True, related_name="prazos"
    )
    concluido = models.BooleanField(default=False)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["prazo"]
        indexes = [
            models.Index(fields=["tenant_id", "prazo"]),
            models.Index(fields=["tenant_id", "urgencia"]),
        ]

    def __str__(self):
        return self.titulo

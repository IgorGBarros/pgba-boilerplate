from django.db import models
from django.utils import timezone
from core.mixins import TenantMixin, AuditMixin, SoftDeleteMixin


class Ticket(TenantMixin, AuditMixin, SoftDeleteMixin, models.Model):
    CATEGORIA_CHOICES = [
        ("hardware", "Hardware"),
        ("software", "Software"),
        ("rede", "Rede"),
        ("acesso", "Acesso"),
        ("mobile", "Mobile"),
        ("infraestrutura", "Infraestrutura"),
        ("equipamento", "Equipamento"),
        ("outro", "Outro"),
    ]
    PRIORIDADE_CHOICES = [
        ("critica", "Crítica"),
        ("alta", "Alta"),
        ("media", "Média"),
        ("baixa", "Baixa"),
    ]
    STATUS_CHOICES = [
        ("aberto", "Aberto"),
        ("em_atendimento", "Em atendimento"),
        ("aguardando", "Aguardando"),
        ("resolvido", "Resolvido"),
        ("fechado", "Fechado"),
    ]

    titulo = models.CharField(max_length=255)
    descricao = models.TextField(blank=True)
    solicitante = models.CharField(max_length=200)
    categoria = models.CharField(max_length=20, choices=CATEGORIA_CHOICES, default="outro")
    prioridade = models.CharField(max_length=10, choices=PRIORIDADE_CHOICES, default="media")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="aberto")
    # Positive = horas restantes antes do vencimento do SLA; negative = SLA já violado
    sla_horas = models.IntegerField(default=24)
    atendente = models.CharField(max_length=200, blank=True)
    created_at = models.DateTimeField(default=timezone.now)
    resolvido_em = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["tenant_id", "status"]),
            models.Index(fields=["tenant_id", "prioridade"]),
        ]

    def __str__(self):
        return f"{self.id} — {self.titulo}"


class EquipamentoTI(TenantMixin, AuditMixin, SoftDeleteMixin, models.Model):
    TIPO_CHOICES = [
        ("notebook", "Notebook"),
        ("desktop", "Desktop"),
        ("servidor", "Servidor"),
        ("switch", "Switch"),
        ("roteador", "Roteador"),
        ("impressora", "Impressora"),
        ("monitor", "Monitor"),
        ("outro", "Outro"),
    ]
    STATUS_CHOICES = [
        ("ativo", "Ativo"),
        ("manutencao", "Em manutenção"),
        ("disponivel", "Disponível"),
        ("descarte", "Descarte"),
    ]

    codigo = models.CharField(max_length=50)
    nome = models.CharField(max_length=200)
    tipo = models.CharField(max_length=20, choices=TIPO_CHOICES, default="notebook")
    usuario = models.CharField(max_length=200, blank=True)
    setor = models.CharField(max_length=100, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="ativo")
    ultima_revisao = models.DateField(null=True, blank=True)
    observacoes = models.TextField(blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["codigo"]
        indexes = [
            models.Index(fields=["tenant_id", "status"]),
            models.Index(fields=["tenant_id", "tipo"]),
        ]
        constraints = [
            models.UniqueConstraint(fields=["tenant_id", "codigo"], name="uniq_equipamento_codigo_per_tenant")
        ]

    def __str__(self):
        return f"{self.codigo} — {self.nome}"

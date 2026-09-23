from django.db import models
from django.utils import timezone
from django.contrib.postgres.fields import ArrayField
from core.mixins import TenantMixin, AuditMixin, SoftDeleteMixin


class CentroCusto(TenantMixin, AuditMixin, SoftDeleteMixin, models.Model):
    TENDENCIA_CHOICES = [
        ("up", "Crescente"),
        ("down", "Decrescente"),
        ("stable", "Estável"),
    ]

    nome = models.CharField(max_length=200)
    codigo = models.CharField(max_length=30, blank=True)
    budget = models.DecimalField(max_digits=16, decimal_places=2, default=0)
    realizado = models.DecimalField(max_digits=16, decimal_places=2, default=0)
    tendencia = models.CharField(max_length=10, choices=TENDENCIA_CHOICES, default="stable")
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["nome"]
        indexes = [models.Index(fields=["tenant_id"])]
        constraints = [
            models.UniqueConstraint(fields=["tenant_id", "codigo"], name="uniq_centro_custo_codigo_per_tenant")
        ]

    def __str__(self):
        return self.nome


class EntradaAuditoria(TenantMixin, models.Model):
    CRITICIDADE_CHOICES = [
        ("baixa", "Baixa"),
        ("media", "Média"),
        ("alta", "Alta"),
        ("critica", "Crítica"),
    ]
    ACAO_CHOICES = [
        ("CREATE", "Criação"),
        ("UPDATE", "Atualização"),
        ("DELETE", "Exclusão"),
        ("LOGIN", "Login"),
        ("EXPORT", "Exportação"),
        ("VIEW", "Visualização"),
    ]

    usuario = models.CharField(max_length=150)
    modulo = models.CharField(max_length=100)
    acao = models.CharField(max_length=20, choices=ACAO_CHOICES)
    recurso = models.CharField(max_length=255)
    ip = models.GenericIPAddressField(null=True, blank=True)
    detalhes = models.TextField(blank=True)
    criticidade = models.CharField(max_length=10, choices=CRITICIDADE_CHOICES, default="baixa")
    created_at = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["tenant_id", "created_at"]),
            models.Index(fields=["tenant_id", "modulo"]),
            models.Index(fields=["tenant_id", "acao"]),
        ]

    def __str__(self):
        return f"[{self.acao}] {self.recurso} by {self.usuario}"


class AlertaConformidade(TenantMixin, AuditMixin, SoftDeleteMixin, models.Model):
    SEVERIDADE_CHOICES = [
        ("critico", "Crítico"),
        ("alto", "Alto"),
        ("medio", "Médio"),
        ("baixo", "Baixo"),
    ]
    STATUS_CHOICES = [
        ("aberto", "Aberto"),
        ("em_analise", "Em análise"),
        ("resolvido", "Resolvido"),
        ("ignorado", "Ignorado"),
    ]

    titulo = models.CharField(max_length=300)
    severidade = models.CharField(max_length=10, choices=SEVERIDADE_CHOICES)
    tags = ArrayField(models.CharField(max_length=50), default=list, blank=True)
    descricao = models.TextField(blank=True)
    prazo = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=15, choices=STATUS_CHOICES, default="aberto")
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["tenant_id", "severidade", "status"]),
        ]

    def __str__(self):
        return f"[{self.severidade}] {self.titulo}"

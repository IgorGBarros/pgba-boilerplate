from django.db import models
from django.utils import timezone
from core.mixins import TenantMixin, AuditMixin, SoftDeleteMixin


class Sprint(TenantMixin, AuditMixin, SoftDeleteMixin, models.Model):
    STATUS_CHOICES = [
        ("planejado", "Planejado"),
        ("ativo", "Ativo"),
        ("concluido", "Concluído"),
        ("cancelado", "Cancelado"),
    ]

    nome = models.CharField(max_length=100)
    numero = models.PositiveIntegerField(default=1)
    data_inicio = models.DateField()
    data_fim = models.DateField()
    status = models.CharField(max_length=15, choices=STATUS_CHOICES, default="planejado")
    velocidade_planejada = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-numero"]
        indexes = [models.Index(fields=["tenant_id", "status"])]

    def __str__(self):
        return f"{self.nome} (Sprint {self.numero})"


class SprintTask(TenantMixin, AuditMixin, SoftDeleteMixin, models.Model):
    TIPO_CHOICES = [
        ("feature", "Feature"),
        ("bug", "Bug"),
        ("chore", "Chore"),
    ]
    STATUS_CHOICES = [
        ("backlog", "Backlog"),
        ("em_dev", "Em Dev"),
        ("review", "Review"),
        ("done", "Done"),
    ]
    PRIORIDADE_CHOICES = [
        ("alta", "Alta"),
        ("media", "Média"),
        ("baixa", "Baixa"),
    ]

    sprint = models.ForeignKey(Sprint, on_delete=models.CASCADE, related_name="tasks")
    titulo = models.CharField(max_length=255)
    tipo = models.CharField(max_length=10, choices=TIPO_CHOICES, default="feature")
    pontos = models.PositiveIntegerField(default=1)
    responsavel = models.CharField(max_length=200, blank=True)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="backlog")
    prioridade = models.CharField(max_length=6, choices=PRIORIDADE_CHOICES, default="media")
    descricao = models.TextField(blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["sprint", "prioridade", "-pontos"]
        indexes = [
            models.Index(fields=["tenant_id", "sprint", "status"]),
        ]

    def __str__(self):
        return self.titulo


class PullRequest(TenantMixin, AuditMixin, SoftDeleteMixin, models.Model):
    STATUS_CHOICES = [
        ("open", "Open"),
        ("review", "Em revisão"),
        ("merged", "Merged"),
        ("closed", "Closed"),
    ]

    numero = models.PositiveIntegerField()
    titulo = models.CharField(max_length=255)
    autor = models.CharField(max_length=200)
    branch = models.CharField(max_length=200)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="open")
    revisoes = models.PositiveIntegerField(default=0)
    conflitos = models.BooleanField(default=False)
    data_criacao = models.DateField(default=timezone.now)
    merged_em = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-numero"]
        indexes = [
            models.Index(fields=["tenant_id", "status"]),
        ]
        constraints = [
            models.UniqueConstraint(fields=["tenant_id", "numero"], name="uniq_pr_numero_per_tenant")
        ]

    def __str__(self):
        return f"#{self.numero} {self.titulo}"


class Pipeline(TenantMixin, AuditMixin, SoftDeleteMixin, models.Model):
    STATUS_CHOICES = [
        ("success", "Sucesso"),
        ("running", "Executando"),
        ("failed", "Falhou"),
        ("pending", "Pendente"),
        ("cancelled", "Cancelado"),
    ]

    nome = models.CharField(max_length=255)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="pending")
    branch = models.CharField(max_length=200)
    duracao = models.CharField(max_length=20, blank=True)
    commit_sha = models.CharField(max_length=40, blank=True)
    autor = models.CharField(max_length=200, blank=True)
    executado_em = models.DateTimeField(default=timezone.now)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-executado_em"]
        indexes = [
            models.Index(fields=["tenant_id", "status"]),
            models.Index(fields=["tenant_id", "branch"]),
        ]

    def __str__(self):
        return f"{self.nome} ({self.branch})"

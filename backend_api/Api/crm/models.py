from django.db import models
from django.utils import timezone
from core.mixins import TenantMixin, AuditMixin, SoftDeleteMixin


class Lead(TenantMixin, AuditMixin, SoftDeleteMixin, models.Model):
    STATUS_CHOICES = [
        ("novo", "Novo"),
        ("contato", "Contato feito"),
        ("qualificado", "Qualificado"),
        ("proposta", "Proposta enviada"),
        ("negociacao", "Em negociação"),
        ("ganho", "Ganho"),
        ("perdido", "Perdido"),
    ]
    ORIGEM_CHOICES = [
        ("site", "Site"),
        ("indicacao", "Indicação"),
        ("social", "Redes sociais"),
        ("evento", "Evento"),
        ("cold_outreach", "Cold outreach"),
        ("outro", "Outro"),
    ]

    nome = models.CharField(max_length=200)
    empresa = models.CharField(max_length=200, blank=True)
    email = models.EmailField(blank=True)
    telefone = models.CharField(max_length=30, blank=True)
    cargo = models.CharField(max_length=100, blank=True)
    valor_estimado = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    status = models.CharField(max_length=15, choices=STATUS_CHOICES, default="novo")
    responsavel = models.CharField(max_length=200, blank=True)
    origem = models.CharField(max_length=20, choices=ORIGEM_CHOICES, default="outro")
    observacoes = models.TextField(blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["tenant_id", "status"]),
            models.Index(fields=["tenant_id", "responsavel"]),
        ]

    def __str__(self):
        return f"{self.nome} ({self.empresa})"


class Contato(TenantMixin, AuditMixin, SoftDeleteMixin, models.Model):
    nome = models.CharField(max_length=200)
    empresa = models.CharField(max_length=200, blank=True)
    cargo = models.CharField(max_length=100, blank=True)
    email = models.EmailField(blank=True)
    telefone = models.CharField(max_length=30, blank=True)
    lead = models.ForeignKey(
        Lead, on_delete=models.SET_NULL, null=True, blank=True, related_name="contatos"
    )
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["nome"]
        indexes = [models.Index(fields=["tenant_id"])]

    def __str__(self):
        return self.nome


class Oportunidade(TenantMixin, AuditMixin, SoftDeleteMixin, models.Model):
    STATUS_CHOICES = [
        ("prospeccao", "Prospecção"),
        ("qualificacao", "Qualificação"),
        ("proposta", "Proposta"),
        ("negociacao", "Negociação"),
        ("ganho", "Ganho"),
        ("perdido", "Perdido"),
    ]

    titulo = models.CharField(max_length=255)
    lead = models.ForeignKey(
        Lead, on_delete=models.CASCADE, related_name="oportunidades"
    )
    valor = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    status = models.CharField(max_length=15, choices=STATUS_CHOICES, default="prospeccao")
    data_fechamento_previsto = models.DateField(null=True, blank=True)
    observacoes = models.TextField(blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["tenant_id", "status"])]

    def __str__(self):
        return self.titulo


class AtividadeCRM(TenantMixin, AuditMixin, SoftDeleteMixin, models.Model):
    TIPO_CHOICES = [
        ("ligacao", "Ligação"),
        ("email", "E-mail"),
        ("reuniao", "Reunião"),
        ("visita", "Visita"),
        ("proposta", "Proposta"),
        ("outro", "Outro"),
    ]

    titulo = models.CharField(max_length=255)
    tipo = models.CharField(max_length=15, choices=TIPO_CHOICES, default="ligacao")
    lead = models.ForeignKey(
        Lead, on_delete=models.CASCADE, related_name="atividades"
    )
    responsavel = models.CharField(max_length=200, blank=True)
    data_hora = models.DateTimeField(default=timezone.now)
    resultado = models.TextField(blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-data_hora"]
        indexes = [
            models.Index(fields=["tenant_id", "data_hora"]),
            models.Index(fields=["tenant_id", "lead"]),
        ]

    def __str__(self):
        return self.titulo

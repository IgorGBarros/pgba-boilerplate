from django.db import models
from django.utils import timezone
from core.mixins import TenantMixin, AuditMixin, SoftDeleteMixin


class ScrapingJob(TenantMixin, AuditMixin, SoftDeleteMixin, models.Model):
    class JobType(models.TextChoices):
        GOOGLE_MAPS = "google_maps", "Google Maps"
        URL = "url", "URL (extração inteligente)"

    class Status(models.TextChoices):
        PENDING = "pending", "Aguardando"
        RUNNING = "running", "Executando"
        DONE = "done", "Concluído"
        FAILED = "failed", "Falhou"

    job_type = models.CharField(max_length=20, choices=JobType.choices)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)

    # Parâmetros de entrada
    query = models.CharField(max_length=500, blank=True, help_text="Busca Google Maps ou URL a extrair")
    lat = models.CharField(max_length=30, blank=True)
    lng = models.CharField(max_length=30, blank=True)
    depth = models.IntegerField(default=5, help_text="Profundidade de busca (Google Maps)")
    extraction_schema = models.JSONField(
        null=True, blank=True,
        help_text="Schema desejado para extração de URL (ex: {'nome': str, 'preco': str})",
    )

    # Resultados
    results = models.JSONField(default=list)
    result_count = models.IntegerField(default=0)
    error_message = models.TextField(blank=True)

    # Timestamps
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    # Rastreabilidade
    external_job_id = models.CharField(max_length=100, blank=True, help_text="ID do job no gmaps-scraper")
    imported_to_crm = models.BooleanField(default=False)
    imported_count = models.IntegerField(default=0)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["tenant_id", "status"]),
            models.Index(fields=["tenant_id", "job_type"]),
        ]

    def __str__(self):
        return f"[{self.job_type}] {self.query[:50]} — {self.status}"

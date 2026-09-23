from django.db import models
from django.utils import timezone
from core.mixins import TenantMixin


class SyncEvent(TenantMixin, models.Model):
    """Registro de uma sincronização do vault Obsidian."""
    source_name = models.CharField(max_length=200, blank=True)
    added = models.PositiveIntegerField(default=0)
    updated = models.PositiveIntegerField(default=0)
    removed = models.PositiveIntegerField(default=0)
    duration_ms = models.PositiveIntegerField(default=0)
    status = models.CharField(max_length=20, default="success")
    error_message = models.TextField(blank=True)
    created_at = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["tenant_id", "created_at"])]

    def __str__(self):
        return f"Sync {self.created_at:%Y-%m-%d %H:%M} (+{self.added} ~{self.updated} -{self.removed})"

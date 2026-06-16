# backend_api/core/mixins.py
from django.db import models
from django.utils import timezone
from simple_history.models import HistoricalRecords  # ← Certifique-se que django-simple-history está instalado


class TenantMixin(models.Model):
    tenant_id = models.UUIDField(editable=False, db_index=True, null=True, blank=True)
    
    class Meta:
        abstract = True
    
    def save(self, *args, **kwargs):
        if not self.tenant_id and hasattr(self, '_current_tenant'):
            self.tenant_id = self._current_tenant
        super().save(*args, **kwargs)


class AuditMixin(models.Model):
    history = HistoricalRecords(inherit=True)
    
    class Meta:
        abstract = True


class SoftDeleteMixin(models.Model):
    deleted_at = models.DateTimeField(null=True, blank=True)
    is_active = models.BooleanField(default=True, db_index=True)
    
    class Meta:
        abstract = True
    
    def delete(self, *args, **kwargs):
        self.is_active = False
        self.deleted_at = timezone.now()
        self.save()
    
    def hard_delete(self, *args, **kwargs):
        super().delete(*args, **kwargs)
    
    @classmethod
    def active_objects(cls):
        return cls.objects.filter(is_active=True)
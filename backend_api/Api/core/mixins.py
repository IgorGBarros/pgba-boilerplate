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


class TenantContextMixin:
    """
    Mixin de DRF — NÃO confundir com `TenantMixin` acima (que é de model).

    Resolve `request.tenant_id` a partir de `request.user.tenant_id`
    DEPOIS que o DRF autentica de verdade a requisição (`initial()` roda
    depois de `perform_authentication`).

    Por que isso existe e não `core.middleware.tenant.TenantMiddleware`:
    middleware de Django roda ANTES de qualquer coisa do DRF — inclusive
    antes da autenticação JWT, que só acontece dentro do `dispatch()` da
    view. Ou seja, `request.user` visto por um middleware comum é sempre
    `AnonymousUser` numa request de API, mesmo com um Bearer token válido
    no header. Isso fazia `request.tenant_id` nunca ser definido de
    verdade em produção — todo `TenantScopedMixin.get_queryset()` sempre
    devolvia lista vazia. Corrigido resolvendo no lugar certo: dentro do
    ciclo de vida do DRF, depois da autenticação.

    Toda APIView/ViewSet do projeto que precisa de `request.tenant_id`
    deve herdar deste mixin (antes de APIView/ViewSet na ordem do MRO).
    """

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        user = request.user
        if user and user.is_authenticated and getattr(user, "tenant_id", None):
            request.tenant_id = user.tenant_id


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
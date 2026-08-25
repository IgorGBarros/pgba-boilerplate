# backend_api/Api/orchestration/admin.py
from django.contrib import admin

from orchestration.models import QueryLog


@admin.register(QueryLog)
class QueryLogAdmin(admin.ModelAdmin):
    list_display = (
        "created_at", "tenant_id", "status", "function_called",
        "model_category", "latency_ms",
    )
    list_filter = ("status", "model_category")
    search_fields = ("question", "function_called")
    readonly_fields = [f.name for f in QueryLog._meta.fields]

    def has_add_permission(self, request):
        return False  # QueryLog só é criado pelo pipeline, nunca manualmente

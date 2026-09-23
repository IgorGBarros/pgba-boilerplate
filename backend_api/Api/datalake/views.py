from django.apps import apps
from django.db import connection
from rest_framework import viewsets, filters
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import serializers
from django_filters.rest_framework import DjangoFilterBackend
from core.mixins import TenantContextMixin
from agency.views import TenantScopedMixin
from datalake.models import SyncEvent


class SyncEventSerializer(serializers.ModelSerializer):
    duration = serializers.SerializerMethodField()

    class Meta:
        model = SyncEvent
        fields = [
            "id", "source_name", "added", "updated", "removed",
            "duration_ms", "duration", "status", "error_message", "created_at",
        ]
        read_only_fields = ["id", "created_at", "duration"]

    def get_duration(self, obj):
        ms = obj.duration_ms
        if ms < 1000:
            return f"{ms}ms"
        return f"{ms / 1000:.1f}s"


class SyncEventViewSet(TenantContextMixin, TenantScopedMixin, viewsets.ModelViewSet):
    queryset = SyncEvent.objects.all()
    serializer_class = SyncEventSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ["status"]
    ordering_fields = ["created_at"]


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def schema_catalog(request):
    """
    Retorna um catálogo dos apps Django instalados com seus modelos e contagem de registros.
    Usado pelo DataLake para exibição do schema real do banco.
    """
    SKIP_APPS = {
        "admin", "auth", "contenttypes", "sessions", "messages",
        "staticfiles", "token_blacklist",
    }

    catalog = []
    for app_config in apps.get_app_configs():
        label = app_config.label
        if label in SKIP_APPS:
            continue

        tables = []
        for model in app_config.get_models():
            meta = model._meta
            if meta.proxy or meta.abstract:
                continue
            try:
                row_count = model.objects.count()
            except Exception:
                row_count = 0

            columns = []
            for field in meta.get_fields():
                if not hasattr(field, "column"):
                    continue
                columns.append({
                    "name": field.name,
                    "type": type(field).__name__.upper().replace("FIELD", ""),
                    "nullable": getattr(field, "null", False),
                    "description": str(getattr(field, "verbose_name", field.name)),
                })

            tables.append({
                "name": meta.db_table,
                "rows": row_count,
                "columns": columns,
                "description": str(meta.verbose_name_plural or meta.db_table),
            })

        if tables:
            catalog.append({
                "id": label,
                "label": app_config.verbose_name or label,
                "tables": tables,
            })

    return Response(catalog)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def obsidian_notes(request):
    """
    Retorna documentos do vault Obsidian do tenant atual via ingestion.Document.
    """
    tenant_id = getattr(request, "tenant_id", None)
    if not tenant_id:
        return Response([])

    try:
        from ingestion.models import Document, KnowledgeSource
        sources = KnowledgeSource.objects.filter(
            tenant_id=tenant_id, source_type="obsidian"
        ).values_list("id", flat=True)

        docs = Document.objects.filter(
            tenant_id=tenant_id, source_id__in=list(sources)
        ).select_related("source").order_by("-updated_at")[:100]

        result = []
        for doc in docs:
            meta = doc.metadata or {}
            result.append({
                "id": doc.id,
                "title": doc.title or doc.source_path or "(sem título)",
                "tags": meta.get("tags", []),
                "last_modified": doc.updated_at.strftime("%Y-%m-%d") if doc.updated_at else None,
                "chunks": doc.chunks.count() if hasattr(doc, "chunks") else 0,
                "has_embedding": doc.chunks.filter(embedding__isnull=False).exists() if hasattr(doc, "chunks") else False,
                "status": "excluded" if doc.is_private else "indexed",
            })
        return Response(result)
    except Exception:
        return Response([])

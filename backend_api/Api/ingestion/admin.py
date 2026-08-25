# backend_api/Api/ingestion/admin.py
from django.contrib import admin

from ingestion.models import KnowledgeSource, Document, DocumentChunk


@admin.register(KnowledgeSource)
class KnowledgeSourceAdmin(admin.ModelAdmin):
    list_display = ("name", "source_type", "tenant_id", "last_synced_at", "is_active")
    list_filter = ("source_type", "is_active")
    search_fields = ("name",)


@admin.register(Document)
class DocumentAdmin(admin.ModelAdmin):
    list_display = ("title", "source", "status", "tenant_id", "indexed_at")
    list_filter = ("status", "source__source_type")
    search_fields = ("title", "external_id")
    readonly_fields = ("content_hash", "indexed_at")


@admin.register(DocumentChunk)
class DocumentChunkAdmin(admin.ModelAdmin):
    list_display = ("document", "chunk_index", "token_count", "tenant_id")
    # Embeddings nunca aparecem legíveis no admin — não há motivo para expor
    exclude = ("embedding",)

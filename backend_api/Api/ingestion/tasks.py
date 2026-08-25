# backend_api/Api/ingestion/tasks.py
"""
Tarefas assíncronas do módulo ingestion.

Indexar documentos e sincronizar vaults do Obsidian pode ser lento
(cada chunk é uma chamada de embedding). Nunca faça isso na thread de
uma request HTTP — sempre via Celery.
"""
import logging

from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(bind=True, max_retries=3, default_retry_delay=30)
def process_document_task(self, document_id: int):
    """Indexa (chunk + embed) um único Document pelo id."""
    from ingestion.models import Document
    from ingestion.services import index_document, EmbeddingError

    try:
        document = Document.objects.get(id=document_id)
    except Document.DoesNotExist:
        logger.warning("process_document_task: Document %s não existe.", document_id)
        return

    try:
        index_document(document)
    except EmbeddingError as exc:
        # Harness: tenta de novo antes de desistir (ex: Ollama reiniciando)
        raise self.retry(exc=exc)


@shared_task(bind=True, max_retries=2, default_retry_delay=60)
def sync_obsidian_source_task(self, source_id):
    """Sincroniza um KnowledgeSource do tipo Obsidian pelo id."""
    from ingestion.models import KnowledgeSource
    from ingestion.services import sync_obsidian_source

    try:
        source = KnowledgeSource.objects.get(id=source_id)
    except KnowledgeSource.DoesNotExist:
        logger.warning("sync_obsidian_source_task: source %s não existe.", source_id)
        return

    try:
        stats = sync_obsidian_source(source)
        logger.info("Sync Obsidian [%s] concluído: %s", source.name, stats)
        return stats
    except Exception as exc:
        logger.error("Falha no sync Obsidian [%s]: %s", source.name, exc)
        raise self.retry(exc=exc)


@shared_task
def sync_all_obsidian_sources_task():
    """
    Task periódica (agendar via Celery Beat, ex: a cada 15 min) que
    sincroniza todos os KnowledgeSource do tipo Obsidian ativos.
    """
    from ingestion.models import KnowledgeSource

    sources = KnowledgeSource.objects.filter(
        source_type=KnowledgeSource.SourceType.OBSIDIAN, is_active=True
    )
    for source in sources:
        sync_obsidian_source_task.delay(source.id)
    return {"sources_enqueued": sources.count()}

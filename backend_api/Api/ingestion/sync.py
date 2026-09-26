# backend_api/Api/ingestion/sync.py
"""
Sincronização dos conectores de conteúdo (ingestion.connectors, mode="documents").

    conector.fetch() → SyncItem → redact_pii → Document (upsert por external_id)
                                              → indexação (Celery) se o conteúdo mudou

- conteúdo igual (mesmo hash) não reindexa;
- conector de snapshot completo: o que sumiu da fonte sai do índice
  (exclusão lógica — o Document fica no banco, fora da busca);
- toda execução vira um SourceSyncRun (o histórico do painel do conector);
- erro nunca é silencioso: fica na execução e em `source.last_sync_message`.
"""
from __future__ import annotations

import logging

from django.db import transaction
from django.utils import timezone

from core.utils.lgpd import redact_pii
from ingestion.connectors import ConnectorError, SyncItem, get_connector
from ingestion.models import Document, KnowledgeSource, SourceSyncRun
from ingestion.services import sha256_of

logger = logging.getLogger(__name__)

MAX_CONTENT = 200_000  # caracteres por documento


def _enqueue_index(document_id: int) -> None:
    from ingestion.tasks import process_document_task

    try:
        process_document_task.delay(document_id)
    except Exception:  # broker fora do ar: indexa no próximo sync (status fica pending)
        logger.warning("Broker indisponível; documento %s fica pendente de indexação.", document_id)


def upsert_item(source: KnowledgeSource, item: SyncItem) -> str:
    """Grava um SyncItem. Devolve 'created' | 'updated' | 'unchanged'."""
    content = redact_pii(item.content or "")[:MAX_CONTENT]
    title = redact_pii(item.title or "")[:500] or item.external_id[:500]
    external_id = item.external_id[:1024]
    digest = sha256_of(content)
    doc = Document.objects.filter(source=source, external_id=external_id).first()
    if doc and doc.content_hash == digest and doc.is_active and doc.title == title:
        return "unchanged"
    metadata = {
        **(doc.metadata if doc else {}),
        **(item.metadata or {}),
        "conector": source.source_type,
    }
    if doc is None:
        doc = Document.objects.create(
            tenant_id=source.tenant_id,
            source=source,
            external_id=external_id,
            title=title,
            content=content,
            content_hash=digest,
            metadata=metadata,
            status=Document.Status.PENDING,
        )
        result = "created"
    else:
        doc.title, doc.content, doc.content_hash, doc.metadata = title, content, digest, metadata
        doc.status, doc.is_active, doc.deleted_at = Document.Status.PENDING, True, None
        doc.save()
        result = "updated"
    transaction.on_commit(lambda: _enqueue_index(doc.id))
    return result


def _sync_obsidian(source, counts: dict) -> str:
    from ingestion.services import sync_obsidian_source

    try:
        stats = sync_obsidian_source(source)
    except ValueError as exc:
        raise ConnectorError(str(exc)) from exc
    counts.update({k: stats.get(k, 0) for k in ("created", "updated", "unchanged")})
    return f"{sum(counts.values())} nota(s) lida(s); {stats.get('skipped', 0)} ignorada(s)."


def _sync_connector(source, counts: dict) -> str:
    connector = get_connector(source)
    if connector.mode != "documents":
        raise ConnectorError("Este conector não copia dados: os agentes consultam na hora.")
    seen: set[str] = set()
    for item in connector.fetch():
        with transaction.atomic():
            counts[upsert_item(source, item)] += 1
        seen.add(item.external_id[:1024])
    if connector.full_snapshot:
        gone = Document.objects.filter(source=source, is_active=True).exclude(external_id__in=seen)
        counts["removed"] = gone.update(is_active=False, deleted_at=timezone.now())
    return f"{counts['created'] + counts['updated'] + counts['unchanged']} registro(s) lido(s)."


def sync_source(
    source: KnowledgeSource, trigger: str = SourceSyncRun.Trigger.MANUAL
) -> SourceSyncRun:
    """Roda a sincronização inteira de uma fonte. Nunca levanta: o erro fica na execução."""
    run = SourceSyncRun.objects.create(tenant_id=source.tenant_id, source=source, trigger=trigger)
    KnowledgeSource.objects.filter(pk=source.pk).update(
        last_sync_status=KnowledgeSource.SyncStatus.RUNNING
    )
    counts = {"created": 0, "updated": 0, "unchanged": 0, "removed": 0}
    try:
        if source.source_type == KnowledgeSource.SourceType.OBSIDIAN:
            run.message = _sync_obsidian(source, counts)
        else:
            run.message = _sync_connector(source, counts)
        run.status = SourceSyncRun.Status.OK
    except ConnectorError as exc:
        run.status, run.message = SourceSyncRun.Status.ERROR, str(exc)
    except Exception as exc:  # bug/inesperado: registra e segue (o agendador tenta de novo)
        logger.exception("Sync do conector %s falhou", source.pk)
        run.status, run.message = SourceSyncRun.Status.ERROR, f"Erro inesperado: {exc}"[:1000]
    run.finished_at = timezone.now()
    for k, v in counts.items():
        setattr(run, k, v)
    run.save()
    update = {"last_sync_status": run.status, "last_sync_message": run.message}
    if run.status == SourceSyncRun.Status.OK:
        update["last_synced_at"] = run.finished_at
    KnowledgeSource.objects.filter(pk=source.pk).update(**update)
    return run


def sources_due(now=None):
    """Fontes com sincronização automática vencida (intervalo em minutos)."""
    now = now or timezone.now()
    due = []
    qs = KnowledgeSource.objects.filter(is_active=True, sync_interval_minutes__gt=0).exclude(
        last_sync_status=KnowledgeSource.SyncStatus.RUNNING
    )
    for source in qs:
        last = source.sync_runs.order_by("-started_at").values_list("started_at", flat=True).first()
        if last is None or (now - last).total_seconds() >= source.sync_interval_minutes * 60:
            due.append(source)
    return due


# ─── Webhook ─────────────────────────────────────────────────────────────────


def receive_webhook(source: KnowledgeSource, payload) -> Document:
    """Um POST recebido vira um Document (mesmo caminho do sync: LGPD, hash, indexação)."""
    connector = get_connector(source)
    item = connector.item_from_payload(payload)
    with transaction.atomic():
        result = upsert_item(source, item)
        SourceSyncRun.objects.create(
            tenant_id=source.tenant_id,
            source=source,
            trigger=SourceSyncRun.Trigger.WEBHOOK,
            status=SourceSyncRun.Status.OK,
            finished_at=timezone.now(),
            created=int(result == "created"),
            updated=int(result == "updated"),
            unchanged=int(result == "unchanged"),
            message=f"Recebido: {item.title[:120]}",
        )
        KnowledgeSource.objects.filter(pk=source.pk).update(
            last_synced_at=timezone.now(),
            last_sync_status=KnowledgeSource.SyncStatus.OK,
            last_sync_message="Último webhook recebido.",
        )
    return Document.objects.get(source=source, external_id=item.external_id[:1024])

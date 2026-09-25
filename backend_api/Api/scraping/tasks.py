"""
scraping.tasks — Celery tasks assíncronos para jobs de scraping.
"""
import logging
import time

from celery import shared_task

from scraping.models import ScrapingJob
from scraping.services import (
    gmaps_create_job, gmaps_get_job, gmaps_normalize_results, url_scrape,
)

logger = logging.getLogger(__name__)

POLL_INTERVAL = 5   # segundos entre verificações de status
MAX_WAIT = 600       # timeout máximo de 10 minutos

DONE_STATUSES = {"completed", "done", "finished", "complete", "success", "succeeded"}
FAIL_STATUSES = {"failed", "error", "cancelled", "canceled"}


def _extract_raw_results(data: dict) -> list:
    """Extrai lista de resultados de qualquer formato de resposta do scraper."""
    for key in ("data", "results", "places", "items"):
        val = data.get(key)
        if val and isinstance(val, list):
            return val
    return []


@shared_task(bind=True, max_retries=2, default_retry_delay=30)
def run_google_maps_job(self, scraping_job_id: int):
    """
    Executa um job de Google Maps no container scraper e salva os resultados.
    Faz polling até o job terminar ou atingir MAX_WAIT.
    Salva resultados parciais a cada poll para exibição progressiva no frontend.
    """
    try:
        job = ScrapingJob.objects.get(id=scraping_job_id)
    except ScrapingJob.DoesNotExist:
        logger.error("ScrapingJob %s não encontrado", scraping_job_id)
        return

    job.status = ScrapingJob.Status.RUNNING
    job.save(update_fields=["status", "updated_at"])

    try:
        ext_id = gmaps_create_job(job.query, job.lat, job.lng, job.depth)
        job.external_job_id = str(ext_id)
        job.save(update_fields=["external_job_id", "updated_at"])

        elapsed = 0
        while elapsed < MAX_WAIT:
            time.sleep(POLL_INTERVAL)
            elapsed += POLL_INTERVAL

            data = gmaps_get_job(ext_id)
            ext_status = str(data.get("status", "")).lower()
            logger.info("Google Maps job %s — status=%s elapsed=%ds", ext_id, ext_status, elapsed)

            # Salva resultados parciais para exibição progressiva
            raw = _extract_raw_results(data)
            if raw:
                normalized = gmaps_normalize_results(raw)
                if len(normalized) != job.result_count:
                    job.results = normalized
                    job.result_count = len(normalized)
                    job.save(update_fields=["results", "result_count", "updated_at"])
                    logger.info("Google Maps job %s — %d resultados parciais salvos", ext_id, len(normalized))

            if ext_status in DONE_STATUSES:
                # Garante que salvamos os resultados finais mesmo que já tenham sido parciais
                if not raw:
                    raw = _extract_raw_results(data)
                normalized = gmaps_normalize_results(raw if isinstance(raw, list) else [raw])
                job.results = normalized
                job.result_count = len(normalized)
                job.status = ScrapingJob.Status.DONE
                job.save(update_fields=["results", "result_count", "status", "updated_at"])
                logger.info("Google Maps job %s concluído: %d resultados", ext_id, len(normalized))
                return

            if ext_status in FAIL_STATUSES:
                job.status = ScrapingJob.Status.FAILED
                job.error_message = data.get("error") or f"Status externo: {ext_status}"
                job.save(update_fields=["status", "error_message", "updated_at"])
                return

        # timeout
        job.status = ScrapingJob.Status.FAILED
        job.error_message = f"Timeout após {MAX_WAIT}s aguardando job externo {ext_id}"
        job.save(update_fields=["status", "error_message", "updated_at"])

    except Exception as exc:
        logger.exception("Erro no run_google_maps_job %s: %s", scraping_job_id, exc)
        try:
            job.status = ScrapingJob.Status.FAILED
            job.error_message = str(exc)[:500]
            job.save(update_fields=["status", "error_message", "updated_at"])
        except Exception:
            pass
        raise self.retry(exc=exc)


@shared_task(bind=True, max_retries=2, default_retry_delay=30)
def run_url_scrape_job(self, scraping_job_id: int):
    """
    Executa extração inteligente de URL via httpx + LLM (harness).
    """
    try:
        job = ScrapingJob.objects.get(id=scraping_job_id)
    except ScrapingJob.DoesNotExist:
        logger.error("ScrapingJob %s não encontrado", scraping_job_id)
        return

    job.status = ScrapingJob.Status.RUNNING
    job.save(update_fields=["status", "updated_at"])

    try:
        result = url_scrape(
            tenant_id=job.tenant_id,
            url=job.query,
            schema=job.extraction_schema,
        )
        job.results = [result] if isinstance(result, dict) else result
        job.result_count = 1
        job.status = ScrapingJob.Status.DONE
        job.save(update_fields=["results", "result_count", "status", "updated_at"])

    except Exception as exc:
        logger.exception("Erro no run_url_scrape_job %s: %s", scraping_job_id, exc)
        try:
            job.status = ScrapingJob.Status.FAILED
            job.error_message = str(exc)[:500]
            job.save(update_fields=["status", "error_message", "updated_at"])
        except Exception:
            pass
        raise self.retry(exc=exc)

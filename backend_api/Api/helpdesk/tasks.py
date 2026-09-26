# backend_api/Api/helpdesk/tasks.py
from __future__ import annotations

import logging

from celery import shared_task

logger = logging.getLogger(__name__)


def despachar(tarefa, *args) -> bool:
    """Enfileira; sem broker/worker disponível, roda na hora. Devolve True se enfileirou."""
    try:
        tarefa.delay(*args)
        return True
    except Exception:  # noqa: BLE001
        tarefa(*args)
        return False


@shared_task
def diagnosticar_task(incidente_id: int, tenant_id: str):
    from helpdesk import services
    from observabilidade.models import Incidente

    inc = Incidente.objects.filter(pk=incidente_id).first()
    if inc is None:
        return
    try:
        services.diagnosticar(tenant_id, inc)
    except Exception as exc:  # noqa: BLE001 — sem IA o chamado continua aberto
        logger.warning("Diagnóstico do incidente %s não saiu: %s", incidente_id, exc)
        inc.diagnostico = {"erro": str(exc)[:500]}
        inc.save(update_fields=["diagnostico"])

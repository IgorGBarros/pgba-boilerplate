# backend_api/Api/agency/celery_tasks.py
"""
Celery tasks para agency — execução assíncrona de Tasks de agentes.
Mantém `agency/tasks.py` como funções Python puras (sem dependência de
Celery), permitindo que sejam chamadas de forma síncrona em testes.
"""
from __future__ import annotations

import logging

from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(bind=True, max_retries=0, name="agency.execute_task_async")
def execute_task_async(self, tenant_id, task_id: int):
    """
    Executa uma Task de agente de forma assíncrona via Celery.
    Retorna o ID da Task após execução. A atualização em tempo real
    chega ao frontend via WebSocket (agency.realtime.broadcast_task_update).
    """
    from agency.tasks import execute_task, TaskStateError
    from harness.providers import ProviderConfigError

    try:
        task = execute_task(tenant_id, task_id)
        return task.id
    except TaskStateError as exc:
        logger.warning("execute_task_async: TaskStateError para task %s: %s", task_id, exc)
        raise
    except ProviderConfigError as exc:
        logger.error("execute_task_async: ProviderConfigError para task %s: %s", task_id, exc)
        raise
    except Exception as exc:
        logger.exception("execute_task_async: erro inesperado para task %s", task_id)
        raise

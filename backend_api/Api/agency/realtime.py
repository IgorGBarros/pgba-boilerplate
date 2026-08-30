# backend_api/Api/agency/realtime.py
"""
Ponte entre a lógica de negócio (agency/services.py) e o WebSocket
(agency/consumers.py). Publicar aqui NUNCA pode quebrar a operação
principal — se o Channel Layer estiver fora do ar por qualquer motivo,
loga e segue em frente; o polling (se o frontend ainda o usa como
fallback) continua funcionando de qualquer forma.
"""
import logging

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

logger = logging.getLogger(__name__)


def _group_send(tenant_id, event_type: str, data: dict) -> None:
    channel_layer = get_channel_layer()
    if channel_layer is None:
        return
    try:
        async_to_sync(channel_layer.group_send)(
            f"tenant_{tenant_id}", {"type": event_type, "data": data},
        )
    except Exception as exc:  # nunca deixa uma falha de broadcast derrubar a request HTTP
        logger.warning("Falha ao publicar evento em tempo real (%s): %s", event_type, exc)


def broadcast_task_update(task) -> None:
    from agency.serializers import TaskSerializer

    _group_send(task.tenant_id, "task.update", {"kind": "task", **TaskSerializer(task).data})


def broadcast_agent_update(agent) -> None:
    from agency.serializers import AgentSerializer

    _group_send(agent.tenant_id, "agent.update", {"kind": "agent", **AgentSerializer(agent).data})

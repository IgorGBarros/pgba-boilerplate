# backend_api/Api/agency/ws_ticket.py
"""
Tickets de uso único para conexão WebSocket.

O JWT de acesso não deve ir na query string do WebSocket pois query strings
aparecem em plaintext nos logs de qualquer reverse proxy (nginx, ALB, etc.).

Fluxo:
  1. Frontend faz POST /api/v1/agency/ws-ticket/ com Bearer token no header
  2. Recebe um ticket opaque de uso único (UUID) válido por WS_TICKET_TTL_S
  3. Conecta ao WebSocket com ?ticket=<uuid> na URL (não o JWT)
  4. JWTAuthMiddleware troca o ticket pelo usuário e o invalida imediatamente
"""
import uuid
import logging

from django.core.cache import cache

logger = logging.getLogger(__name__)

WS_TICKET_TTL_S = 15  # segundos — tempo para o frontend abrir a conexão


def _cache_key(ticket: str) -> str:
    return f"ws_ticket:{ticket}"


def issue_ticket(user_id) -> str:
    """Gera e armazena um ticket de uso único. Retorna o ticket."""
    ticket = str(uuid.uuid4())
    cache.set(_cache_key(ticket), str(user_id), timeout=WS_TICKET_TTL_S)
    return ticket


def consume_ticket(ticket: str) -> str | None:
    """
    Troca o ticket pelo user_id e o invalida. Retorna None se inválido/expirado.
    Operação atômica via get_or_set não existe no Django cache, mas o TTL
    curto (15s) + invalidação imediata tornam a janela de replay desprezível.
    """
    key = _cache_key(ticket)
    user_id = cache.get(key)
    if user_id is not None:
        cache.delete(key)
    return user_id

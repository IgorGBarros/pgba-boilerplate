# backend_api/Api/agency/ws_auth.py
"""
Autenticação de WebSocket via ticket de uso único.

O JWT não vai na query string pois apareceria em plaintext nos logs de
qualquer reverse proxy. O fluxo correto:
  1. Frontend: POST /api/v1/agency/ws-ticket/ → recebe {"ticket": "<uuid>"}
  2. Frontend: abre ws://.../ws/agency/?ticket=<uuid>
  3. JWTAuthMiddleware: troca o ticket pelo usuário, invalida o ticket

Ainda aceita ?token=<JWT> como fallback para ambientes de dev sem Redis
configurado (quando o cache é LocMemCache e não há proxy que logue URLs).
"""
from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from django.contrib.auth.models import AnonymousUser
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import AccessToken


@database_sync_to_async
def _get_user_from_token(token_str: str):
    from django.contrib.auth import get_user_model

    User = get_user_model()
    try:
        validated = AccessToken(token_str)
        return User.objects.get(id=validated["user_id"])
    except (TokenError, User.DoesNotExist, KeyError):
        return AnonymousUser()


@database_sync_to_async
def _get_user_from_ticket(ticket: str):
    from django.contrib.auth import get_user_model
    from agency.ws_ticket import consume_ticket

    user_id = consume_ticket(ticket)
    if not user_id:
        return AnonymousUser()
    User = get_user_model()
    try:
        return User.objects.get(id=user_id)
    except User.DoesNotExist:
        return AnonymousUser()


class JWTAuthMiddleware:
    """Substitui `channels.auth.AuthMiddlewareStack` (baseado em sessão,
    que não existe nesta API — só JWT) no roteamento ASGI."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        query_string = scope.get("query_string", b"").decode()
        params = parse_qs(query_string)

        ticket = params.get("ticket", [None])[0]
        if ticket:
            scope["user"] = await _get_user_from_ticket(ticket)
        else:
            # Fallback legado: ?token=<JWT> (apenas dev, sem proxy que logue URLs)
            token = params.get("token", [None])[0]
            scope["user"] = await _get_user_from_token(token) if token else AnonymousUser()

        return await self.app(scope, receive, send)

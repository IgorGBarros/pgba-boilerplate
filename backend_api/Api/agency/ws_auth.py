# backend_api/Api/agency/ws_auth.py
"""
A API nativa de WebSocket do navegador não permite configurar headers
customizados (`Authorization: Bearer ...`) na conexão — isso só existe em
HTTP normal. Toda autenticação JWT por WebSocket, em qualquer stack,
resolve isso do mesmo jeito: o token vai na própria URL
(`ws://host/ws/agency/?token=...`), e é validado manualmente aqui,
usando a MESMA lib (`rest_framework_simplejwt`) que autentica o resto da
API REST — não é uma segunda forma de autenticação, é a mesma, só
transportada de outro jeito.
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


class JWTAuthMiddleware:
    """Substitui `channels.auth.AuthMiddlewareStack` (baseado em sessão,
    que não existe nesta API — só JWT) no roteamento ASGI."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        query_string = scope.get("query_string", b"").decode()
        token = parse_qs(query_string).get("token", [None])[0]
        scope["user"] = await _get_user_from_token(token) if token else AnonymousUser()
        return await self.app(scope, receive, send)

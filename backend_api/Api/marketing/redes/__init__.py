# backend_api/Api/marketing/redes/__init__.py
"""Registro dos conectores de rede (`REDES[conta.rede]`) e renovação de token."""
from __future__ import annotations

from datetime import timedelta

from django.utils import timezone

from marketing.redes.base import RedeError, Resultado  # noqa: F401
from marketing.redes.discord import Discord
from marketing.redes.google import YouTube
from marketing.redes.linkedin import LinkedIn
from marketing.redes.meta import Facebook, Instagram
from marketing.redes.tiktok import TikTok
from marketing.redes.twitch import Twitch
from marketing.redes.x import X

REDES = {
    r.key: r
    for r in (Instagram(), TikTok(), YouTube(), Facebook(), LinkedIn(), X(), Discord(), Twitch())
}


def rede(key: str):
    try:
        return REDES[key]
    except KeyError as exc:
        raise RedeError(f"Rede desconhecida: {key}") from exc


def token_valido(conta) -> str:
    """Devolve o token de acesso, renovando se estiver pra vencer."""
    from marketing.models import PROVEDOR_OAUTH, AplicativoRede
    from marketing.redes.oauth import PROVEDORES

    if not conta.expira_em or conta.expira_em - timezone.now() > timedelta(minutes=5):
        return conta.token
    refresh = conta.refresh_token
    provedor = PROVEDOR_OAUTH.get(conta.rede)
    app = AplicativoRede.objects.filter(tenant_id=conta.tenant_id, provedor=provedor).first()
    if not refresh or app is None or provedor not in PROVEDORES:
        conta.status = "expirada"
        conta.mensagem = "Token expirado — conecte a conta de novo."
        conta.save(update_fields=["status", "mensagem"])
        raise RedeError(f"{conta}: token expirado — conecte a conta de novo.")
    try:
        tokens = PROVEDORES[provedor].renovar(app, refresh)
    except RedeError as exc:
        conta.status = "expirada"
        conta.mensagem = f"Não consegui renovar o token: {exc}"[:500]
        conta.save(update_fields=["status", "mensagem"])
        raise
    conta.token = tokens.access
    if tokens.refresh:
        conta.refresh_token = tokens.refresh
    conta.expira_em = (
        timezone.now() + timedelta(seconds=tokens.expires_in) if tokens.expires_in else None
    )
    conta.status = "conectada"
    conta.mensagem = ""
    conta.save(update_fields=["_token", "_refresh", "expira_em", "status", "mensagem"])
    return tokens.access

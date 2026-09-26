# backend_api/Api/marketing/redes/twitch.py
"""Twitch — não tem feed de posts. O que a API permite é um ANÚNCIO no chat
do canal (Helix `chat/announcements`); imagem/vídeo não vão. A tela avisa."""
from __future__ import annotations

from marketing.redes.base import Rede, RedeError, Resultado, chamar, json_de

HELIX = "https://api.twitch.tv/helix"


def _client_id(conta) -> str:
    from marketing.models import AplicativoRede

    app = AplicativoRede.objects.filter(tenant_id=conta.tenant_id, provedor="twitch").first()
    if app is None:
        raise RedeError("Falta o app da Twitch (Client ID) em Contas → Apps das redes.")
    return app.client_id


class Twitch(Rede):
    key = "twitch"
    nome = "Twitch"
    limite = 500
    aceita = {"texto"}
    max_imagens = 0
    max_videos = 0

    def _h(self, conta):
        return {"Authorization": f"Bearer {conta.token}", "Client-Id": _client_id(conta)}

    def testar(self, conta) -> str:
        d = (json_de(chamar("GET", f"{HELIX}/users", headers=self._h(conta))).get("data") or [{}])[
            0
        ]
        return f"Conectado como {d.get('display_name') or d.get('login') or '?'}."

    def conferir(self, texto, midias, formato=""):
        # Mídia da publicação é ignorada aqui (vai só o texto) — não bloqueia
        return super().conferir(texto, [], formato)

    def publicar(self, conta, texto, midias, pub) -> Resultado:
        chamar(
            "POST",
            f"{HELIX}/chat/announcements",
            headers=self._h(conta),
            params={"broadcaster_id": conta.conta_id, "moderator_id": conta.conta_id},
            json={"message": texto, "color": "primary"},
        )
        return Resultado(
            "",
            f"https://www.twitch.tv/{conta.usuario}" if conta.usuario else "",
            aviso="Twitch não tem feed: o texto foi como anúncio no chat do canal"
            + (" (imagem/vídeo não vão)." if midias else "."),
        )

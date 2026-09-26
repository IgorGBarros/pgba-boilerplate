# backend_api/Api/marketing/redes/discord.py
"""Discord — webhook do canal (Configurações do canal → Integrações → Webhooks).
Sem OAuth: a URL do webhook É o segredo (guardada cifrada, como token)."""
from __future__ import annotations

import json
from urllib.parse import urlparse

from marketing.redes.base import (
    UPLOAD_TIMEOUT,
    Rede,
    RedeError,
    Resultado,
    chamar,
    json_de,
    ler,
    nome_arquivo,
)

HOSTS = {"discord.com", "discordapp.com", "ptb.discord.com", "canary.discord.com"}
MAX_ARQUIVO = 25 * 1024 * 1024


def validar_webhook(url: str) -> str:
    p = urlparse((url or "").strip())
    if p.scheme != "https" or p.hostname not in HOSTS or not p.path.startswith("/api/webhooks/"):
        raise RedeError("Cole a URL do webhook do Discord (https://discord.com/api/webhooks/...).")
    return f"https://{p.hostname}{p.path.rstrip('/')}"


def info_webhook(url: str) -> dict:
    return json_de(chamar("GET", validar_webhook(url)))


class Discord(Rede):
    key = "discord"
    nome = "Discord"
    limite = 2000

    def testar(self, conta) -> str:
        d = info_webhook(conta.token)
        return f"Webhook '{d.get('name', '?')}' ativo no canal {d.get('channel_id', '?')}."

    def conferir(self, texto, midias, formato=""):
        erros = super().conferir(texto, midias, formato)
        grandes = [m for m in midias if (m.tamanho or 0) > MAX_ARQUIVO]
        if grandes:
            erros.append("Discord: arquivo acima de 25 MB — use um link no texto.")
        return erros

    def publicar(self, conta, texto, midias, pub) -> Resultado:
        url = f"{validar_webhook(conta.token)}?wait=true"
        if midias:
            files = {
                f"files[{i}]": (nome_arquivo(m), ler(m), m.mime or "application/octet-stream")
                for i, m in enumerate(midias)
            }
            resp = chamar(
                "POST",
                url,
                data={"payload_json": json.dumps({"content": texto})},
                files=files,
                timeout=UPLOAD_TIMEOUT,
            )
        else:
            resp = chamar("POST", url, json={"content": texto})
        d = json_de(resp)
        mid, canal = str(d.get("id") or ""), d.get("channel_id") or conta.config.get("channel_id")
        guild = conta.config.get("guild_id")
        link = f"https://discord.com/channels/{guild}/{canal}/{mid}" if guild and canal else ""
        return Resultado(mid, link)

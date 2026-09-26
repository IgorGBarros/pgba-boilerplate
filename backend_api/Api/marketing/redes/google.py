# backend_api/Api/marketing/redes/google.py
"""YouTube Data API v3 — upload resumável (`uploadType=resumable`). Vídeo vertical
de até 3 min vira Short (o YouTube decide pelo formato; #Shorts ajuda)."""
from __future__ import annotations

import re

from marketing.redes.base import (
    UPLOAD_TIMEOUT,
    Rede,
    RedeError,
    Resultado,
    chamar,
    json_de,
    ler,
)

API = "https://www.googleapis.com/youtube/v3"
UPLOAD = "https://www.googleapis.com/upload/youtube/v3/videos"


class YouTube(Rede):
    key = "youtube"
    nome = "YouTube"
    limite = 5000
    aceita = {"video"}
    exige_midia = True
    max_imagens = 0

    def _h(self, conta):
        return {"Authorization": f"Bearer {conta.token}"}

    def testar(self, conta) -> str:
        d = json_de(
            chamar(
                "GET",
                f"{API}/channels",
                params={"part": "snippet", "mine": "true"},
                headers=self._h(conta),
            )
        )
        itens = d.get("items") or []
        if not itens:
            raise RedeError("Essa conta Google não tem canal no YouTube.")
        return f"Canal '{itens[0]['snippet']['title']}' conectado."

    def publicar(self, conta, texto, midias, pub) -> Resultado:
        video = next((m for m in midias if m.tipo == "video"), None)
        if video is None:
            raise RedeError("YouTube exige um vídeo.")
        short = video.altura > video.largura and 0 < video.duracao <= 180
        titulo = re.sub(r"[<>]", "", pub.titulo or texto.split("\n")[0])[:100] or "Vídeo"
        descricao = re.sub(r"[<>]", "", texto)[:5000]
        if short and "#shorts" not in descricao.lower():
            descricao = f"{descricao}\n\n#Shorts".strip()
        tags = [t.lstrip("#") for t in (pub.hashtags or "").split() if t.startswith("#")][:15]
        dados = ler(video)
        meta = {
            "snippet": {
                "title": titulo,
                "description": descricao,
                "tags": tags,
                "categoryId": str(conta.config.get("categoria") or "22"),
            },
            "status": {
                "privacyStatus": conta.config.get("privacidade") or "public",
                "selfDeclaredMadeForKids": False,
            },
        }
        resp = chamar(
            "POST",
            UPLOAD,
            params={"uploadType": "resumable", "part": "snippet,status"},
            headers={
                **self._h(conta),
                "X-Upload-Content-Type": video.mime or "video/mp4",
                "X-Upload-Content-Length": str(len(dados)),
            },
            json=meta,
        )
        destino = resp.headers.get("location")
        if not destino:
            raise RedeError("YouTube não devolveu o endereço de upload.")
        d = json_de(
            chamar(
                "PUT",
                destino,
                headers={**self._h(conta), "Content-Type": video.mime or "video/mp4"},
                content=dados,
                timeout=UPLOAD_TIMEOUT,
            )
        )
        vid = str(d.get("id") or "")
        if not vid:
            raise RedeError("YouTube não devolveu o id do vídeo.")
        url = f"https://www.youtube.com/shorts/{vid}" if short else f"https://youtu.be/{vid}"
        aviso = ""
        if (d.get("status") or {}).get("privacyStatus") == "private" and meta["status"][
            "privacyStatus"
        ] != "private":
            aviso = "O YouTube deixou o vídeo privado (app ainda não verificado pelo Google)."
        return Resultado(vid, url, aviso)

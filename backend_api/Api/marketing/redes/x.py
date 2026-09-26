# backend_api/Api/marketing/redes/x.py
"""X (Twitter) — API v2: POST /2/tweets; mídia por /2/media/upload (imagem simples,
vídeo em partes: initialize → append → finalize → status)."""
from __future__ import annotations

from marketing.redes.base import (
    UPLOAD_TIMEOUT,
    Rede,
    RedeError,
    Resultado,
    chamar,
    dormir,
    json_de,
    ler,
    nome_arquivo,
)

API = "https://api.x.com/2"
PARTE = 4 * 1024 * 1024


class X(Rede):
    key = "x"
    nome = "X"
    limite = 280
    max_imagens = 4

    def _h(self, conta) -> dict:
        return {"Authorization": f"Bearer {conta.token}"}

    def testar(self, conta) -> str:
        d = json_de(chamar("GET", f"{API}/users/me", headers=self._h(conta))).get("data") or {}
        return f"Conectado como @{d.get('username', '?')}."

    def _imagem(self, conta, midia) -> str:
        resp = chamar(
            "POST",
            f"{API}/media/upload",
            headers=self._h(conta),
            files={"media": (nome_arquivo(midia), ler(midia), midia.mime or "image/png")},
            data={"media_category": "tweet_image"},
            timeout=UPLOAD_TIMEOUT,
        )
        return str((json_de(resp).get("data") or {}).get("id") or "")

    def _video(self, conta, midia) -> str:
        dados = ler(midia)
        h = self._h(conta)
        init = (
            json_de(
                chamar(
                    "POST",
                    f"{API}/media/upload/initialize",
                    headers=h,
                    json={
                        "media_type": midia.mime or "video/mp4",
                        "total_bytes": len(dados),
                        "media_category": "tweet_video",
                    },
                )
            ).get("data")
            or {}
        )
        media_id = str(init.get("id") or "")
        if not media_id:
            raise RedeError("X não devolveu o id do upload.")
        for i in range(0, len(dados), PARTE):
            chamar(
                "POST",
                f"{API}/media/upload/{media_id}/append",
                headers=h,
                files={"media": ("parte", dados[i : i + PARTE], "application/octet-stream")},
                data={"segment_index": str(i // PARTE)},
                timeout=UPLOAD_TIMEOUT,
            )
        info = (
            json_de(chamar("POST", f"{API}/media/upload/{media_id}/finalize", headers=h)).get(
                "data"
            )
            or {}
        ).get("processing_info")
        for _ in range(60):
            if not info or info.get("state") in ("succeeded",):
                break
            if info.get("state") == "failed":
                erro = (info.get("error") or {}).get("message") or "processamento falhou"
                raise RedeError(f"X recusou o vídeo: {erro}")
            dormir(min(int(info.get("check_after_secs") or 5), 30))
            info = (
                json_de(
                    chamar(
                        "GET",
                        f"{API}/media/upload",
                        headers=h,
                        params={"command": "STATUS", "media_id": media_id},
                    )
                ).get("data")
                or {}
            ).get("processing_info")
        return media_id

    def publicar(self, conta, texto, midias, pub) -> Resultado:
        ids = [
            self._video(conta, m) if m.tipo == "video" else self._imagem(conta, m) for m in midias
        ]
        body: dict = {"text": texto}
        if ids:
            body["media"] = {"media_ids": [i for i in ids if i]}
        d = (
            json_de(chamar("POST", f"{API}/tweets", headers=self._h(conta), json=body)).get("data")
            or {}
        )
        tid = str(d.get("id") or "")
        return Resultado(tid, f"https://x.com/{conta.usuario or 'i'}/status/{tid}" if tid else "")

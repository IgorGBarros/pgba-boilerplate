# backend_api/Api/marketing/redes/linkedin.py
"""
LinkedIn — Posts API (`/rest/posts`, versionada pelo header LinkedIn-Version).
Imagem: images?action=initializeUpload → PUT; vídeo: videos?action=initializeUpload
→ PUT por parte → finalizeUpload. Autor = pessoa (`urn:li:person:<sub>`) ou,
com o produto Community Management aprovado, a página
(`config.author = "urn:li:organization:<id>"`).
"""
from __future__ import annotations

import re
from datetime import date, timedelta

from django.conf import settings

from marketing.redes.base import (
    UPLOAD_TIMEOUT,
    Rede,
    RedeError,
    Resultado,
    chamar,
    json_de,
    ler,
)

REST = "https://api.linkedin.com/rest"
RESERVADOS = re.compile(r"([\\|{}@\[\]()<>#*_~])")


def versao() -> str:
    """Versão da API (AAAAMM). LinkedIn mantém cada versão ~1 ano; padrão = 2 meses atrás."""
    v = getattr(settings, "LINKEDIN_API_VERSION", "") or ""
    return v or (date.today().replace(day=1) - timedelta(days=45)).strftime("%Y%m")


def little_text(texto: str) -> str:
    """O campo `commentary` usa o "little text format": caractere reservado é escapado
    e hashtag vira {hashtag|\\#|tag} (senão aparece '#' literal sem link)."""
    partes = re.split(r"#(\w+)", texto)
    out = []
    for i, p in enumerate(partes):
        out.append("{hashtag|\\#|" + p + "}" if i % 2 else RESERVADOS.sub(r"\\\1", p))
    return "".join(out)


class LinkedIn(Rede):
    key = "linkedin"
    nome = "LinkedIn"
    limite = 3000
    max_imagens = 20

    def _h(self, conta) -> dict:
        return {
            "Authorization": f"Bearer {conta.token}",
            "LinkedIn-Version": versao(),
            "X-Restli-Protocol-Version": "2.0.0",
        }

    def _autor(self, conta) -> str:
        return conta.config.get("author") or f"urn:li:person:{conta.conta_id}"

    def testar(self, conta) -> str:
        d = json_de(
            chamar(
                "GET",
                "https://api.linkedin.com/v2/userinfo",
                headers={"Authorization": f"Bearer {conta.token}"},
            )
        )
        return f"Conectado como {d.get('name') or '?'}."

    def _imagem(self, conta, midia) -> str:
        v = (
            json_de(
                chamar(
                    "POST",
                    f"{REST}/images",
                    params={"action": "initializeUpload"},
                    headers=self._h(conta),
                    json={"initializeUploadRequest": {"owner": self._autor(conta)}},
                )
            ).get("value")
            or {}
        )
        if not v.get("uploadUrl"):
            raise RedeError("LinkedIn não devolveu o endereço de upload da imagem.")
        chamar(
            "PUT",
            v["uploadUrl"],
            headers={"Authorization": f"Bearer {conta.token}"},
            content=ler(midia),
            timeout=UPLOAD_TIMEOUT,
        )
        return v["image"]

    def _video(self, conta, midia) -> str:
        dados = ler(midia)
        v = (
            json_de(
                chamar(
                    "POST",
                    f"{REST}/videos",
                    params={"action": "initializeUpload"},
                    headers=self._h(conta),
                    json={
                        "initializeUploadRequest": {
                            "owner": self._autor(conta),
                            "fileSizeBytes": len(dados),
                            "uploadCaptions": False,
                            "uploadThumbnail": False,
                        }
                    },
                )
            ).get("value")
            or {}
        )
        etags = []
        for parte in v.get("uploadInstructions") or []:
            ini, fim = int(parte["firstByte"]), int(parte["lastByte"])
            resp = chamar(
                "PUT",
                parte["uploadUrl"],
                headers={"Content-Type": "application/octet-stream"},
                content=dados[ini : fim + 1],
                timeout=UPLOAD_TIMEOUT,
            )
            etags.append(resp.headers.get("etag", "").strip('"'))
        chamar(
            "POST",
            f"{REST}/videos",
            params={"action": "finalizeUpload"},
            headers=self._h(conta),
            json={
                "finalizeUploadRequest": {
                    "video": v.get("video"),
                    "uploadToken": v.get("uploadToken", ""),
                    "uploadedPartIds": etags,
                }
            },
        )
        return v.get("video") or ""

    def publicar(self, conta, texto, midias, pub) -> Resultado:
        body: dict = {
            "author": self._autor(conta),
            "commentary": little_text(texto),
            "visibility": "PUBLIC",
            "distribution": {
                "feedDistribution": "MAIN_FEED",
                "targetEntities": [],
                "thirdPartyDistributionChannels": [],
            },
            "lifecycleState": "PUBLISHED",
            "isReshareDisabledByAuthor": False,
        }
        videos = [m for m in midias if m.tipo == "video"]
        imagens = [m for m in midias if m.tipo == "imagem"]
        if videos:
            body["content"] = {"media": {"id": self._video(conta, videos[0]), "title": pub.titulo}}
        elif len(imagens) == 1:
            body["content"] = {"media": {"id": self._imagem(conta, imagens[0])}}
        elif imagens:
            body["content"] = {
                "multiImage": {
                    "images": [{"id": self._imagem(conta, m), "altText": ""} for m in imagens]
                }
            }
        elif pub.link:
            body["content"] = {"article": {"source": pub.link, "title": pub.titulo[:200]}}
        resp = chamar("POST", f"{REST}/posts", headers=self._h(conta), json=body)
        urn = resp.headers.get("x-restli-id") or resp.headers.get("x-linkedin-id") or ""
        return Resultado(urn, f"https://www.linkedin.com/feed/update/{urn}/" if urn else "")

# backend_api/Api/marketing/redes/meta.py
"""
Meta Graph API — Facebook (página) e Instagram (conta profissional ligada à página).

Facebook: texto/link → /{page}/feed; foto → /{page}/photos (arquivo enviado);
várias fotos → cada uma sem publicar + /feed com attached_media; vídeo →
graph-video /{page}/videos.

Instagram: a Meta BUSCA a mídia por URL pública (não aceita o arquivo). Por
isso a mídia sai por um link assinado desta API (`PUBLIC_API_URL`, válido
por 2 dias) — sem API pública, o Instagram não tem como buscar e a
publicação falha com esse aviso. Fluxo: contêiner (/media) → espera
`status_code=FINISHED` → /media_publish. Reels, carrossel (2-10) e stories.
"""
from __future__ import annotations

import json

from django.conf import settings

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


def versao() -> str:
    return getattr(settings, "META_GRAPH_VERSION", "") or "v23.0"


def graph() -> str:
    return f"https://graph.facebook.com/{versao()}"


class Facebook(Rede):
    key = "facebook"
    nome = "Facebook"
    limite = 63206

    def testar(self, conta) -> str:
        d = json_de(
            chamar(
                "GET",
                f"{graph()}/{conta.conta_id}",
                params={"fields": "name", "access_token": conta.token},
            )
        )
        return f"Página '{d.get('name', '?')}' conectada."

    def _foto(self, conta, midia, legenda: str | None) -> dict:
        data = {"access_token": conta.token}
        if legenda is None:
            data["published"] = "false"
        else:
            data["message"] = legenda
        return json_de(
            chamar(
                "POST",
                f"{graph()}/{conta.conta_id}/photos",
                data=data,
                files={"source": (nome_arquivo(midia), ler(midia), midia.mime or "image/png")},
                timeout=UPLOAD_TIMEOUT,
            )
        )

    def publicar(self, conta, texto, midias, pub) -> Resultado:
        page = conta.conta_id
        videos = [m for m in midias if m.tipo == "video"]
        imagens = [m for m in midias if m.tipo == "imagem"]
        if videos:
            v = videos[0]
            d = json_de(
                chamar(
                    "POST",
                    f"https://graph-video.facebook.com/{versao()}/{page}/videos",
                    data={
                        "description": texto,
                        "title": pub.titulo[:250],
                        "access_token": conta.token,
                    },
                    files={"source": (nome_arquivo(v), ler(v), v.mime or "video/mp4")},
                    timeout=UPLOAD_TIMEOUT,
                )
            )
            vid = str(d.get("id") or "")
            return Resultado(vid, f"https://www.facebook.com/{page}/videos/{vid}" if vid else "")
        if len(imagens) == 1:
            d = self._foto(conta, imagens[0], texto)
            pid = str(d.get("post_id") or d.get("id") or "")
            return Resultado(pid, f"https://www.facebook.com/{pid}" if pid else "")
        data = {"message": texto, "access_token": conta.token}
        for i, m in enumerate(imagens):
            fid = self._foto(conta, m, None).get("id")
            data[f"attached_media[{i}]"] = json.dumps({"media_fbid": fid})
        if not imagens and pub.link:
            data["link"] = pub.link
        d = json_de(chamar("POST", f"{graph()}/{page}/feed", data=data))
        pid = str(d.get("id") or "")
        return Resultado(pid, f"https://www.facebook.com/{pid}" if pid else "")


class Instagram(Rede):
    key = "instagram"
    nome = "Instagram"
    limite = 2200
    exige_midia = True
    link_clicavel = False

    def testar(self, conta) -> str:
        d = json_de(
            chamar(
                "GET",
                f"{graph()}/{conta.conta_id}",
                params={"fields": "username", "access_token": conta.token},
            )
        )
        return f"Conectado como @{d.get('username', '?')}."

    def conferir(self, texto, midias, formato=""):
        erros = super().conferir(texto, midias, formato)
        from marketing.services import api_publica

        if midias and not api_publica():
            erros.append(
                "Instagram: a Meta busca a mídia por um link público desta API — defina "
                "PUBLIC_API_URL no servidor (endereço https público do backend)."
            )
        if len(midias) > 1 and formato == "story":
            erros.append("Instagram: story é uma mídia por vez.")
        return erros

    def _container(self, conta, data: dict) -> str:
        d = json_de(
            chamar(
                "POST",
                f"{graph()}/{conta.conta_id}/media",
                data={**data, "access_token": conta.token},
            )
        )
        cid = str(d.get("id") or "")
        if not cid:
            raise RedeError("Instagram não criou o contêiner da mídia.")
        return cid

    def _esperar(self, conta, cid: str) -> None:
        for _ in range(90):
            d = json_de(
                chamar(
                    "GET",
                    f"{graph()}/{cid}",
                    params={"fields": "status_code,status", "access_token": conta.token},
                )
            )
            code = d.get("status_code")
            if code in ("FINISHED", "PUBLISHED"):
                return
            if code in ("ERROR", "EXPIRED"):
                raise RedeError(f"Instagram recusou a mídia: {d.get('status') or code}")
            dormir(5)
        raise RedeError("Instagram demorou demais processando a mídia.")

    def _item(self, m, url: str, extra: dict) -> dict:
        if m.tipo == "video":
            return {"media_type": "VIDEO", "video_url": url, **extra}
        return {"image_url": url, **extra}

    def publicar(self, conta, texto, midias, pub) -> Resultado:
        from marketing.services import url_publica

        if not midias:
            raise RedeError("Instagram exige imagem ou vídeo.")
        urls = [url_publica(m) for m in midias]
        if pub.formato == "story":
            m = midias[0]
            data = {"media_type": "STORIES"}
            data.update({"video_url": urls[0]} if m.tipo == "video" else {"image_url": urls[0]})
            cid = self._container(conta, data)
        elif len(midias) == 1 and midias[0].tipo == "video":
            cid = self._container(
                conta,
                {
                    "media_type": "REELS",
                    "video_url": urls[0],
                    "caption": texto,
                    "share_to_feed": "true",
                },
            )
        elif len(midias) == 1:
            cid = self._container(conta, {"image_url": urls[0], "caption": texto})
        else:
            filhos = []
            for m, u in zip(midias, urls):
                fid = self._container(conta, self._item(m, u, {"is_carousel_item": "true"}))
                if m.tipo == "video":
                    self._esperar(conta, fid)
                filhos.append(fid)
            cid = self._container(
                conta, {"media_type": "CAROUSEL", "children": ",".join(filhos), "caption": texto}
            )
        self._esperar(conta, cid)
        d = json_de(
            chamar(
                "POST",
                f"{graph()}/{conta.conta_id}/media_publish",
                data={"creation_id": cid, "access_token": conta.token},
            )
        )
        mid = str(d.get("id") or "")
        link = ""
        if mid:
            try:
                link = json_de(
                    chamar(
                        "GET",
                        f"{graph()}/{mid}",
                        params={"fields": "permalink", "access_token": conta.token},
                    )
                ).get("permalink", "")
            except RedeError:
                link = ""
        return Resultado(mid, link)

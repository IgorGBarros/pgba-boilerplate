# backend_api/Api/marketing/redes/tiktok.py
"""
TikTok Content Posting API. Dois modos (`config.modo`):

- "rascunho" (padrão): o vídeo vai pra caixa de entrada do app TikTok da conta
  (`inbox/video/init`) e a pessoa finaliza e publica no celular — funciona
  sem auditoria do app;
- "direto": publica na hora (`video/init` + creator_info). App NÃO auditado
  pelo TikTok só consegue publicar como privado (SELF_ONLY).
"""
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
)

API = "https://open.tiktokapis.com/v2"
PARTE_MAX = 64 * 1024 * 1024
PARTE = 10 * 1024 * 1024


def _ok(d: dict) -> dict:
    err = d.get("error") or {}
    if err.get("code") not in (None, "", "ok"):
        raise RedeError(f"TikTok: {err.get('message') or err.get('code')}")
    return d.get("data") or {}


def partes(tamanho: int) -> tuple[int, int]:
    """(tamanho da parte, quantidade). Até 64 MB vai inteiro; acima, partes de 10 MB
    (a última leva o resto)."""
    if tamanho <= PARTE_MAX:
        return tamanho, 1
    return PARTE, tamanho // PARTE


class TikTok(Rede):
    key = "tiktok"
    nome = "TikTok"
    limite = 2200
    aceita = {"video"}
    exige_midia = True
    max_imagens = 0

    def _h(self, conta):
        return {
            "Authorization": f"Bearer {conta.token}",
            "Content-Type": "application/json; charset=UTF-8",
        }

    def testar(self, conta) -> str:
        d = _ok(
            json_de(
                chamar(
                    "GET",
                    f"{API}/user/info/",
                    params={"fields": "open_id,display_name"},
                    headers=self._h(conta),
                )
            )
        )
        return f"Conectado como {(d.get('user') or {}).get('display_name') or '?'}."

    def publicar(self, conta, texto, midias, pub) -> Resultado:
        video = next((m for m in midias if m.tipo == "video"), None)
        if video is None:
            raise RedeError("TikTok exige um vídeo.")
        dados = ler(video)
        tam = len(dados)
        parte, total = partes(tam)
        fonte = {
            "source": "FILE_UPLOAD",
            "video_size": tam,
            "chunk_size": parte,
            "total_chunk_count": total,
        }
        modo = conta.config.get("modo") or "rascunho"
        if modo == "direto":
            info = _ok(
                json_de(
                    chamar(
                        "POST",
                        f"{API}/post/publish/creator_info/query/",
                        headers=self._h(conta),
                        json={},
                    )
                )
            )
            opcoes = info.get("privacy_level_options") or ["SELF_ONLY"]
            quer = conta.config.get("privacidade") or "PUBLIC_TO_EVERYONE"
            body = {
                "post_info": {
                    "title": texto,
                    "privacy_level": quer if quer in opcoes else opcoes[0],
                    "disable_duet": False,
                    "disable_comment": False,
                    "disable_stitch": False,
                },
                "source_info": fonte,
            }
            url = f"{API}/post/publish/video/init/"
        else:
            body, url = {"source_info": fonte}, f"{API}/post/publish/inbox/video/init/"
        d = _ok(json_de(chamar("POST", url, headers=self._h(conta), json=body)))
        publish_id, upload_url = d.get("publish_id"), d.get("upload_url")
        if not publish_id or not upload_url:
            raise RedeError("TikTok não devolveu o endereço de upload.")
        for i in range(total):
            ini = i * parte
            fim = tam - 1 if i == total - 1 else ini + parte - 1
            chamar(
                "PUT",
                upload_url,
                headers={
                    "Content-Type": video.mime or "video/mp4",
                    "Content-Range": f"bytes {ini}-{fim}/{tam}",
                },
                content=dados[ini : fim + 1],
                timeout=UPLOAD_TIMEOUT,
            )
        status = ""
        info = {}
        for _ in range(24):
            info = _ok(
                json_de(
                    chamar(
                        "POST",
                        f"{API}/post/publish/status/fetch/",
                        headers=self._h(conta),
                        json={"publish_id": publish_id},
                    )
                )
            )
            status = info.get("status", "")
            if status == "FAILED":
                raise RedeError(f"TikTok recusou o vídeo: {info.get('fail_reason') or 'falhou'}")
            if status in ("PUBLISH_COMPLETE", "SEND_TO_USER_INBOX"):
                break
            dormir(5)
        if status == "SEND_TO_USER_INBOX" or modo != "direto":
            return Resultado(
                publish_id,
                "",
                aviso="Foi pra caixa de entrada do TikTok: abra o app pra finalizar e publicar.",
            )
        posts = info.get("publicaly_available_post_id") or []
        link = (
            f"https://www.tiktok.com/@{conta.usuario}/video/{posts[0]}"
            if posts and conta.usuario
            else ""
        )
        aviso = "" if status == "PUBLISH_COMPLETE" else "Ainda processando no TikTok."
        return Resultado(publish_id, link, aviso)

# backend_api/Api/marketing/redes/base.py
"""
Base dos conectores de rede social. Toda saída de rede passa por
`ingestion.connectors.safe_http` (anti-SSRF, redirect conferido); o erro da
API da rede volta legível (as redes explicam o erro em JSON).
"""
from __future__ import annotations

import json
import time
from dataclasses import dataclass, field

import httpx

from ingestion.connectors import ConnectorError, safe_http

MAX_MIDIA = 300 * 1024 * 1024  # teto pra mandar uma mídia inteira numa chamada
UPLOAD_TIMEOUT = 600.0

# Testes trocam por lambda s: None
dormir = time.sleep


class RedeError(Exception):
    pass


@dataclass
class Resultado:
    externo_id: str
    url: str = ""
    aviso: str = ""


@dataclass
class Tokens:
    access: str
    refresh: str = ""
    expires_in: int | None = None
    escopos: str = ""
    extra: dict = field(default_factory=dict)


@dataclass
class Perfil:
    rede: str
    conta_id: str
    nome: str
    usuario: str = ""
    url: str = ""
    token: str | None = None  # token próprio (página da Meta); None = o do login
    config: dict = field(default_factory=dict)


def _mensagem_erro(resp: httpx.Response) -> str:
    try:
        data = resp.json()
    except ValueError:
        return f"{resp.status_code}: {resp.text[:300]}"
    msg = ""
    if isinstance(data, dict):
        err = data.get("error")
        if isinstance(err, dict):
            msg = err.get("message") or err.get("error_user_msg") or err.get("code") or ""
        elif isinstance(err, str):
            msg = data.get("error_description") or data.get("message") or err
        msg = msg or data.get("detail") or data.get("message") or data.get("title") or ""
        errors = data.get("errors")
        if not msg and isinstance(errors, list) and errors:
            first = errors[0]
            msg = first.get("message") or first.get("detail") if isinstance(first, dict) else ""
    return f"{resp.status_code}: {msg or json.dumps(data)[:300]}"


def chamar(method: str, url: str, **kwargs) -> httpx.Response:
    """Chamada a uma API de rede. Erro de rede ou HTTP ≥ 400 vira RedeError legível."""
    try:
        resp = safe_http.request(method, url, raise_for_status=False, **kwargs)
    except ConnectorError as exc:
        raise RedeError(str(exc)) from exc
    if resp.status_code >= 400:
        raise RedeError(_mensagem_erro(resp))
    return resp


def json_de(resp: httpx.Response) -> dict:
    try:
        data = resp.json()
    except ValueError as exc:
        raise RedeError("A rede respondeu algo que não é JSON.") from exc
    return data if isinstance(data, dict) else {"data": data}


def ler(midia) -> bytes:
    if midia.tamanho and midia.tamanho > MAX_MIDIA:
        raise RedeError(f"Arquivo grande demais pra enviar ({midia.tamanho // 1024 // 1024} MB).")
    midia.arquivo.open("rb")
    try:
        return midia.arquivo.read()
    finally:
        midia.arquivo.close()


def nome_arquivo(midia) -> str:
    ext = midia.arquivo.name.rsplit(".", 1)[-1] if "." in midia.arquivo.name else "bin"
    return f"midia-{midia.pk}.{ext}"


class Rede:
    """Um conector de rede. Subclasse define limite, o que aceita e `publicar`."""

    key = ""
    nome = ""
    limite = 2000
    aceita = {"texto", "imagem", "video"}
    exige_midia = False
    max_imagens = 10
    max_videos = 1
    link_clicavel = True

    def testar(self, conta) -> str:
        raise NotImplementedError

    def publicar(self, conta, texto: str, midias: list, pub) -> Resultado:
        raise NotImplementedError

    def conferir(self, texto: str, midias: list, formato: str = "") -> list[str]:
        """Problemas que impedem publicar (checados ANTES de aprovar)."""
        erros = []
        imagens = [m for m in midias if m.tipo == "imagem"]
        videos = [m for m in midias if m.tipo == "video"]
        if len(texto) > self.limite:
            erros.append(
                f"{self.nome}: texto com {len(texto)} caracteres, o limite é {self.limite}."
            )
        if self.exige_midia and not midias:
            o_que = "um vídeo" if self.aceita == {"video"} else "imagem ou vídeo"
            erros.append(f"{self.nome}: precisa de {o_que}.")
        if imagens and "imagem" not in self.aceita:
            erros.append(f"{self.nome}: não aceita imagem por aqui (só vídeo).")
        if videos and "video" not in self.aceita:
            erros.append(f"{self.nome}: não aceita vídeo por aqui.")
        if len(imagens) > self.max_imagens:
            erros.append(f"{self.nome}: no máximo {self.max_imagens} imagens.")
        if len(videos) > self.max_videos:
            erros.append(f"{self.nome}: no máximo {self.max_videos} vídeo(s).")
        if imagens and videos and self.key not in ("instagram", "discord"):
            erros.append(f"{self.nome}: escolha imagens OU vídeo, não os dois.")
        return erros

# backend_api/Api/marketing/midias.py
"""Gravar mídia (imagem/vídeo) com hash, dimensões e miniatura."""
from __future__ import annotations

import hashlib
import mimetypes
import pathlib
import tempfile

from django.core.files.base import ContentFile, File

from marketing.models import Midia

IMAGENS = {"image/png", "image/jpeg", "image/webp", "image/gif"}
VIDEOS = {"video/mp4", "video/quicktime", "video/webm"}
MAX_IMAGEM = 15 * 1024 * 1024
MAX_VIDEO = 500 * 1024 * 1024


class MidiaError(Exception):
    pass


def farejar(cabecalho: bytes) -> str:
    """Tipo real pelo conteúdo (assinatura do arquivo) — nome e mime do cliente não valem."""
    c = cabecalho[:16]
    if c.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if c.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if c[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if c.startswith(b"RIFF") and c[8:12] == b"WEBP":
        return "image/webp"
    if c[4:8] == b"ftyp":
        return "video/quicktime" if c[8:10] == b"qt" else "video/mp4"
    if c.startswith(b"\x1a\x45\xdf\xa3"):
        return "video/webm"
    return ""


def tipo_de(nome: str, mime: str = "", cabecalho: bytes = b"") -> tuple[str, str]:
    mime = (farejar(cabecalho) if cabecalho else "") or mime or mimetypes.guess_type(nome)[0] or ""
    if mime in IMAGENS:
        return "imagem", mime
    if mime in VIDEOS:
        return "video", mime
    raise MidiaError("Formato não aceito — use PNG, JPG, WEBP, GIF, MP4, MOV ou WEBM.")


def salvar_imagem(tenant_id, conteudo: bytes, nome: str, **campos) -> Midia:
    from marketing.criativos import dimensoes, miniatura

    if len(conteudo) > MAX_IMAGEM:
        raise MidiaError("Imagem acima de 15 MB.")
    try:
        w, h = dimensoes(conteudo)
        thumb = miniatura(conteudo)
    except Exception as exc:  # noqa: BLE001 — arquivo que não abre como imagem
        raise MidiaError("Não consegui abrir essa imagem.") from exc
    tipo, mime = tipo_de(nome, campos.pop("mime", ""), conteudo[:16])
    if tipo != "imagem":
        raise MidiaError("Esse arquivo não é uma imagem.")
    m = Midia(
        tenant_id=tenant_id,
        tipo="imagem",
        mime=mime,
        largura=w,
        altura=h,
        tamanho=len(conteudo),
        sha256=hashlib.sha256(conteudo).hexdigest(),
        **campos,
    )
    m.arquivo.save(nome, ContentFile(conteudo), save=False)
    m.miniatura.save("thumb.jpg", ContentFile(thumb), save=False)
    m.save()
    return m


def salvar_video(tenant_id, caminho, nome: str = "video.mp4", **campos) -> Midia:
    from marketing.video import VideoError, quadro, sondar

    caminho = pathlib.Path(caminho)
    tamanho = caminho.stat().st_size
    if tamanho > MAX_VIDEO:
        raise MidiaError("Vídeo acima de 500 MB.")
    h = hashlib.sha256()
    with caminho.open("rb") as fh:
        for bloco in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(bloco)
    try:
        info = sondar(caminho)
    except VideoError:
        info = {"duracao": 0, "largura": 0, "altura": 0}
    with caminho.open("rb") as fh:
        tipo, mime = tipo_de(nome, campos.pop("mime", ""), fh.read(16))
    if tipo != "video":
        raise MidiaError("Esse arquivo não é um vídeo.")
    m = Midia(
        tenant_id=tenant_id,
        tipo="video",
        mime=mime,
        tamanho=tamanho,
        sha256=h.hexdigest(),
        duracao=info["duracao"],
        largura=info["largura"],
        altura=info["altura"],
        **campos,
    )
    with caminho.open("rb") as fh:
        m.arquivo.save(nome, File(fh), save=False)
    try:
        with tempfile.TemporaryDirectory() as tmp:
            thumb = pathlib.Path(tmp) / "thumb.jpg"
            quadro(caminho, thumb, min(1.0, max(info["duracao"] / 3, 0)))
            m.miniatura.save("thumb.jpg", ContentFile(thumb.read_bytes()), save=False)
    except VideoError:
        pass  # sem miniatura não impede nada
    m.save()
    return m


def caminho_local(midia: Midia) -> pathlib.Path:
    """Arquivo no disco (storage local). Mídia em storage remoto teria que ser baixada antes."""
    return pathlib.Path(midia.arquivo.path)

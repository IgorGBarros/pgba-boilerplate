# backend_api/Api/marketing/criativos.py
"""
Criativos em imagem (Pillow), nos formatos de cada rede, com as cores e o
logo da marca. Sem serviço externo nem IA de imagem: a IA escreve o TEXTO
(`ia.texto_criativo`), aqui é só composição — então o resultado é
previsível e legível no celular.

Fonte: Montserrat (SIL Open Font License, `marketing/fonts/OFL.txt`).
"""
from __future__ import annotations

import io
import pathlib

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

FONTE = pathlib.Path(__file__).resolve().parent / "fonts" / "Montserrat.ttf"

FORMATOS = {
    "quadrado": (1080, 1080, "Feed 1:1 — Instagram, Facebook, LinkedIn"),
    "retrato": (1080, 1350, "Feed 4:5 — Instagram, Facebook"),
    "vertical": (1080, 1920, "9:16 — Stories, Reels, TikTok, Shorts"),
    "paisagem": (1920, 1080, "16:9 — YouTube, X, Twitch"),
    "link": (1200, 627, "Link — LinkedIn, Facebook, X"),
    "capa_youtube": (1280, 720, "Capa (thumbnail) do YouTube"),
}
MODELOS = {
    "destaque": "Destaque — título grande e chamada",
    "citacao": "Citação — frase em evidência",
    "lista": "Lista / carrossel — um ponto por lâmina",
    "oferta": "Oferta — benefício ou número em destaque",
}


def _fonte(tam: int, peso: int = 700) -> ImageFont.FreeTypeFont:
    f = ImageFont.truetype(str(FONTE), tam)
    try:
        f.set_variation_by_axes([peso])
    except Exception:  # noqa: BLE001 — sem suporte a fonte variável, fica o peso padrão
        pass
    return f


def _cor(hexa: str, padrao=(16, 185, 129)) -> tuple[int, int, int]:
    h = (hexa or "").lstrip("#")
    if len(h) != 6:
        return padrao
    try:
        return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]
    except ValueError:
        return padrao


def _misturar(a, b, t: float):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def _quebrar(draw, texto: str, fonte, largura: int) -> list[str]:
    linhas: list[str] = []
    for par in (texto or "").split("\n"):
        atual = ""
        for palavra in par.split():
            teste = f"{atual} {palavra}".strip()
            if draw.textlength(teste, font=fonte) <= largura or not atual:
                atual = teste
            else:
                linhas.append(atual)
                atual = palavra
        linhas.append(atual)
    return [linha for linha in linhas if linha] or [""]


def _caber(draw, texto, largura, altura, maximo, minimo=24, peso=800, entre=1.12):
    """Maior tamanho de fonte em que o texto cabe na caixa."""
    tam = maximo
    while tam >= minimo:
        f = _fonte(tam, peso)
        linhas = _quebrar(draw, texto, f, largura)
        h = len(linhas) * tam * entre
        if h <= altura and all(draw.textlength(ln, font=f) <= largura for ln in linhas):
            return f, linhas, tam
        tam -= 2
    f = _fonte(minimo, peso)
    return f, _quebrar(draw, texto, f, largura), minimo


def _texto(draw, xy, linhas, fonte, tam, cor, entre=1.12, alinhar="esquerda", largura=0):
    x, y = xy
    for ln in linhas:
        dx = 0
        if alinhar == "centro" and largura:
            dx = (largura - draw.textlength(ln, font=fonte)) / 2
        draw.text((x + dx, y), ln, font=fonte, fill=cor)
        y += tam * entre
    return y


def _fundo(w, h, marca, imagem_fundo: bytes | None) -> Image.Image:
    prim = _cor(marca.get("cor_primaria"))
    sec = _cor(marca.get("cor_secundaria"), (22, 20, 18))
    if imagem_fundo:
        img = Image.open(io.BytesIO(imagem_fundo)).convert("RGB")
        img = ImageOps.fit(img, (w, h), Image.LANCZOS)
        img = img.filter(ImageFilter.GaussianBlur(1))
        escuro = Image.new("RGB", (w, h), sec)
        return Image.blend(img, escuro, 0.58)
    base = Image.new("RGB", (w, h), sec)
    # brilho suave da cor da marca vindo do canto superior direito (sem borda dura):
    # máscara calculada numa grade pequena e ampliada com interpolação
    gw, gh = 96, max(8, int(96 * h / w))
    cx, cy, raio = 0.95 * w, 0.0, 0.95 * max(w, h)
    grade = Image.new("L", (gw, gh))
    grade.putdata(
        [
            int(
                110
                * max(
                    0.0,
                    1
                    - (((x + 0.5) * w / gw - cx) ** 2 + ((y + 0.5) * h / gh - cy) ** 2) ** 0.5
                    / raio,
                )
                ** 1.6
            )
            for y in range(gh)
            for x in range(gw)
        ]
    )
    mascara = grade.resize((w, h), Image.BICUBIC)
    return Image.composite(Image.new("RGB", (w, h), prim), base, mascara)


def _logo(img, marca, logo: bytes | None, m: int) -> int:
    """Logo (ou nome da marca) no topo. Devolve a altura ocupada."""
    w, h = img.size
    alvo = int(min(w, h) * 0.075)
    if logo:
        try:
            lg = Image.open(io.BytesIO(logo)).convert("RGBA")
            lg.thumbnail((int(w * 0.32), alvo), Image.LANCZOS)
            img.paste(lg, (m, m), lg)
            return lg.height
        except Exception:  # noqa: BLE001 — logo inválido: segue com o nome
            pass
    nome = (marca.get("nome") or "").strip()
    if nome:
        f = _fonte(int(alvo * 0.55), 700)
        ImageDraw.Draw(img).text(
            (m, m), nome, font=f, fill=_cor(marca.get("cor_texto"), (255, 255, 255))
        )
        return int(alvo * 0.55)
    return 0


class _MedeDraw:
    """Mesma interface de desenho, mas não desenha — só pra medir a altura do bloco."""

    def __init__(self, d):
        self._d = d

    def text(self, *args, **kwargs):
        pass

    def textlength(self, *args, **kwargs):
        return self._d.textlength(*args, **kwargs)


def _pilula(draw, xy, texto, fonte, tam, fundo, cor):
    x, y = xy
    larg = draw.textlength(texto, font=fonte)
    px, py = tam * 0.9, tam * 0.5
    draw.rounded_rectangle(
        (x, y, x + larg + 2 * px, y + tam + 2 * py), radius=int((tam + 2 * py) / 2), fill=fundo
    )
    draw.text((x + px, y + py - tam * 0.08), texto, font=fonte, fill=cor)
    return y + tam + 2 * py


def renderizar(
    modelo: str,
    formato: str,
    textos: dict,
    marca: dict,
    logo: bytes | None = None,
    imagem_fundo: bytes | None = None,
    pagina: tuple[int, int] | None = None,
) -> bytes:
    """PNG de um criativo. `textos`: kicker, titulo, subtitulo, destaque, cta, autor."""
    w, h, _ = FORMATOS.get(formato, FORMATOS["quadrado"])
    img = _fundo(w, h, marca, imagem_fundo)
    d = ImageDraw.Draw(img)
    prim = _cor(marca.get("cor_primaria"))
    cor_txt = _cor(marca.get("cor_texto"), (255, 255, 255))
    suave = _misturar(cor_txt, _cor(marca.get("cor_secundaria"), (22, 20, 18)), 0.28)
    paisagem = w > h
    m = int(min(w, h) * 0.075)
    larg = w - 2 * m if not paisagem else int(w * 0.62)
    topo = m + _logo(img, marca, logo, m) + int(m * 0.6)
    rodape = h - m

    # faixa de acento
    d.rectangle((0, h - int(m * 0.18), w, h), fill=prim)
    if pagina:
        f = _fonte(int(m * 0.36), 600)
        txt = f"{pagina[0]}/{pagina[1]}"
        d.text((w - m - d.textlength(txt, font=f), m), txt, font=f, fill=suave)

    kicker = (textos.get("kicker") or "").strip().upper()
    titulo = (textos.get("titulo") or "").strip()
    sub = (textos.get("subtitulo") or "").strip()
    cta = (textos.get("cta") or "").strip()
    destaque = (textos.get("destaque") or "").strip()

    reserva_cta = int(m * 1.8) if cta else 0
    area = rodape - topo - reserva_cta
    base = min(w, h)
    alto = h / w > 1.2  # retrato/vertical: texto maior e centralizado

    def bloco(dr, y):
        """Desenha (ou só mede, com `dr=None`) o bloco de texto a partir de y."""
        medir = _MedeDraw(d) if dr is None else dr
        if modelo == "citacao":
            f_aspas = _fonte(int(base * 0.22), 800)
            medir.text((m - int(m * 0.1), y - int(m * 0.2)), "\u201c", font=f_aspas, fill=prim)
            y += int(base * 0.16)
            f, linhas, tam = _caber(
                d, titulo, larg, area * 0.58, int(base * (0.085 if alto else 0.075)), peso=600
            )
            y = _texto(medir, (m, y), linhas, f, tam, cor_txt, 1.25)
            autor = (textos.get("autor") or sub).strip()
            if autor:
                tam_a = int(base * 0.034)
                medir.text((m, y + m * 0.4), f"\u2014 {autor}", font=_fonte(tam_a, 700), fill=prim)
                y += m * 0.4 + tam_a * 1.3
            return y
        if kicker:
            tk = int(base * (0.036 if alto else 0.03))
            medir.text((m, y), kicker, font=_fonte(tk, 700), fill=prim)
            y += tk * 1.9
        if modelo == "oferta" and destaque:
            fd, ld, td = _caber(
                d, destaque, larg, area * 0.3, int(base * 0.22), peso=800, entre=1.0
            )
            y = _texto(medir, (m, y), ld, fd, td, prim, 1.0) + m * 0.2
        maximo = int(base * ((0.11 if modelo != "oferta" else 0.08) * (1.12 if alto else 1)))
        f, linhas, tam = _caber(d, titulo, larg, area * (0.5 if sub else 0.66), maximo)
        y = _texto(medir, (m, y), linhas, f, tam, cor_txt)
        if sub:
            fs, ls, ts = _caber(
                d,
                sub,
                larg,
                area * 0.26,
                int(base * (0.046 if alto else 0.04)),
                minimo=20,
                peso=500,
                entre=1.3,
            )
            y = _texto(medir, (m, y + m * 0.35), ls, fs, ts, suave, 1.3)
        return y

    altura_bloco = bloco(None, 0)
    folga = max(0, area - altura_bloco)
    bloco(d, topo + folga * (0.45 if alto else 0.4))
    if cta:
        fc = _fonte(int(min(w, h) * 0.034), 700)
        tam_c = int(min(w, h) * 0.034)
        _pilula(
            d, (m, rodape - tam_c - tam_c - int(m * 0.35)), cta, fc, tam_c, prim, (255, 255, 255)
        )
    out = io.BytesIO()
    img.save(out, "PNG", optimize=True)
    return out.getvalue()


def carrossel(textos: dict, formato: str, marca: dict, logo=None, fundo=None) -> list[bytes]:
    """Capa + uma lâmina por ponto + fechamento com CTA."""
    laminas = [x for x in textos.get("laminas") or [] if isinstance(x, dict)]
    total = len(laminas) + 2
    paginas = [
        renderizar(
            "destaque",
            formato,
            {
                "kicker": textos.get("kicker"),
                "titulo": textos.get("titulo"),
                "subtitulo": textos.get("subtitulo"),
            },
            marca,
            logo,
            fundo,
            (1, total),
        )
    ]
    for i, lam in enumerate(laminas, start=2):
        paginas.append(
            renderizar(
                "destaque",
                formato,
                {
                    "kicker": f"{i - 1:02d}",
                    "titulo": lam.get("titulo"),
                    "subtitulo": lam.get("texto"),
                },
                marca,
                logo,
                None,
                (i, total),
            )
        )
    paginas.append(
        renderizar(
            "destaque",
            formato,
            {
                "titulo": textos.get("cta") or "Gostou? Salve e compartilhe",
                "subtitulo": marca.get("site") or "",
            },
            marca,
            logo,
            None,
            (total, total),
        )
    )
    return paginas


def dimensoes(dados: bytes) -> tuple[int, int]:
    with Image.open(io.BytesIO(dados)) as im:
        return im.size


def miniatura(dados: bytes, lado: int = 480) -> bytes:
    with Image.open(io.BytesIO(dados)) as im:
        im = im.convert("RGB")
        im.thumbnail((lado, lado), Image.LANCZOS)
        out = io.BytesIO()
        im.save(out, "JPEG", quality=82)
        return out.getvalue()

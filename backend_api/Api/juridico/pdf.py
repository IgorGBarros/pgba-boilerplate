# backend_api/Api/juridico/pdf.py
"""
PDF sem dependência nova: texto simples (Helvetica, WinAnsi), quebra de linha
e páginas A4. Serve pra congelar um documento gerado de modelo antes de ir
pra assinatura e pra montar a página de "manifesto de assinaturas".
`pypdf` (já no projeto) junta o original + manifesto no PDF assinado.
"""
from __future__ import annotations

import io
import textwrap

W, H = 595, 842  # A4 em pontos
MARGEM = 56


def _esc(s: str) -> bytes:
    raw = s.encode("cp1252", errors="replace")
    return raw.replace(b"\\", b"\\\\").replace(b"(", b"\\(").replace(b")", b"\\)")


def text_pdf(blocos: list[tuple[str, str]], titulo: str = "") -> bytes:
    """
    `blocos` = [(estilo, texto)], estilo "h1" | "h2" | "p" | "small" | "mono".
    Quebra linha pelo tamanho aproximado da fonte.
    """
    estilos = {
        "h1": ("F2", 15, 20),
        "h2": ("F2", 11.5, 16),
        "p": ("F1", 10.5, 14.5),
        "small": ("F1", 8.5, 11.5),
        "mono": ("F3", 8.5, 11.5),
    }
    paginas: list[list[bytes]] = [[]]
    y = H - MARGEM
    for estilo, texto in blocos:
        fonte, tam, lead = estilos.get(estilo, estilos["p"])
        largura = int((W - 2 * MARGEM) / (tam * (0.6 if fonte == "F3" else 0.5)))
        linhas: list[str] = []
        for par in (texto or "").split("\n"):
            linhas += textwrap.wrap(par, largura) or [""]
        if estilo in ("h1", "h2"):
            y -= 4
        for ln in linhas:
            if y < MARGEM + lead:
                paginas.append([])
                y = H - MARGEM
            paginas[-1].append(
                b"BT /"
                + fonte.encode()
                + b" %.1f Tf %d %.1f Td (" % (tam, MARGEM, y)
                + _esc(ln)
                + b") Tj ET"
            )
            y -= lead
        y -= 4

    objs: list[bytes] = []
    add = lambda b: objs.append(b) or len(objs)  # noqa: E731
    f1 = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
    f2 = add(
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"
    )
    f3 = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>")
    pages_id = len(objs) + 1 + 2 * len(paginas)  # reservado depois das páginas
    kids = []
    for n, conteudo in enumerate(paginas, start=1):
        rodape = (
            b"BT /F1 7.5 Tf %d 30 Td (" % MARGEM
            + _esc(f"{titulo}  -  página {n} de {len(paginas)}")
            + b") Tj ET"
        )
        stream = b"\n".join(conteudo + [rodape])
        c = add(b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream")
        kids.append(
            add(
                b"<< /Type /Page /Parent %d 0 R /MediaBox [0 0 %d %d] /Contents %d 0 R "
                b"/Resources << /Font << /F1 %d 0 R /F2 %d 0 R /F3 %d 0 R >> >> >>"
                % (pages_id, W, H, c, f1, f2, f3)
            )
        )
    assert (
        add(
            b"<< /Type /Pages /Kids ["
            + b" ".join(b"%d 0 R" % k for k in kids)
            + b"] /Count %d >>" % len(kids)
        )
        == pages_id
    )
    catalog = add(b"<< /Type /Catalog /Pages %d 0 R >>" % pages_id)
    info = add(b"<< /Title (" + _esc(titulo) + b") /Producer (PGBA Juridico) >>")

    out = io.BytesIO()
    out.write(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for i, body in enumerate(objs, start=1):
        offsets.append(out.tell())
        out.write(b"%d 0 obj\n" % i + body + b"\nendobj\n")
    xref = out.tell()
    out.write(b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1))
    for off in offsets:
        out.write(b"%010d 00000 n \n" % off)
    out.write(
        b"trailer\n<< /Size %d /Root %d 0 R /Info %d 0 R >>\nstartxref\n%d\n%%%%EOF\n"
        % (len(objs) + 1, catalog, info, xref)
    )
    return out.getvalue()


def documento_pdf(titulo: str, conteudo: str) -> bytes:
    blocos = [("h1", titulo)] + [("p", par) for par in conteudo.split("\n\n")]
    return text_pdf(blocos, titulo)


def juntar(original: bytes, anexo: bytes) -> bytes:
    """Original + manifesto num PDF só."""
    from pypdf import PdfReader, PdfWriter

    w = PdfWriter()
    for src in (original, anexo):
        for page in PdfReader(io.BytesIO(src)).pages:
            w.add_page(page)
    w.add_metadata({"/Producer": "PGBA Juridico - assinatura eletronica"})
    buf = io.BytesIO()
    w.write(buf)
    return buf.getvalue()


def paginas(pdf: bytes) -> int:
    from pypdf import PdfReader

    return len(PdfReader(io.BytesIO(pdf)).pages)

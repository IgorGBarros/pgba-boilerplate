# backend_api/Api/marketing/video.py
"""
Vídeo: baixar (yt-dlp), transcrever (legenda do próprio vídeo ou Whisper pelo
harness), cortar em 9:16 com legenda queimada (ffmpeg + libass).

Regras:
- só baixa de YouTube/Twitch (lista fixa de hosts) e só com a pessoa
  confirmando que tem direito sobre o conteúdo (vídeo da própria marca ou
  autorizado) — cortar vídeo de terceiros sem autorização viola direito autoral
  e os termos do YouTube;
- limites de duração e tamanho; tudo numa pasta temporária do job, apagada no fim;
- texto da transcrição é DADO (vai pra IA marcado como tal, ver `ia.escolher_cortes`).

Precisa de `ffmpeg`/`ffprobe` no servidor (Dockerfile do backend instala).
"""
from __future__ import annotations

import html
import json
import pathlib
import re
import shutil
import subprocess
from urllib.parse import urlparse

from marketing.criativos import FONTE

HOSTS = {
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "youtu.be",
    "music.youtube.com",
    "twitch.tv",
    "www.twitch.tv",
    "clips.twitch.tv",
}
MAX_DURACAO = 3 * 3600
MAX_DOWNLOAD = 2 * 1024 * 1024 * 1024
LARG, ALT = 1080, 1920


class VideoError(Exception):
    pass


def _bin(nome: str) -> str:
    caminho = shutil.which(nome)
    if not caminho:
        raise VideoError(f"{nome} não está instalado no servidor.")
    return caminho


def _rodar(args: list[str], cwd=None, timeout=3600) -> subprocess.CompletedProcess:
    try:
        r = subprocess.run(args, cwd=cwd, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired as exc:
        raise VideoError(f"{pathlib.Path(args[0]).name} demorou demais.") from exc
    if r.returncode != 0:
        raise VideoError(f"{pathlib.Path(args[0]).name} falhou: {r.stderr.strip()[-600:]}")
    return r


def validar_url(url: str) -> str:
    p = urlparse((url or "").strip())
    if p.scheme not in ("http", "https") or (p.hostname or "").lower() not in HOSTS:
        raise VideoError("Só vídeos do YouTube ou da Twitch (ou envie o arquivo).")
    return p.geturl()


# ─── Download ────────────────────────────────────────────────────────────────


def baixar(url: str, pasta: pathlib.Path, progresso=None) -> dict:
    """Baixa o vídeo (até 1080p) + legenda (pt, senão en).
    Devolve {"video", "legenda", "titulo", "duracao"}."""
    import yt_dlp

    url = validar_url(url)
    base = {"quiet": True, "no_warnings": True, "noplaylist": True, "socket_timeout": 30}
    try:
        with yt_dlp.YoutubeDL(base) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception as exc:  # noqa: BLE001 — yt-dlp levanta vários tipos
        raise VideoError(f"Não consegui abrir o vídeo: {str(exc)[:300]}") from exc
    if info.get("is_live"):
        raise VideoError("Live em andamento não dá pra cortar — espere terminar.")
    duracao = float(info.get("duration") or 0)
    if duracao > MAX_DURACAO:
        raise VideoError("Vídeo com mais de 3 horas — corte um trecho antes.")

    def gancho(d):
        if progresso and d.get("status") == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            if total:
                progresso(int(d.get("downloaded_bytes", 0) * 100 / total))

    opcoes = {
        **base,
        "format": (
            "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080][ext=mp4]" "/b[height<=1080]/b"
        ),
        "merge_output_format": "mp4",
        "outtmpl": str(pasta / "origem.%(ext)s"),
        "writesubtitles": True,
        "writeautomaticsub": True,
        "subtitleslangs": ["pt-BR", "pt", "pt-orig", "en", "en-orig"],
        "subtitlesformat": "vtt",
        "max_filesize": MAX_DOWNLOAD,
        "progress_hooks": [gancho],
    }
    try:
        with yt_dlp.YoutubeDL(opcoes) as ydl:
            ydl.download([url])
    except Exception as exc:  # noqa: BLE001
        raise VideoError(f"Download falhou: {str(exc)[:300]}") from exc
    videos = [p for p in pasta.glob("origem.*") if p.suffix in (".mp4", ".mkv", ".webm")]
    if not videos:
        raise VideoError("O download não gerou arquivo de vídeo.")
    legendas = sorted(pasta.glob("origem*.vtt"), key=lambda p: (".pt" not in p.name, p.name))
    return {
        "video": videos[0],
        "legenda": legendas[0] if legendas else None,
        "titulo": info.get("title") or "",
        "duracao": duracao,
    }


# ─── Legenda / transcrição ──────────────────────────────────────────────────

_TEMPO = re.compile(r"(\d+):(\d{2}):(\d{2})[.,](\d{3})|(\d{2}):(\d{2})[.,](\d{3})")


def _seg(t: str) -> float:
    m = _TEMPO.search(t)
    if not m:
        return 0.0
    if m.group(1) is not None:
        h, mi, s, ms = (int(x) for x in m.group(1, 2, 3, 4))
    else:
        h, (mi, s, ms) = 0, (int(x) for x in m.group(5, 6, 7))
    return h * 3600 + mi * 60 + s + ms / 1000


def parse_vtt(texto: str) -> list[dict]:
    """WebVTT → segmentos. A legenda automática do YouTube repete a linha anterior em
    cada bloco (efeito "rolando"); aqui só entra o texto novo."""
    segmentos: list[dict] = []
    anterior = ""
    for bloco in re.split(r"\n\s*\n", texto.replace("\r", "")):
        linhas = [ln for ln in bloco.split("\n") if ln.strip()]
        idx = next((i for i, ln in enumerate(linhas) if "-->" in ln), None)
        if idx is None:
            continue
        ini_s, fim_s = linhas[idx].split("-->")[:2]
        ini, fim = _seg(ini_s), _seg(fim_s)
        conteudo = [html.unescape(re.sub(r"<[^>]+>", "", ln)).strip() for ln in linhas[idx + 1 :]]
        conteudo = [c for c in conteudo if c]
        if not conteudo or fim <= ini:
            continue
        novo = conteudo[-1] if len(conteudo) > 1 and conteudo[0] == anterior else " ".join(conteudo)
        if novo == anterior or fim - ini < 0.05:
            continue
        anterior = conteudo[-1]
        segmentos.append({"inicio": round(ini, 2), "fim": round(fim, 2), "texto": novo})
    return juntar_segmentos(segmentos)


def juntar_segmentos(segs: list[dict], max_dur: float = 8.0) -> list[dict]:
    """Junta falas curtas em frases de até ~8s (melhor pra IA e pra legenda)."""
    out: list[dict] = []
    for s in segs:
        if (
            out
            and s["fim"] - out[-1]["inicio"] <= max_dur
            and not out[-1]["texto"].rstrip().endswith((".", "?", "!"))
        ):
            out[-1]["fim"] = s["fim"]
            out[-1]["texto"] = f"{out[-1]['texto']} {s['texto']}".strip()
        else:
            out.append(dict(s))
    return out


def sondar(caminho) -> dict:
    r = _rodar(
        [
            _bin("ffprobe"),
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            str(caminho),
        ],
        timeout=60,
    )
    d = json.loads(r.stdout or "{}")
    v = next((s for s in d.get("streams", []) if s.get("codec_type") == "video"), {})
    rot = str((v.get("tags") or {}).get("rotate") or "")
    w, h = int(v.get("width") or 0), int(v.get("height") or 0)
    if rot in ("90", "270", "-90"):
        w, h = h, w
    return {
        "duracao": float((d.get("format") or {}).get("duration") or 0),
        "largura": w,
        "altura": h,
        "tem_audio": any(s.get("codec_type") == "audio" for s in d.get("streams", [])),
    }


def extrair_audio(video, destino) -> bytes:
    """MP3 mono 16 kHz 32 kbps (~14 MB por hora) — cabe no limite de 25 MB do Whisper até ~1h40."""
    _rodar(
        [
            _bin("ffmpeg"),
            "-y",
            "-i",
            str(video),
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-b:a",
            "32k",
            str(destino),
        ],
        timeout=1800,
    )
    return pathlib.Path(destino).read_bytes()


# ─── Corte 9:16 com legenda ─────────────────────────────────────────────────


def _ass_texto(t: str) -> str:
    return t.replace("\\", "").replace("{", "(").replace("}", ")").replace("\n", " ")


def _tempo_ass(s: float) -> str:
    s = max(0.0, s)
    h, resto = divmod(s, 3600)
    m, seg = divmod(resto, 60)
    return f"{int(h)}:{int(m):02d}:{seg:05.2f}"


def legenda_ass(
    segmentos: list[dict], ini: float, fim: float, gancho: str = "", palavras: int = 4
) -> str:
    """ASS da legenda do trecho [ini, fim]: blocos curtos (estilo shorts) + gancho no topo."""
    fonte = "Montserrat"
    formato_estilo = (
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, "
        "BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, "
        "BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding"
    )
    # legenda: branca com contorno, embaixo do meio; gancho: caixa branca no topo
    legenda = (
        f"Style: Legenda,{fonte},74,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,"
        "-1,0,0,0,100,100,0,0,1,6,2,2,80,80,520,1"
    )
    gancho_estilo = (
        f"Style: Gancho,{fonte},62,&H00111111,&H00111111,&H00FFFFFF,&H00FFFFFF,"
        "-1,0,0,0,100,100,0,0,3,18,0,8,90,90,230,1"
    )
    cab = "\n".join(
        [
            "[Script Info]",
            "ScriptType: v4.00+",
            f"PlayResX: {LARG}",
            f"PlayResY: {ALT}",
            "WrapStyle: 0",
            "ScaledBorderAndShadow: yes",
            "",
            "[V4+ Styles]",
            formato_estilo,
            legenda,
            gancho_estilo,
            "",
            "[Events]",
            "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
            "",
        ]
    )
    eventos = []
    dur = fim - ini
    if gancho:
        eventos.append(
            f"Dialogue: 1,{_tempo_ass(0)},{_tempo_ass(min(dur, 4.0))},Gancho,,0,0,0,,"
            f"{_ass_texto(gancho.upper())}"
        )
    for s in segmentos:
        a, b = max(s["inicio"], ini), min(s["fim"], fim)
        if b - a < 0.2:
            continue
        ws = s["texto"].split()
        if not ws:
            continue
        # distribui o tempo do segmento pelos blocos, proporcional ao tamanho do texto
        blocos = [" ".join(ws[i : i + palavras]) for i in range(0, len(ws), palavras)]
        # parte do segmento antes do corte: descarta os blocos correspondentes
        total_chars = sum(len(x) for x in blocos) or 1
        t = s["inicio"]
        for bl in blocos:
            d = (s["fim"] - s["inicio"]) * len(bl) / total_chars
            x0, x1 = max(t, ini), min(t + d, fim)
            if x1 - x0 >= 0.15:
                eventos.append(
                    f"Dialogue: 0,{_tempo_ass(x0 - ini)},{_tempo_ass(x1 - ini)},Legenda,,0,0,0,,"
                    f"{_ass_texto(bl.upper())}"
                )
            t += d
    return cab + "\n".join(eventos) + "\n"


def cortar(
    origem, ini: float, fim: float, destino, ass: str | None, estilo: str = "desfocado"
) -> None:
    """Trecho [ini, fim] em 1080x1920, H.264/AAC, legenda queimada."""
    destino = pathlib.Path(destino)
    pasta = destino.parent
    (pasta / "fontes").mkdir(exist_ok=True)
    fonte_local = pasta / "fontes" / "Montserrat.ttf"
    if not fonte_local.exists():
        shutil.copy(FONTE, fonte_local)
    sub = ""
    if ass:
        (pasta / "legenda.ass").write_text(ass, encoding="utf-8")
        # caminhos relativos (cwd = pasta): sem ':' nem '\' pra escapar no filtro
        sub = ",ass=legenda.ass:fontsdir=fontes"
    if estilo == "centro":
        filtro = (
            f"[0:v]scale={LARG}:{ALT}:force_original_aspect_ratio=increase,"
            f"crop={LARG}:{ALT},setsar=1{sub}[v]"
        )
    else:
        filtro = (
            f"[0:v]split[a][b];"
            f"[a]scale={LARG}:{ALT}:force_original_aspect_ratio=increase,crop={LARG}:{ALT},"
            f"boxblur=24:2,eq=brightness=-0.08[fundo];"
            f"[b]scale={LARG}:{ALT}:force_original_aspect_ratio=decrease[frente];"
            f"[fundo][frente]overlay=(W-w)/2:(H-h)/2,setsar=1{sub}[v]"
        )
    info = sondar(origem)
    args = [
        _bin("ffmpeg"),
        "-y",
        "-ss",
        f"{ini:.2f}",
        "-t",
        f"{fim - ini:.2f}",
        "-i",
        str(pathlib.Path(origem).resolve()),
        "-filter_complex",
        filtro,
        "-map",
        "[v]",
    ]
    if info["tem_audio"]:
        args += ["-map", "0:a:0", "-c:a", "aac", "-b:a", "160k"]
    args += [
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "22",
        "-r",
        "30",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        destino.name,
    ]
    _rodar(args, cwd=pasta, timeout=1800)


def quadro(video, destino, t: float = 1.0, lado: int = 540) -> None:
    _rodar(
        [
            _bin("ffmpeg"),
            "-y",
            "-ss",
            f"{t:.2f}",
            "-i",
            str(video),
            "-frames:v",
            "1",
            "-vf",
            f"scale={lado}:-2",
            str(destino),
        ],
        timeout=120,
    )

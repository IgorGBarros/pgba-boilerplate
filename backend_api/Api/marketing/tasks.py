# backend_api/Api/marketing/tasks.py
"""
Trabalho lento do Marketing no Celery (sem broker, a view roda na hora):
publicar, escrever rascunhos em lote, cortes de vídeo e vídeo pelo MoneyPrinterTurbo.
"""
from __future__ import annotations

import logging
import pathlib
import shutil
import tempfile
import time

from celery import shared_task
from django.conf import settings
from django.db.models import Q
from django.utils import timezone

logger = logging.getLogger(__name__)


def despachar(tarefa, *args) -> bool:
    """Enfileira; sem broker/worker disponível, roda na hora. Devolve True se enfileirou."""
    try:
        tarefa.delay(*args)
        return True
    except Exception:  # noqa: BLE001
        tarefa(*args)
        return False


# ─── Publicação ─────────────────────────────────────────────────────────────


@shared_task
def publicar_task(pub_id: int, tenant_id: str):
    from marketing.services import MarketingError, publicar

    try:
        publicar(pub_id, tenant_id)
    except MarketingError as exc:
        logger.info("Publicação %s não saiu: %s", pub_id, exc)


@shared_task
def publicar_agendadas_task():
    """Aprovadas cujo horário chegou (ou sem horário = publicar já)."""
    from marketing.models import Publicacao
    from marketing.services import reivindicar

    agora = timezone.now()
    pendentes = Publicacao.objects.filter(is_active=True, status="agendada").filter(
        Q(agendada_para__isnull=True) | Q(agendada_para__lte=agora)
    )
    n = 0
    for pub_id, tenant_id in pendentes.values_list("id", "tenant_id")[:50]:
        if reivindicar(pub_id, tenant_id):
            publicar_task(pub_id, str(tenant_id))
            n += 1
    return n


# ─── Rascunhos em lote ──────────────────────────────────────────────────────


@shared_task
def escrever_rascunhos_task(ids: list[int], tenant_id: str, instrucoes: str = ""):
    from marketing.ia import IAError, aplicar_post, escrever_post
    from marketing.models import Publicacao

    feitos = 0
    for pub in Publicacao.objects.filter(
        tenant_id=tenant_id, pk__in=ids, is_active=True, status__in=["rascunho", "revisao"]
    ):
        redes = sorted({d.conta.rede for d in pub.destinos.select_related("conta")}) or [
            "instagram"
        ]
        try:
            dados = escrever_post(
                tenant_id,
                pub.titulo,
                redes,
                pub.formato,
                instrucoes,
                gancho=pub.gancho,
                pilar=pub.pilar,
            )
            aplicar_post(pub, dados)
            feitos += 1
        except Exception as exc:  # noqa: BLE001 — um post que falha não para os outros
            pub.observacoes = f"IA não escreveu: {exc}"[:1000]
            pub.save(update_fields=["observacoes"])
            if not isinstance(exc, IAError):
                logger.exception("Falha escrevendo rascunho %s", pub.pk)
    return feitos


# ─── Vídeo ───────────────────────────────────────────────────────────────────


def _etapa(job, status: str, progresso: int, etapa: str = "") -> None:
    job.status, job.progresso, job.etapa = status, max(0, min(progresso, 100)), etapa[:255]
    job.save(update_fields=["status", "progresso", "etapa"])


def _pasta(job) -> pathlib.Path:
    raiz = pathlib.Path(getattr(settings, "MEDIA_ROOT", tempfile.gettempdir())) / "marketing_tmp"
    raiz.mkdir(parents=True, exist_ok=True)
    return pathlib.Path(tempfile.mkdtemp(prefix=f"job{job.pk}_", dir=raiz))


@shared_task
def processar_cortes_task(job_id: int):
    from harness.providers import ProviderConfigError, transcribe
    from marketing import ia, video
    from marketing.midias import caminho_local, salvar_video
    from marketing.models import JobVideo

    job = JobVideo.objects.get(pk=job_id)
    if job.status in ("concluido",):
        return
    pasta = _pasta(job)
    p = job.parametros or {}
    try:
        legenda = None
        if job.origem_midia_id:
            origem = caminho_local(job.origem_midia)
            titulo = job.titulo or job.origem_midia.titulo
        else:
            _etapa(job, "baixando", 2, "Baixando o vídeo")
            ultimo = [0]

            def prog(pct):
                if pct - ultimo[0] >= 5:
                    ultimo[0] = pct
                    _etapa(job, "baixando", 2 + int(pct * 0.28), f"Baixando ({pct}%)")

            b = video.baixar(job.origem_url, pasta, prog)
            origem, legenda, titulo = b["video"], b["legenda"], b["titulo"]
            job.titulo = job.titulo or titulo[:255]
            job.save(update_fields=["titulo"])
        info = video.sondar(origem)
        duracao = info["duracao"]

        _etapa(job, "transcrevendo", 32, "Lendo as falas do vídeo")
        segmentos = []
        if legenda:
            segmentos = video.parse_vtt(legenda.read_text(encoding="utf-8", errors="ignore"))
        if not segmentos:
            if not info["tem_audio"]:
                raise video.VideoError("O vídeo não tem áudio pra transcrever.")
            audio = video.extrair_audio(origem, pasta / "audio.mp3")
            try:
                segmentos = video.juntar_segmentos(
                    transcribe(job.tenant_id, audio, language=p.get("idioma", "pt"))
                )
            except ProviderConfigError as exc:
                raise video.VideoError(str(exc)) from exc
        job.transcricao = segmentos
        job.save(update_fields=["transcricao"])

        _etapa(job, "analisando", 50, "Editor de Vídeo escolhendo os melhores trechos")
        cortes, agente = ia.escolher_cortes(
            job.tenant_id,
            segmentos,
            duracao,
            int(p.get("quantidade", 5)),
            int(p.get("minimo", 20)),
            int(p.get("maximo", 60)),
            titulo,
        )
        job.agente = agente
        job.save(update_fields=["agente"])
        if not cortes:
            raise video.VideoError("Nenhum trecho bom o bastante pra corte.")

        feitos = []
        for i, c in enumerate(cortes, start=1):
            _etapa(
                job,
                "cortando",
                55 + int(40 * (i - 1) / len(cortes)),
                f"Cortando {i} de {len(cortes)}",
            )
            sub = pasta / f"corte{i}"
            sub.mkdir()
            ass = (
                video.legenda_ass(
                    segmentos, c["inicio"], c["fim"], c["gancho"] if p.get("gancho", True) else ""
                )
                if p.get("legenda", True)
                else None
            )
            destino = sub / "corte.mp4"
            video.cortar(origem, c["inicio"], c["fim"], destino, ass, p.get("estilo", "desfocado"))
            m = salvar_video(
                job.tenant_id,
                destino,
                f"corte-{i}.mp4",
                origem="corte",
                titulo=c["titulo"],
                formato="vertical",
                legenda_sugerida=f"{c['legenda']}\n\n{c['hashtags']}".strip(),
                dados=c,
                job=job,
            )
            feitos.append(m.pk)
        job.resultado = {"midias": feitos, "duracao_origem": duracao}
        job.status, job.progresso, job.etapa = "concluido", 100, f"{len(feitos)} cortes prontos"
        job.concluido_em = timezone.now()
        job.save(update_fields=["resultado", "status", "progresso", "etapa", "concluido_em"])
    except Exception as exc:  # noqa: BLE001 — qualquer falha fica visível no job, nunca some
        if not isinstance(exc, (video.VideoError, ia.IAError)):
            logger.exception("Job de cortes %s falhou", job_id)
        job.status, job.erro = "erro", str(exc)[:3000]
        job.save(update_fields=["status", "erro"])
    finally:
        shutil.rmtree(pasta, ignore_errors=True)


@shared_task
def gerar_video_ia_task(job_id: int):
    """Manda pro MoneyPrinterTurbo e acompanha até o vídeo ficar pronto (até 40 min)."""
    from integrations import moneyprinter as mp
    from marketing.midias import salvar_video
    from marketing.models import JobVideo

    job = JobVideo.objects.get(pk=job_id)
    p = job.parametros or {}
    pasta = _pasta(job)
    try:
        if not job.externo_id:
            _etapa(job, "gerando", 5, "Enviando o roteiro pro MoneyPrinterTurbo")
            job.externo_id = mp.criar_video(
                job.tenant_id,
                assunto=job.titulo,
                roteiro=p["roteiro"],
                termos=p.get("termos") or [],
                proporcao=p.get("proporcao", "9:16"),
                voz=p.get("voz") or "pt-BR-FranciscaNeural-Female",
                legenda=p.get("legenda", True),
                musica=p.get("musica", True),
            )
            job.save(update_fields=["externo_id"])
        fim = time.monotonic() + 40 * 60
        while True:
            est = mp.estado(job.tenant_id, job.externo_id)
            if est["estado"] == "falhou":
                raise mp.MoneyPrinterError(
                    est["erro"] or "O MoneyPrinterTurbo não conseguiu gerar."
                )
            if est["estado"] == "pronto" and est["videos"]:
                break
            _etapa(
                job,
                "gerando",
                5 + int(est["progresso"] * 0.85),
                "Gerando vídeo (narração, cenas, legenda)",
            )
            if time.monotonic() > fim:
                raise mp.MoneyPrinterError("Passou de 40 minutos — confira o MoneyPrinterTurbo.")
            time.sleep(10)
        _etapa(job, "gerando", 92, "Baixando o vídeo pronto")
        destino = pasta / "video.mp4"
        mp.baixar(job.tenant_id, est["videos"][0], destino)
        m = salvar_video(
            job.tenant_id,
            destino,
            "video-ia.mp4",
            origem="video_ia",
            titulo=job.titulo,
            formato={"9:16": "vertical", "16:9": "paisagem", "1:1": "quadrado"}.get(
                p.get("proporcao", "9:16"), "vertical"
            ),
            legenda_sugerida=f"{p.get('legenda_post', '')}\n\n{p.get('hashtags', '')}".strip(),
            dados={"roteiro": p.get("roteiro", ""), "termos": p.get("termos", [])},
            job=job,
        )
        job.resultado = {"midias": [m.pk]}
        job.status, job.progresso, job.etapa = "concluido", 100, "Vídeo pronto"
        job.concluido_em = timezone.now()
        job.save(update_fields=["resultado", "status", "progresso", "etapa", "concluido_em"])
    except Exception as exc:  # noqa: BLE001
        if not isinstance(exc, mp.MoneyPrinterError):
            logger.exception("Vídeo IA %s falhou", job_id)
        job.status, job.erro = "erro", str(exc)[:3000]
        job.save(update_fields=["status", "erro"])
    finally:
        shutil.rmtree(pasta, ignore_errors=True)

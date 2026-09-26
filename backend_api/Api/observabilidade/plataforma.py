# backend_api/Api/observabilidade/plataforma.py
"""Verificações da infraestrutura (só a equipe da plataforma vê)."""
from __future__ import annotations

import os
import shutil
import time
from datetime import timedelta

from django.conf import settings
from django.utils import timezone

from observabilidade import banco
from observabilidade.registro import Resultado


def verificar_banco() -> Resultado:
    r = banco.verificar()
    return Resultado(
        "plataforma.banco",
        "plataforma",
        "Banco de dados (Postgres)",
        r["status"],
        r["detalhe"],
        r["causa"],
        r["acao"],
        r["dados"],
        r["ms"],
        gravidade="critica",
    )


def verificar_redis() -> Resultado:
    url = getattr(settings, "CELERY_BROKER_URL", "") or ""
    inicio = time.monotonic()
    try:
        import redis

        cli = redis.Redis.from_url(url, socket_timeout=2, socket_connect_timeout=2)
        cli.ping()
        ms = int((time.monotonic() - inicio) * 1000)
        fila = int(cli.llen("celery") or 0)
        mem = (cli.info("memory") or {}).get("used_memory_human", "")
    except Exception as exc:  # noqa: BLE001
        return Resultado(
            "plataforma.redis",
            "plataforma",
            "Redis (fila de tarefas)",
            "falha",
            str(exc)[:400],
            "O Redis não responde: sem ele, nada roda em segundo plano (sincronização, "
            "publicação agendada, cortes, e-mails) e o tempo real do Escritório para.",
            "`docker compose ps redis` e `docker compose up -d redis`; confira REDIS_URL no .env.",
            ms=int((time.monotonic() - inicio) * 1000),
            gravidade="critica",
        )
    status = "alerta" if fila > 200 else "ok"
    detalhe = f"{fila} tarefa(s) na fila · memória {mem}"
    causa = (
        "Fila acumulando: os workers não dão conta ou estão parados." if status == "alerta" else ""
    )
    acao = (
        "Veja o worker (componente abaixo) e `docker compose logs celery_worker`." if causa else ""
    )
    return Resultado(
        "plataforma.redis",
        "plataforma",
        "Redis (fila de tarefas)",
        status,
        detalhe,
        causa,
        acao,
        {"fila": fila, "memoria": mem},
        ms,
        gravidade="critica",
    )


def verificar_workers() -> Resultado:
    inicio = time.monotonic()
    try:
        from config.celery import app

        respostas = app.control.ping(timeout=1.5) or []
    except Exception as exc:  # noqa: BLE001
        respostas, erro = [], str(exc)
    else:
        erro = ""
    ms = int((time.monotonic() - inicio) * 1000)
    if respostas:
        nomes = [list(r.keys())[0] for r in respostas]
        return Resultado(
            "plataforma.worker",
            "plataforma",
            "Workers (Celery)",
            "ok",
            f"{len(nomes)} worker(s) respondendo",
            dados={"workers": nomes},
            ms=ms,
            gravidade="critica",
        )
    return Resultado(
        "plataforma.worker",
        "plataforma",
        "Workers (Celery)",
        "falha",
        erro or "nenhum worker respondeu ao ping",
        "Nenhum worker está rodando: tarefas ficam paradas na fila (sincronização, publicação, "
        "cortes de vídeo, envio de e-mail).",
        "`docker compose up -d celery_worker` e `docker compose logs --tail 100 celery_worker`.",
        ms=ms,
        gravidade="critica",
    )


def verificar_agendador() -> Resultado:
    from observabilidade.models import Batimento

    b = Batimento.objects.filter(nome="beat").first()
    if b is None:
        return Resultado(
            "plataforma.beat",
            "plataforma",
            "Agendador (Celery beat)",
            "desconhecido",
            "ainda sem batimento registrado",
            gravidade="alta",
        )
    idade = (timezone.now() - b.em).total_seconds()
    if idade > 300:
        return Resultado(
            "plataforma.beat",
            "plataforma",
            "Agendador (Celery beat)",
            "falha",
            f"último batimento há {int(idade // 60)} min",
            "O agendador parou: posts agendados não saem, fontes não sincronizam sozinhas e as "
            "verificações automáticas param.",
            "`docker compose up -d celery_beat` e `docker compose logs --tail 100 celery_beat`.",
            gravidade="alta",
        )
    return Resultado(
        "plataforma.beat",
        "plataforma",
        "Agendador (Celery beat)",
        "ok",
        f"batimento há {int(idade)} s",
        gravidade="alta",
    )


def verificar_disco() -> Resultado:
    pasta = str(getattr(settings, "MEDIA_ROOT", "/"))
    try:
        uso = shutil.disk_usage(pasta if os.path.isdir(pasta) else "/")
    except OSError as exc:
        return Resultado("plataforma.disco", "plataforma", "Disco", "desconhecido", str(exc))
    livre = uso.free / uso.total
    status = "falha" if livre < 0.03 else "alerta" if livre < 0.10 else "ok"
    return Resultado(
        "plataforma.disco",
        "plataforma",
        "Disco",
        status,
        f"{uso.free / 1e9:.1f} GB livres de {uso.total / 1e9:.1f} GB ({livre:.0%})",
        "" if status == "ok" else "Disco quase cheio: banco, uploads e cortes de vídeo vão falhar.",
        ""
        if status == "ok"
        else "Apague mídias antigas, backups locais e imagens Docker sem uso "
        "(`docker system prune`), ou aumente o disco.",
        {"livre_gb": round(uso.free / 1e9, 1)},
        gravidade="alta",
    )


def verificar_erros_e_api() -> list[Resultado]:
    from django.db.models import Sum

    from observabilidade.models import EventoErro, Metrica

    desde = timezone.now() - timedelta(minutes=15)
    erros = EventoErro.objects.filter(ultimo__gte=desde, resolvido=False).count()
    r_erros = Resultado(
        "plataforma.erros",
        "plataforma",
        "Erros no log (15 min)",
        "alerta" if erros >= 5 else "ok",
        f"{erros} tipo(s) de erro nos últimos 15 min",
        "Erros novos ou repetindo no backend." if erros >= 5 else "",
        "Abra a aba Erros pra ver a mensagem e onde acontece." if erros >= 5 else "",
        gravidade="media",
    )
    agg = Metrica.objects.filter(
        tipo="api", minuto__gte=timezone.now() - timedelta(minutes=10)
    ).aggregate(total=Sum("total"), erros=Sum("erros"))
    total, falhas = agg["total"] or 0, agg["erros"] or 0
    taxa = falhas / total if total else 0
    status = (
        "falha" if total >= 20 and taxa > 0.2 else "alerta" if total >= 10 and taxa > 0.05 else "ok"
    )
    r_api = Resultado(
        "plataforma.api",
        "plataforma",
        "API (respostas 5xx, 10 min)",
        status,
        f"{total} requisições · {falhas} com erro 5xx ({taxa:.0%})",
        "" if status == "ok" else "A API está respondendo erro interno em parte das requisições.",
        ""
        if status == "ok"
        else "Veja a aba Erros (a exceção aparece lá) e as rotas com mais 5xx em APIs.",
        {"total": total, "erros": falhas},
        gravidade="alta",
    )
    return [r_erros, r_api]


def verificar_config() -> Resultado:
    faltas = []
    if not getattr(settings, "ENCRYPTION_KEY", ""):
        faltas.append("ENCRYPTION_KEY vazia (nenhum segredo pode ser salvo)")
    if not settings.DEBUG and not getattr(settings, "PUBLIC_API_URL", ""):
        faltas.append("PUBLIC_API_URL vazia (OAuth das redes e Instagram não funcionam)")
    return Resultado(
        "plataforma.config",
        "plataforma",
        "Configuração do servidor",
        "alerta" if faltas else "ok",
        "; ".join(faltas) or "variáveis essenciais preenchidas",
        acao="Preencha no .env e reinicie o backend." if faltas else "",
        gravidade="media",
    )


def todas(com_banco: bool = True) -> list[Resultado]:
    """Todas as verificações de plataforma. Sem banco, só as que não dependem dele."""
    resultados = [verificar_banco()] if com_banco else []
    banco_ok = not resultados or resultados[0].status != "falha"
    resultados += [verificar_redis(), verificar_workers(), verificar_disco()]
    if banco_ok:
        for fn in (verificar_agendador, verificar_config):
            resultados.append(fn())
        resultados += verificar_erros_e_api()
    return resultados

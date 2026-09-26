# backend_api/Api/observabilidade/motor.py
"""
Roda as verificações, guarda o estado e decide incidentes.

- falha 2 vezes seguidas → abre Incidente (sinal `incidente_aberto`);
- voltou a ok/alerta → resolve o incidente aberto (sinal `incidente_resolvido`);
- banco FORA: nada pode ser gravado nele — a queda fica anotada no Redis e,
  quando o banco volta, o incidente é registrado com o horário real do início
  (pós-mortem com a causa que foi vista na hora).
"""
from __future__ import annotations

import json
import logging
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from observabilidade import plataforma, registro
from observabilidade.models import PLATAFORMA, Amostra, Batimento, EstadoComponente, Incidente
from observabilidade.registro import Resultado
from observabilidade.sinais import incidente_aberto, incidente_resolvido

logger = logging.getLogger(__name__)

LIMIAR_FALHAS = 2
CHAVE_QUEDA_BANCO = "pgba:obs:queda_banco"


def aplicar(tenant_id, resultados: list[Resultado]) -> list[EstadoComponente]:
    tenant_id = tenant_id or PLATAFORMA
    agora = timezone.now()
    estados, abertos, resolvidos = [], [], []
    for r in resultados:
        with transaction.atomic():
            e, novo = EstadoComponente.objects.select_for_update().get_or_create(
                tenant_id=tenant_id,
                chave=r.chave,
                defaults={"grupo": r.grupo, "nome": r.nome, "desde": agora},
            )
            if not novo and e.status != r.status:
                e.desde = agora
            e.grupo, e.nome, e.status = r.grupo, r.nome[:200], r.status
            e.detalhe, e.causa, e.acao = r.detalhe[:4000], r.causa, r.acao
            e.dados, e.ms, e.verificado_em = r.dados or {}, r.ms, agora
            e.falhas_seguidas = e.falhas_seguidas + 1 if r.status == "falha" else 0
            e.save()
            Amostra.objects.create(
                tenant_id=tenant_id, chave=r.chave, em=agora, status=r.status, ms=r.ms
            )
            aberto = Incidente.objects.filter(
                tenant_id=tenant_id, chave=r.chave, status="aberto"
            ).first()
            if r.status == "falha" and e.falhas_seguidas >= LIMIAR_FALHAS and aberto is None:
                inc = Incidente.objects.create(
                    tenant_id=tenant_id,
                    chave=r.chave,
                    grupo=r.grupo,
                    titulo=f"{r.nome}: fora do ar",
                    gravidade=r.gravidade,
                    aberto_em=e.desde,
                    detalhe=r.detalhe[:4000],
                    causa=r.causa,
                    acao=r.acao,
                    dados=r.dados or {},
                )
                abertos.append(inc)
            elif r.status in ("ok", "alerta") and aberto is not None:
                aberto.status, aberto.resolvido_em = "resolvido", agora
                aberto.save(update_fields=["status", "resolvido_em"])
                resolvidos.append(aberto)
        estados.append(e)
    for inc in abertos:
        incidente_aberto.send_robust(Incidente, incidente=inc)
    for inc in resolvidos:
        incidente_resolvido.send_robust(Incidente, incidente=inc)
    return estados


def _redis():
    import redis

    return redis.Redis.from_url(
        settings.CELERY_BROKER_URL, socket_timeout=2, socket_connect_timeout=2
    )


def _anotar_queda_banco(r: Resultado) -> None:
    try:
        cli = _redis()
        if not cli.exists(CHAVE_QUEDA_BANCO):
            cli.set(
                CHAVE_QUEDA_BANCO,
                json.dumps(
                    {
                        "desde": timezone.now().isoformat(),
                        "detalhe": r.detalhe,
                        "causa": r.causa,
                        "acao": r.acao,
                    }
                ),
            )
    except Exception as exc:  # noqa: BLE001 — sem Redis também: só o log fica
        logger.warning("Banco fora e Redis indisponível pra anotar a queda: %s", exc)


def _registrar_queda_passada() -> None:
    try:
        cli = _redis()
        bruto = cli.get(CHAVE_QUEDA_BANCO)
    except Exception:  # noqa: BLE001
        return
    if not bruto:
        return
    q = json.loads(bruto)
    from django.utils.dateparse import parse_datetime

    inc = Incidente.objects.create(
        tenant_id=PLATAFORMA,
        chave="plataforma.banco",
        grupo="plataforma",
        titulo="Banco de dados (Postgres): ficou fora do ar",
        gravidade="critica",
        aberto_em=parse_datetime(q["desde"]) or timezone.now(),
        status="resolvido",
        resolvido_em=timezone.now(),
        detalhe=q.get("detalhe", ""),
        causa=q.get("causa", ""),
        acao=q.get("acao", ""),
        dados={"registrado_depois": True},
    )
    cli.delete(CHAVE_QUEDA_BANCO)
    incidente_aberto.send_robust(Incidente, incidente=inc)
    incidente_resolvido.send_robust(Incidente, incidente=inc)


def rodar_plataforma() -> list[Resultado]:
    resultados = plataforma.todas()
    banco = resultados[0]
    if banco.status == "falha":
        _anotar_queda_banco(banco)
        return resultados  # nada mais pode ser gravado
    _registrar_queda_passada()
    aplicar(PLATAFORMA, resultados)
    return resultados


def _vez(nome: str, tenant_id, intervalo: int, forcar: bool) -> bool:
    """Respeita o intervalo de cada verificação (as que falam com a rede são mais espaçadas)."""
    if forcar or intervalo <= 60:
        return True
    b, criado = Batimento.objects.get_or_create(nome=f"verif:{nome}:{tenant_id}")
    if not criado and (timezone.now() - b.em).total_seconds() < intervalo:
        return False
    b.em = timezone.now()
    b.save(update_fields=["em"])
    return True


def rodar_tenant(tenant_id, forcar: bool = False) -> list[Resultado]:
    resultados: list[Resultado] = []
    for v in registro.verificacoes():
        if not _vez(v.nome, tenant_id, v.intervalo, forcar):
            continue
        try:
            resultados += v.fn(tenant_id) or []
        except Exception as exc:  # noqa: BLE001 — uma verificação quebrada não para as outras
            logger.exception("Verificação %s falhou", v.nome)
            resultados.append(
                Resultado(
                    f"verificacao.{v.nome}",
                    "plataforma",
                    f"Verificação '{v.nome}'",
                    "desconhecido",
                    f"a própria verificação deu erro: {exc}"[:400],
                )
            )
    if resultados:
        aplicar(tenant_id, resultados)
    return resultados


def limpar() -> None:
    from observabilidade.models import Metrica

    agora = timezone.now()
    Amostra.objects.filter(em__lt=agora - timedelta(days=7)).delete()
    Metrica.objects.filter(minuto__lt=agora - timedelta(days=30)).delete()

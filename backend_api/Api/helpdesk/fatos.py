# backend_api/Api/helpdesk/fatos.py
"""
Fatos do monitoramento, numerados `[F#]`, pro time de TI citar. Montados em
Python a partir da observabilidade — a IA só redige em cima deles.

Isolamento: fatos de uma empresa só vêm do tenant dela + componentes da
plataforma (banco, Redis, workers — o que é de todos). Mensagem de erro do
log NÃO entra (pode citar dado de outra empresa): só logger, origem, tipo de
exceção e contagem.
"""
from __future__ import annotations

import re
from datetime import timedelta

from django.db.models import Max, Sum
from django.utils import timezone

from observabilidade.models import PLATAFORMA, EstadoComponente, EventoErro, Incidente, Metrica


IPV4 = re.compile(r"\b\d{1,3}(?:\.\d{1,3}){3}\b")


def _sem_ip(texto: str) -> str:
    """Fato de incidente da plataforma vai pro chamado de todas as empresas: IP interno sai."""
    return IPV4.sub("x.x.x.x", texto or "")


def _hora(dt) -> str:
    return timezone.localtime(dt).strftime("%d/%m %H:%M") if dt else "?"


def _tipo_excecao(trace: str) -> str:
    ultima = (trace or "").strip().splitlines()[-1:] or [""]
    return ultima[0].split(":", 1)[0][:80]


def coletar(tenant_id, incidente: Incidente | None = None, janela_min: int = 60) -> list[str]:
    agora = timezone.now()
    ref = incidente.aberto_em if incidente else agora
    desde = ref - timedelta(minutes=janela_min)
    escopos = [PLATAFORMA] + ([tenant_id] if tenant_id and tenant_id != PLATAFORMA else [])
    fatos: list[str] = []

    if incidente:
        fatos.append(
            f"Incidente '{incidente.titulo}' (gravidade {incidente.gravidade}) aberto em "
            f"{_hora(incidente.aberto_em)}"
            + (
                f", resolvido em {_hora(incidente.resolvido_em)}"
                if incidente.resolvido_em
                else ", ainda aberto"
            )
            + f". Detalhe da verificação: {incidente.detalhe[:400] or '—'}."
            + (
                f" Causa identificada pela verificação: {incidente.causa}."
                if incidente.causa
                else ""
            )
        )
        dados = {
            k: v for k, v in (incidente.dados or {}).items() if not isinstance(v, (dict, list))
        }
        if dados:
            fatos.append(
                "Dados da verificação: "
                + ", ".join(f"{k}={v}" for k, v in list(dados.items())[:12])
            )

    estados = list(EstadoComponente.objects.filter(tenant_id__in=escopos).order_by("grupo", "nome"))
    problemas = [e for e in estados if e.status in ("falha", "alerta")]
    for e in problemas[:15]:
        fatos.append(
            f"{e.nome} [{e.grupo}]: {e.status.upper()} desde {_hora(e.desde)} — {e.detalhe[:300]}"
            + (f" Causa: {e.causa}" if e.causa else "")
        )
    if estados and not problemas:
        fatos.append(
            f"Todos os {len(estados)} componentes monitorados estão OK "
            f"(última verificação {_hora(max(e.verificado_em for e in estados))})."
        )
    if not estados:
        fatos.append("Nenhum componente foi verificado ainda (o monitoramento não rodou).")

    abertos = Incidente.objects.filter(tenant_id__in=escopos, status="aberto")
    if incidente:
        abertos = abertos.exclude(pk=incidente.pk)
    for i in abertos.order_by("aberto_em")[:5]:
        fatos.append(f"Outro incidente aberto: '{i.titulo}' desde {_hora(i.aberto_em)}.")

    if tenant_id and tenant_id != PLATAFORMA:
        api = Metrica.objects.filter(
            tenant_id=tenant_id,
            tipo="api",
            minuto__gte=desde,
            minuto__lte=ref + timedelta(minutes=5),
        )
        agg = api.aggregate(t=Sum("total"), e=Sum("erros"), ms=Sum("ms_total"))
        if agg["t"]:
            fatos.append(
                f"API desta empresa ({janela_min} min até {_hora(ref)}): {agg['t']} requisições, "
                f"{agg['e'] or 0} com erro 5xx, tempo médio {int((agg['ms'] or 0) / agg['t'])} ms."
            )
            piores = (
                api.values("chave")
                .annotate(e=Sum("erros"), t=Sum("total"))
                .filter(e__gt=0)
                .order_by("-e")[:3]
            )
            for p in piores:
                fatos.append(f"Rota com erro 5xx: {p['chave']} — {p['e']} de {p['t']} requisições.")
        ia = (
            Metrica.objects.filter(tenant_id=tenant_id, tipo="ia", minuto__gte=desde)
            .values("chave")
            .annotate(t=Sum("total"), e=Sum("erros"), ms=Sum("ms_total"), mx=Max("ms_max"))
            .order_by("-t")[:5]
        )
        for m in ia:
            fatos.append(
                f"IA {m['chave']}: {m['t']} chamada(s), {m['e']} com erro, média "
                f"{int(m['ms'] / m['t']) if m['t'] else 0} ms, pior {m['mx']} ms."
            )

    if incidente is None or incidente.tenant_id == PLATAFORMA:
        erros = EventoErro.objects.filter(ultimo__gte=desde, resolvido=False).order_by(
            "-ocorrencias"
        )[:5]
        for ev in erros:
            tipo = _tipo_excecao(ev.trace) or ev.nivel
            fatos.append(
                f"Erro no log: {tipo} em {ev.origem or ev.logger} ({ev.logger}) — "
                f"{ev.ocorrencias} ocorrência(s), última {_hora(ev.ultimo)}."
            )
        http = Metrica.objects.filter(tipo="http", minuto__gte=desde).aggregate(
            t=Sum("total"), e=Sum("erros")
        )
        if http["t"]:
            fatos.append(
                f"Saídas HTTP para serviços externos: {http['t']}, {http['e'] or 0} com erro."
            )
    return [_sem_ip(f) for f in fatos]


def numerar(fatos: list[str]) -> str:
    return "\n".join(f"[F{i}] {f}" for i, f in enumerate(fatos, start=1))

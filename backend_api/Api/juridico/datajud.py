# backend_api/Api/juridico/datajud.py
"""
DataJud — API Pública do CNJ (metadados e movimentações de processos de todos
os tribunais). Gratuita; a chave pública fica na wiki do CNJ
(https://datajud-wiki.cnj.jus.br/api-publica/acesso) e muda de tempos em
tempos — por isso fica em `ServiceCredential(provider="datajud")`, nunca no código.

    POST https://api-publica.datajud.cnj.jus.br/api_publica_<tribunal>/_search
    Authorization: APIKey <chave>
    {"query": {"match": {"numeroProcesso": "<20 dígitos>"}}}

Só traz o que é público (sem segredo de justiça). Não substitui intimação:
prazo conta da publicação/intimação oficial, não da captura.
"""
from __future__ import annotations

import hashlib
from datetime import datetime

from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime

from ingestion.connectors import ConnectorError, safe_http
from integrations.services import IntegrationConfigError, get_credential
from juridico import cnj
from juridico.models import Andamento, Processo

BASE = "https://api-publica.datajud.cnj.jus.br"


class DataJudError(Exception):
    pass


def _key(tenant_id) -> str:
    try:
        return get_credential(tenant_id, "datajud").token
    except IntegrationConfigError as exc:
        raise DataJudError(
            "DataJud não configurado: cole a chave pública do CNJ em Jurídico → Integração DataJud."
        ) from exc


def buscar(tenant_id, numero: str) -> dict | None:
    try:
        alias = cnj.tribunal_alias(numero)
    except cnj.CnjError as exc:
        raise DataJudError(str(exc)) from exc
    if not alias:
        raise DataJudError(
            "Tribunal deste número ainda não é coberto (só estadual, trabalho, federal e STJ)."
        )
    try:
        data = safe_http.post_json(
            f"{BASE}/api_publica_{alias}/_search",
            headers={
                "Authorization": f"APIKey {_key(tenant_id)}",
                "Content-Type": "application/json",
            },
            json={"query": {"match": {"numeroProcesso": cnj.digits(numero)}}, "size": 1},
        )
    except ConnectorError as exc:
        raise DataJudError(str(exc)) from exc
    hits = ((data or {}).get("hits") or {}).get("hits") or []
    return hits[0].get("_source") if hits else None


def _mov_texto(m: dict) -> str:
    extras = [
        f"{c.get('nome', '')}: {c.get('descricao') or c.get('valor') or ''}".strip(": ")
        for c in (m.get("complementosTabelados") or [])
        if isinstance(c, dict)
    ]
    return m.get("nome", "Movimentação") + (
        f" ({'; '.join(e for e in extras if e)})" if extras else ""
    )


def _quando(valor) -> datetime:
    dt = parse_datetime(str(valor or "")) if valor else None
    if dt is None:
        d = parse_date(str(valor or "")[:10]) if valor else None
        dt = datetime(d.year, d.month, d.day) if d else timezone.now()
    return timezone.make_aware(dt) if timezone.is_naive(dt) else dt


def sincronizar(processo: Processo) -> dict:
    """Atualiza dados básicos e grava movimentos novos como Andamento (sem duplicar)."""
    if not processo.numero_cnj:
        raise DataJudError("Informe o número CNJ do processo.")
    try:
        fonte = buscar(processo.tenant_id, processo.numero_cnj)
    except DataJudError as exc:
        Processo.objects.filter(pk=processo.pk).update(
            ultima_sincronizacao=timezone.now(), sincronizacao_msg=str(exc)[:500]
        )
        raise
    if fonte is None:
        msg = (
            "Processo não encontrado no DataJud "
            "(pode estar em segredo de justiça ou ainda não indexado)."
        )
        Processo.objects.filter(pk=processo.pk).update(
            ultima_sincronizacao=timezone.now(), sincronizacao_msg=msg
        )
        return {"novos": 0, "mensagem": msg}
    novos = 0
    with transaction.atomic():
        for m in fonte.get("movimentos") or []:
            if not isinstance(m, dict):
                continue
            texto = _mov_texto(m)[:2000]
            chave = hashlib.sha256(
                f"{m.get('dataHora')}|{m.get('codigo')}|{texto}".encode()
            ).hexdigest()
            _, criado = Andamento.objects.get_or_create(
                processo=processo,
                chave=chave,
                defaults={
                    "tenant_id": processo.tenant_id,
                    "data": _quando(m.get("dataHora")),
                    "descricao": texto,
                    "origem": "datajud",
                },
            )
            novos += int(criado)
        processo.tribunal = cnj.tribunal_alias(processo.numero_cnj) or processo.tribunal
        processo.classe = ((fonte.get("classe") or {}).get("nome") or processo.classe)[:200]
        processo.orgao_julgador = (
            (fonte.get("orgaoJulgador") or {}).get("nome") or processo.orgao_julgador
        )[:200]
        assuntos = [a.get("nome", "") for a in fonte.get("assuntos") or [] if isinstance(a, dict)]
        if assuntos and not processo.assunto:
            processo.assunto = ", ".join(assuntos)[:255]
        if fonte.get("dataAjuizamento") and not processo.data_distribuicao:
            processo.data_distribuicao = _quando(fonte["dataAjuizamento"]).date()
        processo.ultima_sincronizacao = timezone.now()
        processo.sincronizacao_msg = f"{novos} andamento(s) novo(s)."
        processo.save()
    return {"novos": novos, "mensagem": processo.sincronizacao_msg}

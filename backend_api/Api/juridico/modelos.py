# backend_api/Api/juridico/modelos.py
"""
Modelos de documento com campos `{{grupo.campo}}`. Só os campos da lista
abaixo são trocados — o resto fica marcado `[[campo?]]` e volta em `faltando`,
pra ninguém mandar pra assinatura um contrato com lacuna em branco.
"""
from __future__ import annotations

import re

from django.utils import timezone

CAMPO = re.compile(r"\{\{\s*([a-z_]+(?:\.[a-z_]+)?)\s*\}\}")

CAMPOS = {
    "empresa": ["razao_social", "nome_fantasia", "cnpj", "endereco", "municipio", "uf"],
    "parte": ["nome", "documento", "email", "endereco"],
    "processo": ["numero", "titulo", "foro", "orgao", "parte_contraria", "valor_causa"],
    "contrato": ["titulo", "inicio", "fim", "valor", "reajuste"],
    "data": ["hoje", "extenso"],
}

MESES = [
    "janeiro",
    "fevereiro",
    "março",
    "abril",
    "maio",
    "junho",
    "julho",
    "agosto",
    "setembro",
    "outubro",
    "novembro",
    "dezembro",
]


def _brl(v) -> str:
    try:
        n = float(v or 0)
    except (TypeError, ValueError):
        return ""
    s = f"{n:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"R$ {s}"


def contexto(tenant_id, processo=None, contrato=None, parceiro=None) -> dict[str, str]:
    from erp.models import DadosEmpresa

    ctx: dict[str, str] = {}
    e = DadosEmpresa.objects.filter(tenant_id=tenant_id).first()
    if e:
        ctx.update(
            {
                "empresa.razao_social": e.razao_social,
                "empresa.nome_fantasia": e.nome_fantasia or e.razao_social,
                "empresa.cnpj": e.cnpj,
                "empresa.endereco": ", ".join(x for x in [e.logradouro, e.numero, e.bairro] if x),
                "empresa.municipio": e.municipio,
                "empresa.uf": e.uf,
            }
        )
    parceiro = (
        parceiro
        or (contrato.parceiro if contrato else None)
        or (processo.cliente if processo else None)
    )
    if parceiro:
        ctx.update(
            {
                "parte.nome": parceiro.nome,
                "parte.documento": getattr(parceiro, "cpf_cnpj", "") or "",
                "parte.email": getattr(parceiro, "email", "") or "",
                "parte.endereco": getattr(parceiro, "endereco", "") or "",
            }
        )
    elif contrato and contrato.partes:
        ctx["parte.nome"] = contrato.partes
    elif processo and processo.parte:
        ctx["parte.nome"] = processo.parte
    if processo:
        ctx.update(
            {
                "processo.numero": processo.numero_cnj,
                "processo.titulo": processo.titulo,
                "processo.foro": processo.foro,
                "processo.orgao": processo.orgao_julgador,
                "processo.parte_contraria": processo.parte_contraria,
                "processo.valor_causa": _brl(processo.valor_causa),
            }
        )
    if contrato:
        ctx.update(
            {
                "contrato.titulo": contrato.titulo,
                "contrato.inicio": contrato.data_inicio.strftime("%d/%m/%Y")
                if contrato.data_inicio
                else "",
                "contrato.fim": contrato.data_fim.strftime("%d/%m/%Y") if contrato.data_fim else "",
                "contrato.valor": _brl(contrato.valor_anual),
                "contrato.reajuste": contrato.indice_reajuste,
            }
        )
    hoje = timezone.localdate()
    ctx["data.hoje"] = hoje.strftime("%d/%m/%Y")
    ctx["data.extenso"] = f"{hoje.day} de {MESES[hoje.month - 1]} de {hoje.year}"
    return {k: v for k, v in ctx.items() if v}


def render(corpo: str, ctx: dict[str, str]) -> tuple[str, list[str]]:
    faltando: list[str] = []

    def troca(m):
        chave = m.group(1)
        if chave in ctx:
            return ctx[chave]
        if chave not in faltando:
            faltando.append(chave)
        return f"[[{chave}?]]"

    return CAMPO.sub(troca, corpo or ""), faltando


def _padrao() -> list[dict]:
    """Modelos padrão (contrato de serviços, NDA, procuração, notificação) — texto em JSON."""
    import json
    from pathlib import Path

    return json.loads((Path(__file__).with_name("modelos_padrao.json")).read_text(encoding="utf-8"))


PADRAO = _padrao()

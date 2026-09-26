# backend_api/Api/helpdesk/equipe.py
"""
O time de TI — Head de TI (orquestrador) + 5 especialistas, todos no setor
"TI". Idempotente (get_or_create por tenant + nome); agente que já existia no
setor (ex.: "AI TI" do seed) continua lá e atende como Suporte se faltar o
analista.

Todo agente nasce OBSERVER: diagnostica e sugere, nunca executa comando.
"""
from __future__ import annotations

import pathlib

from django.db import transaction
from django.utils.text import slugify

from agency.models import Agent, Sector

SKILLS = pathlib.Path(__file__).resolve().parent.parent / "agency" / "skills"

# papel → (nome, cargo, nível de acesso, arquivo de skill)
TIME = {
    "head": ("Head de TI", "Orquestrador de TI", "sector_orchestrator", "head-ti.md"),
    "sre": (
        "SRE / Observabilidade",
        "SRE / Observabilidade",
        "operational",
        "sre-observabilidade.md",
    ),
    "dba": ("DBA", "Administrador de Banco de Dados", "operational", "dba.md"),
    "suporte": (
        "Analista de Suporte",
        "Analista de Suporte (Helpdesk)",
        "operational",
        "analista-suporte.md",
    ),
    "integracoes": (
        "Analista de Integrações",
        "Analista de Integrações (APIs & MCP)",
        "operational",
        "analista-integracoes.md",
    ),
    "seguranca": (
        "Segurança da Informação",
        "Analista de Segurança da Informação",
        "operational",
        "seguranca-informacao.md",
    ),
}
DESCRICAO = (
    "Suporte técnico interno, observabilidade do sistema (APIs, IA, conectores, MCP), "
    "incidentes, banco de dados, segurança da informação e ativos de TI."
)

# categoria do chamado → papel que atende
POR_CATEGORIA = {
    "banco": "dba",
    "sistema": "sre",
    "infraestrutura": "sre",
    "rede": "sre",
    "integracao": "integracoes",
    "ia": "integracoes",
    "acesso": "seguranca",
}
# grupo do componente monitorado → papel que diagnostica
POR_GRUPO = {
    "plataforma": "sre",
    "ia": "integracoes",
    "conector": "integracoes",
    "mcp": "integracoes",
    "social": "integracoes",
    "email": "integracoes",
    "agentes": "sre",
}


def setor(tenant_id) -> Sector | None:
    qs = Sector.objects.filter(tenant_id=tenant_id, is_active=True)
    return (
        qs.filter(slug="ti").first()
        or qs.filter(name__iexact="TI").first()
        or qs.filter(name__icontains="tecnologia").first()
    )


@transaction.atomic
def montar(tenant_id) -> dict:
    s = setor(tenant_id)
    setor_criado = s is None
    if s is None:
        s = Sector.objects.create(
            tenant_id=tenant_id, name="TI", slug=slugify("TI"), description=DESCRICAO
        )
    criados, existentes = [], []
    for nome, cargo, nivel, arquivo in TIME.values():
        agent, novo = Agent.objects.get_or_create(
            tenant_id=tenant_id,
            name=nome,
            defaults={"role": cargo, "sector": s, "access_level": nivel},
        )
        if novo:
            skill = SKILLS / arquivo
            if skill.exists():
                agent.instructions = skill.read_text(encoding="utf-8")
                agent.save(update_fields=["instructions"])
            criados.append(nome)
        else:
            existentes.append(nome)
    return {
        "setor": s.id,
        "setor_criado": setor_criado,
        "criados": criados,
        "existentes": existentes,
    }


def agentes(tenant_id):
    s = setor(tenant_id)
    if s is None:
        return Agent.objects.none()
    return Agent.objects.select_related("sector").filter(
        tenant_id=tenant_id, sector=s, is_active=True
    )


def agente(tenant_id, papel: str) -> Agent | None:
    """O agente do papel; senão o Suporte; senão um operacional do setor; senão o orquestrador."""
    qs = agentes(tenant_id)
    for nome in (TIME.get(papel, ("",))[0], TIME["suporte"][0]):
        a = qs.filter(name=nome).first()
        if a:
            return a
    return (
        qs.filter(access_level=Agent.AccessLevel.OPERATIONAL).order_by("id").first()
        or qs.order_by("id").first()
    )


def papel_de(agent: Agent | None) -> str:
    if agent is None:
        return ""
    return next((p for p, v in TIME.items() if v[0] == agent.name), "")

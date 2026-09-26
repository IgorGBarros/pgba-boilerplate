# backend_api/Api/marketing/equipe.py
"""
O time de marketing — um orquestrador + 6 especialistas, todos no setor
"Marketing". Idempotente (get_or_create por tenant + nome); agente que a
pessoa já criou no setor (ex.: "AI Marketing") continua lá.

Todo agente nasce OBSERVER: escreve rascunho, nunca publica sozinho.
"""
from __future__ import annotations

import pathlib

from django.db import transaction
from django.utils.text import slugify

from agency.models import Agent, Sector

SKILLS = pathlib.Path(__file__).resolve().parent.parent / "agency" / "skills"

# papel → (nome, cargo, nível de acesso, arquivo de skill)
TIME = {
    "head": (
        "Head de Marketing",
        "Orquestrador de Marketing",
        "sector_orchestrator",
        "head-marketing.md",
    ),
    "estrategia": (
        "Estrategista de Conteúdo",
        "Estrategista de Conteúdo",
        "operational",
        "estrategista-conteudo.md",
    ),
    "texto": ("Copywriter", "Copywriter", "operational", "copywriter.md"),
    "design": (
        "Designer de Criativos",
        "Designer de Criativos",
        "operational",
        "designer-criativos.md",
    ),
    "video": ("Editor de Vídeo", "Editor de Vídeo", "operational", "editor-video.md"),
    "social": ("Social Media", "Social Media", "operational", "social-media.md"),
    "dados": (
        "Analista de Performance",
        "Analista de Performance",
        "operational",
        "analista-performance.md",
    ),
}
DESCRICAO = (
    "Conteúdo e redes sociais para qualquer ramo: calendário editorial, textos por rede, "
    "criativos, cortes de vídeo e publicação com aprovação humana."
)


def setor(tenant_id) -> Sector | None:
    qs = Sector.objects.filter(tenant_id=tenant_id, is_active=True)
    return qs.filter(slug="marketing").first() or qs.filter(name__icontains="marketing").first()


@transaction.atomic
def montar(tenant_id) -> dict:
    s = setor(tenant_id)
    setor_criado = s is None
    if s is None:
        s = Sector.objects.create(
            tenant_id=tenant_id, name="Marketing", slug=slugify("Marketing"), description=DESCRICAO
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


def agente(tenant_id, papel: str) -> Agent | None:
    """O agente do papel; senão um operacional do setor; senão o orquestrador."""
    s = setor(tenant_id)
    if s is None:
        return None
    qs = Agent.objects.select_related("sector").filter(
        tenant_id=tenant_id, sector=s, is_active=True
    )
    nome = TIME.get(papel, ("",))[0]
    return (
        qs.filter(name=nome).first()
        or qs.filter(access_level=Agent.AccessLevel.OPERATIONAL).order_by("id").first()
        or qs.order_by("id").first()
    )

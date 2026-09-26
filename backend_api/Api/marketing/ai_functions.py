# backend_api/Api/marketing/ai_functions.py
"""
Funções da IA ligadas ao Marketing (orchestration.registry, CLAUDE.md §6).

- `marketing_resumo` e `marketing_agenda`: só leem.
- `marketing_rascunho_post`: o agente ESCREVE um rascunho na fila do
  Marketing. Não publica — publicar é de uma pessoa, aprovando (§12). Por
  isso o risco é "low", igual ao rascunho de e-mail.
"""
from datetime import timedelta

from django.db.models import Count
from django.utils import timezone

from orchestration.registry import register_query_function


@register_query_function(
    name="marketing_resumo",
    description=(
        "Resumo do Marketing: publicações por status, agendadas nos próximos 7 dias, "
        "publicadas no mês, contas de redes sociais conectadas e com problema."
    ),
    parameters={},
)
def marketing_resumo(tenant_id) -> dict:
    from marketing.models import ContaSocial, Publicacao

    agora = timezone.now()
    pubs = Publicacao.objects.filter(tenant_id=tenant_id, is_active=True)
    contas = ContaSocial.objects.filter(tenant_id=tenant_id, is_active=True)
    return {
        "por_status": dict(pubs.values_list("status").annotate(n=Count("id"))),
        "agendadas_7_dias": pubs.filter(
            status="agendada", agendada_para__gte=agora, agendada_para__lt=agora + timedelta(days=7)
        ).count(),
        "publicadas_no_mes": pubs.filter(
            publicada_em__gte=agora.replace(day=1, hour=0, minute=0, second=0)
        ).count(),
        "contas": [
            {"rede": c.get_rede_display(), "nome": c.nome, "status": c.get_status_display()}
            for c in contas
        ],
    }


@register_query_function(
    name="marketing_agenda",
    description=(
        "Próximas publicações do calendário (data, título, status, redes) nos próximos N dias."
    ),
    parameters={"dias": "inteiro (padrão 14)"},
)
def marketing_agenda(tenant_id, dias=14) -> dict:
    from marketing.models import Publicacao

    try:
        dias = max(1, min(int(dias), 90))
    except (TypeError, ValueError):
        dias = 14
    agora = timezone.now()
    qs = (
        Publicacao.objects.filter(
            tenant_id=tenant_id,
            is_active=True,
            agendada_para__gte=agora,
            agendada_para__lt=agora + timedelta(days=dias),
        )
        .exclude(status="cancelada")
        .prefetch_related("destinos__conta")
        .order_by("agendada_para")[:60]
    )
    return {
        "itens": [
            {
                "quando": timezone.localtime(p.agendada_para).strftime("%d/%m %H:%M"),
                "titulo": p.titulo,
                "status": p.get_status_display(),
                "redes": sorted({d.conta.get_rede_display() for d in p.destinos.all()}),
            }
            for p in qs
        ]
    }


@register_query_function(
    name="marketing_rascunho_post",
    description=(
        "Cria um RASCUNHO de publicação na fila do Marketing (título + texto, opcionalmente "
        "com data AAAA-MM-DD HH:MM). Não publica: uma pessoa revisa e aprova na tela do Marketing."
    ),
    parameters={"titulo": "string", "texto": "texto do post", "quando": "data/hora opcional"},
)
def marketing_rascunho_post(tenant_id, titulo: str, texto: str, quando: str = "") -> dict:
    from datetime import datetime

    from marketing.models import Publicacao

    titulo, texto = (titulo or "").strip()[:255], (texto or "").strip()
    if not titulo or not texto:
        return {"erro": "Informe título e texto."}
    agendada = None
    if quando:
        try:
            agendada = timezone.make_aware(datetime.fromisoformat(quando.strip().replace(" ", "T")))
        except ValueError:
            return {"erro": "Data inválida — use AAAA-MM-DD HH:MM."}
    pub = Publicacao.objects.create(
        tenant_id=tenant_id,
        titulo=titulo,
        texto=texto[:10000],
        agendada_para=agendada,
        escrita_por_ia=True,
    )
    return {
        "rascunho": pub.id,
        "status": "rascunho — falta escolher as contas e uma pessoa aprovar na tela do Marketing",
    }

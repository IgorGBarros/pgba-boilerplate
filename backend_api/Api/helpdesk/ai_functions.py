# backend_api/Api/helpdesk/ai_functions.py
"""
Funções da IA ligadas ao TI (orchestration.registry, CLAUDE.md §6).

- `ti_status_sistema` e `ti_chamados_abertos`: só leem.
- `ti_abrir_chamado`: o agente de QUALQUER setor abre um chamado pro TI
  ("o sistema está lento", "a integração X parou"). Abrir chamado não muda
  nada no sistema — só entra na fila do TI, que responde com aprovação de
  uma pessoa. Por isso o risco é "low".
"""
from django.utils import timezone

from orchestration.registry import register_query_function


@register_query_function(
    name="ti_status_sistema",
    description=(
        "Estado do sistema agora (monitoramento do TI): componentes com falha ou alerta "
        "(banco, fila, workers, IA dos setores, conectores, MCP, e-mail, redes sociais, "
        "agentes) e incidentes abertos, com causa e o que fazer."
    ),
    parameters={},
)
def ti_status_sistema(tenant_id) -> dict:
    from observabilidade.models import PLATAFORMA, EstadoComponente, Incidente

    escopos = [tenant_id, PLATAFORMA]
    estados = EstadoComponente.objects.filter(tenant_id__in=escopos)
    problemas = estados.filter(status__in=("falha", "alerta")).order_by("status", "nome")
    return {
        "componentes_monitorados": estados.count(),
        "tudo_ok": not problemas.exists(),
        "problemas": [
            {"nome": e.nome, "status": e.status, "desde": e.desde, "causa": e.causa, "acao": e.acao}
            for e in problemas[:20]
        ],
        "incidentes_abertos": [
            {"titulo": i.titulo, "gravidade": i.gravidade, "desde": i.aberto_em}
            for i in Incidente.objects.filter(tenant_id__in=escopos, status="aberto")[:10]
        ],
    }


@register_query_function(
    name="ti_chamados_abertos",
    description=(
        "Chamados do TI em aberto: quantos por prioridade, os que estouraram o SLA "
        "e os mais urgentes."
    ),
    parameters={},
)
def ti_chamados_abertos(tenant_id) -> dict:
    from helpdesk.models import Ticket

    abertos = Ticket.objects.filter(tenant_id=tenant_id, is_active=True).exclude(
        status__in=("resolvido", "fechado")
    )
    agora = timezone.now()
    ordem = {"critica": 0, "alta": 1, "media": 2, "baixa": 3}
    lista = sorted(abertos[:200], key=lambda t: (ordem.get(t.prioridade, 9), t.created_at))
    return {
        "total": abertos.count(),
        "por_prioridade": {p: sum(1 for t in lista if t.prioridade == p) for p in ordem},
        "sla_estourado": sum(1 for t in lista if t.prazo_sla and t.prazo_sla < agora),
        "mais_urgentes": [
            {
                "id": t.id,
                "titulo": t.titulo,
                "prioridade": t.prioridade,
                "status": t.status,
                "atendente": t.atendente,
            }
            for t in lista[:8]
        ],
    }


@register_query_function(
    name="ti_abrir_chamado",
    description=(
        "Abre um chamado para o time de TI (problema no sistema, integração parada, acesso, "
        "equipamento). Não resolve nada sozinho: entra na fila do TI."
    ),
    parameters={
        "titulo": "resumo do problema",
        "descricao": "o que aconteceu, desde quando, quem é afetado",
        "categoria": "sistema|banco|integracao|ia|acesso|software|hardware|rede|outro",
        "prioridade": "critica|alta|media|baixa",
    },
)
def ti_abrir_chamado(
    tenant_id, titulo: str, descricao: str = "", categoria: str = "outro", prioridade: str = "media"
) -> dict:
    from core.utils.lgpd import redact_pii
    from helpdesk.models import Ticket
    from helpdesk.services import abrir_chamado

    categorias = {c for c, _ in Ticket.CATEGORIA_CHOICES}
    prioridades = {p for p, _ in Ticket.PRIORIDADE_CHOICES}
    t = abrir_chamado(
        tenant_id,
        redact_pii(str(titulo or "Chamado aberto por agente"))[:255],
        redact_pii(str(descricao or ""))[:4000],
        solicitante="Agente de IA",
        categoria=categoria if categoria in categorias else "outro",
        prioridade=prioridade if prioridade in prioridades else "media",
        origem="agente",
    )
    return {"chamado": t.id, "atribuido_a": t.atendente, "sla_horas": t.sla_horas}

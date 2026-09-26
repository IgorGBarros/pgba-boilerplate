# backend_api/Api/helpdesk/services.py
"""
Chamados atendidos pelo time de TI através de Tasks reais (`agency.Task`,
`task_type="chamado"`): o chamado nasce com um agente do TI e uma Task; a
IA sugere a resposta; uma pessoa responde; resolver = aprovar a Task.

A Task e o chamado andam juntos (`helpdesk.receptores`): aprovar a Task no
quadro de tarefas resolve o chamado; rejeitar devolve o chamado pra fila.
"""
from __future__ import annotations

from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from agency.models import Task
from helpdesk import equipe
from helpdesk.models import InteracaoChamado, Ticket

SLA_HORAS = {"critica": 4, "alta": 8, "media": 24, "baixa": 72}
DECIDIDAS = (Task.Status.APPROVED, Task.Status.REJECTED)


class ChamadoError(Exception):
    pass


class ChamadoNaoEncontrado(ChamadoError):
    pass


def interacao(
    ticket: Ticket, tipo: str, texto: str, autor: str = "", dados=None
) -> InteracaoChamado:
    return InteracaoChamado.objects.create(
        tenant_id=ticket.tenant_id,
        ticket=ticket,
        tipo=tipo,
        autor=autor[:200],
        texto=texto,
        dados=dados or {},
    )


def _brief(ticket: Ticket) -> str:
    return (
        f"Chamado #{ticket.id} ({ticket.get_prioridade_display()}, "
        f"{ticket.get_categoria_display()}): "
        f"{ticket.titulo}\n\nSolicitante: {ticket.solicitante}\n\n{ticket.descricao}"
    )[:4000]


def _garantir_task(ticket: Ticket) -> Task | None:
    """Task viva do chamado — chamado reaberto ganha uma Task nova (a antiga já foi decidida)."""
    from agency.tasks import create_task

    if ticket.agente_id is None:
        return None
    if ticket.task_id and ticket.task.status not in DECIDIDAS:
        return ticket.task
    ticket.task = create_task(
        ticket.tenant_id, ticket.agente_id, _brief(ticket), task_type="chamado"
    )
    ticket.save(update_fields=["task"])
    return ticket.task


def _andamento(task: Task | None, progresso: float, resultado: dict | None = None) -> None:
    from agency.realtime import broadcast_task_update

    if task is None or task.status in DECIDIDAS:
        return
    campos = ["progress", "updated_at"]
    if task.status == Task.Status.CREATED:
        task.status = Task.Status.IN_PROGRESS
        campos.append("status")
    task.progress = max(task.progress, progresso)
    if resultado is not None:
        task.result = resultado
        campos.append("result")
    task.updated_at = timezone.now()
    task.save(update_fields=campos)
    broadcast_task_update(task)


@transaction.atomic
def abrir_chamado(
    tenant_id,
    titulo: str,
    descricao: str = "",
    solicitante: str = "",
    categoria: str = "outro",
    prioridade: str = "media",
    setor_id=None,
    origem: str = "manual",
    incidente_id=None,
    autor: str = "",
) -> Ticket:
    papel = equipe.POR_CATEGORIA.get(categoria, "suporte")
    agent = equipe.agente(tenant_id, papel)
    horas = SLA_HORAS.get(prioridade, 24)
    agora = timezone.now()
    ticket = Ticket.objects.create(
        tenant_id=tenant_id,
        titulo=titulo[:255],
        descricao=descricao,
        solicitante=(solicitante or autor or "—")[:200],
        categoria=categoria,
        prioridade=prioridade,
        sla_horas=horas,
        prazo_sla=agora + timedelta(hours=horas),
        created_at=agora,
        setor_id=setor_id,
        origem=origem,
        incidente_id=incidente_id,
        agente=agent,
        atendente=agent.name if agent else "",
    )
    _garantir_task(ticket)
    interacao(
        ticket,
        "sistema",
        f"Chamado aberto ({ticket.get_origem_display().lower()}). "
        + (
            f"Atribuído a {agent.name}. "
            if agent
            else "Sem time de TI montado — atribua manualmente. "
        )
        + f"SLA: {horas}h.",
        autor=autor,
    )
    return ticket


def _pegar(tenant_id, ticket_id) -> Ticket:
    try:
        return Ticket.objects.select_related("task", "agente").get(
            pk=ticket_id, tenant_id=tenant_id, is_active=True
        )
    except Ticket.DoesNotExist as exc:
        raise ChamadoNaoEncontrado("Chamado não encontrado.") from exc


def atribuir(tenant_id, ticket_id, papel: str = "", agente_id=None, autor: str = "") -> Ticket:
    from agency.models import Agent

    t = _pegar(tenant_id, ticket_id)
    if agente_id:
        agent = Agent.objects.filter(pk=agente_id, tenant_id=tenant_id, is_active=True).first()
    else:
        agent = equipe.agente(tenant_id, papel)
    if agent is None:
        raise ChamadoError("Agente não encontrado.")
    if t.task_id and t.task.status not in DECIDIDAS and t.task.agent_id != agent.id:
        from agency.tasks import reject_task

        reject_task(tenant_id, t.task_id, "Chamado reatribuído")
        t.task = None
    t.agente, t.atendente = agent, agent.name
    t.save(update_fields=["agente", "atendente", "task"])
    _garantir_task(t)
    interacao(t, "sistema", f"Chamado atribuído a {agent.name}.", autor=autor)
    return t


def atender_com_ia(tenant_id, ticket_id, instrucoes: str = "", autor: str = "") -> InteracaoChamado:
    from helpdesk import ia

    t = _pegar(tenant_id, ticket_id)
    if t.status in ("resolvido", "fechado"):
        raise ChamadoError("Chamado já resolvido — reabra antes.")
    task = _garantir_task(t)
    try:
        data = ia.atender_chamado(t, instrucoes)
    except ia.TIError as exc:
        raise ChamadoError(str(exc)) from exc
    if t.status == "aberto":
        t.status = "em_atendimento"
        t.save(update_fields=["status"])
    _andamento(task, 0.5, {"sugestao": data})
    return interacao(t, "ia", data.get("resposta", ""), autor=data["agente"]["nome"], dados=data)


def responder(
    tenant_id, ticket_id, texto: str, autor: str = "", aguardar: bool = False
) -> InteracaoChamado:
    """Resposta que vai pro solicitante (escrita ou revisada por uma pessoa)."""
    t = _pegar(tenant_id, ticket_id)
    if not texto.strip():
        raise ChamadoError("Escreva a resposta.")
    campos = ["status"]
    if t.primeira_resposta_em is None:
        t.primeira_resposta_em = timezone.now()
        campos.append("primeira_resposta_em")
    t.status = (
        "aguardando"
        if aguardar
        else ("em_atendimento" if t.status in ("aberto", "aguardando") else t.status)
    )
    t.save(update_fields=campos)
    _andamento(_garantir_task(t), 0.8)
    return interacao(t, "resposta", texto.strip(), autor=autor)


def comentar(tenant_id, ticket_id, texto: str, autor: str = "") -> InteracaoChamado:
    t = _pegar(tenant_id, ticket_id)
    if not texto.strip():
        raise ChamadoError("Escreva o comentário.")
    return interacao(t, "comentario", texto.strip(), autor=autor)


def resolver(tenant_id, ticket_id, solucao: str, autor: str = "") -> Ticket:
    """Decisão humana: grava a solução e aprova a Task do chamado."""
    from agency.tasks import approve_task

    t = _pegar(tenant_id, ticket_id)
    if t.status in ("resolvido", "fechado"):
        raise ChamadoError("Chamado já resolvido.")
    if not solucao.strip():
        raise ChamadoError(
            "Descreva a solução — é o que fica de registro pro próximo chamado igual."
        )
    t.status, t.resolvido_em, t.solucao = "resolvido", timezone.now(), solucao.strip()
    t.save(update_fields=["status", "resolvido_em", "solucao"])
    interacao(t, "sistema", f"Resolvido por {autor or 'atendente'}: {t.solucao}", autor=autor)
    if t.task_id and t.task.status not in DECIDIDAS:
        _andamento(t.task, 1.0)
        approve_task(tenant_id, t.task_id, trigger_git=False)
    return t


def reabrir(tenant_id, ticket_id, motivo: str = "", autor: str = "") -> Ticket:
    t = _pegar(tenant_id, ticket_id)
    if t.status not in ("resolvido", "fechado"):
        raise ChamadoError("Só dá pra reabrir chamado resolvido ou fechado.")
    t.status, t.resolvido_em = "aberto", None
    t.save(update_fields=["status", "resolvido_em"])
    _garantir_task(t)
    interacao(t, "sistema", "Chamado reaberto" + (f": {motivo}" if motivo else "."), autor=autor)
    return t


def fechar(tenant_id, ticket_id, autor: str = "") -> Ticket:
    t = _pegar(tenant_id, ticket_id)
    if t.status != "resolvido":
        raise ChamadoError("Resolva o chamado antes de fechar.")
    t.status = "fechado"
    t.save(update_fields=["status"])
    interacao(t, "sistema", "Chamado fechado.", autor=autor)
    return t


# ─── Incidentes do monitoramento ─────────────────────────────────────────────

PRIORIDADE_DA_GRAVIDADE = {"critica": "critica", "alta": "alta", "media": "media", "baixa": "baixa"}
CATEGORIA_DO_GRUPO = {
    "plataforma": "sistema",
    "ia": "ia",
    "conector": "integracao",
    "mcp": "integracao",
    "social": "integracao",
    "email": "integracao",
    "agentes": "ia",
}


def chamado_de_incidente(tenant_id, incidente) -> Ticket | None:
    if Ticket.objects.filter(tenant_id=tenant_id, incidente_id=incidente.id).exists():
        return None
    categoria = (
        "banco"
        if incidente.chave == "plataforma.banco"
        else CATEGORIA_DO_GRUPO.get(incidente.grupo, "sistema")
    )
    from observabilidade.models import PLATAFORMA

    # Detalhe técnico da plataforma (host, IP) não vai pro chamado de cada empresa
    detalhe = "" if incidente.tenant_id == PLATAFORMA else incidente.detalhe
    descricao = "\n".join(
        x
        for x in (
            detalhe,
            f"Causa identificada: {incidente.causa}" if incidente.causa else "",
            f"O que fazer: {incidente.acao}" if incidente.acao else "",
        )
        if x
    )
    return abrir_chamado(
        tenant_id,
        incidente.titulo,
        descricao,
        solicitante="Monitoramento",
        categoria=categoria,
        prioridade=PRIORIDADE_DA_GRAVIDADE.get(incidente.gravidade, "alta"),
        origem="incidente",
        incidente_id=incidente.id,
    )


def diagnosticar(tenant_id, incidente) -> dict:
    """Diagnóstico da IA guardado no incidente e anotado nos chamados dele."""
    from helpdesk import ia

    chamado = (
        Ticket.objects.select_related("task")
        .filter(tenant_id=tenant_id, incidente_id=incidente.id)
        .first()
    )
    data = ia.diagnosticar_incidente(tenant_id, incidente, task=chamado.task if chamado else None)
    incidente.diagnostico = data
    incidente.save(update_fields=["diagnostico"])
    for t in Ticket.objects.filter(incidente_id=incidente.id, is_active=True):
        interacao(
            t,
            "ia",
            data.get("causa_provavel", ""),
            autor=data["agente"]["nome"],
            dados={"diagnostico": data},
        )
        _andamento(t.task, 0.5, {"diagnostico": data})
    return data

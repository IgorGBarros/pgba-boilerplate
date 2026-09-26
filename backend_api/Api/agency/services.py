# backend_api/Api/agency/services.py
"""
Serviços do agency: nunca chama um provedor de IA diretamente — sempre
via `orchestration.answer_question` (que já passa pelo `harness` e pelos
guardrails). Este módulo adiciona três coisas por cima disso:

1. Registro de custo/tokens por interação (`ask_as_agent`).
2. Controle de acesso hierárquico: um agente OPERATIONAL só enxerga o
   "cérebro" (KnowledgeSource) do próprio setor; CEO e orquestrador-geral
   enxergam tudo (ver `_rag_scope_for`).
3. Comunicação entre setores mediada (`request_cross_sector_message` +
   `relay_message`) — um setor nunca fala com outro sem passar por um
   agente com `can_relay=True`.
"""
from __future__ import annotations

import os

from decimal import Decimal

from django.db.models import Sum, Count, Avg, Max, Q
from django.utils import timezone

from agency.models import Sector, Agent, AgentInteraction, SectorMessage, Project, PendingApproval
from harness.injection_guard import sanitize_user_input
from harness.providers import track_usage
from agency.realtime import (
    broadcast_pending_approval_update,
    broadcast_sector_message_update,
)
from integrations.services import create_project_repository, get_project_repository, IntegrationConfigError
from orchestration import registry

class AccessDeniedError(Exception):
    """Uma regra de hierarquia foi violada (ex: setor tentando falar com outro sem mediação)."""


def _estimate_tokens(text: str) -> int:
    """Heurística grosseira (chars/4) — troque por um tokenizer real se precisar de precisão."""
    return max(1, len(text) // 4)


def _rag_scope_for(agent: Agent) -> list[int] | None:
    """
    Decide de quais KnowledgeSource(s) este agente pode puxar contexto.
    `None` = sem restrição (busca em tudo do tenant) — reservado para
    quem tem acesso total. Agente comum só vê o cérebro do próprio setor;
    se o setor não tiver `knowledge_source` configurado, o resultado é
    lista vazia (zero contexto) — nunca cai para "sem restrição" por
    omissão, isso vazaria dado de outro setor.
    """
    if agent.has_full_access:
        return None
    if not agent.sector:
        return []
    return sector_source_ids(agent.sector)


def sector_source_ids(sector) -> list[int]:
    """Fontes que o setor pode consultar: o cérebro principal + as adicionais."""
    ids = [sector.knowledge_source_id] if sector.knowledge_source_id else []
    ids += [i for i in sector.extra_knowledge_sources.values_list("id", flat=True) if i not in ids]
    return ids


def resolve_agent_llm(agent: Agent) -> tuple[str, str | None]:
    """
    Qual provedor/modelo de IA este agente usa, nesta ordem:

      1. `Agent.default_provider` (exceção individual, ex: um agente de teste);
      2. `Sector.default_provider` (ex: Desenvolvimento → "anthropic");
      3. provedor ativo do tenant (`harness.get_active_provider`, ex: Groq).

    Quando o provedor vem do agente ou do setor ele é FIXO: se a credencial
    dele não estiver configurada, `harness.chat_completion` levanta
    `ProviderConfigError` — nunca cai em silêncio no provedor do tenant.
    "Setor de Desenvolvimento só com Claude" tem que significar isso, não
    "com Claude quando der, Groq quando não der".

    Modelo: o do mesmo nível que fixou o provedor; `None` = `default_model`
    da credencial do provedor (resolvido em `harness.chat_completion`).
    """
    from harness.providers import get_active_provider

    if agent.default_provider:
        return agent.default_provider, agent.default_model or None
    sector = agent.sector
    if sector is not None and sector.default_provider:
        return sector.default_provider, sector.default_model or None
    return get_active_provider(agent.tenant_id), None


def record_interaction(
    agent: Agent, question: str, answer: str, provider: str, model: str | None = None,
    source_document_ids: list[int] | None = None, task=None,
    usage: list | None = None, tokens_in: int | None = None, tokens_out: int | None = None,
    cost_usd=None,
) -> AgentInteraction:
    """
    Registra uma chamada de IA feita em nome de um agente e QUAL provedor
    respondeu. Único lugar que registra custo de agente — `ask_as_agent`
    (pergunta avulsa), `execute_task` (Task) e `report_task_result` (Claude
    Code local) passam por aqui, então orçamento de setor e custo por
    provedor enxergam os três.

    Ordem de precisão: `usage` (lista de `harness.ChatUsage` — tokens que o
    provedor informou, preço do modelo em `harness.pricing`) → `tokens_in/
    tokens_out` informados por quem rodou fora → estimativa por texto.
    `cost_usd` explícito (ex: `total_cost_usd` do Claude Code) vence o cálculo.
    """
    from harness.pricing import estimate_cost

    estimated = False
    if usage:
        tin = sum(u.tokens_in for u in usage)
        tout = sum(u.tokens_out for u in usage)
        model = model or usage[-1].model
        cost = sum(
            (estimate_cost(u.provider, u.model, u.tokens_in, u.tokens_out) for u in usage),
            start=Decimal(0),
        )
    elif tokens_in is not None or tokens_out is not None:
        tin, tout = tokens_in or 0, tokens_out or 0
        cost = estimate_cost(provider, model or "", tin, tout)
    else:
        tin, tout = _estimate_tokens(question), _estimate_tokens(answer)
        cost = estimate_cost(provider, model or "", tin, tout)
        estimated = True
    if cost_usd is not None:
        cost = Decimal(str(cost_usd))

    return AgentInteraction.objects.create(
        tenant_id=agent.tenant_id,
        agent=agent,
        question=question,
        answer=answer,
        tokens_used=tin + tout,
        tokens_estimated=estimated,
        estimated_cost_usd=cost,
        source_document_ids=sorted(set(source_document_ids or [])),
        provider=provider or "",
        model=model or "",
        task=task,
    )


def sector_ai_status(tenant_id) -> dict:
    """
    Qual IA cada setor usa e se ela está PRONTA (credencial + modelo), sem
    chamar provedor nenhum — `harness.providers.provider_readiness`.

    Existe porque um provedor fixado no setor não tem fallback (ver
    `resolve_agent_llm`): sem a chave da Anthropic, o Desenvolvimento só
    descobria o problema ao rodar uma tarefa. Agentes com provedor próprio
    (exceção individual) aparecem em `agents`.
    """
    from harness.providers import get_active_provider, provider_readiness

    cache: dict[tuple[str, str], str | None] = {}

    def ready(provider: str, model: str | None) -> str | None:
        key = (provider, model or "")
        if key not in cache:
            cache[key] = provider_readiness(tenant_id, provider, model)
        return cache[key]

    tenant_provider = get_active_provider(tenant_id)
    tenant_problem = ready(tenant_provider, None)

    sectors = []
    for sector in Sector.objects.filter(tenant_id=tenant_id, is_active=True).order_by("name"):
        if sector.default_provider:
            provider, model, source = sector.default_provider, sector.default_model, "sector"
            problem = ready(provider, model or None)
        else:
            provider, model, source, problem = tenant_provider, "", "tenant", tenant_problem
        sectors.append({
            "sector_id": sector.id,
            "sector_name": sector.name,
            "provider": provider,
            "model": model,
            "source": source,
            "ready": problem is None,
            "detail": problem or "",
        })

    agents = []
    overrides = Agent.objects.filter(tenant_id=tenant_id, is_active=True).exclude(default_provider="")
    for agent in overrides:
        problem = ready(agent.default_provider, agent.default_model or None)
        agents.append({
            "agent_id": agent.id,
            "agent_name": agent.name,
            "provider": agent.default_provider,
            "model": agent.default_model,
            "ready": problem is None,
            "detail": problem or "",
        })

    return {
        "tenant": {
            "provider": tenant_provider,
            "ready": tenant_problem is None,
            "detail": tenant_problem or "",
        },
        "sectors": sectors,
        "agents": agents,
    }


def knowledge_usage(tenant_id, document_id: int) -> list[dict]:
    """
    Quais agentes usaram um `ingestion.Document` como contexto de resposta
    (AgentInteraction.source_document_ids), com contagem e última vez.
    Só registra a partir de quando o campo existe — consultas antigas não
    aparecem (não dá pra reconstruir quais notas foram usadas antes).
    """
    rows = (
        AgentInteraction.objects
        .filter(tenant_id=tenant_id, source_document_ids__contains=[document_id])
        .values("agent_id", "agent__name", "agent__sector__name")
        .annotate(count=Count("id"), last_at=Max("created_at"))
        .order_by("-last_at")
    )
    return [
        {
            "agent_id": r["agent_id"],
            "agent_name": r["agent__name"],
            "sector_name": r["agent__sector__name"],
            "count": r["count"],
            "last_at": r["last_at"],
        }
        for r in rows
    ]


def knowledge_usage_summary(tenant_id, since=None) -> dict[int, dict]:
    """
    Quantas vezes cada `ingestion.Document` foi usado como contexto de
    resposta (todas as notas de uma vez) — o "mapa de calor" do Cérebro.
    `{document_id: {"count": n, "last_at": datetime}}`; nota ausente = nunca
    usada desde que `source_document_ids` existe.

    Agrega no banco (jsonb_array_elements) em vez de trazer todas as
    interações pro Python. SQL fixo e parametrizado — nada vem do usuário
    além do tenant (sempre do código) e da data.
    """
    from django.db import connection

    table = AgentInteraction._meta.db_table
    sql = (
        f"SELECT (doc.value)::bigint AS document_id, COUNT(*), MAX(i.created_at) "
        f"FROM {table} i "
        f"CROSS JOIN LATERAL jsonb_array_elements_text(i.source_document_ids) AS doc "
        f"WHERE i.tenant_id = %s AND jsonb_typeof(i.source_document_ids) = 'array'"
    )
    params: list = [str(tenant_id)]
    if since is not None:
        sql += " AND i.created_at >= %s"
        params.append(since)
    sql += " GROUP BY 1"
    with connection.cursor() as cursor:
        cursor.execute(sql, params)
        return {int(doc_id): {"count": n, "last_at": last} for doc_id, n, last in cursor.fetchall()}


TIMELINE_MAX_EVENTS = 3000


def company_timeline(tenant_id, since, until) -> dict:
    """
    Tudo o que aconteceu na empresa entre `since` e `until`, em ordem, pra
    reproduzir o dia no Escritório 3D: interações de IA (quem trabalhou),
    mudanças de status de Task (histórico de auditoria — `Task.history`),
    mensagens entre setores (criada/respondida/rejeitada) e aprovações
    (criada/decidida). Só LÊ o que já é registrado — nada é inventado pra
    preencher o replay.
    """
    from agency.models import Task

    events: list[dict] = []

    for i in (
        AgentInteraction.objects
        .filter(tenant_id=tenant_id, created_at__gte=since, created_at__lte=until)
        .select_related("agent")
        .order_by("created_at")[:TIMELINE_MAX_EVENTS]
    ):
        events.append({
            "kind": "interaction", "at": i.created_at,
            "agent_id": i.agent_id, "agent_name": i.agent.name, "text": i.question[:160],
            "provider": i.provider, "cost_usd": float(i.estimated_cost_usd),
            "task_id": i.task_id,
        })

    # Histórico de Task: um evento por MUDANÇA de status, e um quando ela
    # termina (progress chega a 1.0 — tarefa concluída continua IN_PROGRESS
    # esperando decisão humana, então sem isso o agente pareceria trabalhando
    # até alguém aprovar). O histórico grava toda alteração; o resto é ignorado.
    history = (
        Task.history.filter(tenant_id=tenant_id, history_date__lte=until)
        .filter(id__in=Task.history.filter(
            tenant_id=tenant_id, history_date__gte=since, history_date__lte=until,
        ).values("id"))
        .order_by("id", "history_date")
        .values("id", "status", "progress", "agent_id", "brief", "history_date")
    )
    last_state: dict[int, tuple[str, bool]] = {}
    for h in history.iterator():
        finished = (h["progress"] or 0) >= 1.0
        previous = last_state.get(h["id"])
        last_state[h["id"]] = (h["status"], finished)
        if h["history_date"] < since:
            continue
        base = {
            "at": h["history_date"], "task_id": h["id"], "agent_id": h["agent_id"],
            "text": (h["brief"] or "")[:160],
        }
        if previous is None or h["status"] != previous[0]:
            events.append({
                **base, "kind": "task_status", "status": h["status"],
                "previous_status": previous[0] if previous else None, "finished": finished,
            })
        elif finished and not previous[1]:
            events.append({**base, "kind": "task_finished"})

    messages = SectorMessage.objects.filter(tenant_id=tenant_id).filter(
        Q(created_at__range=(since, until))
        | Q(answered_at__range=(since, until))
        | Q(rejected_at__range=(since, until))
    ).select_related("from_agent", "to_sector", "relayed_by")
    for m in messages:
        base = {
            "message_id": m.id, "agent_id": m.from_agent_id, "agent_name": m.from_agent.name,
            "from_sector_id": m.from_agent.sector_id, "to_sector_id": m.to_sector_id,
            "to_sector_name": m.to_sector.name, "text": m.content[:160],
            "created_at": m.created_at,
        }
        if since <= m.created_at <= until:
            events.append({**base, "kind": "message_created", "at": m.created_at})
        if m.answered_at and since <= m.answered_at <= until:
            events.append({
                **base, "kind": "message_answered", "at": m.answered_at,
                "relayed_by_id": m.relayed_by_id,
                "relayed_by_name": m.relayed_by.name if m.relayed_by else None,
            })
        if m.rejected_at and since <= m.rejected_at <= until:
            events.append({**base, "kind": "message_rejected", "at": m.rejected_at})

    approvals = PendingApproval.objects.filter(tenant_id=tenant_id).filter(
        Q(created_at__range=(since, until)) | Q(decided_at__range=(since, until))
    ).select_related("agent")
    for p in approvals:
        base = {
            "approval_id": p.id, "agent_id": p.agent_id, "agent_name": p.agent.name,
            "text": p.function_name, "risk": p.risk,
        }
        if since <= p.created_at <= until:
            events.append({**base, "kind": "approval_created", "at": p.created_at})
        if p.decided_at and since <= p.decided_at <= until:
            events.append(
                {**base, "kind": "approval_decided", "at": p.decided_at, "status": p.status}
            )

    events.sort(key=lambda e: e["at"])
    truncated = len(events) > TIMELINE_MAX_EVENTS
    return {
        "since": since, "until": until,
        "events": events[:TIMELINE_MAX_EVENTS], "truncated": truncated,
    }


def ask_as_agent(tenant_id, agent_id, question: str, use_rag_context: bool = True) -> dict:
    """
    Ponto de entrada: um Agent faz uma pergunta via `orchestration`, e o
    resultado fica registrado em `AgentInteraction` (tokens/custo
    estimados). O contexto de RAG é restrito pelo setor do agente — ver
    `_rag_scope_for`. Se a ação escolhida pelo modelo tiver risco acima do
    que o `autonomy_level` do agente permite (ver `agency.policy`), a
    execução é bloqueada e uma `PendingApproval` é criada em vez de rodar
    a função — human-in-the-loop de verdade, não decorativo.
    """
    from orchestration.services import answer_question  # import local: agency depende de orchestration, nunca o contrário
    from agency.policy import make_policy_check

    agent = Agent.objects.select_related("sector").get(id=agent_id, tenant_id=tenant_id)
    question = sanitize_user_input(question, source=f"agent_{agent_id}")
    agent.work_status = Agent.WorkStatus.WORKING
    agent.current_task = question[:255]
    agent.save(update_fields=["work_status", "current_task"])

    provider, model = resolve_agent_llm(agent)
    with track_usage() as usage:  # tokens reais de todas as chamadas da pergunta
        result = answer_question(
            tenant_id, question,
            use_rag_context=use_rag_context,
            rag_source_ids=_rag_scope_for(agent),
            policy_check=make_policy_check(agent),
            agent_instructions=agent.instructions or "",
            provider=provider,
            model=model,
        )

    if result.get("status") == "pending_approval" and result.get("function_called"):
        fn = registry.get_function(result["function_called"])
        pending = PendingApproval.objects.create(
            tenant_id=tenant_id,
            agent=agent,
            function_name=result["function_called"],
            params=result.get("pending_function_params") or {},
            risk=fn.risk if fn else "critical",
            reason=result["answer"],
        )
        broadcast_pending_approval_update(pending)

    record_interaction(
        agent, question, result.get("answer", ""), provider, model,
        usage=usage,
        source_document_ids=[
            s["document_id"]
            for s in result.get("sources") or []
            if s.get("document_id") is not None
        ],
    )

    agent.work_status = Agent.WorkStatus.IDLE
    agent.current_task = ""
    agent.save(update_fields=["work_status", "current_task"])

    return result


def decide_pending_approval(tenant_id, pending_id, approved: bool, decided_by=None) -> "PendingApproval":
    """
    Humano aprova ou rejeita uma ação que a política bloqueou. Se
    aprovada, a função É EXECUTADA agora de verdade (via
    `orchestration.registry.execute` — nunca pulando o mesmo caminho de
    execução usado no fluxo automático) e o resultado fica registrado no
    próprio `PendingApproval`, fechando a rastreabilidade do §31 do
    documento: dá pra sempre responder "quem aprovou e o que aconteceu".
    """
    pending = PendingApproval.objects.get(id=pending_id, tenant_id=tenant_id)
    if pending.status != PendingApproval.Status.PENDING:
        raise ValueError(f"Esta ação já foi decidida ({pending.get_status_display()}).")

    pending.decided_by = decided_by
    pending.decided_at = timezone.now()

    if approved:
        pending.status = PendingApproval.Status.APPROVED
        try:
            pending.result = registry.execute(pending.function_name, tenant_id, pending.params)
        except (LookupError, ValueError) as exc:
            pending.result = {"error": str(exc)}
    else:
        pending.status = PendingApproval.Status.REJECTED

    pending.save(update_fields=["status", "decided_by", "decided_at", "result"])
    broadcast_pending_approval_update(pending)
    return pending


# ---------------------------------------------------------------------------
# Comunicação entre setores (sempre mediada)
# ---------------------------------------------------------------------------

def request_cross_sector_message(tenant_id, from_agent_id, to_sector_id, content: str) -> SectorMessage:
    """
    Um agente (de qualquer setor) registra o desejo de mandar algo para
    outro setor. Isto NÃO executa nada ainda — só cria o pedido, com
    status `pending`, esperando um orquestrador (ou CEO) mediar via
    `relay_message`. Um agente nunca fala direto com outro setor.
    """
    from_agent = Agent.objects.select_related("sector").get(id=from_agent_id, tenant_id=tenant_id)

    if from_agent.sector_id == to_sector_id:
        raise ValueError("from_agent já pertence a este setor — não é uma mensagem cruzada.")

    safe_content = sanitize_user_input(content, source=f"sector_message:agent_{from_agent_id}")
    message = SectorMessage.objects.create(
        tenant_id=tenant_id,
        from_agent=from_agent,
        to_sector_id=to_sector_id,
        content=safe_content,
    )
    broadcast_sector_message_update(message)
    return message


def relay_message(tenant_id, relaying_agent_id, message_id: int, answering_agent_id=None) -> SectorMessage:
    """
    Um orquestrador (de setor ou geral) ou o CEO efetivamente encaminha
    uma `SectorMessage` pendente: executa a pergunta como se fosse o
    setor de destino respondendo (via `ask_as_agent`, escopado ao cérebro
    daquele setor) e marca a mensagem como respondida.

    Regra de permissão (`can_relay` sozinho não basta — um orquestrador de
    setor só pode mediar mensagens que envolvam o PRÓPRIO setor, na ponta
    de origem ou de destino; só CEO/orquestrador-geral medeiam qualquer
    par de setores):
    """
    relaying_agent = Agent.objects.select_related("sector").get(id=relaying_agent_id, tenant_id=tenant_id)
    message = SectorMessage.objects.select_related("from_agent__sector", "to_sector").get(
        id=message_id, tenant_id=tenant_id
    )

    if not relaying_agent.can_relay:
        message.status = SectorMessage.Status.REJECTED
        message.rejection_reason = "Agente não tem permissão de mediação (é operacional)."
        message.rejected_at = timezone.now()
        message.save(update_fields=["status", "rejection_reason", "rejected_at"])
        broadcast_sector_message_update(message)
        raise AccessDeniedError(
            "Este agente é operacional e não pode mediar comunicação entre setores — "
            "só um orquestrador (do setor de origem/destino) ou o orquestrador-geral/CEO pode."
        )

    if not relaying_agent.has_full_access:
        # Orquestrador de setor: só medeia se o setor dele for origem OU destino.
        envolve_seu_setor = relaying_agent.sector_id in (message.from_agent.sector_id, message.to_sector_id)
        if not envolve_seu_setor:
            message.status = SectorMessage.Status.REJECTED
            message.rejection_reason = (
                f"Orquestrador de {relaying_agent.sector} não medeia mensagens entre outros setores."
            )
            message.rejected_at = timezone.now()
            message.save(update_fields=["status", "rejection_reason", "rejected_at"])
            broadcast_sector_message_update(message)
            raise AccessDeniedError(message.rejection_reason)

    # Quem responde: um agente explícito do setor de destino, ou (padrão)
    # o orquestrador daquele setor, se existir.
    if answering_agent_id:
        answering_agent = Agent.objects.get(id=answering_agent_id, tenant_id=tenant_id, sector=message.to_sector)
    else:
        answering_agent = (
            Agent.objects.filter(
                tenant_id=tenant_id, sector=message.to_sector,
                access_level=Agent.AccessLevel.SECTOR_ORCHESTRATOR, is_active=True,
            ).first()
            or Agent.objects.filter(tenant_id=tenant_id, sector=message.to_sector, is_active=True).first()
        )
        if not answering_agent:
            raise ValueError(f"Setor '{message.to_sector}' não tem nenhum agente ativo para responder.")

    result = ask_as_agent(tenant_id, answering_agent.id, message.content)

    message.response = result.get("answer", "")
    message.relayed_by = relaying_agent
    message.status = SectorMessage.Status.ANSWERED
    message.answered_at = timezone.now()
    message.save(update_fields=["response", "relayed_by", "status", "answered_at"])
    broadcast_sector_message_update(message)

    return message


# ---------------------------------------------------------------------------
# Métricas ("cérebro principal" — visão sem restrição, para CEO/orquestrador-geral)
# ---------------------------------------------------------------------------

def _month_start():
    """Início do mês corrente no fuso do projeto — o orçamento é MENSAL."""
    return timezone.localtime().replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def _cost_by_provider(qs) -> list[dict]:
    """Custo/tokens/chamadas agrupados por provedor ('' = anterior ao campo)."""
    rows = (
        qs.values("provider")
        .annotate(cost=Sum("estimated_cost_usd"), tokens=Sum("tokens_used"), calls=Count("id"))
        .order_by("-cost")
    )
    return [
        {
            "provider": r["provider"],
            "cost_usd": float(r["cost"] or 0),
            "tokens": r["tokens"] or 0,
            "calls": r["calls"],
        }
        for r in rows
    ]


def get_overview(tenant_id) -> dict:
    qs = AgentInteraction.objects.filter(tenant_id=tenant_id)
    agg = qs.aggregate(
        total_cost=Sum("estimated_cost_usd"), total_tokens=Sum("tokens_used"), total_calls=Count("id")
    )
    month_start = _month_start()
    month_qs = qs.filter(created_at__gte=month_start)
    month_cost = month_qs.aggregate(c=Sum("estimated_cost_usd"))["c"]
    return {
        "month_start": month_start,
        "month_cost_usd": float(month_cost or 0),
        "month_by_provider": _cost_by_provider(month_qs),
        "total_cost_usd": float(agg["total_cost"] or 0),
        "total_tokens": agg["total_tokens"] or 0,
        "total_calls": agg["total_calls"] or 0,
        "total_agents": Agent.objects.filter(tenant_id=tenant_id, is_active=True).count(),
        "total_sectors": Sector.objects.filter(tenant_id=tenant_id, is_active=True).count(),
        "pending_cross_sector_messages": SectorMessage.objects.filter(
            tenant_id=tenant_id, status=SectorMessage.Status.PENDING
        ).count(),
    }


def get_sector_metrics(tenant_id) -> list[dict]:
    sectors = list(Sector.objects.filter(tenant_id=tenant_id, is_active=True))
    sector_ids = [s.id for s in sectors]

    # Poucas queries para todos os setores ao invés de N queries num loop
    interactions = AgentInteraction.objects.filter(
        tenant_id=tenant_id, agent__sector_id__in=sector_ids,
    )
    agg_by_sector: dict = {
        row["agent__sector_id"]: row
        for row in interactions
        .values("agent__sector_id")
        .annotate(cost=Sum("estimated_cost_usd"), tokens=Sum("tokens_used"), calls=Count("id"))
    }
    # Orçamento é MENSAL (`monthly_budget_usd`): compara com o gasto do mês
    # corrente. Antes comparava com o gasto de todos os tempos — um setor
    # estourava o "orçamento do mês" pra sempre depois do primeiro mês cheio.
    month_start = _month_start()
    month_by_sector: dict = {}
    for row in (
        interactions.filter(created_at__gte=month_start)
        .values("agent__sector_id", "provider")
        .annotate(cost=Sum("estimated_cost_usd"), tokens=Sum("tokens_used"), calls=Count("id"))
    ):
        month_by_sector.setdefault(row["agent__sector_id"], []).append({
            "provider": row["provider"],
            "cost_usd": float(row["cost"] or 0),
            "tokens": row["tokens"] or 0,
            "calls": row["calls"],
        })
    agents_count_by_sector: dict = {
        row["sector_id"]: row["n"]
        for row in Agent.objects
        .filter(tenant_id=tenant_id, sector_id__in=sector_ids, is_active=True)
        .values("sector_id")
        .annotate(n=Count("id"))
    }

    metrics = []
    for sector in sectors:
        agg = agg_by_sector.get(sector.id, {})
        by_provider = sorted(month_by_sector.get(sector.id, []), key=lambda r: -r["cost_usd"])
        month_spent = sum(r["cost_usd"] for r in by_provider)
        budget = float(sector.monthly_budget_usd)
        usage_percent = round((month_spent / budget) * 100, 1) if budget > 0 else None
        metrics.append({
            "sector_id": sector.id,
            "sector_name": sector.name,
            "agents_count": agents_count_by_sector.get(sector.id, 0),
            "has_own_knowledge_base": sector.knowledge_source_id is not None,
            "tokens": agg.get("tokens") or 0,
            "cost_usd": float(agg.get("cost") or 0),
            "month_cost_usd": month_spent,
            "month_by_provider": by_provider,
            "ai_provider": sector.default_provider,
            "budget_usd": budget,
            "usage_percent": usage_percent,
            "status": _budget_status(usage_percent),
        })
    return metrics


def get_agent_metrics(tenant_id, sector_id=None) -> list[dict]:
    qs = Agent.objects.filter(tenant_id=tenant_id, is_active=True)
    if sector_id:
        qs = qs.filter(sector_id=sector_id)

    metrics = []
    for agent in qs.select_related("sector"):
        agg = AgentInteraction.objects.filter(tenant_id=tenant_id, agent=agent).aggregate(
            cost=Sum("estimated_cost_usd"), tokens=Sum("tokens_used"),
            calls=Count("id"), avg_tokens=Avg("tokens_used"),
        )
        metrics.append({
            "agent_id": agent.id,
            "agent_name": agent.name,
            "role": agent.role,
            "sector_name": agent.sector.name if agent.sector else "(sem setor — acesso total)",
            "access_level": agent.access_level,
            "work_status": agent.work_status,
            "calls": agg["calls"] or 0,
            "tokens": agg["tokens"] or 0,
            "cost_usd": float(agg["cost"] or 0),
        })
    return metrics


def get_budget_status(tenant_id) -> list[dict]:
    """Só os setores com orçamento definido (monthly_budget_usd > 0)."""
    return [m for m in get_sector_metrics(tenant_id) if m["budget_usd"] > 0]


def _budget_status(usage_percent: float | None) -> str:
    if usage_percent is None:
        return "sem_orcamento"
    if usage_percent >= 100:
        return "over"
    if usage_percent >= 80:
        return "warn"
    return "ok"


# ---------------------------------------------------------------------------
# Criação de projeto comercial (setor de Desenvolvimento)
# ---------------------------------------------------------------------------

def _project_templates_root():
    """
    Onde estão os templates: `PROJECT_TEMPLATES_PATH` (se definido) →
    volume do Docker (`/app/project-templates`) → a pasta do próprio
    repositório (`frontend/project-templates`, rodando fora do Docker,
    ex: pytest local). Variável explícita sempre vence; sem ela, o primeiro
    caminho que existe.
    """
    import pathlib

    explicit = os.environ.get("PROJECT_TEMPLATES_PATH")
    if explicit:
        return pathlib.Path(explicit)
    docker = pathlib.Path("/app/project-templates")
    if docker.is_dir():
        return docker
    # agency/services.py → backend_api/Api/agency → raiz do repositório
    return pathlib.Path(__file__).resolve().parents[3] / "frontend" / "project-templates"


def _load_simple_commercial_template(project_name: str) -> dict[str, str]:
    """
    Lê o template de `frontend/project-templates/simple_commercial/` —
    fica fisicamente em `frontend/` (é conteúdo React/Vite/TS de
    verdade), montado só-leitura no container do backend via
    docker-compose (`PROJECT_TEMPLATES_PATH`, default
    `/app/project-templates` — o caminho do volume; fora do Docker,
    aponte para `../frontend/project-templates` no `.env`).

    100% Python + httpx daqui pra frente (`integrations.github.
    push_template_files`) — nenhum `.mjs`/Node.js entra nesse fluxo, só
    lê os arquivos do disco e empurra pro GitHub via API. `package-lock.
    json` é excluído (será regenerado no primeiro `npm install` de quem
    for trabalhar no projeto).
    """
    template_dir = _project_templates_root() / "simple_commercial"

    if not template_dir.is_dir():
        raise FileNotFoundError(
            f"Template não encontrado em '{template_dir}'. Dentro do Docker isso é o volume "
            f"montado (ver docker-compose.yml, serviço 'backend'); fora do Docker, a pasta "
            f"'frontend/project-templates' do repositório. Defina PROJECT_TEMPLATES_PATH se "
            f"o template estiver em outro lugar."
        )

    files: dict[str, str] = {}

    for path in template_dir.rglob("*"):
        if path.is_dir() or path.name == "package-lock.json":
            continue
        relative = path.relative_to(template_dir).as_posix()
        content = path.read_text(encoding="utf-8")
        files[relative] = content.replace("PROJECT_NAME_PLACEHOLDER", project_name)

    return files


def create_project(
    tenant_id, requesting_agent_id, name: str, description: str = "", private: bool = True, workspace: str = "",
) -> Project:
    """
    Ponto de entrada: "setor de Desenvolvimento, crie um projeto X".

    Cria um `Project` (registro local), um repositório GitHub (via
    `integrations`) e envia o template `simple-commercial` (React+Vite+TS,
    pronto para Vercel + Supabase — NUNCA o boilerplate PGBA completo,
    que é a plataforma interna, não um produto para o cliente final).

    Não levanta exceção em caso de falha na integração — grava
    `status=failed` + `error_message` no Project e retorna assim mesmo,
    para que o chamador (view/agente) sempre tenha um registro para
    mostrar, nunca um 500 cru.
    """
    project = Project.objects.create(
        tenant_id=tenant_id, name=name, description=description, origin=Project.Origin.CREATED, workspace=workspace,
        requested_by_id=requesting_agent_id, status=Project.Status.PENDING,
    )

    try:
        template_files = _load_simple_commercial_template(name)
        repo = create_project_repository(
            tenant_id, name=name, description=description, private=private, template_files=template_files,
        )
    except (IntegrationConfigError, FileNotFoundError) as exc:
        project.status = Project.Status.FAILED
        project.error_message = str(exc)
        project.save(update_fields=["status", "error_message"])
        return project

    project.status = Project.Status.READY
    project.github_repo_url = repo["html_url"]
    project.github_full_name = repo["full_name"]
    project.save(update_fields=["status", "github_repo_url", "github_full_name"])
    return project


def import_project(
    tenant_id, requesting_agent_id, name: str, github_full_name: str, description: str = "", workspace: str = "", local_path: str = "",
) -> Project:
    """
    Registra um projeto que JÁ EXISTIA (repositório GitHub real, criado
    por fora do PGBA) na gestão do sistema — nunca cria repositório
    novo, nunca envia template. Diferente de `create_project`: aqui
    `github_full_name` vem de quem chama, não é gerado.

    Confirma que o repositório existe de verdade (`get_project_repository`)
    antes de marcar como pronto — nunca grava `status=ready` só porque
    o nome foi digitado, sem checar a API do GitHub.

    Mesmo padrão de nunca levantar exceção pro chamador: grava
    `status=failed` + `error_message` e retorna assim mesmo.
    """
    project = Project.objects.create(
        tenant_id=tenant_id, name=name, description=description, origin=Project.Origin.IMPORTED, workspace=workspace,
        local_path=local_path, requested_by_id=requesting_agent_id, status=Project.Status.PENDING,
    )

    try:
        repo = get_project_repository(tenant_id, github_full_name)
    except IntegrationConfigError as exc:
        project.status = Project.Status.FAILED
        project.error_message = str(exc)
        project.save(update_fields=["status", "error_message"])
        return project

    project.status = Project.Status.READY
    project.github_repo_url = repo["html_url"]
    project.github_full_name = repo["full_name"]
    project.save(update_fields=["status", "github_repo_url", "github_full_name"])
    return project
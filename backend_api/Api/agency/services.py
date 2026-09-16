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

from django.db.models import Sum, Count, Avg
from django.utils import timezone

from agency.models import Sector, Agent, AgentInteraction, SectorMessage, Project, PendingApproval
from agency.realtime import broadcast_pending_approval_update
from integrations.services import create_project_repository, IntegrationConfigError
from orchestration import registry

# Preço aproximado por 1K tokens (entrada+saída médio), só para dar uma
# ordem de grandeza no console — não é billing real. Ajuste conforme os
# preços vigentes do(s) provedor(es) configurados no harness.
APPROX_PRICE_PER_1K_TOKENS = {
    "ollama": Decimal("0.0"),       # local, sem custo de API
    "openai": Decimal("0.01"),
    "anthropic": Decimal("0.01"),
    "groq": Decimal("0.001"),
    "openrouter": Decimal("0.005"),
}


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
    if agent.sector and agent.sector.knowledge_source_id:
        return [agent.sector.knowledge_source_id]
    return []


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
    agent.work_status = Agent.WorkStatus.WORKING
    agent.current_task = question[:255]
    agent.save(update_fields=["work_status", "current_task"])

    result = answer_question(
        tenant_id, question,
        use_rag_context=use_rag_context,
        rag_source_ids=_rag_scope_for(agent),
        policy_check=make_policy_check(agent),
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

    tokens = _estimate_tokens(question) + _estimate_tokens(result.get("answer", ""))
    price_table = APPROX_PRICE_PER_1K_TOKENS.get(agent.default_provider, Decimal("0.005"))
    cost = (Decimal(tokens) / Decimal(1000)) * price_table

    AgentInteraction.objects.create(
        tenant_id=tenant_id,
        agent=agent,
        question=question,
        answer=result.get("answer", ""),
        tokens_used=tokens,
        estimated_cost_usd=cost,
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

    return SectorMessage.objects.create(
        tenant_id=tenant_id,
        from_agent=from_agent,
        to_sector_id=to_sector_id,
        content=content,
    )


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
        message.save(update_fields=["status", "rejection_reason"])
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
            message.save(update_fields=["status", "rejection_reason"])
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

    return message


# ---------------------------------------------------------------------------
# Métricas ("cérebro principal" — visão sem restrição, para CEO/orquestrador-geral)
# ---------------------------------------------------------------------------

def get_overview(tenant_id) -> dict:
    agg = AgentInteraction.objects.filter(tenant_id=tenant_id).aggregate(
        total_cost=Sum("estimated_cost_usd"), total_tokens=Sum("tokens_used"), total_calls=Count("id")
    )
    return {
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
    sectors = Sector.objects.filter(tenant_id=tenant_id, is_active=True)
    metrics = []
    for sector in sectors:
        agg = AgentInteraction.objects.filter(
            tenant_id=tenant_id, agent__sector=sector
        ).aggregate(cost=Sum("estimated_cost_usd"), tokens=Sum("tokens_used"), calls=Count("id"))
        spent = float(agg["cost"] or 0)
        budget = float(sector.monthly_budget_usd)
        usage_percent = round((spent / budget) * 100, 1) if budget > 0 else None
        metrics.append({
            "sector_id": sector.id,
            "sector_name": sector.name,
            "agents_count": sector.agents.filter(is_active=True).count(),
            "has_own_knowledge_base": sector.knowledge_source_id is not None,
            "tokens": agg["tokens"] or 0,
            "cost_usd": spent,
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
    import pathlib

    templates_root = pathlib.Path(os.environ.get("PROJECT_TEMPLATES_PATH", "/app/project-templates"))
    template_dir = templates_root / "simple_commercial"

    if not template_dir.is_dir():
        raise FileNotFoundError(
            f"Template não encontrado em '{template_dir}'. Dentro do Docker isso é o volume "
            f"montado (ver docker-compose.yml, serviço 'backend') e deveria sempre existir. "
            f"Rodando fora do Docker (ex: pytest local), defina PROJECT_TEMPLATES_PATH "
            f"apontando para a pasta 'frontend/project-templates' do repositório."
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
    tenant_id, requesting_agent_id, name: str, description: str = "", private: bool = True,
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
        tenant_id=tenant_id, name=name, description=description,
        requested_by_id=requesting_agent_id, status=Project.Status.PENDING,
    )

    try:
        template_files = _load_simple_commercial_template(name)
        repo = create_project_repository(
            tenant_id, name=name, description=description, private=private, template_files=template_files,
        )
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
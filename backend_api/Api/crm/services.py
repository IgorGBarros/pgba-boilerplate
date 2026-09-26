"""
Regras de negócio do CRM — Lead, Deal, Project.
Segue o padrão do boilerplate: harness/providers.py para o LLM, nunca HTTP direto.
"""
import logging
from django.db import transaction

from harness.providers import chat_completion, chat_completion_with_usage, get_active_provider, get_credential
from crm.models import Lead, Deal, Project, LeadMessage, Pipeline, Stage

logger = logging.getLogger(__name__)


def _fire_obsidian_sync(lead_id: int, tenant_id):
    """Dispara sync assíncrono do lead para o Obsidian (falha silenciosamente se Celery indisponível)."""
    try:
        from crm.tasks import sync_lead_to_obsidian
        sync_lead_to_obsidian.delay(lead_id, tenant_id)
    except Exception as exc:
        logger.warning("_fire_obsidian_sync: não foi possível enfileirar task (%s).", exc)

# ─── Etapas padrão sugeridas ──────────────────────────────────────────────────

DEFAULT_STAGES = {
    "lead": [
        {"name": "Novo Lead",          "color": "blue",   "position": 0},
        {"name": "Primeiro Contato",   "color": "blue",   "position": 1},
        {"name": "Qualificado",        "color": "indigo", "position": 2},
        {"name": "Aguardando Retorno", "color": "violet", "position": 3},
    ],
    "deal": [
        {"name": "Proposta Enviada",   "color": "amber",  "position": 0},
        {"name": "Em Negociação",      "color": "orange", "position": 1},
        {"name": "Aguardando Decisão", "color": "yellow", "position": 2},
        {"name": "Ganho",              "color": "green",  "position": 3, "is_won": True},
        {"name": "Perdido",            "color": "red",    "position": 4, "is_lost": True},
    ],
    "project": [
        {"name": "Kickoff",            "color": "cyan",    "position": 0},
        {"name": "Em Desenvolvimento", "color": "teal",    "position": 1},
        {"name": "Em Revisão",         "color": "sky",     "position": 2},
        {"name": "Entregue",           "color": "emerald", "position": 3},
        {"name": "Concluído",          "color": "green",   "position": 4, "is_won": True},
    ],
}


def seed_default_pipeline(tenant_id) -> Pipeline:
    """Cria o pipeline padrão com todas as etapas para um tenant. Idempotente."""
    pipeline, created = Pipeline.objects.get_or_create(
        tenant_id=tenant_id,
        is_default=True,
        defaults={"name": "Pipeline Comercial"},
    )

    if not created:
        return pipeline

    with transaction.atomic():
        for main_stage, stages in DEFAULT_STAGES.items():
            for s in stages:
                Stage.objects.create(
                    tenant_id=tenant_id,
                    pipeline=pipeline,
                    main_stage=main_stage,
                    name=s["name"],
                    color=s["color"],
                    position=s["position"],
                    is_won=s.get("is_won", False),
                    is_lost=s.get("is_lost", False),
                )

    return pipeline


# ─── Lead ─────────────────────────────────────────────────────────────────────

def move_lead_to_stage(lead_id: int, stage_id: int, tenant_id) -> Lead:
    lead = Lead.objects.get(id=lead_id, tenant_id=tenant_id)
    stage = Stage.objects.get(id=stage_id, tenant_id=tenant_id)
    lead.stage = stage
    lead.pipeline = stage.pipeline
    lead.save(update_fields=["stage", "pipeline"])
    LeadMessage.objects.create(
        tenant_id=tenant_id, lead=lead,
        role=LeadMessage.Role.SYSTEM,
        content=f"Lead movido para etapa: {stage.name}",
    )
    _fire_obsidian_sync(lead_id, tenant_id)
    return lead


def convert_lead_to_deal(lead_id: int, tenant_id, titulo: str = "", responsavel: str = "", valor=None) -> Deal:
    """
    Converte um Lead em Deal:
    - Cria um registro Deal referenciando o Lead
    - Atualiza lead.outcome = 'convertido'
    - Coloca o Deal no primeiro stage de 'deal' do pipeline do lead
    """
    lead = Lead.objects.get(id=lead_id, tenant_id=tenant_id)

    first_deal_stage = Stage.objects.filter(
        tenant_id=tenant_id,
        pipeline=lead.pipeline,
        main_stage="deal",
    ).order_by("position").first()

    with transaction.atomic():
        deal = Deal.objects.create(
            tenant_id=tenant_id,
            lead=lead,
            pipeline=lead.pipeline,
            stage=first_deal_stage,
            titulo=titulo or lead.nome,
            empresa=lead.empresa,
            responsavel=responsavel or lead.responsavel,
            valor=valor or lead.valor_estimado,
        )
        lead.outcome = "convertido"
        lead.save(update_fields=["outcome"])
        LeadMessage.objects.create(
            tenant_id=tenant_id, lead=lead,
            role=LeadMessage.Role.SYSTEM,
            content=f"Lead convertido em Deal: #{deal.id} — {deal.titulo}",
        )

    _fire_obsidian_sync(lead_id, tenant_id)
    return deal


# ─── Deal ─────────────────────────────────────────────────────────────────────

def move_deal_to_stage(deal_id: int, stage_id: int, tenant_id) -> Deal:
    deal = Deal.objects.get(id=deal_id, tenant_id=tenant_id)
    stage = Stage.objects.get(id=stage_id, tenant_id=tenant_id)
    deal.stage = stage
    deal.pipeline = stage.pipeline
    deal.save(update_fields=["stage", "pipeline"])
    return deal


def set_deal_outcome(deal_id: int, outcome: str, tenant_id) -> Deal:
    """
    Define o desfecho de um Deal.
    Se 'ganho' ou 'contrato_assinado', cria automaticamente um Project.
    """
    VALID = {"ganho", "contrato_assinado", "perdido", "cancelado", ""}
    if outcome not in VALID:
        raise ValueError(f"outcome inválido: {outcome}")

    deal = Deal.objects.select_related("stage", "lead").get(id=deal_id, tenant_id=tenant_id)
    deal.outcome = outcome
    deal.save(update_fields=["outcome"])

    if outcome in {"ganho", "contrato_assinado"}:
        first_project_stage = Stage.objects.filter(
            tenant_id=tenant_id,
            pipeline=deal.pipeline,
            main_stage="project",
        ).order_by("position").first()

        if first_project_stage and not deal.projects.filter(tenant_id=tenant_id).exists():
            Project.objects.create(
                tenant_id=tenant_id,
                deal=deal,
                lead=deal.lead,
                pipeline=deal.pipeline,
                stage=first_project_stage,
                titulo=deal.titulo,
                empresa=deal.empresa,
                responsavel=deal.responsavel,
            )

    return deal


# ─── Project ──────────────────────────────────────────────────────────────────

def move_project_to_stage(project_id: int, stage_id: int, tenant_id) -> Project:
    project = Project.objects.get(id=project_id, tenant_id=tenant_id)
    stage = Stage.objects.get(id=stage_id, tenant_id=tenant_id)
    project.stage = stage
    project.pipeline = stage.pipeline
    project.save(update_fields=["stage", "pipeline"])
    return project


def set_project_outcome(project_id: int, outcome: str, tenant_id) -> Project:
    VALID = {"concluido", "pausado", "cancelado", ""}
    if outcome not in VALID:
        raise ValueError(f"outcome inválido: {outcome}")
    project = Project.objects.get(id=project_id, tenant_id=tenant_id)
    project.outcome = outcome
    project.save(update_fields=["outcome"])
    return project


# ─── Qualificação de lead via agente ──────────────────────────────────────────

def qualify_lead(lead_id: int, user_message: str, tenant_id) -> dict:
    lead = Lead.objects.prefetch_related("messages").get(id=lead_id, tenant_id=tenant_id)

    LeadMessage.objects.create(
        tenant_id=tenant_id, lead=lead,
        role=LeadMessage.Role.USER, content=user_message,
    )

    rag_context = ""
    try:
        from ingestion.services import semantic_search
        chunks = semantic_search(user_message, tenant_id=tenant_id, top_k=4)
        if chunks:
            rag_context = "\n\n".join(c.content for c in chunks[:4])
    except Exception as exc:
        logger.warning("CRM qualify_lead: RAG falhou (%s) — seguindo sem contexto.", exc)

    history_qs = lead.messages.all().order_by("created_at")
    history = []
    for m in history_qs:
        if m.role == LeadMessage.Role.SYSTEM:
            continue
        role = "assistant" if m.role == LeadMessage.Role.AGENT else "user"
        history.append({"role": role, "content": m.content})

    knowledge_section = (
        f"CATÁLOGO DE SERVIÇOS E TABELA DE PREÇOS DA EMPRESA:\n{rag_context}\n\n"
        if rag_context
        else (
            "Catálogo de serviços não encontrado na base de conhecimento. "
            "Apresente-se cordialmente, entenda a necessidade do lead e informe que "
            "um especialista entrará em contato com uma proposta personalizada.\n\n"
        )
    )
    system_prompt = (
        f"Você é o consultor comercial da empresa, responsável por atender leads via mensagem.\n"
        f"Atendendo: {lead.nome}" + (f" da empresa {lead.empresa}" if lead.empresa else "") + ".\n\n"
        "OBJETIVOS (nesta ordem):\n"
        "1. Cumprimentar o contato e entender o que ele precisa.\n"
        "2. Apresentar o serviço ou solução mais adequada com base no catálogo abaixo.\n"
        "3. Informar prazo e investimento conforme a tabela de preços — nunca invente valores.\n"
        "4. Quando o interesse for claro, perguntar: \"Posso avançar para a etapa de proposta?\"\n\n"
        "REGRAS:\n"
        "- Responda sempre em português do Brasil, de forma natural e amigável.\n"
        "- NUNCA peça ao lead que informe o orçamento dele — é a empresa que apresenta o preço.\n"
        "- Apresente os valores e prazos diretamente do catálogo, sem esperar o lead perguntar.\n"
        "- Se a necessidade do lead não bater com nenhum serviço do catálogo, diga que "
        "vai verificar e acionar um especialista.\n"
        "- Nunca invente preços, prazos ou funcionalidades fora do catálogo.\n"
        "- Respostas objetivas: no máximo 3 parágrafos.\n"
        "- Nunca mencione que você é uma IA, a menos que o lead pergunte diretamente.\n\n"
        + knowledge_section
    )

    tokens_in = tokens_out = 0
    cost_usd = 0
    try:
        provider = get_active_provider(tenant_id)
        cred = get_credential(tenant_id, provider)
        model = cred.default_model or None
        response_text, tokens_in, tokens_out = chat_completion_with_usage(
            tenant_id, provider, model,
            messages=[{"role": "system", "content": system_prompt}] + history,
            temperature=0.4,
        )
        from harness.pricing import estimate_cost  # preço por modelo, único no projeto

        cost_usd = float(estimate_cost(provider, model or "", tokens_in, tokens_out))
    except Exception as exc:
        logger.error("CRM qualify_lead: provedor falhou (%s).", exc)
        response_text = "Desculpe, houve um problema técnico. Tente novamente em instantes."

    LeadMessage.objects.create(
        tenant_id=tenant_id, lead=lead,
        role=LeadMessage.Role.AGENT, content=response_text,
        tokens_in=tokens_in, tokens_out=tokens_out, cost_estimated_usd=cost_usd,
    )

    closing_suggested = any(
        phrase in response_text.lower()
        for phrase in ["etapa de proposta", "avançar para", "fechar negócio", "posso avançar"]
    )

    _fire_obsidian_sync(lead_id, tenant_id)

    return {"response": response_text, "closing_suggested": closing_suggested, "lead_id": lead_id}

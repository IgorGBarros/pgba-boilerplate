"""
Regras de negócio do CRM — Lead, Deal, Project.
Segue o padrão do boilerplate: harness/providers.py para o LLM, nunca HTTP direto.
"""
import logging
from django.db import transaction

from harness.providers import chat_completion, get_active_provider
from crm.models import Lead, Deal, Project, LeadMessage, Pipeline, Stage

logger = logging.getLogger(__name__)

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

    system_prompt = (
        "Você é o agente comercial da empresa. Seja direto, profissional e amigável.\n\n"
        "OBJETIVO:\n"
        "1. Responder dúvidas sobre produtos/serviços usando APENAS as informações fornecidas.\n"
        "2. Qualificar o lead: entender necessidade, orçamento, prazo e autoridade de decisão.\n"
        "3. Quando o lead demonstrar interesse claro, perguntar: \"Posso avançar para a etapa de proposta?\"\n\n"
        "REGRAS:\n"
        "- Nunca invente preços, prazos ou funcionalidades não documentadas.\n"
        "- Se não souber, diga: \"Vou verificar e retorno em breve.\"\n"
        "- Máximo 3 parágrafos por resposta.\n"
        f"- Lead: {lead.nome}" + (f" ({lead.empresa})" if lead.empresa else "") + "\n\n"
        + (f"BASE DE CONHECIMENTO DA EMPRESA:\n{rag_context}\n" if rag_context else "")
    )

    try:
        provider, model, _ = get_active_provider(tenant_id)
        response_text = chat_completion(
            tenant_id, provider, model,
            messages=[{"role": "system", "content": system_prompt}] + history,
            temperature=0.4,
        )
    except Exception as exc:
        logger.error("CRM qualify_lead: provedor falhou (%s).", exc)
        response_text = "Desculpe, houve um problema técnico. Tente novamente em instantes."

    LeadMessage.objects.create(
        tenant_id=tenant_id, lead=lead,
        role=LeadMessage.Role.AGENT, content=response_text,
    )

    closing_suggested = any(
        phrase in response_text.lower()
        for phrase in ["etapa de proposta", "avançar para", "fechar negócio", "posso avançar"]
    )

    return {"response": response_text, "closing_suggested": closing_suggested, "lead_id": lead_id}

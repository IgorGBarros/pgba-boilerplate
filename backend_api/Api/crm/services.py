"""
Regras de negócio do CRM — qualificação de leads via agente de IA,
seed do pipeline padrão, movimentação de cards.

Segue o padrão do boilerplate: harness/providers.py para o LLM,
ingestion.services para RAG, nunca HTTP direto a um provedor.
"""
import logging
from django.db import transaction

from harness.providers import chat_completion, get_active_provider
from crm.models import Lead, LeadMessage, Pipeline, Stage

logger = logging.getLogger(__name__)

# ─── Etapas padrão sugeridas (genéricas — customizar por ramo) ────────────────

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
        {"name": "Ganho",             "color": "green",  "position": 3, "is_won": True},
        {"name": "Perdido",           "color": "red",    "position": 4, "is_lost": True},
    ],
    "project": [
        {"name": "Kickoff",           "color": "cyan",   "position": 0},
        {"name": "Em Desenvolvimento","color": "teal",   "position": 1},
        {"name": "Em Revisão",        "color": "sky",    "position": 2},
        {"name": "Entregue",          "color": "emerald","position": 3},
        {"name": "Concluído",         "color": "green",  "position": 4, "is_won": True},
    ],
}


def seed_default_pipeline(tenant_id) -> Pipeline:
    """
    Cria o pipeline padrão com todas as etapas sugeridas para um tenant.
    Idempotente: se já existe um pipeline default, retorna ele sem criar novo.
    """
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


def move_lead_to_stage(lead_id: int, stage_id: int, tenant_id) -> Lead:
    """Move um lead para uma nova etapa do kanban."""
    lead = Lead.objects.get(id=lead_id, tenant_id=tenant_id)
    stage = Stage.objects.get(id=stage_id, tenant_id=tenant_id)

    lead.stage = stage
    lead.pipeline = stage.pipeline
    lead.save(update_fields=["stage", "pipeline"])

    LeadMessage.objects.create(
        tenant_id=tenant_id,
        lead=lead,
        role=LeadMessage.Role.SYSTEM,
        content=f"Lead movido para etapa: {stage.get_main_stage_display()} → {stage.name}",
    )

    return lead


def qualify_lead(lead_id: int, user_message: str, tenant_id) -> dict:
    """
    Agente comercial responde uma mensagem do lead.

    Fluxo:
    1. Salva mensagem do usuário
    2. Busca contexto RAG do setor (base de conhecimento da empresa)
    3. Constrói histórico de conversa
    4. Chama o LLM via harness
    5. Detecta se o agente sugeriu fechamento
    6. Retorna resposta + flag closing_suggested

    Segue o "Princípio Akita": nunca aceita resposta sem tratamento de erro;
    falha do provedor não derruba a operação, loga e devolve mensagem de erro.
    """
    lead = Lead.objects.prefetch_related("messages").get(id=lead_id, tenant_id=tenant_id)

    LeadMessage.objects.create(
        tenant_id=tenant_id,
        lead=lead,
        role=LeadMessage.Role.USER,
        content=user_message,
    )

    # RAG: contexto da base de conhecimento do tenant
    rag_context = ""
    try:
        from ingestion.services import semantic_search
        chunks = semantic_search(user_message, tenant_id=tenant_id, top_k=4)
        if chunks:
            rag_context = "\n\n".join(c.content for c in chunks[:4])
    except Exception as exc:
        logger.warning("CRM qualify_lead: RAG falhou (%s) — seguindo sem contexto.", exc)

    # Histórico (sem a última mensagem que acabamos de salvar)
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
        "3. Quando o lead demonstrar interesse claro, perguntar diretamente:\n"
        "   \"Posso avançar para a etapa de proposta?\"\n\n"
        "REGRAS:\n"
        "- Nunca invente preços, prazos ou funcionalidades não documentadas.\n"
        "- Se não souber, diga: \"Vou verificar e retorno em breve.\"\n"
        "- Máximo 3 parágrafos por resposta.\n"
        f"- Lead: {lead.nome}"
        + (f" ({lead.empresa})" if lead.empresa else "")
        + "\n\n"
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
        tenant_id=tenant_id,
        lead=lead,
        role=LeadMessage.Role.AGENT,
        content=response_text,
    )

    closing_suggested = any(
        phrase in response_text.lower()
        for phrase in ["etapa de proposta", "avançar para", "fechar negócio", "posso avançar"]
    )

    return {
        "response": response_text,
        "closing_suggested": closing_suggested,
        "lead_id": lead_id,
    }

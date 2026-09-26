# backend_api/Api/agency/summary.py
"""
Resumo do dia escrito pelo agente CEO — a partir do que o sistema
REGISTROU (agency.services.company_timeline + custos), nunca de memória.

Princípio Akita aplicado:
- os fatos são montados em Python e numerados ([E1], [E2]...); o modelo só
  redige, e cada afirmação específica tem que citar o fato de origem;
- sem fatos no período, nem chama o modelo (require_grounded_context);
- citação a um fato que não existe é removida do texto e devolvida em
  `invalid_citations` — a tela avisa em vez de mostrar como verdade;
- a chamada passa pelo harness (IA do CEO, mesma regra de resolve_agent_llm)
  e o custo entra no registro do CEO como qualquer outra interação.
"""
from __future__ import annotations

import re
from collections import Counter

from django.db.models import Count, Sum
from django.utils import timezone

from agency.models import Agent, AgentInteraction, PendingApproval

MAX_FACTS = 80

SYSTEM_PROMPT = (
    "Você é o CEO de uma empresa operada por agentes de IA e escreve o resumo do dia para o dono "
    "da empresa. Use SOMENTE os fatos numerados fornecidos — nunca invente números, nomes ou "
    "eventos. Toda afirmação específica termina com o id do fato entre colchetes, ex: [E3] ou "
    "[E3][E7]. Se algo não está nos fatos, não escreva. Responda em português, em Markdown curto, "
    "com estas seções (omita a que não tiver fato): '## O que foi feito', '## O que travou', "
    "'## Custos', '## Pendências para decidir'. No máximo ~200 palavras."
)

_CITATION = re.compile(r"\[E(\d+)\]")
_TASK_WORD = {
    "created": "criada",
    "in_progress": "começou",
    "paused_ceo": "pausada",
    "adapted": "adaptada",
    "approved": "aprovada",
    "rejected": "rejeitada",
}


def _fmt_time(dt) -> str:
    return timezone.localtime(dt).strftime("%H:%M")


def build_day_facts(tenant_id, since, until) -> list[dict]:
    """Fatos numerados do período: totais + eventos relevantes (sem as perguntas uma a uma)."""
    from agency.services import company_timeline

    timeline = company_timeline(tenant_id, since, until)
    events = timeline["events"]
    agent_names = dict(Agent.objects.filter(tenant_id=tenant_id).values_list("id", "name"))
    facts: list[dict] = []

    def add(text: str, at=None):
        facts.append({"id": f"E{len(facts) + 1}", "text": text, "at": at})

    # Totais de IA por agente e custo por setor (interações do período)
    interactions = AgentInteraction.objects.filter(
        tenant_id=tenant_id,
        created_at__gte=since,
        created_at__lte=until,
    )
    by_sector = (
        interactions.values("agent__sector__name")
        .annotate(cost=Sum("estimated_cost_usd"), calls=Count("id"))
        .order_by("-cost")
    )
    for row in by_sector:
        sector = row["agent__sector__name"] or "Diretoria"
        add(
            f"Setor {sector}: {row['calls']} chamada(s) de IA, "
            f"custo estimado US$ {float(row['cost'] or 0):.4f}."
        )
    busiest = Counter(e["agent_id"] for e in events if e["kind"] == "interaction").most_common(5)
    for agent_id, n in busiest:
        add(f"{agent_names.get(agent_id, f'Agente #{agent_id}')} respondeu {n} pergunta(s).")

    # Eventos que contam a história do dia (tarefas, mensagens, aprovações)
    kinds = Counter(e["kind"] for e in events)
    for e in events:
        if len(facts) >= MAX_FACTS:
            break
        who = agent_names.get(e.get("agent_id"), e.get("agent_name") or "agente")
        at = e["at"]
        if e["kind"] == "task_status":
            add(
                f"{_fmt_time(at)} — tarefa #{e['task_id']} de {who} "
                f"{_TASK_WORD.get(e['status'], e['status'])}: {e['text']}",
                at,
            )
        elif e["kind"] == "task_finished":
            add(
                f"{_fmt_time(at)} — tarefa #{e['task_id']} de {who} terminou "
                f"(aguarda decisão): {e['text']}",
                at,
            )
        elif e["kind"] == "message_created":
            add(f"{_fmt_time(at)} — {who} pediu ao setor {e['to_sector_name']}: {e['text']}", at)
        elif e["kind"] == "message_answered":
            add(
                f"{_fmt_time(at)} — setor {e['to_sector_name']} respondeu o pedido de {who} "
                f"(mediado por {e.get('relayed_by_name') or '?'}).",
                at,
            )
        elif e["kind"] == "message_rejected":
            add(
                f"{_fmt_time(at)} — pedido de {who} ao setor {e['to_sector_name']} foi rejeitado.",
                at,
            )
        elif e["kind"] == "approval_created":
            add(
                f"{_fmt_time(at)} — {who} pediu aprovação para '{e['text']}' (risco {e['risk']}).",
                at,
            )
        elif e["kind"] == "approval_decided":
            add(
                f"{_fmt_time(at)} — ação '{e['text']}' de {who} foi "
                f"{'aprovada' if e.get('status') == 'approved' else 'rejeitada'}.",
                at,
            )
    if timeline["truncated"] or len(facts) >= MAX_FACTS:
        add(f"(Há mais eventos no período do que os listados: {sum(kinds.values())} no total.)")

    # Estado AGORA (não só o que aconteceu no período)
    pending = PendingApproval.objects.filter(
        tenant_id=tenant_id, status=PendingApproval.Status.PENDING
    )
    for p in pending.select_related("agent")[:10]:
        add(
            f"Pendente agora: '{p.function_name}' de {p.agent.name} espera aprovação humana "
            f"(risco {p.risk})."
        )

    return facts


def _speaker(tenant_id):
    """O CEO escreve (IA dele); sem CEO cadastrado, o Orquestrador-Geral; senão ninguém."""
    for level in (Agent.AccessLevel.CEO, Agent.AccessLevel.GENERAL_ORCHESTRATOR):
        agent = Agent.objects.filter(
            tenant_id=tenant_id, access_level=level, is_active=True
        ).first()
        if agent:
            return agent
    return None


def daily_summary(tenant_id, since, until) -> dict:
    """Gera o resumo. Levanta ProviderConfigError se a IA do CEO não estiver configurada."""
    from agency.services import record_interaction, resolve_agent_llm
    from harness.guardrails import GroundingError, require_grounded_context
    from harness.providers import chat_completion, get_active_provider, track_usage

    facts = build_day_facts(tenant_id, since, until)
    speaker = _speaker(tenant_id)
    base = {
        "since": since,
        "until": until,
        "facts": facts,
        "author": speaker.name if speaker else None,
    }
    digest = "\n".join(f"[{f['id']}] {f['text']}" for f in facts)
    try:
        require_grounded_context(digest, min_length=10)
    except GroundingError:
        return {
            **base,
            "summary": "Nada registrado neste período — sem fatos, não há o que resumir.",
            "cited": [],
            "invalid_citations": [],
            "provider": None,
            "model": None,
        }

    provider, model = (
        resolve_agent_llm(speaker) if speaker else (get_active_provider(tenant_id), None)
    )
    period = f"{timezone.localtime(since):%d/%m %H:%M} a {timezone.localtime(until):%d/%m %H:%M}"
    with track_usage() as usage:
        text = chat_completion(
            tenant_id,
            provider,
            model,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": f"Período: {period}\n\nFATOS:\n{digest}"},
            ],
            temperature=0.2,
        )

    valid = {f["id"] for f in facts}
    cited, invalid = [], []
    for n in _CITATION.findall(text):
        (cited if f"E{n}" in valid else invalid).append(f"E{n}")
    if invalid:
        text = _CITATION.sub(lambda m: m.group(0) if f"E{m.group(1)}" in valid else "", text)

    if speaker:
        record_interaction(speaker, f"Resumo do dia ({period})", text, provider, model, usage=usage)
    return {
        **base,
        "summary": text.strip(),
        "cited": sorted(set(cited), key=lambda x: int(x[1:])),
        "invalid_citations": sorted(set(invalid)),
        "provider": provider,
        "model": usage[-1].model if usage else model,
    }


SUMMARY_SOURCE_NAME = "Resumos do dia (CEO)"


def save_summary_to_brain(tenant_id, day, markdown: str, facts: list[dict] | None = None) -> dict:
    """
    Guarda o resumo como nota do Cérebro: uma KnowledgeSource própria
    ("Resumos do dia (CEO)", tipo manual — nunca o vault do Obsidian, que é
    só leitura) e um Document por dia (salvar de novo substitui o do dia).
    A indexação (embeddings) roda no Celery, como todo documento.
    """
    from ingestion.models import Document, KnowledgeSource

    source, _ = KnowledgeSource.objects.get_or_create(
        tenant_id=tenant_id,
        name=SUMMARY_SOURCE_NAME,
        defaults={"source_type": KnowledgeSource.SourceType.MANUAL},
    )
    appendix = ""
    if facts:
        appendix = "\n\n---\nFatos de origem:\n" + "\n".join(
            f"- [{f['id']}] {f['text']}" for f in facts
        )
    doc, _ = Document.objects.update_or_create(
        source=source,
        external_id=f"resumo-{day:%Y-%m-%d}.md",
        defaults={
            "tenant_id": tenant_id,
            "title": f"Resumo do dia {day:%d/%m/%Y}",
            "content": markdown + appendix,
            "status": Document.Status.PENDING,
            "metadata": {"tags": ["resumo-do-dia"], "author": "ceo"},
        },
    )
    queued = True
    try:
        from ingestion.tasks import process_document_task

        process_document_task.delay(doc.id)
    except Exception:  # broker fora do ar: a nota fica salva, indexa no próximo reprocessamento
        queued = False
    return {"document_id": doc.id, "source_id": source.id, "indexing_queued": queued}

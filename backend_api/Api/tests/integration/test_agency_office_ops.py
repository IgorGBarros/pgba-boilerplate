# backend_api/Api/tests/integration/test_agency_office_ops.py
"""
Operações que o Escritório 3D passou a usar: status da IA por setor,
custo por provedor (inclusive das Tasks), orçamento MENSAL, Task rodando
fora do Django (tela "Gerar"), linha do tempo do dia e mapa de uso das
notas do Cérebro.
"""
from datetime import timedelta
from decimal import Decimal

import pytest
from django.utils import timezone

from agency.models import AgentInteraction, PendingApproval, SectorMessage, Task
from agency.services import (
    ask_as_agent,
    get_sector_metrics,
    record_interaction,
    relay_message,
    request_cross_sector_message,
)
from agency.tasks import execute_task
from harness.models import AIProviderCredential
from harness.providers import provider_readiness
from tests.factories import AgentFactory, CeoAgentFactory, SectorFactory, SectorOrchestratorFactory


@pytest.fixture
def tenant_groq(monkeypatch):
    monkeypatch.setattr("harness.providers.get_active_provider", lambda tenant_id: "groq")


@pytest.fixture
def no_env_keys(settings):
    from cryptography.fernet import Fernet

    settings.ENCRYPTION_KEY = Fernet.generate_key().decode()
    for p in ("GROQ", "ANTHROPIC", "OPENAI", "OPENROUTER"):
        setattr(settings, f"{p}_API_KEY", "")
        setattr(settings, f"{p}_CHAT_MODEL", "")


def _cred(tenant_id, provider, model="m-1"):
    return AIProviderCredential.objects.create(
        tenant_id=tenant_id,
        provider=provider,
        api_key="k",
        default_model=model,
        is_active=True,
    )


# --- Status da IA por setor -------------------------------------------------


@pytest.mark.django_db
def test_provider_readiness_without_and_with_credential(tenant_id, no_env_keys):
    assert "anthropic" in provider_readiness(tenant_id, "anthropic")
    _cred(tenant_id, "anthropic", model="")
    assert "modelo" in provider_readiness(tenant_id, "anthropic")
    assert provider_readiness(tenant_id, "anthropic", "claude-sonnet-5") is None
    assert "não suportado" in provider_readiness(tenant_id, "inventado")


@pytest.mark.django_db
def test_ai_status_flags_dev_sector_without_anthropic_key(auth_client, tenant_id, no_env_keys):
    _cred(tenant_id, "groq")
    dev = SectorFactory(tenant_id=tenant_id, name="Desenvolvimento", default_provider="anthropic")
    comercial = SectorFactory(tenant_id=tenant_id, name="Comercial")
    AgentFactory(tenant_id=tenant_id, sector=comercial, default_provider="openai")

    res = auth_client.get("/api/v1/agency/ai-status/")
    assert res.status_code == 200
    by_id = {s["sector_id"]: s for s in res.data["sectors"]}
    assert by_id[dev.id]["provider"] == "anthropic" and by_id[dev.id]["source"] == "sector"
    assert by_id[dev.id]["ready"] is False and "anthropic" in by_id[dev.id]["detail"]
    assert by_id[comercial.id] == {
        **by_id[comercial.id],
        "provider": "groq",
        "source": "tenant",
        "ready": True,
    }
    assert res.data["tenant"] == {"provider": "groq", "ready": True, "detail": ""}
    assert [a["ready"] for a in res.data["agents"]] == [False]  # exceção individual sem chave

    _cred(tenant_id, "anthropic")
    res = auth_client.get("/api/v1/agency/ai-status/")
    assert {s["sector_id"]: s["ready"] for s in res.data["sectors"]}[dev.id] is True


# --- Custo por provedor ------------------------------------------------------


@pytest.mark.django_db
def test_ask_as_agent_records_provider(tenant_id, tenant_groq, monkeypatch):
    monkeypatch.setattr(
        "orchestration.services.answer_question",
        lambda *a, **k: {"answer": "ok", "function_called": None, "sources": [], "status": "ok"},
    )
    dev = SectorFactory(tenant_id=tenant_id, default_provider="anthropic", default_model="claude-x")
    agent = AgentFactory(tenant_id=tenant_id, sector=dev)
    ask_as_agent(tenant_id, agent.id, "pergunta")
    i = AgentInteraction.objects.get(agent=agent)
    assert (i.provider, i.model, i.task_id) == ("anthropic", "claude-x", None)


@pytest.mark.django_db
def test_execute_task_records_cost_with_task(tenant_id, tenant_groq, monkeypatch):
    monkeypatch.setattr(
        "harness.providers.chat_completion",
        lambda *a, **k: '{"output": "feito", "needs_review": false}',
    )
    agent = AgentFactory(tenant_id=tenant_id, sector=SectorFactory(tenant_id=tenant_id))
    task = Task.objects.create(tenant_id=tenant_id, agent=agent, brief="Resumo do mês")
    execute_task(tenant_id, task.id)
    i = AgentInteraction.objects.get(agent=agent)
    assert i.task_id == task.id and i.provider == "groq" and i.tokens_used > 0


@pytest.mark.django_db
def test_sector_metrics_month_budget_and_provider_breakdown(tenant_id):
    sector = SectorFactory(tenant_id=tenant_id, monthly_budget_usd=Decimal("10"))
    agent = AgentFactory(tenant_id=tenant_id, sector=sector)

    def interaction(provider, cost, when):
        i = record_interaction(agent, "q", "a", provider)
        AgentInteraction.objects.filter(id=i.id).update(
            estimated_cost_usd=Decimal(cost), created_at=when
        )

    now = timezone.now()
    interaction("anthropic", "6", now)
    interaction("groq", "2", now)
    interaction("groq", "50", now - timedelta(days=45))  # mês passado: não conta no orçamento

    m = next(x for x in get_sector_metrics(tenant_id) if x["sector_id"] == sector.id)
    assert m["month_cost_usd"] == pytest.approx(8)
    assert m["cost_usd"] == pytest.approx(58)  # total de sempre continua disponível
    assert m["usage_percent"] == 80.0 and m["status"] == "warn"
    assert [(r["provider"], r["cost_usd"]) for r in m["month_by_provider"]] == [
        ("anthropic", 6),
        ("groq", 2),
    ]


# --- Task rodando fora do Django (tela "Gerar") ----------------------------------


@pytest.mark.django_db
def test_start_external_then_report_result(auth_client, tenant_id, tenant_groq):
    dev = SectorFactory(tenant_id=tenant_id, default_provider="anthropic", default_model="claude-x")
    agent = AgentFactory(tenant_id=tenant_id, sector=dev)
    task = Task.objects.create(tenant_id=tenant_id, agent=agent, brief="Página de contato")

    res = auth_client.post(f"/api/v1/agency/tasks/{task.id}/start-external/")
    assert res.status_code == 200
    assert (res.data["status"], res.data["ai_provider"], res.data["ai_model"]) == (
        "in_progress",
        "anthropic",
        "claude-x",
    )
    agent.refresh_from_db()
    assert agent.work_status == "working"

    again = auth_client.post(f"/api/v1/agency/tasks/{task.id}/start-external/")
    assert again.status_code == 409

    res = auth_client.post(
        f"/api/v1/agency/tasks/{task.id}/report-result/",
        {
            "success": True,
            "result": {"pageName": "Contato"},
            "current_files": ["src/pages/Contato.tsx"],
        },
        format="json",
    )
    assert res.status_code == 200 and res.data["progress"] == 1.0
    agent.refresh_from_db()
    assert agent.work_status == "idle"
    # já tem resultado: não aceita um segundo
    dup = auth_client.post(
        f"/api/v1/agency/tasks/{task.id}/report-result/",
        {"success": True, "result": {}},
        format="json",
    )
    assert dup.status_code == 409


@pytest.mark.django_db
def test_report_result_refuses_task_running_inside_django(auth_client, tenant_id):
    agent = AgentFactory(tenant_id=tenant_id, sector=SectorFactory(tenant_id=tenant_id))
    task = Task.objects.create(tenant_id=tenant_id, agent=agent, brief="x", status="in_progress")
    res = auth_client.post(
        f"/api/v1/agency/tasks/{task.id}/report-result/",
        {"success": True, "result": {}},
        format="json",
    )
    assert res.status_code == 409


@pytest.mark.django_db
def test_harness_generate_honors_provider(auth_client, tenant_id, monkeypatch):
    seen = []

    def fake_chat(tenant_id, provider, model, **kw):
        seen.append((provider, model))
        return "```tsx\nexport default function A() { return null; }\n```"

    monkeypatch.setattr("harness.views.chat_completion", fake_chat)
    res = auth_client.post(
        "/api/v1/harness/generate/",
        {"prompt": "uma página", "provider": "anthropic", "model": "claude-x"},
        format="json",
    )
    assert res.status_code == 200, res.data
    assert seen == [("anthropic", "claude-x")]
    bad = auth_client.post(
        "/api/v1/harness/generate/", {"prompt": "x", "provider": "inventado"}, format="json"
    )
    assert bad.status_code == 400


# --- Linha do tempo -------------------------------------------------------------


@pytest.mark.django_db
def test_timeline_collects_day_events(auth_client, tenant_id, monkeypatch):
    monkeypatch.setattr(
        "agency.services.ask_as_agent",
        lambda tenant_id, agent_id, q, **k: {"answer": "resposta"},
    )
    a = SectorFactory(tenant_id=tenant_id, name="A")
    b = SectorFactory(tenant_id=tenant_id, name="B")
    sender = AgentFactory(tenant_id=tenant_id, sector=a)
    SectorOrchestratorFactory(tenant_id=tenant_id, sector=b)
    ceo = CeoAgentFactory(tenant_id=tenant_id)

    record_interaction(sender, "pergunta do dia", "ok", "groq")
    task = Task.objects.create(tenant_id=tenant_id, agent=sender, brief="tarefa")
    task.status = Task.Status.IN_PROGRESS
    task.save()
    task.progress = 0.5
    task.save()  # só progresso: não é evento
    task.progress = 1.0
    task.save()  # terminou (continua in_progress esperando decisão)
    msg = request_cross_sector_message(tenant_id, sender.id, b.id, "oi B")
    relay_message(tenant_id, ceo.id, msg.id)
    PendingApproval.objects.create(
        tenant_id=tenant_id,
        agent=sender,
        function_name="apagar",
        risk="high",
        reason="bloqueado",
    )
    # outro tenant não aparece
    other = AgentFactory(sector=SectorFactory())
    record_interaction(other, "de outro tenant", "x", "groq")

    res = auth_client.get("/api/v1/agency/timeline/")
    assert res.status_code == 200
    kinds = [e["kind"] for e in res.data["events"]]
    assert kinds.count("interaction") == 1
    assert [e["status"] for e in res.data["events"] if e["kind"] == "task_status"] == [
        "created",
        "in_progress",
    ]
    assert kinds.count("task_finished") == 1
    assert "message_created" in kinds and "message_answered" in kinds
    assert "approval_created" in kinds
    ats = [e["at"] for e in res.data["events"]]
    assert ats == sorted(ats)
    assert all("outro tenant" not in e.get("text", "") for e in res.data["events"])


@pytest.mark.django_db
def test_timeline_rejected_message_and_validation(auth_client, tenant_id):
    a = SectorFactory(tenant_id=tenant_id)
    b = SectorFactory(tenant_id=tenant_id)
    sender = AgentFactory(tenant_id=tenant_id, sector=a)
    msg = request_cross_sector_message(tenant_id, sender.id, b.id, "oi")
    with pytest.raises(Exception):
        relay_message(
            tenant_id, AgentFactory(tenant_id=tenant_id, sector=a).id, msg.id
        )  # operacional
    msg.refresh_from_db()
    assert msg.status == SectorMessage.Status.REJECTED and msg.rejected_at is not None

    res = auth_client.get("/api/v1/agency/timeline/")
    assert "message_rejected" in [e["kind"] for e in res.data["events"]]

    assert auth_client.get("/api/v1/agency/timeline/?since=ontem").status_code == 400
    week_ago = (timezone.now() - timedelta(days=8)).isoformat()
    assert auth_client.get("/api/v1/agency/timeline/", {"since": week_ago}).status_code == 400


# --- Mapa de uso das notas ------------------------------------------------------


@pytest.mark.django_db
def test_knowledge_usage_summary_counts_per_document(auth_client, tenant_id):
    agent = AgentFactory(tenant_id=tenant_id, sector=SectorFactory(tenant_id=tenant_id))
    record_interaction(agent, "q1", "a", "groq", source_document_ids=[10, 11])
    record_interaction(agent, "q2", "a", "groq", source_document_ids=[10])
    record_interaction(agent, "q3", "a", "groq")
    old = record_interaction(agent, "q4", "a", "groq", source_document_ids=[12])
    AgentInteraction.objects.filter(id=old.id).update(
        created_at=timezone.now() - timedelta(days=60)
    )
    other = AgentFactory(sector=SectorFactory())
    record_interaction(other, "q", "a", "groq", source_document_ids=[10])

    res = auth_client.get("/api/v1/agency/knowledge-usage/summary/")
    docs = res.data["documents"]
    assert {k: v["count"] for k, v in docs.items()} == {"10": 2, "11": 1, "12": 1}

    recent = auth_client.get("/api/v1/agency/knowledge-usage/summary/?days=30").data["documents"]
    assert set(recent) == {"10", "11"}
    assert auth_client.get("/api/v1/agency/knowledge-usage/summary/?days=x").status_code == 400

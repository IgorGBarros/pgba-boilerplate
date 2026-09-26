# backend_api/Api/tests/integration/test_agency_sector_ai.py
"""
Modelo de IA por setor: Desenvolvimento fixo em Claude ("anthropic"),
demais setores no provedor ativo do tenant (ex: Groq).
"""
from importlib import import_module

import pytest
from django.apps import apps as django_apps

from agency.models import Agent, Sector, Task
from agency.services import ask_as_agent, resolve_agent_llm
from agency.tasks import execute_task
from harness.providers import ProviderConfigError
from tests.factories import AgentFactory, CeoAgentFactory, SectorFactory


@pytest.fixture
def tenant_groq(monkeypatch):
    """Tenant cujo provedor ativo é o Groq (sem depender de credencial no banco)."""
    monkeypatch.setattr("harness.providers.get_active_provider", lambda tenant_id: "groq")


@pytest.mark.django_db
def test_resolution_order_agent_sector_tenant(tenant_id, tenant_groq):
    dev = SectorFactory(
        tenant_id=tenant_id,
        name="Desenvolvimento",
        default_provider="anthropic",
        default_model="claude-sonnet-5",
    )
    comercial = SectorFactory(tenant_id=tenant_id, name="Comercial")

    dev_agent = AgentFactory(tenant_id=tenant_id, sector=dev)
    vendedor = AgentFactory(tenant_id=tenant_id, sector=comercial)
    ceo = CeoAgentFactory(tenant_id=tenant_id)
    excecao = AgentFactory(
        tenant_id=tenant_id,
        sector=dev,
        default_provider="openrouter",
        default_model="moonshotai/kimi-k2",
    )

    assert resolve_agent_llm(dev_agent) == ("anthropic", "claude-sonnet-5")
    assert resolve_agent_llm(vendedor) == ("groq", None)
    assert resolve_agent_llm(ceo) == ("groq", None)  # sem setor → tenant
    assert resolve_agent_llm(excecao) == ("openrouter", "moonshotai/kimi-k2")  # agente > setor


@pytest.mark.django_db
def test_ask_as_agent_uses_sector_provider(tenant_id, tenant_groq, monkeypatch):
    calls = []

    def fake_answer(tenant_id, question, **kw):
        calls.append((kw.get("provider"), kw.get("model")))
        return {"answer": "ok", "function_called": None, "sources": [], "status": "ok"}

    monkeypatch.setattr("orchestration.services.answer_question", fake_answer)
    dev = SectorFactory(tenant_id=tenant_id, name="Desenvolvimento", default_provider="anthropic")
    comercial = SectorFactory(tenant_id=tenant_id, name="Comercial")

    ask_as_agent(tenant_id, AgentFactory(tenant_id=tenant_id, sector=dev).id, "pergunta")
    ask_as_agent(tenant_id, AgentFactory(tenant_id=tenant_id, sector=comercial).id, "pergunta")

    assert calls == [("anthropic", None), ("groq", None)]


@pytest.mark.django_db
def test_dev_sector_never_falls_back_to_groq(tenant_id, tenant_groq, settings, monkeypatch):
    """Sem credencial da Anthropic, a tarefa do setor de Dev falha explícita — não roda no Groq."""
    settings.ANTHROPIC_API_KEY = ""
    groq_calls = []
    real_openai = "harness.providers._chat_openai_compatible"
    monkeypatch.setattr(real_openai, lambda *a, **k: groq_calls.append(a) or "{}")

    dev = SectorFactory(tenant_id=tenant_id, name="Desenvolvimento", default_provider="anthropic")
    agent = AgentFactory(tenant_id=tenant_id, sector=dev)
    task = Task.objects.create(tenant_id=tenant_id, agent=agent, brief="Criar endpoint")

    with pytest.raises(ProviderConfigError, match="anthropic"):
        execute_task(tenant_id, task.id)

    task.refresh_from_db()
    agent.refresh_from_db()
    assert task.status == Task.Status.REJECTED
    assert "anthropic" in task.result["error"]
    assert agent.work_status == Agent.WorkStatus.IDLE
    assert groq_calls == []


@pytest.mark.django_db
def test_data_migration_sets_only_dev_sector(tenant_id):
    dev = SectorFactory(tenant_id=tenant_id, name="Desenvolvimento")
    escolhido = SectorFactory(
        tenant_id=tenant_id,
        name="desenvolvimento-legado",
        default_provider="openai",
    )
    comercial = SectorFactory(tenant_id=tenant_id, name="Comercial")

    import_module("agency.migrations.0011_desenvolvimento_usa_claude").forwards(django_apps, None)

    assert Sector.objects.get(id=dev.id).default_provider == "anthropic"
    assert Sector.objects.get(id=escolhido.id).default_provider == "openai"  # nunca sobrescreve
    assert Sector.objects.get(id=comercial.id).default_provider == ""


@pytest.mark.django_db
def test_sector_api_rejects_unknown_provider(auth_client, tenant_id):
    s = SectorFactory(tenant_id=tenant_id, name="Comercial")
    url = f"/api/v1/agency/sectors/{s.id}/"
    bad = auth_client.patch(url, {"default_provider": "inventado"}, format="json")
    assert bad.status_code == 400
    res = auth_client.patch(url, {"default_provider": "anthropic"}, format="json")
    assert res.status_code == 200 and res.data["default_provider"] == "anthropic"


@pytest.mark.django_db
def test_sector_api_exposes_knowledge_source_name(auth_client, tenant_id):
    from ingestion.models import KnowledgeSource

    ks = KnowledgeSource.objects.create(
        tenant_id=tenant_id, name="Vault Dev", source_type="obsidian"
    )
    s = SectorFactory(tenant_id=tenant_id, name="Desenvolvimento", knowledge_source=ks)
    res = auth_client.get(f"/api/v1/agency/sectors/{s.id}/")
    assert res.data["knowledge_source_name"] == "Vault Dev"

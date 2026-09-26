# backend_api/Api/tests/integration/test_daily_summary.py
"""Resumo do dia pelo CEO: só fatos registrados, citações conferidas, salvo no Cérebro."""
from unittest.mock import patch

import pytest

from agency.models import AgentInteraction, PendingApproval, Task
from agency.services import record_interaction, request_cross_sector_message
from harness.providers import ProviderConfigError
from tests.factories import AgentFactory, CeoAgentFactory, SectorFactory


@pytest.fixture
def tenant_groq(monkeypatch):
    monkeypatch.setattr("harness.providers.get_active_provider", lambda tenant_id: "groq")


def _day_with_events(tenant_id):
    vendas = SectorFactory(tenant_id=tenant_id, name="Vendas")
    juridico = SectorFactory(tenant_id=tenant_id, name="Jurídico")
    ana = AgentFactory(tenant_id=tenant_id, sector=vendas, name="Ana")
    record_interaction(ana, "qual a meta?", "100", "groq")
    Task.objects.create(tenant_id=tenant_id, agent=ana, brief="Montar proposta Acme")
    request_cross_sector_message(tenant_id, ana.id, juridico.id, "Contrato Acme ok?")
    PendingApproval.objects.create(
        tenant_id=tenant_id,
        agent=ana,
        function_name="dar_desconto",
        risk="high",
        reason="acima da alçada",
    )
    return CeoAgentFactory(tenant_id=tenant_id, name="Clara CEO")


@pytest.mark.django_db
def test_summary_uses_only_facts_and_strips_invented_citations(auth_client, tenant_id, tenant_groq):
    ceo = _day_with_events(tenant_id)
    seen = {}

    def fake_chat(tenant_id, provider, model, messages, **kw):
        seen["prompt"] = messages[1]["content"]
        return (
            "## O que foi feito\nAna montou a proposta [E3]. Algo inventado [E99].\n"
            "## Pendências para decidir\nDesconto [E6]."
        )

    with patch("harness.providers.chat_completion", side_effect=fake_chat):
        res = auth_client.post("/api/v1/agency/daily-summary/", {}, format="json")

    assert res.status_code == 200, res.data
    facts = {f["id"]: f["text"] for f in res.data["facts"]}
    assert any("Montar proposta Acme" in t for t in facts.values())
    assert any("Contrato Acme ok?" in t for t in facts.values())
    assert any("dar_desconto" in t and "Pendente agora" in t for t in facts.values())
    assert "[E99]" not in res.data["summary"] and res.data["invalid_citations"] == ["E99"]
    assert "E3" in res.data["cited"]
    assert res.data["author"] == "Clara CEO"
    assert "FATOS" in seen["prompt"] and "[E1]" in seen["prompt"]
    # o custo do resumo entra na conta do CEO
    assert AgentInteraction.objects.filter(agent=ceo, question__startswith="Resumo do dia").exists()


@pytest.mark.django_db
def test_summary_without_events_does_not_call_model(auth_client, tenant_id, tenant_groq):
    with patch("harness.providers.chat_completion") as chat:
        res = auth_client.post("/api/v1/agency/daily-summary/", {}, format="json")
    assert res.status_code == 200
    assert chat.call_count == 0
    assert res.data["facts"] == [] and "Nada registrado" in res.data["summary"]


@pytest.mark.django_db
def test_summary_reports_unconfigured_ai(auth_client, tenant_id, tenant_groq):
    _day_with_events(tenant_id)
    with patch("harness.providers.chat_completion", side_effect=ProviderConfigError("sem chave")):
        res = auth_client.post("/api/v1/agency/daily-summary/", {}, format="json")
    assert res.status_code == 502 and "sem chave" in res.data["detail"]


@pytest.mark.django_db
def test_save_summary_creates_brain_note_once_per_day(auth_client, tenant_id):
    from ingestion.models import Document, KnowledgeSource

    with patch("ingestion.tasks.process_document_task.delay") as delay:
        body = {
            "markdown": "## O que foi feito\nTudo [E1].",
            "facts": [{"id": "E1", "text": "fato"}],
            "day": "2026-09-25T12:00:00",
        }
        first = auth_client.post("/api/v1/agency/daily-summary/save/", body, format="json")
        again = auth_client.post("/api/v1/agency/daily-summary/save/", body, format="json")
    assert first.status_code == 201 and first.data["indexing_queued"] is True
    assert first.data["document_id"] == again.data["document_id"]  # mesmo dia substitui
    doc = Document.objects.get(id=first.data["document_id"])
    assert doc.tenant_id == tenant_id and doc.title == "Resumo do dia 25/09/2026"
    assert "[E1] fato" in doc.content
    assert KnowledgeSource.objects.get(id=doc.source_id).source_type == "manual"
    assert delay.call_count == 2
    assert (
        auth_client.post(
            "/api/v1/agency/daily-summary/save/", {"markdown": ""}, format="json"
        ).status_code
        == 400
    )

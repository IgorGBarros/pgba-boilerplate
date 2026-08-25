# backend_api/Api/tests/integration/test_agency_hierarchy.py
"""
Prova de que a hierarquia (CEO -> Orquestrador-Geral -> Orquestrador de
Setor -> Operacional) e a comunicação mediada entre setores funcionam
como especificado. Requer Postgres real (pgvector) para rodar de fato —
ver docs/DEPLOY.md — mas está pronto para o CI assim que houver um banco
disponível.
"""
import pytest

from agency.models import SectorMessage, Agent
from agency.services import (
    request_cross_sector_message,
    relay_message,
    AccessDeniedError,
    _rag_scope_for,
)
from tests.factories import (
    SectorFactory,
    AgentFactory,
    SectorOrchestratorFactory,
    CeoAgentFactory,
)


@pytest.mark.django_db
def test_operational_agent_cannot_relay(tenant_id):
    juridico = SectorFactory(tenant_id=tenant_id, name="Jurídico")
    financeiro = SectorFactory(tenant_id=tenant_id, name="Financeiro")
    operacional = AgentFactory(tenant_id=tenant_id, sector=juridico, access_level=Agent.AccessLevel.OPERATIONAL)

    message = request_cross_sector_message(
        tenant_id=tenant_id, from_agent_id=operacional.id, to_sector_id=financeiro.id,
        content="Preciso do relatório de despesas do trimestre.",
    )
    assert message.status == SectorMessage.Status.PENDING

    with pytest.raises(AccessDeniedError):
        relay_message(tenant_id=tenant_id, relaying_agent_id=operacional.id, message_id=message.id)

    message.refresh_from_db()
    assert message.status == SectorMessage.Status.REJECTED


@pytest.mark.django_db
def test_sector_orchestrator_cannot_relay_unrelated_sectors(tenant_id):
    juridico = SectorFactory(tenant_id=tenant_id, name="Jurídico")
    financeiro = SectorFactory(tenant_id=tenant_id, name="Financeiro")
    devops = SectorFactory(tenant_id=tenant_id, name="DevOps")

    origem = AgentFactory(tenant_id=tenant_id, sector=juridico)
    orq_devops = SectorOrchestratorFactory(tenant_id=tenant_id, sector=devops)  # não envolvido na mensagem

    message = request_cross_sector_message(
        tenant_id=tenant_id, from_agent_id=origem.id, to_sector_id=financeiro.id, content="Pergunta X",
    )

    with pytest.raises(AccessDeniedError):
        relay_message(tenant_id=tenant_id, relaying_agent_id=orq_devops.id, message_id=message.id)


@pytest.mark.django_db
def test_ceo_can_relay_any_pair_of_sectors(tenant_id, monkeypatch):
    juridico = SectorFactory(tenant_id=tenant_id, name="Jurídico")
    financeiro = SectorFactory(tenant_id=tenant_id, name="Financeiro")

    origem = AgentFactory(tenant_id=tenant_id, sector=juridico)
    resposta_agente = AgentFactory(tenant_id=tenant_id, sector=financeiro)
    ceo = CeoAgentFactory(tenant_id=tenant_id)

    message = request_cross_sector_message(
        tenant_id=tenant_id, from_agent_id=origem.id, to_sector_id=financeiro.id, content="Pergunta Y",
    )

    # Mocka a chamada de IA de verdade (ask_as_agent -> orchestration.answer_question)
    monkeypatch.setattr(
        "agency.services.ask_as_agent",
        lambda tenant_id, agent_id, question, use_rag_context=True: {
            "answer": "resposta simulada", "function_called": None, "sources": [], "status": "ok",
        },
    )

    result = relay_message(
        tenant_id=tenant_id, relaying_agent_id=ceo.id, message_id=message.id,
        answering_agent_id=resposta_agente.id,
    )

    assert result.status == SectorMessage.Status.ANSWERED
    assert result.response == "resposta simulada"
    assert result.relayed_by_id == ceo.id


@pytest.mark.django_db
def test_rag_scope_never_leaks_across_sectors():
    """Sem tocar no banco: prova que _rag_scope_for nunca devolve None (acesso irrestrito) para agente comum."""
    juridico = SectorFactory.build(name="Jurídico")
    juridico.pk = 1
    juridico.knowledge_source_id = 99

    operacional = AgentFactory.build(sector=juridico, access_level=Agent.AccessLevel.OPERATIONAL)
    assert _rag_scope_for(operacional) == [99]

    ceo = CeoAgentFactory.build()
    assert _rag_scope_for(ceo) is None  # único caso em que None (irrestrito) é aceitável

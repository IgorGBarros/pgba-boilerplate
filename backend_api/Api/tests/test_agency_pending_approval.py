# backend_api/Api/tests/integration/test_agency_pending_approval.py
"""
Testa o fluxo completo de human-in-the-loop (§12 do documento "Agentic
Enterprise OS"): uma ação de risco alto fica congelada em PendingApproval
até um humano decidir — e só EXECUTA DE VERDADE se aprovada.

Registra uma função real no orchestration.registry (nunca mocka a
execução em si) para provar que decide_pending_approval() realmente roda
o código, não só muda um status.
"""
import pytest

from agency.models import Agent, PendingApproval
from agency.services import decide_pending_approval
from orchestration import registry
from tests.factories import AgentFactory, UserFactory


@pytest.fixture
def registered_risky_function():
    """Registra (e depois remove) uma função de risco 'high' real, só para este teste."""
    calls = []

    @registry.register_query_function(
        name="test_cancelar_pedido", description="Cancela um pedido (teste).",
        parameters={"pedido_id": "int"}, risk="high",
    )
    def _cancelar_pedido(tenant_id, pedido_id: int) -> dict:
        calls.append((tenant_id, pedido_id))
        return {"pedido_id": pedido_id, "status": "cancelado"}

    yield calls

    registry._REGISTRY.pop("test_cancelar_pedido", None)


@pytest.mark.django_db
def test_approving_pending_action_actually_executes_it(tenant_id, registered_risky_function):
    agent = AgentFactory(tenant_id=tenant_id, autonomy_level=Agent.AutonomyLevel.SUPERVISED_EXECUTOR)
    approver = UserFactory(tenant_id=tenant_id)

    pending = PendingApproval.objects.create(
        tenant_id=tenant_id, agent=agent, function_name="test_cancelar_pedido",
        params={"pedido_id": 42}, risk="high", reason="Requer aprovação — risco alto.",
    )

    decided = decide_pending_approval(tenant_id, pending.id, approved=True, decided_by=approver)

    assert decided.status == PendingApproval.Status.APPROVED
    assert decided.decided_by_id == approver.id
    assert decided.decided_at is not None
    assert decided.result == {"pedido_id": 42, "status": "cancelado"}
    # A prova real: a função registrada foi de fato chamada, não só o status mudou.
    assert registered_risky_function == [(tenant_id, 42)]


@pytest.mark.django_db
def test_rejecting_pending_action_never_executes_it(tenant_id, registered_risky_function):
    agent = AgentFactory(tenant_id=tenant_id, autonomy_level=Agent.AutonomyLevel.SUPERVISED_EXECUTOR)
    approver = UserFactory(tenant_id=tenant_id)

    pending = PendingApproval.objects.create(
        tenant_id=tenant_id, agent=agent, function_name="test_cancelar_pedido",
        params={"pedido_id": 99}, risk="high", reason="Requer aprovação.",
    )

    decided = decide_pending_approval(tenant_id, pending.id, approved=False, decided_by=approver)

    assert decided.status == PendingApproval.Status.REJECTED
    assert decided.result is None
    assert registered_risky_function == [], "função nunca deveria ter sido chamada"


@pytest.mark.django_db
def test_cannot_decide_the_same_approval_twice(tenant_id, registered_risky_function):
    agent = AgentFactory(tenant_id=tenant_id)
    pending = PendingApproval.objects.create(
        tenant_id=tenant_id, agent=agent, function_name="test_cancelar_pedido",
        params={"pedido_id": 1}, risk="high", reason="teste",
    )
    decide_pending_approval(tenant_id, pending.id, approved=True)

    with pytest.raises(ValueError, match="já foi decidida"):
        decide_pending_approval(tenant_id, pending.id, approved=True)

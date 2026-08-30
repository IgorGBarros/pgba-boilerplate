# backend_api/Api/tests/unit/test_agency_policy.py
"""
Testa o policy engine (agency/policy.py) isoladamente — sem precisar de
LLM real, já que evaluate_policy() só depende de autonomy_level + risk +
PolicyRule, tudo puramente Django ORM.
"""
import pytest

from agency.models import Agent
from agency.policy import evaluate_policy
from tests.factories import AgentFactory, SectorFactory


@pytest.mark.django_db
class TestEvaluatePolicy:
    def test_observer_can_do_low_risk(self):
        agent = AgentFactory(autonomy_level=Agent.AutonomyLevel.OBSERVER)
        decision = evaluate_policy(agent, "low")
        assert decision.allowed is True

    def test_observer_blocked_on_medium_risk(self):
        agent = AgentFactory(autonomy_level=Agent.AutonomyLevel.OBSERVER)
        decision = evaluate_policy(agent, "medium")
        assert decision.allowed is False
        assert "aprovação" in decision.reason.lower()

    def test_recommender_blocked_on_high_risk(self):
        agent = AgentFactory(autonomy_level=Agent.AutonomyLevel.RECOMMENDER)
        decision = evaluate_policy(agent, "high")
        assert decision.allowed is False

    def test_supervised_executor_blocked_without_explicit_rule(self):
        agent = AgentFactory(autonomy_level=Agent.AutonomyLevel.SUPERVISED_EXECUTOR)
        decision = evaluate_policy(agent, "medium")
        assert decision.allowed is False

    def test_policy_executor_blocked_on_critical_even_with_rule(self, tenant_id):
        sector = SectorFactory(tenant_id=tenant_id)
        agent = AgentFactory(tenant_id=tenant_id, sector=sector, autonomy_level=Agent.AutonomyLevel.POLICY_EXECUTOR)
        from agency.models import PolicyRule

        PolicyRule.objects.create(tenant_id=tenant_id, risk="critical", min_autonomy_level=Agent.AutonomyLevel.POLICY_EXECUTOR)
        decision = evaluate_policy(agent, "critical")
        assert decision.allowed is False, "critical nunca é liberado para POLICY_EXECUTOR, nem com regra"

    def test_policy_executor_allowed_on_medium_with_matching_rule(self, tenant_id):
        sector = SectorFactory(tenant_id=tenant_id)
        agent = AgentFactory(tenant_id=tenant_id, sector=sector, autonomy_level=Agent.AutonomyLevel.POLICY_EXECUTOR)
        from agency.models import PolicyRule

        PolicyRule.objects.create(
            tenant_id=tenant_id, sector=sector, risk="medium", min_autonomy_level=Agent.AutonomyLevel.POLICY_EXECUTOR,
        )
        decision = evaluate_policy(agent, "medium")
        assert decision.allowed is True

    def test_policy_executor_blocked_on_medium_without_rule(self, tenant_id):
        sector = SectorFactory(tenant_id=tenant_id)
        agent = AgentFactory(tenant_id=tenant_id, sector=sector, autonomy_level=Agent.AutonomyLevel.POLICY_EXECUTOR)
        decision = evaluate_policy(agent, "medium")
        assert decision.allowed is False

    def test_autonomous_allowed_on_critical_with_rule(self, tenant_id):
        sector = SectorFactory(tenant_id=tenant_id)
        agent = AgentFactory(tenant_id=tenant_id, sector=sector, autonomy_level=Agent.AutonomyLevel.AUTONOMOUS)
        from agency.models import PolicyRule

        PolicyRule.objects.create(
            tenant_id=tenant_id, sector=sector, risk="critical", min_autonomy_level=Agent.AutonomyLevel.AUTONOMOUS,
        )
        decision = evaluate_policy(agent, "critical")
        assert decision.allowed is True

    def test_autonomous_blocked_on_critical_without_rule(self, tenant_id):
        agent = AgentFactory(tenant_id=tenant_id, autonomy_level=Agent.AutonomyLevel.AUTONOMOUS)
        decision = evaluate_policy(agent, "critical")
        assert decision.allowed is False

    def test_tenant_wide_rule_applies_to_agent_without_sector(self, tenant_id):
        """PolicyRule com sector=None vale pro tenant inteiro, inclusive
        agentes sem setor (CEO/Orquestrador-Geral — únicos access_level
        que a constraint do banco permite sem sector)."""
        agent = AgentFactory(
            tenant_id=tenant_id, sector=None, access_level="general_orchestrator",
            autonomy_level=Agent.AutonomyLevel.POLICY_EXECUTOR,
        )
        from agency.models import PolicyRule

        PolicyRule.objects.create(tenant_id=tenant_id, sector=None, risk="high", min_autonomy_level=Agent.AutonomyLevel.POLICY_EXECUTOR)
        decision = evaluate_policy(agent, "high")
        assert decision.allowed is True

    def test_rule_from_another_sector_does_not_leak(self, tenant_id):
        """Uma PolicyRule presa a um setor específico não libera agente de outro setor."""
        sector_a = SectorFactory(tenant_id=tenant_id, name="Financeiro")
        sector_b = SectorFactory(tenant_id=tenant_id, name="Comercial")
        agent_b = AgentFactory(tenant_id=tenant_id, sector=sector_b, autonomy_level=Agent.AutonomyLevel.POLICY_EXECUTOR)
        from agency.models import PolicyRule

        PolicyRule.objects.create(tenant_id=tenant_id, sector=sector_a, risk="medium", min_autonomy_level=Agent.AutonomyLevel.POLICY_EXECUTOR)
        decision = evaluate_policy(agent_b, "medium")
        assert decision.allowed is False

    def test_inactive_rule_does_not_apply(self, tenant_id):
        sector = SectorFactory(tenant_id=tenant_id)
        agent = AgentFactory(tenant_id=tenant_id, sector=sector, autonomy_level=Agent.AutonomyLevel.POLICY_EXECUTOR)
        from agency.models import PolicyRule

        PolicyRule.objects.create(
            tenant_id=tenant_id, sector=sector, risk="medium",
            min_autonomy_level=Agent.AutonomyLevel.POLICY_EXECUTOR, is_active=False,
        )
        decision = evaluate_policy(agent, "medium")
        assert decision.allowed is False

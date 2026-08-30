# backend_api/Api/agency/policy.py
"""
Policy Engine (documento "Agentic Enterprise OS", §12-13, §50).

Regra geral, direto da seção 6 do documento — cada nível de autonomia
define um teto de risco que o agente pode executar sozinho:

    OBSERVER (0)              -> só risco "low"; nunca executa nada além disso
    RECOMMENDER (1)           -> só risco "low" sozinho; acima disso, aprovação
    SUPERVISED_EXECUTOR (2)   -> só risco "low" sozinho; acima disso, aprovação
    POLICY_EXECUTOR (3)       -> "low"/"medium"/"high" liberado SE uma
                                  PolicyRule ativa cobrir; "critical" sempre
                                  exige aprovação, mesmo com regra
    AUTONOMOUS (4)            -> qualquer risco liberado SE uma PolicyRule
                                  ativa cobrir, incluindo "critical"

Nunca hardcoda "este agente pode fazer X" — a régua é sempre
autonomy_level (do Agent) + risk (da função) + PolicyRule (configurável
por tenant/setor). Ver agency/models.py::PolicyRule para o porquê disso
ser um model, não uma constante no código.
"""
from __future__ import annotations

from dataclasses import dataclass

from agency.models import Agent, PolicyRule

_RISK_RANK = {"low": 0, "medium": 1, "high": 2, "critical": 3}


@dataclass
class PolicyDecision:
    allowed: bool
    reason: str


def _policy_rule_allows(tenant_id, sector_id, risk: str, autonomy_level: int) -> bool:
    """
    Existe uma PolicyRule ativa (do setor específico OU do tenant inteiro)
    cobrindo esse risco, com min_autonomy_level <= o nível do agente?
    """
    from django.db.models import Q

    rules = PolicyRule.objects.filter(tenant_id=tenant_id, risk=risk, is_active=True)
    if sector_id:
        rules = rules.filter(Q(sector_id=sector_id) | Q(sector__isnull=True))
    else:
        rules = rules.filter(sector__isnull=True)
    return rules.filter(min_autonomy_level__lte=autonomy_level).exists()


def evaluate_policy(agent: Agent, risk: str) -> PolicyDecision:
    """
    Decide se `agent` pode executar sozinho uma ação classificada com
    `risk` (orchestration.registry.RISK_LEVELS). Nunca lança exceção —
    risco desconhecido é tratado como "critical" (mais restritivo), nunca
    "low" (menos restritivo é o lado errado pra falhar).
    """
    risk_rank = _RISK_RANK.get(risk, _RISK_RANK["critical"])
    level = agent.autonomy_level

    if risk_rank == 0:  # low: todo nível de autonomia pode, inclusive OBSERVER
        return PolicyDecision(True, "")

    if level in (
        Agent.AutonomyLevel.OBSERVER,
        Agent.AutonomyLevel.RECOMMENDER,
        Agent.AutonomyLevel.SUPERVISED_EXECUTOR,
    ):
        return PolicyDecision(
            False,
            f"Agente com autonomia '{agent.get_autonomy_level_display()}' não executa ações de "
            f"risco '{risk}' sem aprovação humana.",
        )

    if level == Agent.AutonomyLevel.POLICY_EXECUTOR:
        if risk == "critical":
            return PolicyDecision(
                False, "Risco 'critical' sempre exige aprovação humana, mesmo em Executor por Política."
            )
        if _policy_rule_allows(agent.tenant_id, agent.sector_id, risk, level):
            return PolicyDecision(True, "")
        return PolicyDecision(False, f"Nenhuma PolicyRule ativa libera risco '{risk}' para este setor/tenant.")

    if level == Agent.AutonomyLevel.AUTONOMOUS:
        if _policy_rule_allows(agent.tenant_id, agent.sector_id, risk, level):
            return PolicyDecision(True, "")
        return PolicyDecision(False, f"Nenhuma PolicyRule ativa libera risco '{risk}' (nem em modo Autônomo).")

    return PolicyDecision(False, "Nível de autonomia desconhecido — negado por padrão.")


def make_policy_check(agent: Agent):
    """
    Monta o callback (function_name, risk) -> (bool, str) que
    orchestration.answer_question(policy_check=...) espera — é o único
    ponto de contato entre agency (que sabe o que é autonomia) e
    orchestration (que não sabe e não deveria saber).
    """

    def _check(function_name: str, risk: str) -> tuple[bool, str]:
        decision = evaluate_policy(agent, risk)
        return decision.allowed, decision.reason

    return _check

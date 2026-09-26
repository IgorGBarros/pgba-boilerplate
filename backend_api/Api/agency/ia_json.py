# backend_api/Api/agency/ia_json.py
"""
Um agente responde em JSON — o caminho comum de qualquer vertical que pede a
um agente uma saída estruturada (marketing, TI...). Sempre pelo harness:
IA do agente (`resolve_agent_llm`), `chat_completion` em modo JSON,
`extract_json` + `validate_schema` e custo em `record_interaction`. O agente
aparece "trabalhando" durante a chamada e sempre volta a ocioso.

Saída fora do formato é `SaidaInvalida` — nunca "aproveitada na confiança".
"""
from __future__ import annotations

import logging

from agency.models import Agent
from harness.guardrails import extract_json, validate_schema

logger = logging.getLogger(__name__)


class SaidaInvalida(Exception):
    pass


def marcar_trabalhando(agent: Agent, working: bool, tarefa: str = "") -> None:
    from agency.realtime import broadcast_agent_update

    agent.work_status = Agent.WorkStatus.WORKING if working else Agent.WorkStatus.IDLE
    agent.current_task = tarefa[:255] if working else ""
    agent.save(update_fields=["work_status", "current_task"])
    broadcast_agent_update(agent)


def executar(
    agent: Agent,
    tarefa: str,
    sistema: str,
    usuario: str,
    esquema: dict,
    doc_ids=None,
    temperatura: float = 0.6,
    task=None,
) -> dict:
    from agency.services import record_interaction, resolve_agent_llm
    from harness.providers import chat_completion, track_usage

    provider, model = resolve_agent_llm(agent)
    instrucoes = f"\n\nSuas instruções:\n{agent.instructions[:3000]}" if agent.instructions else ""
    marcar_trabalhando(agent, True, tarefa)
    try:
        with track_usage() as usage:
            bruto = chat_completion(
                agent.tenant_id,
                provider,
                model,
                messages=[
                    {"role": "system", "content": sistema + instrucoes},
                    {"role": "user", "content": usuario},
                ],
                temperature=temperatura,
                json_mode=True,
            )
        record_interaction(
            agent,
            tarefa,
            bruto[:4000],
            provider,
            model,
            source_document_ids=doc_ids or [],
            task=task,
            usage=usage,
        )
    finally:
        marcar_trabalhando(agent, False)
    try:
        data = extract_json(bruto)
        validate_schema(data, esquema)
    except ValueError as exc:
        logger.warning("Saída do agente fora do formato (%s): %s", tarefa, exc)
        raise SaidaInvalida("A IA respondeu fora do formato combinado — tente de novo.") from exc
    return data

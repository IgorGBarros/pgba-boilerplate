# backend_api/Api/orchestration/services.py
"""
Pipeline de resposta a perguntas sobre dado estruturado.

Fluxo (cada etapa é auditada em QueryLog):
  1. `router.route()` escolhe a categoria/modelo.
  2. O LLM recebe o CATÁLOGO de funções permitidas (orchestration.registry)
     e escolhe uma, respondendo em JSON estrito (validado por
     `harness.guardrails`) — nunca gera SQL.
  3. `registry.execute()` roda a função de verdade, com tenant_id vindo do
     código Python (nunca do LLM).
  4. O resultado (dado estruturado) + contexto de RAG (opcional, via
     `ingestion.semantic_search`) viram o prompt final. Se NENHUM dos dois
     existir, o guardrail de grounding bloqueia a geração — a IA nunca
     "tenta mesmo assim" sem nenhuma base real.

Toda chamada de modelo passa por `harness.providers.chat_completion`, que
resolve a credencial (tenant > global > .env) — nunca montamos requisição
HTTP a provedor de IA aqui diretamente.

Princípio GenAI4EU / human-centric aplicado aqui: a IA nunca age sozinha
sobre dado sensível sem que a consulta passe por uma função pré-aprovada
por humano (quem escreveu a função definiu o que é seguro expor). Decisões
de negócio de maior impacto continuam exigindo revisão humana explícita —
este pipeline responde perguntas, não executa ações.
"""
from __future__ import annotations

import json
import logging
import time

from django.conf import settings

from harness.guardrails import extract_json, validate_schema, require_grounded_context, GroundingError, NoAnswer
from harness.providers import chat_completion, ProviderConfigError
from orchestration import registry, router
from orchestration.models import QueryLog

logger = logging.getLogger(__name__)


class OrchestrationError(Exception):
    pass


def _select_function(tenant_id, question: str, provider: str, model: str) -> tuple[str | None, dict]:
    """Pede ao LLM para escolher uma função do catálogo, em JSON validado."""
    catalog = registry.catalog_for_prompt()
    prompt = f"""Você escolhe qual função usar para responder a pergunta abaixo.
Responda SOMENTE em JSON no formato:
{{"function": "<nome_da_funcao_ou_null>", "params": {{}}}}

Use "function": null se nenhuma função do catálogo servir para a pergunta.

FUNÇÕES DISPONÍVEIS:
{catalog}

PERGUNTA: {question}
"""
    try:
        raw = chat_completion(
            tenant_id, provider, model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1, json_mode=True,
        )
    except ProviderConfigError as exc:
        raise OrchestrationError(f"Falha ao consultar o modelo: {exc}") from exc

    try:
        data = extract_json(raw)
        validate_schema(data, {"function": (str, type(None)), "params": dict})
    except ValueError as exc:
        raise OrchestrationError(f"Saída do modelo fora do formato esperado: {exc}") from exc

    return data.get("function"), data.get("params") or {}


def answer_question(
    tenant_id, question: str, user=None, use_rag_context: bool = True,
    rag_source_ids: list[int] | None = None,
    policy_check=None,
) -> dict:
    """
    Ponto de entrada único do módulo. Retorna:
        {"answer": str, "function_called": str|None, "sources": [...], "status": str}
    Nunca levanta exceção para o chamador — erros viram um `status` no log
    e uma resposta amigável, para nunca quebrar a UI por falha do LLM.

    `rag_source_ids`: repassado a `ingestion.semantic_search` — permite a
    uma vertical (ex: `agency`) restringir de quais KnowledgeSource(s) o
    contexto de RAG pode vir, sem o `orchestration` precisar saber nada
    sobre o conceito de "setor" da vertical.

    `policy_check`: callback opcional `(function_name, risk) -> (bool, str)`
    — chamado logo antes de `registry.execute()`. Se retornar `(False, motivo)`,
    a função NÃO é executada e a resposta volta com `status="pending_approval"`.
    Este módulo não sabe o que o callback verifica (nível de autonomia, regra
    de negócio, o que for) — quem decide isso é `agency.policy`, nunca aqui.
    Mantém a regra de dependência: vertical conhece core, nunca o contrário.
    """
    if not tenant_id:
        raise ValueError("answer_question requer tenant_id explícito.")

    start = time.monotonic()
    category, model_config = router.route(question)
    provider = getattr(settings, "CHAT_PROVIDER", "ollama")
    model = model_config.get("model", "")

    log = QueryLog(
        tenant_id=tenant_id, user=user, question=question,
        model_category=category, model_name=model,
    )

    try:
        function_name, params = _select_function(tenant_id, question, provider, model)
    except OrchestrationError as exc:
        log.status = QueryLog.Status.LLM_ERROR
        log.error_message = str(exc)
        _finish(log, start)
        return {
            "answer": "Não consegui processar sua pergunta agora. Tente novamente em instantes.",
            "function_called": None, "sources": [], "status": log.status,
        }

    function_result: dict = {}
    if function_name:
        fn = registry.get_function(function_name)
        if fn and policy_check:
            allowed, reason = policy_check(function_name, fn.risk)
            if not allowed:
                log.status = QueryLog.Status.PENDING_APPROVAL
                log.function_called = function_name
                log.function_params = params
                log.error_message = reason
                _finish(log, start)
                return {
                    "answer": f"Essa ação precisa de aprovação humana antes de executar: {reason}",
                    "function_called": function_name, "sources": [], "status": log.status,
                    "pending_function_params": params,
                }
        try:
            function_result = registry.execute(function_name, tenant_id, params)
            log.function_called = function_name
            log.function_params = params
            log.function_result = function_result
        except (LookupError, ValueError) as exc:
            log.status = QueryLog.Status.FUNCTION_ERROR
            log.error_message = str(exc)
            _finish(log, start)
            return {
                "answer": "Não encontrei uma forma segura de responder essa pergunta com os dados disponíveis.",
                "function_called": function_name, "sources": [], "status": log.status,
            }

    rag_context = ""
    rag_sources: list[dict] = []
    if use_rag_context:
        try:
            from ingestion.services import semantic_search, build_context_prompt

            chunks = semantic_search(question, tenant_id=tenant_id, top_k=3, source_ids=rag_source_ids)
            rag_context = build_context_prompt(chunks)
            rag_sources = [{"document": c.document_title, "source": c.source_name} for c in chunks]
        except Exception as exc:  # RAG é opcional: nunca derruba a resposta
            logger.info("RAG indisponível para orchestration: %s", exc)

    # Guardrail: sem função executada E sem contexto de RAG, não há base
    # nenhuma para responder — recusar explicitamente em vez de arriscar.
    combined_context = json.dumps(function_result, ensure_ascii=False) if function_result else ""
    combined_context = f"{combined_context}\n{rag_context}".strip()
    try:
        require_grounded_context(combined_context, min_length=5)
    except GroundingError:
        log.status = QueryLog.Status.REJECTED
        log.answer = NoAnswer.TEXT
        _finish(log, start)
        return {
            "answer": NoAnswer.TEXT,
            "function_called": function_name, "sources": rag_sources, "status": log.status,
        }

    final_prompt = f"""Responda a pergunta em português, de forma direta e amigável,
usando SOMENTE as informações abaixo. Se não houver dado suficiente, diga isso
claramente em vez de inventar.

DADO ESTRUTURADO (resultado de consulta ao banco):
{json.dumps(function_result, ensure_ascii=False) if function_result else "(nenhum)"}

CONTEXTO ADICIONAL (base de conhecimento):
{rag_context or "(nenhum)"}

PERGUNTA: {question}
"""
    try:
        answer_text = chat_completion(
            tenant_id, provider, model,
            messages=[{"role": "user", "content": final_prompt}],
            temperature=model_config.get("temperature", 0.3),
        )
    except ProviderConfigError as exc:
        log.status = QueryLog.Status.LLM_ERROR
        log.error_message = str(exc)
        _finish(log, start)
        return {
            "answer": "Encontrei o dado, mas não consegui gerar o texto da resposta agora.",
            "function_called": function_name, "sources": rag_sources, "status": log.status,
        }

    log.answer = answer_text
    log.status = QueryLog.Status.OK
    _finish(log, start)

    return {
        "answer": answer_text,
        "function_called": function_name, "sources": rag_sources, "status": log.status,
    }


def _finish(log: QueryLog, start: float) -> None:
    log.latency_ms = int((time.monotonic() - start) * 1000)
    log.save()

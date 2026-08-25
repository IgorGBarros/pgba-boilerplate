# backend_api/Api/harness/guardrails.py
"""
Guardrails anti-alucinação — as regras concretas por trás do "Princípio
Akita" (ver CLAUDE.md). Cada função aqui é usada por `ingestion` e
`orchestration` antes/depois de qualquer chamada a LLM.

Não é sobre "prompt bonito" — é sobre nunca deixar a IA responder sem
base, e sempre validar a forma da saída antes de confiar nela.
"""
from __future__ import annotations

import json
import logging
import re

logger = logging.getLogger(__name__)


class GroundingError(Exception):
    """Levantado quando não há base suficiente para responder com segurança."""


class NoAnswer:
    """
    Resposta-padrão quando o guardrail bloqueia a geração. Nunca deixe o
    LLM "tentar mesmo assim" — devolver isso é sempre mais seguro que
    arriscar uma alucinação.
    """

    TEXT = (
        "Não encontrei informação suficiente na base de conhecimento ou "
        "nos dados disponíveis para responder com segurança. Tente "
        "reformular a pergunta ou verifique se a fonte relevante já foi "
        "indexada."
    )


def require_grounded_context(context: str, min_length: int = 20) -> None:
    """
    Guardrail 1 — nunca gerar resposta sem contexto real.

    Chame isso ANTES de montar o prompt final. Se levantar `GroundingError`,
    o chamador deve devolver `NoAnswer.TEXT` em vez de perguntar ao LLM
    "responda mesmo sem contexto" — essa é exatamente a situação em que
    modelos alucinam com mais confiança.
    """
    if not context or len(context.strip()) < min_length:
        raise GroundingError("Contexto insuficiente para gerar resposta com segurança.")


def extract_json(raw: str) -> dict:
    """
    Guardrail 2 — saída estruturada, nunca texto livre interpretado "na
    confiança". Extrai o primeiro objeto JSON válido de `raw` (mesmo que o
    modelo tenha cercado com ```json ou adicionado texto antes/depois,
    comum mesmo em "modo JSON").
    """
    raw = (raw or "").strip()
    raw = re.sub(r"^```(json)?|```$", "", raw, flags=re.MULTILINE).strip()

    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass

    match = re.search(r"\{.*\}", raw, flags=re.DOTALL)
    if match:
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            pass

    raise ValueError(f"Não foi possível extrair JSON válido da resposta do modelo: {raw[:200]!r}")


def extract_code_block(raw: str, language: str | None = None) -> str:
    """
    Guardrail 2b — extrai um bloco de código de uma resposta de LLM, mesmo
    com texto explicativo antes/depois (comum mesmo quando o prompt pede
    "só o código"). Usado pelo pipeline de geração de frontend
    (`harness.views.GenerateCodeView`) — nunca aceite a resposta bruta do
    modelo como arquivo final sem passar por aqui.
    """
    raw = (raw or "").strip()
    if not raw:
        raise ValueError("Resposta do modelo vazia — nada para extrair.")

    fence = rf"```{language or '\\w*'}\n([\s\S]*?)\n```"
    match = re.search(fence, raw)
    if match:
        return match.group(1).strip()

    # Sem crases: se a resposta inteira parece já ser código (heurística
    # simples), aceita como está — melhor que falhar por formatação.
    if language != "json" and ("{" in raw or "export" in raw or "function" in raw):
        return raw

    raise ValueError(
        f"Não foi possível extrair bloco de código ({language or 'qualquer'}) da resposta do modelo."
    )


def validate_schema(data: dict, required_keys: dict[str, type]) -> None:
    """
    Guardrail 3 — valida que a saída JSON do modelo tem exatamente as
    chaves e tipos esperados antes de usá-la para qualquer decisão (ex:
    qual função chamar em `orchestration`). Falha explícita > campo
    ausente sendo tratado como None silenciosamente.
    """
    for key, expected_type in required_keys.items():
        if key not in data:
            raise ValueError(f"Campo obrigatório ausente na saída do modelo: '{key}'")
        if data[key] is not None and not isinstance(data[key], expected_type):
            raise ValueError(
                f"Campo '{key}' com tipo inesperado: esperado {expected_type.__name__}, "
                f"recebido {type(data[key]).__name__}"
            )


def citation_coverage(answer: str, source_snippets: list[str], min_overlap: float = 0.15) -> float:
    """
    Guardrail 4 (heurístico, não bloqueante) — estima o quanto da resposta
    parece vir de fato das fontes recuperadas, comparando trigramas de
    palavras. É um sinal para log/auditoria (`QueryLog`/monitoramento),
    não um bloqueio automático — falsos negativos são comuns em respostas
    curtas ou muito parafraseadas. Use para alertar revisão humana em
    respostas de baixa cobertura, não para silenciosamente reescrever.
    """
    def trigrams(text: str) -> set[str]:
        words = re.findall(r"\w+", (text or "").lower())
        return {" ".join(words[i:i + 3]) for i in range(len(words) - 2)} or {" ".join(words)}

    answer_grams = trigrams(answer)
    if not answer_grams:
        return 0.0

    source_grams: set[str] = set()
    for snippet in source_snippets:
        source_grams |= trigrams(snippet)

    if not source_grams:
        return 0.0

    overlap = len(answer_grams & source_grams) / len(answer_grams)
    if overlap < min_overlap:
        logger.info(
            "Baixa cobertura de citação (%.0f%%) — resposta pode não estar bem ancorada nas fontes.",
            overlap * 100,
        )
    return overlap

# backend_api/Api/orchestration/router.py
"""
Roteador multi-modelo — generaliza `ai/model_router.py` do gestao_estoque.

Lá era fixo (3 modelos Ollama hardcoded, keywords de estoque). Aqui:
- as categorias e os modelos por categoria vêm de `settings.AI_MODEL_CATALOG`
  (configurável por ambiente/projeto, sem editar código);
- a classificação por keyword continua como default por ser barata e local,
  mas qualquer vertical pode registrar suas próprias keywords via
  `register_classifier_keywords()`, sem tocar neste arquivo.

Categorias-base (sugestão, ajustável por projeto):
  "fast"      → perguntas objetivas/numéricas (contagens, totais, preços)
  "standard"  → conversas gerais, dúvidas de uso
  "report"    → análises, comparações, "por quê", relatórios
"""
from __future__ import annotations

from django.conf import settings

DEFAULT_MODEL_CATALOG = {
    "fast": {"model": "qwen2.5:14b", "temperature": 0.25, "num_ctx": 2048},
    "standard": {"model": "mistral-nemo:14b", "temperature": 0.3, "num_ctx": 4096},
    "report": {"model": "deepseek-r1:14b", "temperature": 0.2, "num_ctx": 4096},
}

DEFAULT_KEYWORDS = {
    "fast": ["quantos", "total", "valor", "preço", "quantidade", "saldo"],
    "report": ["análise", "detalhado", "explicar", "diferença", "por que", "resumo", "relatório", "compare"],
}

_extra_keywords: dict[str, list[str]] = {}


def register_classifier_keywords(category: str, keywords: list[str]) -> None:
    """Permite a uma vertical (ex: financeiro) somar suas próprias keywords."""
    _extra_keywords.setdefault(category, []).extend(keywords)


def _keywords_for(category: str) -> list[str]:
    return DEFAULT_KEYWORDS.get(category, []) + _extra_keywords.get(category, [])


def classify(question: str) -> str:
    """Escolhe a categoria de modelo com base em palavras-chave da pergunta."""
    q = (question or "").lower()

    if any(k in q for k in _keywords_for("fast")):
        return "fast"
    if any(k in q for k in _keywords_for("report")):
        return "report"
    return "standard"


def get_model_config(category: str) -> dict:
    catalog = getattr(settings, "AI_MODEL_CATALOG", DEFAULT_MODEL_CATALOG)
    return catalog.get(category, catalog.get("standard", DEFAULT_MODEL_CATALOG["standard"]))


def route(question: str) -> tuple[str, dict]:
    """Retorna (categoria, config_do_modelo) para a pergunta recebida."""
    category = classify(question)
    return category, get_model_config(category)

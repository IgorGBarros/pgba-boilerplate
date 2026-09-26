# backend_api/Api/harness/pricing.py
"""
Preço por modelo (US$ por 1 milhão de tokens, entrada/saída) — o custo
de cada chamada de IA sai dos tokens que o PROVEDOR informou
(`providers.ChatUsage`) vezes este preço.

Antes: um preço fixo por provedor aplicado a "caracteres ÷ 4" — Claude
Sonnet e Claude Opus custavam o mesmo, e a conta não batia com a fatura.

Anthropic: valores oficiais da tabela de modelos (primeira parte, sem
cache). Demais provedores: aproximados — variam por modelo e mudam com
frequência. Ajuste sem editar código em `AI_MODEL_PRICES` (settings/.env,
JSON): `{"groq:llama-3.3-70b": [0.59, 0.79], "openai:gpt-4o": [2.5, 10]}`
— chave `provedor:prefixo-do-modelo` (ou só `provedor`), valor
`[entrada, saída]`. O prefixo mais longo que casar vence.

Continua sendo ESTIMATIVA (sem desconto de cache, lote, câmbio) — ordem
de grandeza pra orçamento, não fatura.
"""
from __future__ import annotations

import json
from decimal import Decimal

from django.conf import settings

# (provedor, prefixo do modelo) -> (entrada, saída) em US$/MTok
_DEFAULT_PRICES: dict[tuple[str, str], tuple[str, str]] = {
    ("anthropic", "claude-fable"): ("10", "50"),
    ("anthropic", "claude-mythos"): ("10", "50"),
    ("anthropic", "claude-opus-5-5"): ("4", "20"),
    ("anthropic", "claude-opus-5"): ("5", "25"),
    ("anthropic", "claude-opus-4"): ("5", "25"),
    ("anthropic", "claude-sonnet-5"): ("2", "10"),
    ("anthropic", "claude-sonnet-4"): ("3", "15"),
    ("anthropic", "claude-haiku-4"): ("1", "5"),
    # Claude Code local (sessão paga pelo plano/chave de quem roda): o custo
    # real vem do próprio Claude Code (total_cost_usd), não desta tabela.
    ("anthropic", "claude-code"): ("0", "0"),
    ("anthropic", ""): ("3", "15"),
    # Aproximados — ajuste em AI_MODEL_PRICES conforme o modelo configurado
    ("groq", ""): ("0.6", "0.8"),
    ("openai", ""): ("2.5", "10"),
    ("openrouter", ""): ("3", "15"),
    ("ollama", ""): ("0", "0"),  # local, sem custo de API
}
_UNKNOWN = ("3", "15")
_MILLION = Decimal(1_000_000)


def _price_table() -> dict[tuple[str, str], tuple[Decimal, Decimal]]:
    table = {k: (Decimal(a), Decimal(b)) for k, (a, b) in _DEFAULT_PRICES.items()}
    raw = getattr(settings, "AI_MODEL_PRICES", None)
    overrides = json.loads(raw) if isinstance(raw, str) and raw.strip() else (raw or {})
    for key, value in overrides.items():
        provider, _, prefix = str(key).partition(":")
        table[(provider, prefix)] = (Decimal(str(value[0])), Decimal(str(value[1])))
    return table


def price_per_mtok(provider: str, model: str) -> tuple[Decimal, Decimal]:
    """(entrada, saída) em US$ por milhão de tokens — prefixo mais longo que casar."""
    model = model or ""
    best: tuple[int, tuple[Decimal, Decimal]] | None = None
    for (p, prefix), price in _price_table().items():
        if p == provider and model.startswith(prefix) and (best is None or len(prefix) > best[0]):
            best = (len(prefix), price)
    if best:
        return best[1]
    return Decimal(_UNKNOWN[0]), Decimal(_UNKNOWN[1])


def estimate_cost(provider: str, model: str, tokens_in: int, tokens_out: int) -> Decimal:
    price_in, price_out = price_per_mtok(provider, model)
    return (Decimal(tokens_in) * price_in + Decimal(tokens_out) * price_out) / _MILLION

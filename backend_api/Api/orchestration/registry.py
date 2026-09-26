# backend_api/Api/orchestration/registry.py
"""
Registro de "funções seguras" que a IA pode chamar para responder perguntas
sobre dado estruturado.

REGRA DE OURO (não negociável — ver CLAUDE.md):
O LLM NUNCA escreve nem executa SQL. Ele só recebe a lista de funções
registradas aqui (nome + descrição + schema de parâmetros) e escolhe QUAL
usar e com quais argumentos. O código Python é quem executa a função de
verdade, e É O CÓDIGO PYTHON — nunca o LLM — quem injeta `tenant_id`.

Isso fecha o mesmo buraco de segurança identificado no gestao_estoque: lá,
a versão antiga deixava o modelo gerar SQL e rodava direto no Postgres,
sem filtro de tenant garantido — qualquer prompt injection podia, em tese,
vazar dado de outro cliente. Aqui isso é estruturalmente impossível: o
tenant_id nunca passa pelo LLM, nem na entrada nem na saída.

Cada vertical (app de domínio: estoque, crm, financeiro...) registra suas
próprias funções assim:

    from orchestration.registry import register_query_function

    @register_query_function(
        name="total_itens_em_estoque",
        description="Retorna o total de unidades em estoque de um produto pelo nome.",
        parameters={"produto_nome": "string"},
    )
    def total_itens_em_estoque(tenant_id, produto_nome: str) -> dict:
        qtd = InventoryItem.objects.filter(
            tenant_id=tenant_id, product__name__icontains=produto_nome
        ).aggregate(total=Sum("quantity"))["total"] or 0
        return {"produto": produto_nome, "quantidade": qtd}

A assinatura é sempre `func(tenant_id, **params) -> dict`. `params` vêm do
LLM (portanto são tratados como entrada não confiável: valide tipos/tamanho
dentro da função); `tenant_id` vem sempre do código chamador.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Callable

logger = logging.getLogger(__name__)

# Classificação de risco de uma ação — quanto maior, maior a governança
# exigida antes de executar (ver agency.policy). Definido aqui (core),
# não em `agency`, porque é a própria vertical que registra a função quem
# sabe o quão arriscada ela é — "criar_pedido_de_compra" não é a mesma
# coisa que "consultar_estoque".
RISK_LEVELS = ("low", "medium", "high", "critical")


@dataclass
class QueryFunction:
    name: str
    description: str
    parameters: dict  # {"nome_param": "tipo descritivo, ex: 'string' ou 'int'"}
    handler: Callable
    # Finalidade LGPD associada (ver core.models.ConsentRecord). Se setado,
    # o dado do titular só é usado por esta função quando houver
    # consentimento ativo para essa finalidade.
    requires_consent_purpose: str | None = None
    # "low" (padrão) | "medium" | "high" | "critical" — usado por
    # agency.policy.evaluate_policy() para decidir se um agente pode
    # executar sozinho ou precisa de aprovação humana antes.
    risk: str = "low"


_REGISTRY: dict[str, QueryFunction] = {}

# Catálogos dinâmicos: funções que dependem do tenant (ex: consultas que um
# humano cadastrou num conector de banco — ingestion.connectors.structured).
# Cada provedor é `(tenant_id, source_ids) -> list[QueryFunction]`; `source_ids`
# é o mesmo escopo genérico da busca semântica (None = sem restrição) — este
# módulo não sabe o que é setor nem conector, só repassa.
_CATALOG_PROVIDERS: list[Callable] = []


def register_catalog_provider(provider: Callable) -> None:
    if provider not in _CATALOG_PROVIDERS:
        _CATALOG_PROVIDERS.append(provider)


def dynamic_functions(tenant_id, source_ids=None) -> list["QueryFunction"]:
    if not tenant_id:
        return []
    out: list[QueryFunction] = []
    for provider in _CATALOG_PROVIDERS:
        try:
            out.extend(provider(tenant_id, source_ids))
        except Exception as exc:  # provedor quebrado nunca derruba a pergunta
            name = getattr(provider, "__name__", provider)
            logger.warning("Catálogo dinâmico falhou (%s): %s", name, exc)
    return [fn for fn in out if fn.risk in RISK_LEVELS and fn.name not in _REGISTRY]


def register_query_function(
    name: str,
    description: str,
    parameters: dict | None = None,
    requires_consent_purpose: str | None = None,
    risk: str = "low",
):
    """Decorator: registra uma função de consulta segura, tenant-scoped."""
    if risk not in RISK_LEVELS:
        raise ValueError(f"risk deve ser um de {RISK_LEVELS}, recebeu '{risk}'.")

    def decorator(func: Callable):
        if name in _REGISTRY:
            raise ValueError(f"Função '{name}' já registrada (colisão de nome).")
        _REGISTRY[name] = QueryFunction(
            name=name,
            description=description,
            parameters=parameters or {},
            handler=func,
            requires_consent_purpose=requires_consent_purpose,
            risk=risk,
        )
        return func

    return decorator


def get_function(name: str, tenant_id=None, source_ids=None) -> QueryFunction | None:
    """Estática primeiro; com `tenant_id`, também as dinâmicas daquele tenant/escopo."""
    if name in _REGISTRY:
        return _REGISTRY[name]
    return next((fn for fn in dynamic_functions(tenant_id, source_ids) if fn.name == name), None)


def list_functions() -> list[QueryFunction]:
    return list(_REGISTRY.values())


def catalog_for_prompt(tenant_id=None, source_ids=None) -> str:
    """Serializa o catálogo de funções em texto para injetar no prompt do LLM."""
    lines = []
    for fn in [*_REGISTRY.values(), *dynamic_functions(tenant_id, source_ids)]:
        params = ", ".join(f"{k}: {v}" for k, v in fn.parameters.items()) or "sem parâmetros"
        lines.append(f"- {fn.name}({params}): {fn.description}")
    return "\n".join(lines)


def execute(name: str, tenant_id, params: dict, source_ids=None) -> dict:
    """
    Executa uma função registrada. Único ponto de entrada de execução —
    tudo que chama uma QueryFunction passa por aqui, então é o único lugar
    que precisa garantir que `tenant_id` nunca vem do LLM.
    """
    if not tenant_id:
        raise ValueError("execute() requer tenant_id explícito.")
    fn = get_function(name, tenant_id, source_ids)
    if fn is None:
        raise LookupError(f"Função '{name}' não está registrada.")
    try:
        return fn.handler(tenant_id, **(params or {}))
    except TypeError as exc:
        logger.warning("Parâmetros inválidos para '%s': %s", name, exc)
        raise ValueError(f"Parâmetros inválidos para '{name}': {exc}") from exc

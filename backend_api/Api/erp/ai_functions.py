# backend_api/Api/erp/ai_functions.py
"""
Funções seguras do ERP para a IA (orchestration.registry). É assim que o
ERP fica "integrado com todos os setores": o agente de qualquer setor
pergunta ("quanto temos a receber este mês?") e o orquestrador escolhe uma
destas funções — o LLM nunca vê SQL nem escolhe o tenant. Todas só leem.
"""
from datetime import timedelta

from django.db.models import Count, F, Q, Sum
from django.utils import timezone

from orchestration.registry import register_query_function


@register_query_function(
    name="erp_contratos_resumo",
    description=(
        "Contratos de serviço do ERP: quantos estão ativos, valor total ativo e os que "
        "vencem nos próximos N dias (número, projeto, cliente, fim)."
    ),
    parameters={"dias": "inteiro (padrão 30)"},
)
def erp_contratos_resumo(tenant_id, dias: int = 30) -> dict:
    from erp.models import ContratoServico

    hoje = timezone.now().date()
    ativos = ContratoServico.objects.filter(
        tenant_id=tenant_id, is_active=True, status=ContratoServico.Status.ATIVO
    )
    agg = ativos.aggregate(total=Sum("valor_total"), n=Count("id"))
    vencendo = ativos.filter(data_fim__lte=hoje + timedelta(days=int(dias))).select_related(
        "parceiro"
    )
    return {
        "ativos": agg["n"],
        "valor_ativo": float(agg["total"] or 0),
        "vencendo": [
            {
                "numero": c.numero,
                "projeto": c.nome_projeto,
                "cliente": c.parceiro.nome,
                "fim": c.data_fim.isoformat(),
            }
            for c in vencendo[:20]
        ],
    }


@register_query_function(
    name="erp_financeiro_resumo",
    description=(
        "Contas a receber e a pagar do ERP: total pendente, total vencido e o que vence "
        "nos próximos N dias, separado em receber/pagar."
    ),
    parameters={"dias": "inteiro (padrão 30)"},
)
def erp_financeiro_resumo(tenant_id, dias: int = 30) -> dict:
    from erp.models import LancamentoFinanceiro

    hoje = timezone.now().date()
    base = LancamentoFinanceiro.objects.filter(
        tenant_id=tenant_id, is_active=True, status__in=["pendente", "vencido"]
    )
    out = {}
    for tipo, nome in (("receita", "receber"), ("despesa", "pagar")):
        qs = base.filter(tipo=tipo)
        out[nome] = {
            "pendente": float(qs.aggregate(v=Sum("valor"))["v"] or 0),
            "vencido": float(
                qs.filter(Q(status="vencido") | Q(vencimento__lt=hoje)).aggregate(v=Sum("valor"))[
                    "v"
                ]
                or 0
            ),
            "proximos_dias": float(
                qs.filter(
                    vencimento__gte=hoje, vencimento__lte=hoje + timedelta(days=int(dias))
                ).aggregate(v=Sum("valor"))["v"]
                or 0
            ),
        }
    return out


@register_query_function(
    name="erp_itens_abaixo_do_minimo",
    description="Materiais do estoque abaixo da quantidade mínima (código, nome, saldo, mínimo).",
    parameters={},
)
def erp_itens_abaixo_do_minimo(tenant_id) -> dict:
    from erp.models import ItemEstoque

    itens = ItemEstoque.objects.filter(
        tenant_id=tenant_id,
        is_active=True,
        tipo_item="material",
        quantidade__lt=F("quantidade_minima"),
    ).order_by("nome")[:50]
    return {
        "itens": [
            {
                "codigo": i.codigo,
                "nome": i.nome,
                "saldo": i.quantidade,
                "minimo": i.quantidade_minima,
            }
            for i in itens
        ]
    }

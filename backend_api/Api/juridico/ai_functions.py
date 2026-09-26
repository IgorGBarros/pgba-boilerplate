# backend_api/Api/juridico/ai_functions.py
"""Funções seguras do Jurídico para a IA (CLAUDE.md §6) — só leitura."""
from datetime import timedelta

from django.db.models import Sum
from django.utils import timezone

from orchestration.registry import register_query_function


@register_query_function(
    name="juridico_resumo",
    description=(
        "Resumo do Jurídico: processos ativos, provisão (perda provável), contingência possível, "
        "prazos vencidos e dos próximos 7 dias, contratos vencendo em 30 dias e "
        "assinaturas pendentes."
    ),
    parameters={},
)
def juridico_resumo(tenant_id) -> dict:
    from juridico.models import Contrato, Prazo, Processo, SolicitacaoAssinatura

    hoje = timezone.localdate()
    ativos = Processo.objects.filter(
        tenant_id=tenant_id, is_active=True, status__in=["em_andamento", "suspenso"]
    )
    prazos = Prazo.objects.filter(tenant_id=tenant_id, is_active=True, concluido=False)

    def soma(prob):
        return float(
            ativos.filter(probabilidade_perda=prob).aggregate(v=Sum("valor_estimado_perda"))["v"]
            or 0
        )

    return {
        "processos_ativos": ativos.count(),
        "provisao_provavel": soma("provavel"),
        "contingencia_possivel": soma("possivel"),
        "prazos_vencidos": prazos.filter(prazo__lt=hoje).count(),
        "prazos_7_dias": prazos.filter(
            prazo__gte=hoje, prazo__lte=hoje + timedelta(days=7)
        ).count(),
        "contratos_vencendo_30_dias": Contrato.objects.filter(
            tenant_id=tenant_id,
            is_active=True,
            data_fim__gte=hoje,
            data_fim__lte=hoje + timedelta(days=30),
        )
        .exclude(status="cancelado")
        .count(),
        "assinaturas_pendentes": SolicitacaoAssinatura.objects.filter(
            tenant_id=tenant_id, status="enviada"
        ).count(),
    }


@register_query_function(
    name="juridico_prazos_proximos",
    description=(
        "Lista os prazos jurídicos em aberto dos próximos N dias "
        "(título, vencimento, processo, responsável)."
    ),
    parameters={"dias": "inteiro (padrão 15)"},
)
def juridico_prazos_proximos(tenant_id, dias: int = 15) -> dict:
    from juridico.models import Prazo

    hoje = timezone.localdate()
    qs = (
        Prazo.objects.filter(
            tenant_id=tenant_id,
            is_active=True,
            concluido=False,
            prazo__lte=hoje + timedelta(days=int(dias)),
        )
        .select_related("processo")
        .order_by("prazo")[:30]
    )
    return {
        "prazos": [
            {
                "titulo": p.titulo,
                "vencimento": p.prazo.isoformat(),
                "vencido": p.prazo < hoje,
                "processo": p.processo.numero_cnj or p.processo.titulo if p.processo else "",
                "responsavel": p.responsavel,
                "urgencia": p.urgencia,
            }
            for p in qs
        ]
    }

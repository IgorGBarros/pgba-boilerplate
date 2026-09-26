# backend_api/Api/helpdesk/verificacoes.py
"""
O que o TI monitora em cada empresa, registrado na observabilidade
(`observabilidade.registro`): IA de cada setor, conectores do Data Lake,
servidores MCP, caixas de e-mail e a saúde dos agentes (tarefas presas,
aprovações esquecidas, orçamento, falhas). Falha 2x seguidas vira incidente →
chamado pro time de TI (`helpdesk.receptores`).
"""
from __future__ import annotations

import time
from datetime import timedelta

from django.db.models import Sum
from django.utils import timezone

from observabilidade.registro import Resultado, registrar_fonte_de_tenants, registrar_verificacao


@registrar_fonte_de_tenants
def _empresas():
    from agency.models import Sector

    return Sector.objects.filter(is_active=True).values_list("tenant_id", flat=True).distinct()


def _taxa(erros: int, total: int) -> float:
    return erros / total if total else 0.0


@registrar_verificacao("ia", intervalo=300)
def verificar_ia(tenant_id) -> list[Resultado]:
    from agency.services import sector_ai_status
    from observabilidade.models import Metrica

    out = []
    status = sector_ai_status(tenant_id)
    for s in status["sectors"]:
        out.append(
            Resultado(
                f"ia.setor.{s['sector_id']}",
                "ia",
                f"IA do setor {s['sector_name']} "
                f"({s['provider']}{' · ' + s['model'] if s['model'] else ''})",
                "ok" if s["ready"] else "alerta",
                "credencial e modelo configurados" if s["ready"] else s["detail"],
                causa=""
                if s["ready"]
                else "Sem credencial/modelo pra esse provedor — as tarefas do setor falham.",
                acao=""
                if s["ready"]
                else "Painel administrativo → IA: cadastre a chave do provedor.",
                dados={"provider": s["provider"], "model": s["model"], "origem": s["source"]},
                gravidade="alta",
            )
        )
    desde = timezone.now() - timedelta(minutes=15)
    linhas = (
        Metrica.objects.filter(tenant_id=tenant_id, tipo="ia", minuto__gte=desde)
        .values("chave")
        .annotate(t=Sum("total"), e=Sum("erros"), ms=Sum("ms_total"))
    )
    for m in linhas:
        taxa = _taxa(m["e"] or 0, m["t"] or 0)
        st = "falha" if m["t"] >= 3 and taxa >= 0.5 else ("alerta" if taxa >= 0.2 else "ok")
        out.append(
            Resultado(
                f"ia.provedor.{m['chave']}"[:150],
                "ia",
                f"Provedor de IA {m['chave']}",
                st,
                f"{m['t']} chamada(s) em 15 min, {m['e']} com erro ({taxa:.0%}), média "
                f"{int(m['ms'] / m['t']) if m['t'] else 0} ms",
                causa="O provedor está recusando ou falhando nas chamadas "
                "(chave, limite ou instabilidade)."
                if st != "ok"
                else "",
                acao="Veja o erro em Observabilidade → Erros; confira a chave e o limite do plano."
                if st != "ok"
                else "",
                dados={"total": m["t"], "erros": m["e"]},
                ms=int(m["ms"] / m["t"]) if m["t"] else None,
            )
        )
    return out


@registrar_verificacao("conectores", intervalo=120)
def verificar_conectores(tenant_id) -> list[Resultado]:
    from ingestion.models import KnowledgeSource

    out = []
    fontes = (
        KnowledgeSource.objects.filter(tenant_id=tenant_id, is_active=True)
        .exclude(source_type="mcp")
        .exclude(last_sync_status__in=("", "running"))
    )
    for f in fontes:
        erro = f.last_sync_status == "error"
        atrasada = (
            not erro
            and f.sync_interval_minutes
            and f.last_synced_at
            and timezone.now() - f.last_synced_at
            > timedelta(minutes=f.sync_interval_minutes * 3 + 10)
        )
        out.append(
            Resultado(
                f"conector.{f.id}",
                "conector",
                f"Conector {f.name} ({f.get_source_type_display()})",
                "falha" if erro else ("alerta" if atrasada else "ok"),
                (f.last_sync_message or "")[:400]
                or (
                    f"sincronizou em {timezone.localtime(f.last_synced_at):%d/%m %H:%M}"
                    if f.last_synced_at
                    else ""
                ),
                causa="A última sincronização falhou."
                if erro
                else (
                    "Sincronização atrasada — o agendador ou o worker parou?" if atrasada else ""
                ),
                acao="Data Lake → Conectores → Ver dados → Testar conexão."
                if erro or atrasada
                else "",
                dados={"tipo": f.source_type, "status": f.last_sync_status},
                gravidade="media",
            )
        )
    return out


@registrar_verificacao("mcp", intervalo=600)
def verificar_mcp(tenant_id) -> list[Resultado]:
    """Chamada real a cada servidor MCP liberado (só lista as ferramentas)."""
    from ingestion.connectors import get_connector
    from ingestion.models import KnowledgeSource

    out = []
    for f in KnowledgeSource.objects.filter(tenant_id=tenant_id, is_active=True, source_type="mcp"):
        t0 = time.monotonic()
        try:
            msg = get_connector(f).test()
            st, detalhe, causa = "ok", str(msg)[:400], ""
        except Exception as exc:  # noqa: BLE001
            st, detalhe = "falha", str(exc)[:400]
            causa = "O servidor MCP não respondeu ou recusou a credencial."
        out.append(
            Resultado(
                f"mcp.{f.id}",
                "mcp",
                f"Servidor MCP {f.name}",
                st,
                detalhe,
                causa=causa,
                acao="Data Lake → Conectores → o servidor MCP → Testar conexão / renovar o token."
                if st != "ok"
                else "",
                ms=int((time.monotonic() - t0) * 1000),
                gravidade="media",
            )
        )
    return out


@registrar_verificacao("email", intervalo=300)
def verificar_email(tenant_id) -> list[Resultado]:
    from integrations.models import EmailAccount

    out = []
    for c in EmailAccount.objects.filter(tenant_id=tenant_id, is_active=True).select_related(
        "sector"
    ):
        st = {"ready": "ok", "error": "falha"}.get(c.status, "desconhecido")
        out.append(
            Resultado(
                f"email.{c.id}",
                "email",
                f"E-mail {c.address or '(sem endereço)'}"
                + (f" · {c.sector.name}" if c.sector else ""),
                st,
                c.last_check_message or c.get_status_display(),
                causa="Login SMTP/IMAP falhou no último teste." if st == "falha" else "",
                acao="Painel administrativo → E-mails dos setores → Testar."
                if st == "falha"
                else "",
                gravidade="media",
            )
        )
    return out


@registrar_verificacao("agentes", intervalo=120)
def verificar_agentes(tenant_id) -> list[Resultado]:
    """Todos os agentes de todos os setores: tarefas presas, falhas, aprovações e orçamento."""
    from agency.models import PendingApproval, Task
    from agency.services import get_sector_metrics

    agora = timezone.now()
    out = []

    presas = Task.objects.filter(
        tenant_id=tenant_id, status=Task.Status.IN_PROGRESS, progress__lt=1.0
    ).filter(updated_at__lt=agora - timedelta(minutes=30))
    n = presas.count()
    out.append(
        Resultado(
            "agentes.tarefas_presas",
            "agentes",
            "Agentes: tarefas paradas no meio",
            "alerta" if n else "ok",
            f"{n} tarefa(s) em andamento sem progresso há mais de 30 min"
            if n
            else "nenhuma tarefa parada",
            causa="O provedor de IA travou, o worker caiu no meio ou o trabalho "
            "externo (devserver) não reportou."
            if n
            else "",
            acao="Quadro de tarefas: pause/retome ou rejeite; veja Workers e IA no painel."
            if n
            else "",
            dados={"tarefas": list(presas.values_list("id", flat=True)[:20])},
        )
    )

    falhas = Task.objects.filter(
        tenant_id=tenant_id, status=Task.Status.REJECTED, updated_at__gte=agora - timedelta(hours=1)
    ).exclude(result__error__isnull=True)
    nf = falhas.count()
    out.append(
        Resultado(
            "agentes.falhas",
            "agentes",
            "Agentes: tarefas que falharam (1h)",
            "falha" if nf >= 3 else ("alerta" if nf else "ok"),
            f"{nf} tarefa(s) falharam na execução na última hora"
            if nf
            else "nenhuma falha de execução",
            causa="Tarefas estão caindo por erro do provedor de IA ou de configuração."
            if nf
            else "",
            acao="Abra as tarefas rejeitadas e veja o erro; confira IA do setor." if nf else "",
            dados={"tarefas": list(falhas.values_list("id", flat=True)[:20])},
        )
    )

    velhas = PendingApproval.objects.filter(
        tenant_id=tenant_id,
        status=PendingApproval.Status.PENDING,
        created_at__lt=agora - timedelta(hours=24),
    ).count()
    out.append(
        Resultado(
            "agentes.aprovacoes",
            "agentes",
            "Agentes: aprovações esperando",
            "alerta" if velhas else "ok",
            f"{velhas} aprovação(ões) pendente(s) há mais de 24h"
            if velhas
            else "nenhuma aprovação esquecida",
            acao="Empresa → Aprovações." if velhas else "",
            gravidade="baixa",
        )
    )

    estourados = [s for s in get_sector_metrics(tenant_id) if s["status"] in ("warn", "over")]
    out.append(
        Resultado(
            "agentes.orcamento",
            "agentes",
            "Agentes: orçamento de IA do mês",
            "alerta" if estourados else "ok",
            ", ".join(f"{s['sector_name']} {s['usage_percent']}%" for s in estourados)
            or "todos dentro do orçamento",
            acao="Ajuste o orçamento do setor ou a IA usada." if estourados else "",
            dados={"setores": [s["sector_id"] for s in estourados]},
            gravidade="baixa",
        )
    )
    return out

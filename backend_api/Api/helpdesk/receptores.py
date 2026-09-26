# backend_api/Api/helpdesk/receptores.py
"""
O TI escuta a observabilidade (incidente abriu/fechou) e as Tasks dos
chamados. Nunca o contrário: a observabilidade não sabe que existe chamado.
"""
from __future__ import annotations

import logging

from django.db.models.signals import post_save
from django.dispatch import receiver

from agency.models import Task
from observabilidade.models import PLATAFORMA
from observabilidade.sinais import incidente_aberto, incidente_resolvido

logger = logging.getLogger(__name__)
MAX_EMPRESAS = 50


def empresas_com_ti() -> list:
    from helpdesk import equipe
    from agency.models import Agent

    nomes = [v[0] for v in equipe.TIME.values()]
    return list(
        Agent.objects.filter(name__in=nomes, is_active=True, sector__isnull=False)
        .values_list("tenant_id", flat=True)
        .distinct()[:MAX_EMPRESAS]
    )


@receiver(incidente_aberto)
def _incidente_aberto(sender, incidente, **kwargs):
    from helpdesk import services
    from helpdesk.tasks import despachar, diagnosticar_task

    tenants = empresas_com_ti() if incidente.tenant_id == PLATAFORMA else [incidente.tenant_id]
    primeiro = None
    for tenant_id in tenants:
        try:
            t = services.chamado_de_incidente(tenant_id, incidente)
            primeiro = primeiro or t
        except Exception:  # noqa: BLE001 — um tenant com problema não impede os outros
            logger.exception(
                "Não abriu chamado do incidente %s no tenant %s", incidente.id, tenant_id
            )
    if primeiro is None:
        return
    incidente.chamado_id = primeiro.id
    incidente.save(update_fields=["chamado_id"])
    despachar(diagnosticar_task, incidente.id, str(primeiro.tenant_id))


@receiver(incidente_resolvido)
def _incidente_resolvido(sender, incidente, **kwargs):
    from helpdesk import services
    from helpdesk.models import Ticket

    abertos = Ticket.objects.filter(incidente_id=incidente.id, is_active=True).exclude(
        status__in=("resolvido", "fechado")
    )
    for t in abertos:
        services.interacao(
            t,
            "sistema",
            "O monitoramento viu o componente voltar ao normal "
            f"(fora do ar por ~{incidente.duracao_min} min). "
            "Confirme com quem foi afetado e resolva o chamado com a causa.",
        )
        if t.status != "aguardando":
            t.status = "aguardando"
            t.save(update_fields=["status"])


@receiver(post_save, sender=Task)
def _task_do_chamado(sender, instance: Task, **kwargs):
    """Aprovar a Task no quadro resolve o chamado; rejeitar devolve pra fila."""
    if instance.task_type != "chamado" or instance.status not in (
        Task.Status.APPROVED,
        Task.Status.REJECTED,
    ):
        return
    from django.utils import timezone

    from helpdesk import services
    from helpdesk.models import Ticket

    for t in Ticket.objects.filter(task=instance, is_active=True):
        if instance.status == Task.Status.APPROVED and t.status not in ("resolvido", "fechado"):
            t.status, t.resolvido_em = "resolvido", timezone.now()
            t.solucao = t.solucao or "Resolvido pela aprovação da tarefa no quadro."
            t.save(update_fields=["status", "resolvido_em", "solucao"])
            services.interacao(t, "sistema", "Task aprovada no quadro — chamado resolvido.")
        elif instance.status == Task.Status.REJECTED and t.status not in (
            "resolvido",
            "fechado",
            "aberto",
        ):
            t.status = "aberto"
            t.save(update_fields=["status"])
            services.interacao(t, "sistema", "Task rejeitada — o chamado voltou pra fila.")

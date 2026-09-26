# backend_api/Api/observabilidade/receptores.py
"""Ouve os sinais do core (IA e saída HTTP) e o fim das tarefas do Celery."""
from celery.signals import task_postrun
from django.dispatch import receiver

from core.signals import chamada_ia, saida_http
from observabilidade import coletor


@receiver(chamada_ia)
def _ia(sender, tenant_id=None, provider="", model="", ok=True, ms=0, erro="", **kw):
    coletor.registrar("ia", f"{provider}:{model or '?'}", ms, erro=not ok, tenant_id=tenant_id)


@receiver(saida_http)
def _http(sender, host="", method="GET", status=None, ms=0, erro="", **kw):
    # Saída HTTP é da plataforma (o safe_http não sabe de quem é): só a equipe vê
    coletor.registrar(
        "http",
        host or "?",
        ms,
        erro=bool(erro) or (status or 0) >= 500,
        erro_cliente=400 <= (status or 0) < 500,
    )


@task_postrun.connect
def _fim_da_tarefa(**kw):
    coletor.gravar()

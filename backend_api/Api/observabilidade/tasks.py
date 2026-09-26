# backend_api/Api/observabilidade/tasks.py
from celery import shared_task
from django.utils import timezone


@shared_task
def verificar_task():
    """Beat a cada 60 s: batimento do agendador, plataforma e cada empresa."""
    from observabilidade import coletor, motor, registro
    from observabilidade.models import Batimento

    try:
        Batimento.objects.update_or_create(nome="beat", defaults={"em": timezone.now()})
    except Exception:  # noqa: BLE001 — banco fora: a verificação de plataforma anota a queda
        pass
    resultados = motor.rodar_plataforma()
    if resultados and resultados[0].status == "falha":
        return "banco fora do ar"
    for tenant_id in registro.tenants():
        motor.rodar_tenant(tenant_id)
    b, criado = Batimento.objects.get_or_create(nome="limpeza")
    if criado or (timezone.now() - b.em).total_seconds() > 3600:
        motor.limpar()
        b.em = timezone.now()
        b.save(update_fields=["em"])
    coletor.gravar()
    return "ok"

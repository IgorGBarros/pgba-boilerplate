# backend_api/Api/integrations/tasks.py
from celery import shared_task

from integrations.email import EmailError, send_outbound
from integrations.models import OutboundEmail


@shared_task
def send_outbound_task(email_id: int, approved_by: str = "") -> str:
    email = OutboundEmail.objects.filter(pk=email_id).first()
    if email is None:
        return "missing"
    try:
        return send_outbound(email, approved_by=approved_by).status
    except EmailError as exc:
        OutboundEmail.objects.filter(pk=email_id).update(
            status=OutboundEmail.Status.FAILED, error=str(exc)[:500]
        )
        return "failed"


@shared_task
def fetch_inboxes_task() -> int:
    """Beat: e-mails novos de toda caixa pronta com IMAP. Uma com erro não para as outras."""
    from integrations.email import EmailError, fetch_inbox
    from integrations.models import EmailAccount

    total = 0
    for account in EmailAccount.objects.filter(
        is_active=True, status=EmailAccount.Status.READY
    ).exclude(imap_host=""):
        try:
            total += fetch_inbox(account)
        except EmailError:
            continue  # erro já ficou em account.last_fetch_message
    return total

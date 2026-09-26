# backend_api/Api/integrations/email.py
"""
Caixas de e-mail dos setores e envio (SMTP).

    rascunho (agente ou tela) → pessoa aprova → send_outbound() → SMTP da caixa do setor

- Presets de provedor (Hostinger, Gmail, Outlook) só preenchem host/porta —
  quem configura pode sobrescrever.
- Host passa pela mesma trava anti-SSRF dos conectores (`check_host`).
- Senha fica cifrada (Fernet); nunca volta na API.
- Nunca manda por outra caixa sem dizer: sem caixa pronta do setor, usa a
  caixa padrão da empresa (setor vazio) SE existir; senão o rascunho espera.
"""
from __future__ import annotations

import imaplib
import smtplib
import socket
import ssl
from email import message_from_bytes, policy
from email.message import EmailMessage
from email.utils import formataddr, getaddresses, make_msgid, parsedate_to_datetime

from django.db import transaction
from django.utils import timezone

from ingestion.connectors import ConnectorError
from ingestion.connectors import safe_http
from integrations.models import EmailAccount, InboundEmail, OutboundEmail

TIMEOUT = 20

# Host/porta padrão de cada provedor (documentação pública de cada um).
PRESETS = {
    "hostinger": {
        "smtp_host": "smtp.hostinger.com",
        "smtp_port": 465,
        "smtp_security": "ssl",
        "imap_host": "imap.hostinger.com",
        "imap_port": 993,
    },
    "gmail": {
        "smtp_host": "smtp.gmail.com",
        "smtp_port": 465,
        "smtp_security": "ssl",
        "imap_host": "imap.gmail.com",
        "imap_port": 993,
    },
    "outlook": {
        "smtp_host": "smtp.office365.com",
        "smtp_port": 587,
        "smtp_security": "starttls",
        "imap_host": "outlook.office365.com",
        "imap_port": 993,
    },
    "custom": {},
}


class EmailError(Exception):
    pass


def apply_preset(account: EmailAccount) -> None:
    """Preenche o que estiver vazio com o padrão do provedor."""
    for field, value in PRESETS.get(account.provider, {}).items():
        if not getattr(account, field):
            setattr(account, field, value)


def _smtp_connect(account: EmailAccount) -> smtplib.SMTP:
    if not account.configured:
        raise EmailError("Caixa ainda não configurada (falta endereço, servidor SMTP ou senha).")
    try:
        safe_http.check_host(account.smtp_host, account.smtp_port)
    except ConnectorError as exc:
        raise EmailError(str(exc)) from exc
    try:
        if account.smtp_security == EmailAccount.Security.SSL:
            server = smtplib.SMTP_SSL(
                account.smtp_host,
                account.smtp_port,
                timeout=TIMEOUT,
                context=ssl.create_default_context(),
            )
        else:
            server = smtplib.SMTP(account.smtp_host, account.smtp_port, timeout=TIMEOUT)
            if account.smtp_security == EmailAccount.Security.STARTTLS:
                server.starttls(context=ssl.create_default_context())
        server.login(account.login, account.password)
        return server
    except smtplib.SMTPAuthenticationError as exc:
        raise EmailError("Usuário ou senha recusados pelo servidor SMTP.") from exc
    except (smtplib.SMTPException, OSError, socket.timeout) as exc:
        raise EmailError(
            f"Não consegui falar com {account.smtp_host}:{account.smtp_port} — {exc}"
        ) from exc


def test_account(account: EmailAccount) -> str:
    """Login SMTP de verdade (e IMAP, se configurado). Atualiza o status da caixa."""
    try:
        server = _smtp_connect(account)
        server.quit()
        msg = f"SMTP ok ({account.smtp_host})."
        if account.imap_host:
            safe_http.check_host(account.imap_host, account.imap_port)
            try:
                conn = imaplib.IMAP4_SSL(account.imap_host, account.imap_port, timeout=TIMEOUT)
                conn.login(account.login, account.password)
                conn.logout()
                msg += f" IMAP ok ({account.imap_host})."
            except (imaplib.IMAP4.error, OSError, socket.timeout) as exc:
                msg += f" IMAP falhou: {exc}"
        account.status = EmailAccount.Status.READY
    except (EmailError, ConnectorError) as exc:
        msg = str(exc)
        account.status = (
            EmailAccount.Status.PENDING if not account.configured else EmailAccount.Status.ERROR
        )
    account.last_check_at = timezone.now()
    account.last_check_message = msg[:500]
    account.save(update_fields=["status", "last_check_at", "last_check_message", "updated_at"])
    if account.status != EmailAccount.Status.READY:
        raise EmailError(msg)
    return msg


def account_for_sector(tenant_id, sector_id) -> EmailAccount | None:
    """Caixa do setor; sem ela, a caixa padrão da empresa (setor vazio)."""
    qs = EmailAccount.objects.filter(tenant_id=tenant_id, is_active=True)
    if sector_id:
        own = qs.filter(sector_id=sector_id).first()
        if own and own.configured:
            return own
    default = qs.filter(sector__isnull=True).first()
    if default and default.configured:
        return default
    return None


def create_draft(
    tenant_id,
    *,
    sector_id,
    to,
    subject: str,
    body: str,
    origin: str = "",
    requested_by: str = "",
    cc=None,
    in_reply_to: InboundEmail | None = None,
    written_by_ai: bool = False,
) -> OutboundEmail:
    to = [a.strip() for a in (to if isinstance(to, (list, tuple)) else [to]) if a and a.strip()]
    if not to:
        raise EmailError("Informe pelo menos um destinatário.")
    return OutboundEmail.objects.create(
        tenant_id=tenant_id,
        sector_id=sector_id,
        to=to,
        cc=[a.strip() for a in (cc or []) if a and a.strip()],
        subject=subject[:255],
        body=body,
        origin=origin[:100],
        requested_by=requested_by[:150],
        in_reply_to=in_reply_to,
        written_by_ai=written_by_ai,
    )


def send_outbound(email: OutboundEmail, approved_by: str = "") -> OutboundEmail:
    """Envia de verdade. Erro fica no próprio e-mail (status failed), nunca some."""
    with transaction.atomic():
        email = OutboundEmail.objects.select_for_update().get(pk=email.pk)
        if email.status not in (OutboundEmail.Status.DRAFT, OutboundEmail.Status.FAILED):
            raise EmailError(
                f"Este e-mail está '{email.get_status_display()}' e não pode ser enviado."
            )
        account = account_for_sector(email.tenant_id, email.sector_id)
        if account is None:
            raise EmailError(
                "O setor não tem caixa de e-mail pronta (nem a empresa tem uma caixa padrão). "
                "Configure em Empresa → Painel administrativo → E-mails. O rascunho continua salvo."
            )
        email.status, email.account, email.approved_by = (
            OutboundEmail.Status.SENDING,
            account,
            approved_by[:150],
        )
        email.save()

    msg = EmailMessage()
    msg["From"] = formataddr((account.display_name or "", account.address))
    msg["To"] = ", ".join(email.to)
    if email.cc:
        msg["Cc"] = ", ".join(email.cc)
    msg["Subject"] = email.subject
    msg["Message-ID"] = make_msgid(domain=account.address.split("@")[-1])
    if email.in_reply_to_id and email.in_reply_to.message_id:
        # Resposta cai na mesma conversa no cliente de e-mail do destinatário
        msg["In-Reply-To"] = email.in_reply_to.message_id
        msg["References"] = email.in_reply_to.message_id
    body = email.body
    if account.signature:
        body = f"{body.rstrip()}\n\n--\n{account.signature}"
    msg.set_content(body)
    try:
        server = _smtp_connect(account)
        try:
            server.send_message(msg)
        finally:
            server.quit()
    except (EmailError, smtplib.SMTPException, OSError) as exc:
        email.status, email.error = OutboundEmail.Status.FAILED, str(exc)[:500]
        email.save()
        return email
    email.status, email.error = OutboundEmail.Status.SENT, ""
    email.sent_at, email.message_id = timezone.now(), msg["Message-ID"]
    email.save()
    from integrations.signals import email_sent

    email_sent.send(sender=OutboundEmail, email=email)
    return email


# ─── Caixa de entrada (IMAP, só leitura) ─────────────────────────────────────

MAX_BODY = 50_000
FETCH_LIMIT = 50


def _imap_connect(account: EmailAccount) -> imaplib.IMAP4:
    if not (account.imap_host and account.address and account.password_encrypted):
        raise EmailError("A caixa não tem IMAP configurado (servidor, endereço e senha).")
    try:
        safe_http.check_host(account.imap_host, account.imap_port)
    except ConnectorError as exc:
        raise EmailError(str(exc)) from exc
    try:
        if account.imap_port == 143:
            conn = imaplib.IMAP4(account.imap_host, account.imap_port, timeout=TIMEOUT)
            conn.starttls(ssl_context=ssl.create_default_context())
        else:
            conn = imaplib.IMAP4_SSL(
                account.imap_host,
                account.imap_port,
                timeout=TIMEOUT,
                ssl_context=ssl.create_default_context(),
            )
        conn.login(account.login, account.password)
        return conn
    except imaplib.IMAP4.error as exc:
        raise EmailError(f"IMAP recusou o login: {exc}") from exc
    except (OSError, socket.timeout) as exc:
        raise EmailError(
            f"Não consegui falar com {account.imap_host}:{account.imap_port} — {exc}"
        ) from exc


def _text_of(msg) -> str:
    part = msg.get_body(preferencelist=("plain", "html"))
    if part is None:
        return ""
    try:
        content = part.get_content()
    except (LookupError, UnicodeDecodeError):
        payload = part.get_payload(decode=True) or b""
        content = payload.decode("utf-8", errors="replace")
    if part.get_content_type() == "text/html":
        from ingestion.connectors.documents import html_to_text

        content = html_to_text(content)[1]
    return str(content).strip()[:MAX_BODY]


def _addresses(value) -> list[str]:
    return [addr for _, addr in getaddresses([str(value or "")]) if addr][:20]


def fetch_inbox(account: EmailAccount, limit: int = FETCH_LIMIT) -> int:
    """
    Traz os e-mails novos da INBOX (UID maior que o último visto). Só leitura:
    `select(readonly=True)` + `BODY.PEEK[]` — não marca como lido no servidor.
    Devolve quantos entraram. Erro fica em `last_fetch_message`, nunca some.
    """
    created = 0
    try:
        conn = _imap_connect(account)
        try:
            conn.select("INBOX", readonly=True)
            if account.imap_last_uid:
                typ, data = conn.uid("search", None, f"UID {account.imap_last_uid + 1}:*")
            else:
                typ, data = conn.uid("search", None, "ALL")
            uids = [int(u) for u in (data[0] or b"").split() if int(u) > account.imap_last_uid]
            for uid in sorted(uids)[-limit:]:
                typ, parts = conn.uid("fetch", str(uid), "(BODY.PEEK[])")
                raw = next((p[1] for p in parts or [] if isinstance(p, tuple)), None)
                if not raw:
                    continue
                msg = message_from_bytes(raw, policy=policy.default)
                try:
                    received = parsedate_to_datetime(str(msg.get("date")))
                    if timezone.is_naive(received):
                        received = timezone.make_aware(received)
                except (TypeError, ValueError):
                    received = timezone.now()
                sender = getaddresses([str(msg.get("from", ""))])
                name, addr = sender[0] if sender else ("", "")
                _, was_created = InboundEmail.objects.get_or_create(
                    account=account,
                    uid=uid,
                    defaults={
                        "tenant_id": account.tenant_id,
                        "sector_id": account.sector_id,
                        "message_id": str(msg.get("message-id", ""))[:255],
                        "from_address": addr[:255],
                        "from_name": name[:255],
                        "to": _addresses(msg.get("to")),
                        "cc": _addresses(msg.get("cc")),
                        "subject": str(msg.get("subject", "(sem assunto)"))[:255],
                        "body": _text_of(msg),
                        "received_at": received,
                    },
                )
                created += int(was_created)
                account.imap_last_uid = max(account.imap_last_uid, uid)
        finally:
            try:
                conn.logout()
            except Exception:  # noqa: BLE001 — logout falhando não apaga o que já entrou
                pass
        account.last_fetch_message = f"{created} e-mail(s) novo(s)."
    except EmailError as exc:
        account.last_fetch_message = str(exc)[:500]
        account.last_fetch_at = timezone.now()
        account.save(
            update_fields=["imap_last_uid", "last_fetch_at", "last_fetch_message", "updated_at"]
        )
        raise
    account.last_fetch_at = timezone.now()
    account.save(
        update_fields=["imap_last_uid", "last_fetch_at", "last_fetch_message", "updated_at"]
    )
    return created

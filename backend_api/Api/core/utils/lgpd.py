# backend_api/core/utils/lgpd.py
import re
import hashlib
import logging
from django.conf import settings
from django.utils import timezone
from cryptography.fernet import Fernet, InvalidToken

logger = logging.getLogger(__name__)


def mask_cpf(cpf: str) -> str:
    if not cpf:
        return "***.***.***-**"
    cpf_clean = re.sub(r'\D', '', str(cpf))
    if len(cpf_clean) != 11:
        return "***.***.***-**"
    return f"***.{cpf_clean[3:6]}.***-{cpf_clean[9:]}"


def mask_email(email: str) -> str:
    if not email or '@' not in email:
        return "***@***.***"
    local, domain = email.split('@', 1)
    if len(local) <= 2:
        local_masked = local[0] + "*"
    else:
        local_masked = local[0] + "*" * (len(local) - 2) + local[-1]
    domain_parts = domain.split('.')
    if len(domain_parts) >= 2:
        domain_name = domain_parts[0]
        tld = domain_parts[-1]
        if len(domain_name) <= 2:
            domain_masked = domain_name[0] + "*"
        else:
            domain_masked = domain_name[0] + "*" * (len(domain_name) - 2) + domain_name[-1]
        return f"{local_masked}@{domain_masked}.{tld}"
    return "***@***.***"


def mask_phone(phone: str) -> str:
    if not phone:
        return "(***) ****-****"
    phone_clean = re.sub(r'\D', '', str(phone))
    if len(phone_clean) < 10:
        return "(***) ****-****"
    return f"(***) ****-{phone_clean[-4:]}"


def encrypt_field(value: str, field_name: str) -> str:
    if not value:
        return value
    if settings.DEBUG:
        salt = getattr(settings, 'CPF_SALT', 'dev_salt_change_in_prod')
        return hashlib.sha256(f"{value}{salt}_{field_name}".encode()).hexdigest()
    encryption_key = getattr(settings, 'ENCRYPTION_KEY', '')
    if not encryption_key:
        logger.warning("ENCRYPTION_KEY não configurada; campo '%s' será armazenado como hash irreversível.", field_name)
        salt = getattr(settings, 'CPF_SALT', 'fallback_salt')
        return hashlib.sha256(f"{value}{salt}_{field_name}".encode()).hexdigest()
    try:
        fernet = Fernet(encryption_key.encode())
        return fernet.encrypt(value.encode()).decode()
    except (ValueError, TypeError) as exc:
        logger.error("Falha ao criptografar campo '%s': %s — verifique ENCRYPTION_KEY.", field_name, exc)
        raise


def decrypt_field(encrypted: str, field_name: str) -> str | None:
    if not encrypted or settings.DEBUG:
        return None
    encryption_key = getattr(settings, 'ENCRYPTION_KEY', '')
    if not encryption_key:
        return None
    try:
        fernet = Fernet(encryption_key.encode())
        return fernet.decrypt(encrypted.encode()).decode()
    except (InvalidToken, ValueError, TypeError) as exc:
        logger.error("Falha ao descriptografar campo '%s': %s", field_name, exc)
        return None


def export_personal_data(user_id: str, fields: list[str]) -> dict:
    from User.models import CustomUser
    try:
        user = CustomUser.objects.get(id=user_id)
        data = {}
        for field in fields:
            value = getattr(user, field, None)
            if value:
                if field in ['cpf', 'phone']:
                    data[field] = mask_cpf(value) if field == 'cpf' else mask_phone(value)
                elif field == 'email':
                    data[field] = mask_email(value)
                else:
                    data[field] = str(value)
        return {
            "user_id": user_id,
            "exported_at": timezone.now().isoformat(),
            "data": data,
            "note": "Dados mascarados conforme LGPD."
        }
    except CustomUser.DoesNotExist:
        return {"error": "Usuário não encontrado"}

# Texto livre vindo de fonte externa (Slack, e-mail, planilha, API) — antes de
# virar ingestion.Document, que alimenta a busca semântica e pode aparecer
# numa resposta de IA (CLAUDE.md §1.2). CNPJ fica: é dado de empresa.
_RE_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_RE_CPF = re.compile(r"(?<!\d)\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?!\d)")
_RE_PHONE = re.compile(r"(?<![\w/])(?:\+?55[\s-]?)?\(?\d{2}\)?[\s-]?9?\d{4}[\s-]?\d{4}(?!\d)")


def redact_pii(text: str) -> str:
    """Mascara e-mail, CPF e telefone num texto livre (mantém o resto intacto)."""
    if not text:
        return text
    text = _RE_EMAIL.sub(lambda m: mask_email(m.group(0)), text)
    text = _RE_CPF.sub(lambda m: mask_cpf(m.group(0)), text)
    return _RE_PHONE.sub(lambda m: mask_phone(m.group(0)), text)

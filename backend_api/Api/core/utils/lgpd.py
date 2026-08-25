# backend_api/core/utils/lgpd.py
import re
import hashlib
from django.conf import settings
from django.utils import timezone
from cryptography.fernet import Fernet


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
    try:
        encryption_key = getattr(settings, 'ENCRYPTION_KEY', '')
        if not encryption_key:
            salt = getattr(settings, 'CPF_SALT', 'fallback_salt')
            return hashlib.sha256(f"{value}{salt}_{field_name}".encode()).hexdigest()
        fernet = Fernet(encryption_key.encode())
        return fernet.encrypt(value.encode()).decode()
    except Exception:
        salt = getattr(settings, 'CPF_SALT', 'fallback_salt')
        return hashlib.sha256(f"{value}{salt}_{field_name}".encode()).hexdigest()


def decrypt_field(encrypted: str, field_name: str) -> str | None:
    if not encrypted or settings.DEBUG:
        return None
    try:
        encryption_key = getattr(settings, 'ENCRYPTION_KEY', '')
        if not encryption_key:
            return None
        fernet = Fernet(encryption_key.encode())
        return fernet.decrypt(encrypted.encode()).decode()
    except Exception:
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
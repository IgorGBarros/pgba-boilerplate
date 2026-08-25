# backend_api/Api/harness/crypto.py
"""
Criptografia simétrica das credenciais de IA (API keys/tokens).

Usa a mesma chave (`settings.ENCRYPTION_KEY`) já usada por
`core.utils.lgpd`, mas aqui SEMPRE cifra/decifra de verdade (diferente de
`encrypt_field`, que em DEBUG vira hash irreversível — credencial precisa
ser recuperável para autenticar chamadas, PII não).

Gere uma chave com:
    python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
e configure em ENCRYPTION_KEY no .env.
"""
from django.conf import settings
from cryptography.fernet import Fernet, InvalidToken


class CredentialEncryptionError(Exception):
    pass


def _get_fernet() -> Fernet:
    key = getattr(settings, "ENCRYPTION_KEY", "")
    if not key:
        raise CredentialEncryptionError(
            "ENCRYPTION_KEY não configurada — necessária para armazenar "
            "credenciais de IA com segurança. Gere uma com Fernet.generate_key()."
        )
    return Fernet(key.encode() if isinstance(key, str) else key)


def encrypt_secret(plaintext: str) -> str:
    if not plaintext:
        return ""
    return _get_fernet().encrypt(plaintext.encode()).decode()


def decrypt_secret(ciphertext: str) -> str:
    if not ciphertext:
        return ""
    try:
        return _get_fernet().decrypt(ciphertext.encode()).decode()
    except InvalidToken as exc:
        raise CredentialEncryptionError(
            "Não foi possível decifrar a credencial — ENCRYPTION_KEY pode "
            "ter mudado desde que ela foi salva."
        ) from exc


def mask_secret(plaintext: str) -> str:
    """Para exibição no admin: nunca mostra a chave inteira."""
    if not plaintext:
        return ""
    if len(plaintext) <= 8:
        return "•" * len(plaintext)
    return f"{plaintext[:4]}{'•' * 8}{plaintext[-4:]}"

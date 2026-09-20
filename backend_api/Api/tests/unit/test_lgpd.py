# backend_api/Api/tests/unit/test_lgpd.py
"""
Testes unitários para core.utils.lgpd — criptografia, hash e mascaramento.
"""
import pytest
from cryptography.fernet import Fernet
from unittest.mock import patch


# ---------------------------------------------------------------------------
# mask_* — sem dependência de settings
# ---------------------------------------------------------------------------

def test_mask_cpf_valid():
    from core.utils.lgpd import mask_cpf
    result = mask_cpf("12345678901")
    assert result == "***.456.***-01"


def test_mask_cpf_invalid():
    from core.utils.lgpd import mask_cpf
    assert mask_cpf("123") == "***.***.***-**"
    assert mask_cpf("") == "***.***.***-**"


def test_mask_email():
    from core.utils.lgpd import mask_email
    result = mask_email("joao@exemplo.com")
    assert "@" in result
    assert result.startswith("j")
    assert result.endswith(".com")
    assert "joao" not in result  # local mascarado


def test_mask_email_short_local():
    from core.utils.lgpd import mask_email
    result = mask_email("ab@exemplo.com")
    assert "@" in result


def test_mask_phone():
    from core.utils.lgpd import mask_phone
    result = mask_phone("11987654321")
    assert result.endswith("4321")
    assert result.startswith("(***)")


# ---------------------------------------------------------------------------
# encrypt_field / decrypt_field
# ---------------------------------------------------------------------------

@pytest.fixture
def valid_key():
    return Fernet.generate_key().decode()


def test_encrypt_decrypt_roundtrip(settings, valid_key):
    settings.DEBUG = False
    settings.ENCRYPTION_KEY = valid_key
    from core.utils.lgpd import encrypt_field, decrypt_field
    encrypted = encrypt_field("12345678901", "cpf")
    assert encrypted != "12345678901"
    decrypted = decrypt_field(encrypted, "cpf")
    assert decrypted == "12345678901"


def test_encrypt_debug_returns_hash(settings):
    settings.DEBUG = True
    from core.utils.lgpd import encrypt_field
    result = encrypt_field("12345678901", "cpf")
    # SHA-256 hex digest tem 64 chars
    assert len(result) == 64


def test_encrypt_no_key_logs_warning_and_hashes(settings, caplog):
    import logging
    settings.DEBUG = False
    settings.ENCRYPTION_KEY = ""
    from core.utils.lgpd import encrypt_field
    with caplog.at_level(logging.WARNING, logger="core.utils.lgpd"):
        result = encrypt_field("12345678901", "cpf")
    assert len(result) == 64
    assert "ENCRYPTION_KEY" in caplog.text


def test_encrypt_bad_key_raises(settings):
    settings.DEBUG = False
    settings.ENCRYPTION_KEY = "chave-invalida-nao-e-fernet"
    from core.utils.lgpd import encrypt_field
    with pytest.raises((ValueError, TypeError)):
        encrypt_field("12345678901", "cpf")


def test_decrypt_invalid_token_returns_none(settings, valid_key):
    settings.DEBUG = False
    settings.ENCRYPTION_KEY = valid_key
    from core.utils.lgpd import decrypt_field
    result = decrypt_field("lixo-nao-criptografado", "cpf")
    assert result is None


def test_decrypt_debug_always_none(settings):
    settings.DEBUG = True
    from core.utils.lgpd import decrypt_field
    result = decrypt_field("qualquer-coisa", "cpf")
    assert result is None


def test_encrypt_empty_value_passthrough(settings, valid_key):
    settings.DEBUG = False
    settings.ENCRYPTION_KEY = valid_key
    from core.utils.lgpd import encrypt_field
    assert encrypt_field("", "cpf") == ""

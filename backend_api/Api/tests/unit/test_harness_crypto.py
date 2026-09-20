# backend_api/Api/tests/unit/test_harness_crypto.py
"""Testes unitários para harness.crypto — encrypt/decrypt de credenciais de IA."""
import pytest
from cryptography.fernet import Fernet


@pytest.fixture
def valid_key():
    return Fernet.generate_key().decode()


def test_encrypt_decrypt_roundtrip(settings, valid_key):
    settings.ENCRYPTION_KEY = valid_key
    from harness.crypto import encrypt_secret, decrypt_secret
    ciphertext = encrypt_secret("sk-minha-api-key")
    assert ciphertext != "sk-minha-api-key"
    assert decrypt_secret(ciphertext) == "sk-minha-api-key"


def test_encrypt_empty_returns_empty(settings, valid_key):
    settings.ENCRYPTION_KEY = valid_key
    from harness.crypto import encrypt_secret
    assert encrypt_secret("") == ""


def test_decrypt_empty_returns_empty(settings, valid_key):
    settings.ENCRYPTION_KEY = valid_key
    from harness.crypto import decrypt_secret
    assert decrypt_secret("") == ""


def test_no_key_raises_on_encrypt(settings):
    settings.ENCRYPTION_KEY = ""
    from harness.crypto import encrypt_secret, CredentialEncryptionError
    with pytest.raises(CredentialEncryptionError, match="ENCRYPTION_KEY"):
        encrypt_secret("sk-minha-key")


def test_wrong_key_raises_on_decrypt(settings, valid_key):
    settings.ENCRYPTION_KEY = valid_key
    from harness.crypto import encrypt_secret
    ciphertext = encrypt_secret("sk-minha-key")

    # Troca a chave — simula rotação de ENCRYPTION_KEY
    settings.ENCRYPTION_KEY = Fernet.generate_key().decode()
    from harness.crypto import decrypt_secret, CredentialEncryptionError
    with pytest.raises(CredentialEncryptionError, match="ENCRYPTION_KEY"):
        decrypt_secret(ciphertext)


def test_mask_secret_long():
    from harness.crypto import mask_secret
    result = mask_secret("sk-abc123xyz9999")
    assert result.startswith("sk-a")
    assert result.endswith("9999")
    assert "•" in result


def test_mask_secret_short():
    from harness.crypto import mask_secret
    result = mask_secret("abcd")
    assert "•" in result
    assert len(result) == 4


def test_mask_secret_empty():
    from harness.crypto import mask_secret
    assert mask_secret("") == ""

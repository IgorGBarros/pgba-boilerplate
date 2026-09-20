# backend_api/Api/tests/unit/test_harness_providers.py
"""
Testes unitários para harness.providers — resolução de credencial e
chamadas de embed/chat com httpx mockado.
"""
import uuid
import pytest
from unittest.mock import MagicMock, patch
from cryptography.fernet import Fernet


@pytest.fixture
def tenant_id():
    return uuid.uuid4()


@pytest.fixture(autouse=True)
def valid_key(settings):
    key = Fernet.generate_key().decode()
    settings.ENCRYPTION_KEY = key
    return key


# ---------------------------------------------------------------------------
# get_credential — resolução por prioridade
# ---------------------------------------------------------------------------

def test_get_credential_falls_back_to_env(settings, tenant_id):
    settings.OLLAMA_BASE_URL = "http://ollama:11434"
    settings.OPENAI_API_KEY = ""

    with patch("harness.models.AIProviderCredential.objects") as mock_mgr:
        mock_qs = MagicMock()
        mock_qs.filter.return_value = mock_qs
        mock_qs.first.return_value = None
        mock_mgr.filter.return_value = mock_qs
        from harness.providers import get_credential
        cred = get_credential(tenant_id, "ollama")
    assert cred.provider == "ollama"
    assert "ollama" in cred.base_url


def test_get_credential_env_openai(settings, tenant_id):
    settings.OPENAI_API_KEY = "sk-test-env"
    settings.OPENAI_BASE_URL = ""

    with patch("harness.models.AIProviderCredential.objects") as mock_mgr:
        mock_qs = MagicMock()
        mock_qs.filter.return_value = mock_qs
        mock_qs.first.return_value = None
        mock_mgr.filter.return_value = mock_qs
        from harness.providers import get_credential
        cred = get_credential(tenant_id, "openai")
    assert cred.api_key == "sk-test-env"


# ---------------------------------------------------------------------------
# embed — mock httpx
# ---------------------------------------------------------------------------

def test_embed_returns_vector(settings, tenant_id):
    settings.EMBEDDING_PROVIDER = "ollama"
    settings.EMBEDDING_MODEL = "nomic-embed-text"
    settings.OLLAMA_BASE_URL = "http://ollama:11434"
    fake_vector = [0.1] * 768

    with patch("harness.models.AIProviderCredential.objects") as mock_mgr:
        mock_qs = MagicMock()
        mock_qs.filter.return_value = mock_qs
        mock_qs.first.return_value = None
        mock_mgr.filter.return_value = mock_qs
        with patch("harness.providers.httpx.post") as mock_post:
            mock_post.return_value = MagicMock(
                status_code=200,
                json=lambda: {"embedding": fake_vector},
            )
            from harness.providers import embed
            result = embed(tenant_id, "ollama", "nomic-embed-text", "texto de teste")
    assert result == fake_vector


def test_embed_http_error_raises(settings, tenant_id):
    settings.EMBEDDING_PROVIDER = "ollama"
    settings.OLLAMA_BASE_URL = "http://ollama:11434"

    with patch("harness.models.AIProviderCredential.objects") as mock_mgr:
        mock_qs = MagicMock()
        mock_qs.filter.return_value = mock_qs
        mock_qs.first.return_value = None
        mock_mgr.filter.return_value = mock_qs
        with patch("harness.providers.httpx.post") as mock_post:
            mock_post.side_effect = Exception("connection refused")
            from harness.providers import embed, ProviderConfigError
            with pytest.raises(Exception):
                embed(tenant_id, "ollama", "nomic-embed-text", "texto")

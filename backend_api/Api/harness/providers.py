# backend_api/Api/harness/providers.py
"""
Resolução de credencial + cliente HTTP unificado para qualquer provedor.

`ingestion.services` e `orchestration.services` não devem mais montar
requisições HTTP a Ollama/OpenAI diretamente com chave vinda só de
`settings` — devem chamar `harness.providers.get_credential()` e/ou
`chat_completion()` / `embed()` daqui, para que a troca de provedor e a
configuração de chave sejam centralizadas neste único módulo.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

import httpx
from django.conf import settings

logger = logging.getLogger(__name__)

DEFAULT_BASE_URLS = {
    # Nome do serviço no docker-compose, não "localhost" — de dentro do
    # container do backend, "localhost" aponta pro próprio container do
    # backend, não pro container do Ollama (rede interna do Docker
    # resolve nomes de serviço, não localhost). Quem roda Django fora de
    # Docker com Ollama nativo instalado localmente deve sobrescrever via
    # `--base-url http://localhost:11434` ou `OLLAMA_BASE_URL` no .env.
    "ollama": "http://ollama:11434",
    "openai": "https://api.openai.com/v1",
    "anthropic": "https://api.anthropic.com/v1",
    "groq": "https://api.groq.com/openai/v1",
    "openrouter": "https://openrouter.ai/api/v1",
}

# Provedores que falam o dialeto "OpenAI-compatible" de /chat/completions
# (Groq e OpenRouter são compatíveis; Ollama tem endpoint próprio, ver services).
OPENAI_COMPATIBLE = {"openai", "groq", "openrouter"}


@dataclass
class ResolvedCredential:
    provider: str
    api_key: str
    base_url: str
    default_model: str = ""


class ProviderConfigError(Exception):
    pass


def get_credential(tenant_id, provider: str) -> ResolvedCredential:
    """
    Resolve a credencial a usar, nesta ordem:
      1. AIProviderCredential ativa do tenant para esse provider
      2. AIProviderCredential ativa global (tenant_id nulo) para esse provider
      3. Variável de ambiente (fallback dev): <PROVIDER>_API_KEY / <PROVIDER>_BASE_URL
    """
    from harness.models import AIProviderCredential

    qs = AIProviderCredential.objects.filter(provider=provider, is_active=True)

    cred = None
    if tenant_id:
        cred = qs.filter(tenant_id=tenant_id).first()
    if cred is None:
        cred = qs.filter(tenant_id__isnull=True).first()

    if cred is not None:
        return ResolvedCredential(
            provider=provider,
            api_key=cred.api_key,
            base_url=cred.base_url or DEFAULT_BASE_URLS.get(provider, ""),
            default_model=cred.default_model,
        )

    # Fallback: variáveis de ambiente diretas (comportamento anterior, dev-friendly)
    env_key = getattr(settings, f"{provider.upper()}_API_KEY", "")
    env_base = getattr(settings, f"{provider.upper()}_BASE_URL", "") or DEFAULT_BASE_URLS.get(provider, "")

    if provider != "ollama" and not env_key:
        raise ProviderConfigError(
            f"Nenhuma credencial configurada para '{provider}' (nem no banco via "
            f"AIProviderCredential, nem em {provider.upper()}_API_KEY). "
            f"Configure pelo Django admin, por `python manage.py configure_ai_provider`, "
            f"ou pelo .env."
        )

    return ResolvedCredential(provider=provider, api_key=env_key, base_url=env_base)


def chat_completion(
    tenant_id, provider: str, model: str, messages: list[dict],
    temperature: float = 0.3, json_mode: bool = False, timeout: float = 45.0,
) -> str:
    """
    Chamada de chat unificada. Retorna o texto da resposta (já extraído).
    Único ponto do projeto que deveria montar essa requisição — nunca
    duplicar isso em `ingestion` ou `orchestration`.
    """
    cred = get_credential(tenant_id, provider)

    if provider == "ollama":
        return _chat_ollama(cred, model, messages, temperature, json_mode, timeout)
    if provider in OPENAI_COMPATIBLE:
        return _chat_openai_compatible(cred, model, messages, temperature, json_mode, timeout)
    if provider == "anthropic":
        return _chat_anthropic(cred, model, messages, temperature, timeout)

    raise ProviderConfigError(f"Provedor '{provider}' não suportado.")


def _chat_ollama(cred, model, messages, temperature, json_mode, timeout):
    try:
        resp = httpx.post(
            f"{cred.base_url}/api/chat",
            json={
                "model": model,
                "messages": messages,
                "stream": False,
                "format": "json" if json_mode else None,
                "options": {"temperature": temperature},
            },
            timeout=timeout,
        )
        resp.raise_for_status()
        return resp.json().get("message", {}).get("content", "").strip()
    except httpx.HTTPStatusError as exc:
        # O Ollama devolve o motivo real no corpo (ex: "model 'llama3' not
        # found, try pulling it first") — sem isso, só aparecia o texto
        # genérico do httpx ("Client error '404 Not Found' for url...."),
        # que não dizia o que fazer pra corrigir.
        try:
            detail = exc.response.json().get("error", exc.response.text)
        except Exception:
            detail = exc.response.text or str(exc)
        hint = (
            f" — modelo '{model}' provavelmente não foi baixado neste Ollama. "
            f"Rode: docker compose exec ollama ollama pull {model}"
            if exc.response.status_code == 404
            else ""
        )
        logger.error("Erro Ollama chat (%s): %s", exc.response.status_code, detail)
        raise ProviderConfigError(f"{detail}{hint}") from exc
    except httpx.HTTPError as exc:
        logger.error("Erro Ollama chat: %s", exc)
        raise ProviderConfigError(str(exc)) from exc


def _chat_openai_compatible(cred, model, messages, temperature, json_mode, timeout):
    if not cred.api_key:
        raise ProviderConfigError(f"Credencial sem api_key para '{cred.provider}'.")
    try:
        body = {"model": model, "messages": messages, "temperature": temperature}
        if json_mode:
            body["response_format"] = {"type": "json_object"}
        resp = httpx.post(
            f"{cred.base_url}/chat/completions",
            headers={"Authorization": f"Bearer {cred.api_key}"},
            json=body,
            timeout=timeout,
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"].strip()
    except (httpx.HTTPError, KeyError, IndexError) as exc:
        logger.error("Erro %s chat: %s", cred.provider, exc)
        raise ProviderConfigError(str(exc)) from exc


def _chat_anthropic(cred, model, messages, temperature, timeout):
    if not cred.api_key:
        raise ProviderConfigError("Credencial sem api_key para 'anthropic'.")
    system = "\n".join(m["content"] for m in messages if m["role"] == "system")
    user_messages = [m for m in messages if m["role"] != "system"]
    try:
        resp = httpx.post(
            f"{cred.base_url}/messages",
            headers={
                "x-api-key": cred.api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": model,
                "system": system,
                "messages": user_messages,
                "max_tokens": 1024,
                "temperature": temperature,
            },
            timeout=timeout,
        )
        resp.raise_for_status()
        blocks = resp.json().get("content", [])
        return "".join(b.get("text", "") for b in blocks if b.get("type") == "text").strip()
    except (httpx.HTTPError, KeyError, IndexError) as exc:
        logger.error("Erro Anthropic chat: %s", exc)
        raise ProviderConfigError(str(exc)) from exc


def embed(tenant_id, provider: str, model: str, text: str, timeout: float = 30.0) -> list[float]:
    """Embeddings — hoje só Ollama e OpenAI-compatible expõem endpoint dedicado."""
    cred = get_credential(tenant_id, provider)

    if provider == "ollama":
        try:
            resp = httpx.post(
                f"{cred.base_url}/api/embeddings",
                json={"model": model, "prompt": text},
                timeout=timeout,
            )
            resp.raise_for_status()
            vector = resp.json().get("embedding")
            if not vector:
                raise ProviderConfigError("Ollama retornou embedding vazio.")
            return vector
        except httpx.HTTPError as exc:
            raise ProviderConfigError(str(exc)) from exc

    if provider in OPENAI_COMPATIBLE:
        if not cred.api_key:
            raise ProviderConfigError(f"Credencial sem api_key para '{provider}'.")
        try:
            resp = httpx.post(
                f"{cred.base_url}/embeddings",
                headers={"Authorization": f"Bearer {cred.api_key}"},
                json={"model": model, "input": text},
                timeout=timeout,
            )
            resp.raise_for_status()
            return resp.json()["data"][0]["embedding"]
        except (httpx.HTTPError, KeyError, IndexError) as exc:
            raise ProviderConfigError(str(exc)) from exc

    raise ProviderConfigError(f"Provedor '{provider}' não suporta embeddings aqui.")

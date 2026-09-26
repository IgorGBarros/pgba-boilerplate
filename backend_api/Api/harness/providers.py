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
import re
import time
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass

import httpx
from django.conf import settings

from core.signals import chamada_ia

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


# Ordem de prioridade: quem está no topo substitui quem está abaixo.
_PROVIDER_PRIORITY = ["openrouter", "groq", "openai", "anthropic", "ollama"]


def get_active_provider(tenant_id) -> str:
    """
    Retorna o nome do provedor de chat a usar, em ordem de prioridade:
      openrouter → groq → openai → anthropic → ollama

    Leva em conta AIProviderCredential no banco (tenant ou global) antes
    de cair no CHAT_PROVIDER do .env.
    """
    from harness.models import AIProviderCredential

    qs = AIProviderCredential.objects.filter(is_active=True)
    if tenant_id:
        db_providers = set(
            qs.filter(tenant_id=tenant_id).values_list("provider", flat=True)
        ) | set(qs.filter(tenant_id__isnull=True).values_list("provider", flat=True))
    else:
        db_providers = set(qs.filter(tenant_id__isnull=True).values_list("provider", flat=True))

    for p in _PROVIDER_PRIORITY:
        if p in db_providers:
            return p

    # Nenhuma credencial no banco — cai no .env
    return getattr(settings, "CHAT_PROVIDER", "ollama")


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


def credential_source(tenant_id, provider: str) -> str | None:
    """
    De onde viria a credencial: "tenant", "global", "env" ou None (nenhuma) —
    mesma ordem de get_credential.
    """
    from harness.models import AIProviderCredential

    qs = AIProviderCredential.objects.filter(provider=provider, is_active=True)
    if tenant_id and qs.filter(tenant_id=tenant_id).exists():
        return "tenant"
    if qs.filter(tenant_id__isnull=True).exists():
        return "global"
    if provider == "ollama" or getattr(settings, f"{provider.upper()}_API_KEY", ""):
        return "env"
    return None


def provider_readiness(tenant_id, provider: str, model: str | None = None) -> str | None:
    """
    Diz se `chat_completion(tenant_id, provider, model, ...)` teria o que
    precisa pra rodar — credencial E modelo resolvidos pelas MESMAS regras
    de `get_credential`/`chat_completion` — sem chamar o provedor. Devolve
    `None` quando está pronto, ou a mensagem do `ProviderConfigError` que a
    chamada real levantaria. Não testa rede nem validade da chave: serve
    pra avisar antes ("este setor usa Claude e não há credencial"), não
    pra garantir que a chamada vai dar certo.
    """
    if provider not in DEFAULT_BASE_URLS:
        return f"Provedor '{provider}' não suportado."
    try:
        cred = get_credential(tenant_id, provider)
    except ProviderConfigError as exc:
        return str(exc)
    if not (model or cred.default_model or getattr(settings, f"{provider.upper()}_CHAT_MODEL", "")):
        return (
            f"Nenhum modelo configurado para '{provider}' — defina em "
            f"`configure_ai_provider --provider {provider} --model ...`."
        )
    return None


@dataclass
class ChatUsage:
    """Uma chamada de chat: quem respondeu e os tokens que o PROVEDOR informou."""

    provider: str
    model: str
    tokens_in: int
    tokens_out: int


# Coletores de uso por contexto (thread/async-safe): quem precisa saber
# quanto custaram as chamadas feitas por baixo (ex: agency, que chama
# orchestration.answer_question — 1 a 2 chamadas de chat lá dentro) abre um
# `with track_usage() as usage:` e lê a lista no fim. Aninháveis: cada
# chamada entra em TODOS os coletores abertos (orchestration mede a dele pro
# QueryLog, agency mede a mesma pro custo do agente). Sem coletor, nada é
# guardado. Evita mudar a assinatura de toda função intermediária.
_usage_collectors: ContextVar[tuple[list[ChatUsage], ...]] = ContextVar(
    "harness_usage_collectors", default=(),
)


@contextmanager
def track_usage():
    mine: list[ChatUsage] = []
    token = _usage_collectors.set(_usage_collectors.get() + (mine,))
    try:
        yield mine
    finally:
        _usage_collectors.reset(token)


def resolve_model(tenant_id, provider: str, model: str | None) -> str:
    """Modelo efetivo: o pedido, senão o `default_model` da credencial, senão o do .env."""
    cred = get_credential(tenant_id, provider)
    return _resolve_model_for(cred, provider, model)


def _resolve_model_for(cred: ResolvedCredential, provider: str, model: str | None) -> str:
    env_model = getattr(settings, f"{provider.upper()}_CHAT_MODEL", "")
    resolved = model or cred.default_model or env_model
    if not resolved:
        raise ProviderConfigError(
            f"Nenhum modelo configurado para '{provider}' — defina em "
            f"`configure_ai_provider --provider {provider} --model ...` "
            f"(recomendado) ou em {provider.upper()}_CHAT_MODEL no .env."
        )
    return resolved


def chat_completion(
    tenant_id, provider: str, model: str | None, messages: list[dict],
    temperature: float = 0.3, json_mode: bool = False, timeout: float | None = None,
) -> str:
    """
    Chamada de chat unificada. Retorna o texto da resposta (já extraído).
    Único ponto do projeto que deveria montar essa requisição — nunca
    duplicar isso em `ingestion` ou `orchestration`.

    `model=None` (ou vazio) resolve o modelo pela MESMA credencial que
    `get_credential()` já usou pra `base_url`/`api_key` — nunca uma
    segunda fonte de configuração. Antes disso, cada chamador lia direto
    de `settings.OLLAMA_CHAT_MODEL`, ignorando o `default_model` que
    `configure_ai_provider`/Django admin salvam no banco: rodar o comando
    de configuração não tinha efeito nenhum na prática, porque nada
    olhava pro valor que ele salvava — só pro `.env`, que ninguém era
    instruído a atualizar também.

    `timeout=None` resolve de `CHAT_TIMEOUT_SECONDS` (.env, padrão 120s)
    — 45s fixo era curto demais pra gerar uma página inteira num modelo
    de alguns GB rodando em CPU sem GPU; hardware varia demais entre
    quem usa isso pra fixar um número só que sirva pra todo mundo.

    Os tokens informados pelo provedor vão pro coletor de `track_usage()`
    quando houver um aberto.
    """
    text, _, _ = chat_completion_with_usage(
        tenant_id, provider, model, messages,
        temperature=temperature, json_mode=json_mode, timeout=timeout,
    )
    return text


def chat_completion_with_usage(
    tenant_id, provider: str, model: str | None, messages: list[dict],
    temperature: float = 0.3, json_mode: bool = False, timeout: float | None = None,
) -> tuple[str, int, int]:
    """
    Como chat_completion mas retorna (texto, tokens_in, tokens_out) — os
    tokens que o provedor informou (estimativa só se ele não informar).
    """
    inicio = time.monotonic()
    resolved_model = model or ""
    try:
        text, tin, tout, resolved_model = _chat_dispatch(
            tenant_id, provider, model, messages, temperature, json_mode, timeout
        )
    except Exception as exc:
        chamada_ia.send_robust(
            None, tenant_id=tenant_id, provider=provider, model=resolved_model, ok=False,
            ms=int((time.monotonic() - inicio) * 1000), erro=str(exc)[:500],
        )
        raise
    chamada_ia.send_robust(
        None, tenant_id=tenant_id, provider=provider, model=resolved_model, ok=True,
        ms=int((time.monotonic() - inicio) * 1000), erro="",
    )
    for collector in _usage_collectors.get():
        collector.append(ChatUsage(provider, resolved_model, tin, tout))
    return text, tin, tout


def _chat_dispatch(tenant_id, provider, model, messages, temperature, json_mode, timeout):
    cred = get_credential(tenant_id, provider)
    resolved_model = _resolve_model_for(cred, provider, model)
    resolved_timeout = timeout if timeout is not None else getattr(settings, "CHAT_TIMEOUT_SECONDS", 120.0)

    if provider == "ollama":
        text, tin, tout = _chat_ollama(
            cred, resolved_model, messages, temperature, json_mode, resolved_timeout,
        )
    elif provider in OPENAI_COMPATIBLE:
        text, tin, tout = _chat_openai_compatible(
            cred, resolved_model, messages, temperature, json_mode, resolved_timeout,
        )
    elif provider == "anthropic":
        text, tin, tout = _chat_anthropic(
            cred, resolved_model, messages, temperature, resolved_timeout,
        )
    else:
        raise ProviderConfigError(f"Provedor '{provider}' não suportado.")
    return text, tin, tout, resolved_model


def _estimate_tokens(text: str) -> int:
    """Estimativa simples: ~4 chars por token."""
    return max(1, len(text) // 4)


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
        data = resp.json()
        text = data.get("message", {}).get("content", "").strip()
        tokens_in = data.get("prompt_eval_count") or _estimate_tokens(str(messages))
        tokens_out = data.get("eval_count") or _estimate_tokens(text)
        return text, tokens_in, tokens_out
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
        if not resp.is_success:
            try:
                detail = resp.json()
            except Exception:
                detail = resp.text
            logger.error("Erro %s chat (%s): %s", cred.provider, resp.status_code, detail)
            resp.raise_for_status()
        data = resp.json()
        text = data["choices"][0]["message"]["content"].strip()
        usage = data.get("usage") or {}
        tokens_in = usage.get("prompt_tokens") or _estimate_tokens(str(messages))
        tokens_out = usage.get("completion_tokens") or _estimate_tokens(text)
        return text, tokens_in, tokens_out
    except httpx.HTTPStatusError as exc:
        raise ProviderConfigError(str(exc)) from exc
    except (httpx.HTTPError, KeyError, IndexError) as exc:
        logger.error("Erro %s chat: %s", cred.provider, exc)
        raise ProviderConfigError(str(exc)) from exc


# Modelos Claude que RECUSAM parâmetros de amostragem (temperature/top_p/
# top_k) com 400: famílias Fable/Mythos, Opus/Sonnet 5+ e Opus 4.7/4.8.
# Mandar temperature pra eles derrubava toda chamada do setor fixado em
# Claude. Modelos anteriores (Sonnet/Opus 4.6, Haiku 4.5...) ainda aceitam.
_ANTHROPIC_NO_SAMPLING = re.compile(
    r"^claude-(fable|mythos)|^claude-(opus|sonnet)-([5-9]|\d{2})|^claude-opus-4-[78]"
)


def _chat_anthropic(cred, model, messages, temperature, timeout):
    if not cred.api_key:
        raise ProviderConfigError("Credencial sem api_key para 'anthropic'.")
    system = "\n".join(m["content"] for m in messages if m["role"] == "system")
    user_messages = [m for m in messages if m["role"] != "system"]
    body: dict = {
        "model": model,
        "messages": user_messages,
        "max_tokens": 4096,
    }
    if not _ANTHROPIC_NO_SAMPLING.match(model):
        body["temperature"] = temperature
    if system:
        body["system"] = system
    try:
        resp = httpx.post(
            f"{cred.base_url}/messages",
            headers={
                "x-api-key": cred.api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json=body,
            timeout=timeout,
        )
        if not resp.is_success:
            try:
                detail = resp.json()
            except Exception:
                detail = resp.text
            logger.error("Erro Anthropic chat (%s): %s", resp.status_code, detail)
            resp.raise_for_status()
        data = resp.json()
        if data.get("stop_reason") == "refusal":
            raise ProviderConfigError("O modelo recusou o pedido (stop_reason=refusal).")
        blocks = data.get("content", [])
        text = "".join(b.get("text", "") for b in blocks if b.get("type") == "text").strip()
        usage = data.get("usage") or {}
        tokens_in = (
            (usage.get("input_tokens") or 0)
            + (usage.get("cache_read_input_tokens") or 0)
            + (usage.get("cache_creation_input_tokens") or 0)
        ) or _estimate_tokens(str(messages))
        tokens_out = usage.get("output_tokens") or _estimate_tokens(text)
        return text, tokens_in, tokens_out
    except httpx.HTTPStatusError as exc:
        raise ProviderConfigError(str(exc)) from exc
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


# Transcrição de áudio (Whisper) — Groq e OpenAI expõem `/audio/transcriptions`
# no mesmo dialeto. Ollama não tem Whisper: vídeo sem legenda precisa de uma
# dessas duas credenciais (opt-in explícito, como qualquer nuvem aqui).
TRANSCRIBE_MODELS = {"groq": "whisper-large-v3-turbo", "openai": "whisper-1"}
TRANSCRIBE_MAX_BYTES = 25 * 1024 * 1024


def transcription_provider(tenant_id) -> str | None:
    """Primeiro provedor com credencial que transcreve (groq → openai), ou None."""
    for provider in ("groq", "openai"):
        try:
            if get_credential(tenant_id, provider).api_key:
                return provider
        except ProviderConfigError:
            continue
    return None


def transcribe(
    tenant_id, audio: bytes, filename: str = "audio.mp3", language: str = "pt",
    provider: str | None = None, timeout: float = 600.0,
) -> list[dict]:
    """
    Transcreve áudio e devolve segmentos com tempo: [{"inicio", "fim", "texto"}].
    Levanta ProviderConfigError de forma explícita (sem credencial, arquivo
    grande demais, resposta sem segmentos).
    """
    provider = provider or transcription_provider(tenant_id)
    if provider not in TRANSCRIBE_MODELS:
        raise ProviderConfigError(
            "Transcrever áudio precisa de credencial da Groq ou da OpenAI (Whisper) — "
            "configure em IA (painel administrativo)."
        )
    if len(audio) > TRANSCRIBE_MAX_BYTES:
        raise ProviderConfigError("Áudio acima de 25 MB — o provedor não aceita.")
    cred = get_credential(tenant_id, provider)
    try:
        resp = httpx.post(
            f"{cred.base_url}/audio/transcriptions",
            headers={"Authorization": f"Bearer {cred.api_key}"},
            data={
                "model": TRANSCRIBE_MODELS[provider],
                "response_format": "verbose_json",
                "language": language,
            },
            files={"file": (filename, audio, "audio/mpeg")},
            timeout=timeout,
        )
        resp.raise_for_status()
        data = resp.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise ProviderConfigError(f"Transcrição falhou ({provider}): {exc}") from exc
    segs = [
        {"inicio": float(s["start"]), "fim": float(s["end"]), "texto": str(s["text"]).strip()}
        for s in data.get("segments") or []
        if str(s.get("text", "")).strip()
    ]
    if not segs:
        raise ProviderConfigError("A transcrição voltou sem falas.")
    return segs

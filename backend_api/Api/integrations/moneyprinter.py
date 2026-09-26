# backend_api/Api/integrations/moneyprinter.py
"""
MoneyPrinterTurbo — gerador de vídeo curto (roteiro → banco de imagens →
narração → legenda → MP4). Projeto aberto (MIT,
github.com/harry0703/MoneyPrinterTurbo) que roda como SERVIÇO À PARTE (a API
FastAPI dele, porta 8080) — nada do código dele é copiado pra cá; esta é só a
chamada à API pública dele:

    POST {url}/api/v1/videos        cria a tarefa (devolve task_id)
    GET  {url}/api/v1/tasks/{id}     estado (1 = pronto, -1 = falhou, 4 = processando)
    GET  {url}/tasks/{id}/final-1.mp4  o vídeo

Credencial: `ServiceCredential(provider="moneyprinter")`, `account_ref` = URL
(ex.: http://moneyprinter:8080), token = `app.api_key` do config.toml dele
(opcional, mas recomendado). O ROTEIRO e as palavras-chave de busca vão
prontos daqui (IA do setor Marketing, pelo harness) — o MoneyPrinter não
precisa de LLM configurado, só da chave do Pexels/Pixabay pro banco de vídeos.

Rede interna (serviço do docker-compose) só com o host em
CONNECTORS_ALLOWED_PRIVATE_HOSTS — mesma regra anti-SSRF dos conectores.
"""
from __future__ import annotations

from urllib.parse import urljoin

from ingestion.connectors import ConnectorError, safe_http
from integrations.models import ServiceCredential
from integrations.services import IntegrationConfigError, get_credential

ESTADO_FALHOU = -1
ESTADO_PRONTO = 1
ESTADO_PROCESSANDO = 4
MAX_VIDEO = 500 * 1024 * 1024


class MoneyPrinterError(Exception):
    pass


def _client(tenant_id) -> tuple[str, dict]:
    try:
        cred = get_credential(tenant_id, ServiceCredential.Provider.MONEYPRINTER)
    except IntegrationConfigError as exc:
        raise MoneyPrinterError(
            "MoneyPrinterTurbo não configurado — informe a URL da API dele no painel "
            "administrativo (Integrações → MoneyPrinterTurbo)."
        ) from exc
    base = (cred.account_ref or "").rstrip("/")
    if not base:
        raise MoneyPrinterError("Falta a URL da API do MoneyPrinterTurbo.")
    if base.endswith("/api/v1"):
        base = base[: -len("/api/v1")]
    headers = {"Accept": "application/json"}
    try:
        token = cred.token
    except Exception:  # noqa: BLE001 — sem ENCRYPTION_KEY o token não abre
        token = ""
    if token:
        headers["x-api-key"] = token
    return base, headers


def _json(method: str, tenant_id, path: str, **kwargs) -> dict:
    base, headers = _client(tenant_id)
    try:
        resp = safe_http.request(
            method, f"{base}{path}", headers=headers, raise_for_status=False, **kwargs
        )
    except ConnectorError as exc:
        raise MoneyPrinterError(str(exc)) from exc
    try:
        data = resp.json()
    except ValueError:
        data = {}
    if resp.status_code >= 400:
        msg = data.get("message") if isinstance(data, dict) else ""
        raise MoneyPrinterError(
            f"MoneyPrinterTurbo respondeu {resp.status_code}: {msg or resp.text[:200]}"
        )
    return data if isinstance(data, dict) else {"data": data}


def test_connection(tenant_id) -> str:
    base, headers = _client(tenant_id)
    try:
        safe_http.request("GET", f"{base}/ping", headers=headers)
        # /ping não pede chave; a lista de tarefas pede — confere a chave também
        _json("GET", tenant_id, "/api/v1/tasks", params={"page": 1, "page_size": 1})
    except ConnectorError as exc:
        raise MoneyPrinterError(str(exc)) from exc
    return f"MoneyPrinterTurbo respondeu em {base}."


def criar_video(
    tenant_id,
    *,
    assunto: str,
    roteiro: str,
    termos: list[str],
    proporcao: str = "9:16",
    voz: str = "pt-BR-FranciscaNeural-Female",
    idioma: str = "pt-BR",
    legenda: bool = True,
    musica: bool = True,
    duracao_cena: int = 4,
) -> str:
    """Cria a tarefa no MoneyPrinter. Devolve o task_id dele."""
    if proporcao not in ("9:16", "16:9", "1:1"):
        raise MoneyPrinterError("Proporção inválida (use 9:16, 16:9 ou 1:1).")
    body = {
        "video_subject": assunto[:200],
        "video_script": roteiro,
        "video_terms": [t for t in termos if t][:12],
        "video_aspect": proporcao,
        "video_language": idioma,
        "voice_name": voz,
        "subtitle_enabled": legenda,
        "bgm_type": "random" if musica else "",
        "video_source": "pexels",
        "video_clip_duration": max(2, min(duracao_cena, 10)),
        "video_count": 1,
    }
    data = _json("POST", tenant_id, "/api/v1/videos", json=body)
    task_id = (data.get("data") or {}).get("task_id")
    if not task_id:
        raise MoneyPrinterError("O MoneyPrinterTurbo não devolveu o id da tarefa.")
    return task_id


def estado(tenant_id, task_id: str) -> dict:
    """{"estado": processando|pronto|falhou, "progresso": int, "videos": [url], "erro": str}"""
    data = _json("GET", tenant_id, f"/api/v1/tasks/{task_id}").get("data") or {}
    state = data.get("state")
    base, _ = _client(tenant_id)
    videos = [urljoin(f"{base}/", str(v).lstrip("/")) for v in data.get("videos") or []]
    return {
        "estado": (
            "pronto"
            if state == ESTADO_PRONTO
            else "falhou"
            if state == ESTADO_FALHOU
            else "processando"
        ),
        "progresso": int(data.get("progress") or 0),
        "videos": videos,
        "erro": data.get("error") or "",
    }


def baixar(tenant_id, url: str, destino) -> int:
    base, headers = _client(tenant_id)
    if not url.startswith(base):
        # O link vem da resposta do próprio MoneyPrinter; outro host não é baixado.
        raise MoneyPrinterError("Link de vídeo fora do servidor do MoneyPrinterTurbo.")
    try:
        return safe_http.download(url, destino, max_bytes=MAX_VIDEO, headers=headers)
    except ConnectorError as exc:
        raise MoneyPrinterError(str(exc)) from exc

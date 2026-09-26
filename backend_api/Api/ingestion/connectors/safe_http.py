# backend_api/Api/ingestion/connectors/safe_http.py
"""
Saída de rede dos conectores — o ÚNICO jeito de um conector falar com fora.

O endereço vem do usuário (URL da API, host do banco, servidor IMAP), então
sem trava qualquer um do tenant faria o servidor acessar a rede interna
(metadados da nuvem em 169.254.169.254, o Postgres/Redis da própria
plataforma em localhost) — SSRF. Regras:

- só http/https (nada de file://, gopher://...);
- o host precisa resolver SÓ pra IP público; IP privado, loopback,
  link-local, reservado ou multicast é recusado;
- redirect é seguido à mão, conferindo cada salto;
- resposta tem teto de tamanho e a chamada tem timeout.

Rede interna de propósito (ex: o banco da empresa na VPN) só por lista
explícita: CONNECTORS_ALLOWED_PRIVATE_HOSTS no .env (hosts separados por vírgula).

Limite honesto: entre conferir o DNS e o httpx conectar, o DNS pode mudar
(DNS rebinding). Pra fechar isso de vez, rode os workers atrás de um proxy
de saída / regra de firewall que bloqueie as faixas privadas.
"""
from __future__ import annotations

import ipaddress
import socket
import time
from urllib.parse import urljoin, urlparse

import httpx
from django.conf import settings

from core.signals import saida_http
from ingestion.connectors.base import ConnectorError

MAX_BYTES = 10 * 1024 * 1024
TIMEOUT = 20.0
MAX_REDIRECTS = 5
USER_AGENT = "PGBA-Connector/1.0"

# Testes trocam por httpx.MockTransport
_transport: httpx.BaseTransport | None = None


def _allowed_private_hosts() -> set[str]:
    raw = getattr(settings, "CONNECTORS_ALLOWED_PRIVATE_HOSTS", "") or ""
    if isinstance(raw, (list, tuple, set)):
        return {h.strip().lower() for h in raw if h}
    return {h.strip().lower() for h in raw.split(",") if h.strip()}


def _resolve(host: str, port: int) -> list[str]:
    try:
        infos = socket.getaddrinfo(host, port, proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise ConnectorError(f"Não consegui resolver o endereço '{host}'.") from exc
    return sorted({info[4][0] for info in infos})


def check_host(host: str, port: int) -> None:
    """Recusa host que resolva pra rede interna (a menos que esteja na lista liberada)."""
    host = (host or "").strip().lower().strip("[]")
    if not host:
        raise ConnectorError("Endereço vazio.")
    if host in _allowed_private_hosts():
        return
    try:  # IP literal: confere o próprio IP, sem DNS
        addrs = [str(ipaddress.ip_address(host))]
    except ValueError:
        addrs = _resolve(host, port)
    for addr in addrs:
        ip = ipaddress.ip_address(addr.split("%")[0])
        if not ip.is_global or ip.is_multicast:
            raise ConnectorError(
                f"'{host}' aponta pra um endereço interno ({addr}) — bloqueado. "
                "Se é um servidor da sua rede de propósito, peça pra incluir em "
                "CONNECTORS_ALLOWED_PRIVATE_HOSTS."
            )


def check_url(url: str) -> str:
    parsed = urlparse((url or "").strip())
    if parsed.scheme not in ("http", "https"):
        raise ConnectorError("Só endereços http:// ou https:// são aceitos.")
    if not parsed.hostname:
        raise ConnectorError("URL sem host.")
    if parsed.username or parsed.password:
        raise ConnectorError("Não coloque usuário/senha na URL — use os campos de autenticação.")
    check_host(parsed.hostname, parsed.port or (443 if parsed.scheme == "https" else 80))
    return parsed.geturl()


def request(
    method: str,
    url: str,
    *,
    timeout: float | None = None,
    max_bytes: int | None = None,
    raise_for_status: bool = True,
    **kwargs,
) -> httpx.Response:
    """
    httpx com as travas acima. Levanta ConnectorError com mensagem legível.

    `raise_for_status=False` devolve a resposta de erro (4xx/5xx) pra quem
    chama ler o corpo — APIs de redes sociais explicam o erro em JSON.
    `timeout`/`max_bytes` sobem o teto pra upload/download de mídia.
    """
    inicio = time.monotonic()
    host = urlparse(url or "").hostname or ""
    status = None
    try:
        resp = _request(method, url, timeout, max_bytes, raise_for_status, **kwargs)
        status = resp.status_code
        return resp
    except ConnectorError as exc:
        saida_http.send_robust(
            None, host=host, method=method, status=status,
            ms=int((time.monotonic() - inicio) * 1000), erro=str(exc)[:300],
        )
        raise
    finally:
        if status is not None:
            saida_http.send_robust(
                None, host=host, method=method, status=status,
                ms=int((time.monotonic() - inicio) * 1000), erro="",
            )


def _request(method, url, timeout, max_bytes, raise_for_status, **kwargs) -> httpx.Response:
    headers = {"User-Agent": USER_AGENT, **(kwargs.pop("headers", None) or {})}
    limit = max_bytes or MAX_BYTES
    current = check_url(url)
    with httpx.Client(
        transport=_transport, timeout=timeout or TIMEOUT, follow_redirects=False
    ) as client:
        for _ in range(MAX_REDIRECTS + 1):
            try:
                with client.stream(method, current, headers=headers, **kwargs) as resp:
                    if resp.is_redirect:
                        location = resp.headers.get("location", "")
                        current = check_url(urljoin(current, location))
                        if resp.status_code in (301, 302, 303):
                            method, kwargs = "GET", {
                                k: v for k, v in kwargs.items() if k == "params"
                            }
                        continue
                    body = bytearray()
                    for chunk in resp.iter_bytes():
                        body.extend(chunk)
                        if len(body) > limit:
                            raise ConnectorError(
                                f"Resposta grande demais (limite de {limit // (1024 * 1024)} MB)."
                            )
                    response = httpx.Response(
                        resp.status_code,
                        headers=resp.headers,
                        content=bytes(body),
                        request=resp.request,
                    )
            except httpx.TimeoutException as exc:
                raise ConnectorError(
                    f"Tempo esgotado falando com {urlparse(current).hostname}."
                ) from exc
            except httpx.HTTPError as exc:
                raise ConnectorError(f"Falha de rede: {exc}") from exc
            if not raise_for_status:
                return response
            if response.status_code in (401, 403):
                raise ConnectorError(
                    f"Acesso negado ({response.status_code}) — confira a credencial."
                )
            if response.status_code >= 400:
                raise ConnectorError(
                    f"A fonte respondeu {response.status_code}: {response.text[:200]}"
                )
            return response
    raise ConnectorError("Redirecionamentos demais.")


def get_json(url: str, **kwargs):
    resp = request("GET", url, **kwargs)
    try:
        return resp.json()
    except ValueError as exc:
        raise ConnectorError("A resposta não é JSON.") from exc


def post_json(url: str, **kwargs):
    resp = request("POST", url, **kwargs)
    try:
        return resp.json()
    except ValueError as exc:
        raise ConnectorError("A resposta não é JSON.") from exc


def download(url: str, dest, *, max_bytes: int, timeout: float = 120.0, **kwargs) -> int:
    """
    Baixa pra arquivo em pedaços (sem carregar tudo na memória), com as
    mesmas travas de host e redirect. Devolve o tamanho gravado.
    """
    headers = {"User-Agent": USER_AGENT, **(kwargs.pop("headers", None) or {})}
    current = check_url(url)
    with httpx.Client(transport=_transport, timeout=timeout, follow_redirects=False) as client:
        for _ in range(MAX_REDIRECTS + 1):
            try:
                with client.stream("GET", current, headers=headers, **kwargs) as resp:
                    if resp.is_redirect:
                        current = check_url(urljoin(current, resp.headers.get("location", "")))
                        continue
                    if resp.status_code >= 400:
                        raise ConnectorError(f"Download recusado ({resp.status_code}).")
                    total = 0
                    with open(dest, "wb") as fh:
                        for chunk in resp.iter_bytes():
                            total += len(chunk)
                            if total > max_bytes:
                                mb = max_bytes // (1024 * 1024)
                                raise ConnectorError(f"Arquivo grande demais (limite de {mb} MB).")
                            fh.write(chunk)
                    return total
            except httpx.TimeoutException as exc:
                raise ConnectorError(
                    f"Tempo esgotado baixando de {urlparse(current).hostname}."
                ) from exc
            except httpx.HTTPError as exc:
                raise ConnectorError(f"Falha de rede: {exc}") from exc
    raise ConnectorError("Redirecionamentos demais.")

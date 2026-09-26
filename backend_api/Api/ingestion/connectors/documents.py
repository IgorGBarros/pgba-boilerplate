# backend_api/Api/ingestion/connectors/documents.py
"""
Conectores de conteúdo (mode="documents"): trazem texto da fonte e cada
unidade vira um ingestion.Document, indexado pra busca semântica dos agentes.

Toda saída de rede passa por `safe_http` (anti-SSRF) e todo texto passa por
`core.utils.lgpd.redact_pii` antes de ser gravado (isso é feito em
ingestion.sync, no mesmo lugar pra todos).
"""
from __future__ import annotations

import base64
import csv
import email
import email.policy
import hashlib
import imaplib
import io
import json
import re
import socket
import time
from html.parser import HTMLParser
from urllib.parse import quote, urljoin, urlparse

from ingestion.connectors import safe_http
from ingestion.connectors.base import BaseConnector, ConnectorError, SyncItem

MAX_ITEMS = 2000


# ─── Utilitários ─────────────────────────────────────────────────────────────


def dig(data, path: str):
    """'data.items' → data["data"]["items"] (índice numérico vale: 'results.0')."""
    for part in [p for p in (path or "").split(".") if p]:
        if isinstance(data, list) and part.isdigit():
            data = data[int(part)] if int(part) < len(data) else None
        elif isinstance(data, dict):
            data = data.get(part)
        else:
            return None
    return data


def flatten(obj, prefix: str = "") -> list[str]:
    """JSON → linhas 'campo: valor' (legível pro modelo, sem chaves e aspas)."""
    lines: list[str] = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            lines += flatten(v, f"{prefix}{k}.")
    elif isinstance(obj, list):
        if all(not isinstance(v, (dict, list)) for v in obj):
            if obj:
                lines.append(f"{prefix[:-1]}: {', '.join(str(v) for v in obj)}")
        else:
            for i, v in enumerate(obj):
                lines += flatten(v, f"{prefix}{i}.")
    elif obj not in (None, ""):
        lines.append(f"{prefix[:-1]}: {obj}")
    return lines


class _TextExtractor(HTMLParser):
    """
    HTML → texto, sem dependência nova. `selector` aceita o básico:
    'tag', '.classe', '#id', 'tag.classe', 'tag#id' — só o texto dentro do
    primeiro elemento que casar entra.
    """

    SKIP = {"script", "style", "noscript", "svg", "head", "template"}
    BLOCK = {"p", "div", "br", "li", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "section", "article"}

    def __init__(self, selector: str = ""):
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.title = ""
        self.links: list[str] = []
        self._skip = 0
        self._in_title = False
        m = (
            re.fullmatch(r"([a-zA-Z0-9]*)(?:([.#])([\w-]+))?", selector.strip())
            if selector
            else None
        )
        self._sel = m.groups() if m else None
        self._depth_in_sel = 0 if self._sel else 1  # sem seletor = página toda
        self._matched = False

    def _matches(self, tag, attrs) -> bool:
        name, kind, value = self._sel
        if name and tag != name:
            return False
        attrs = dict(attrs)
        if kind == ".":
            return value in (attrs.get("class") or "").split()
        if kind == "#":
            return attrs.get("id") == value
        return True

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self._skip += 1
        if tag == "title":
            self._in_title = True
        if tag == "a":
            href = dict(attrs).get("href")
            if href:
                self.links.append(href)
        if self._sel:
            if self._depth_in_sel:
                self._depth_in_sel += 1
            elif not self._matched and self._matches(tag, attrs):
                self._depth_in_sel, self._matched = 1, True
        if tag in self.BLOCK and self._depth_in_sel:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in self.SKIP and self._skip:
            self._skip -= 1
        if tag == "title":
            self._in_title = False
        if self._sel and self._depth_in_sel:
            self._depth_in_sel -= 1

    def handle_data(self, data):
        if self._in_title:
            self.title += data
        elif not self._skip and self._depth_in_sel:
            self.parts.append(data)

    def text(self) -> str:
        raw = "".join(self.parts)
        lines = [re.sub(r"[ \t]+", " ", ln).strip() for ln in raw.splitlines()]
        return "\n".join(ln for ln in lines if ln)


def html_to_text(html: str, selector: str = "") -> tuple[str, str, list[str]]:
    parser = _TextExtractor(selector)
    parser.feed(html)
    return parser.title.strip(), parser.text(), parser.links


# ─── REST API ────────────────────────────────────────────────────────────────


class RestApiConnector(BaseConnector):
    source_type = "rest_api"
    required_fields = ["url"]
    secret_fields = ["api_key"]

    def _headers(self) -> dict:
        auth = (self.config.get("auth_type") or "none").lower()
        key = self.config.get("api_key")
        if auth == "bearer" and key:
            return {"Authorization": f"Bearer {key}"}
        if auth == "api_key" and key:
            return {self.config.get("api_key_header") or "X-API-Key": key}
        return {}

    def _load(self):
        self.check_config()
        data = safe_http.get_json(self.config["url"], headers=self._headers())
        path = self.config.get("data_path") or ""
        items = dig(data, path) if path else data
        if items is None:
            raise ConnectorError(f"O caminho '{path}' não existe na resposta.")
        return items if isinstance(items, list) else [items]

    def test(self) -> str:
        items = self._load()
        return f"Conectou: {len(items)} registro(s) na resposta."

    def fetch(self):
        id_field = self.config.get("id_field") or "id"
        title_field = self.config.get("title_field") or ""
        for i, item in enumerate(self._load()[:MAX_ITEMS]):
            if isinstance(item, dict):
                ident = item.get(id_field)
                title = str(item.get(title_field) or "") if title_field else ""
                content = "\n".join(flatten(item))
            else:
                ident, title, content = None, "", str(item)
            if ident in (None, ""):
                ident = hashlib.sha256(content.encode()).hexdigest()[:16]
            yield SyncItem(
                external_id=f"item:{ident}",
                title=title or f"{self.source.name} #{ident if ident else i + 1}",
                content=content,
                metadata={"origem": self.config["url"]},
            )


# ─── URL / páginas web ───────────────────────────────────────────────────────


class UrlConnector(BaseConnector):
    source_type = "url"
    required_fields = ["url"]

    def _page(self, url: str) -> tuple[str, str, list[str]]:
        resp = safe_http.request("GET", url)
        ctype = resp.headers.get("content-type", "")
        if "html" not in ctype and "text" not in ctype:
            raise ConnectorError(f"{url} não é uma página de texto ({ctype or 'sem tipo'}).")
        if "html" in ctype:
            return html_to_text(resp.text, self.config.get("css_selector") or "")
        return "", resp.text, []

    def test(self) -> str:
        self.check_config()
        title, text, _ = self._page(self.config["url"])
        return f"Conectou: '{title or self.config['url']}', {len(text)} caracteres de texto."

    def fetch(self):
        self.check_config()
        start = self.config["url"]
        host = urlparse(start).hostname
        follow = self.cfg_bool("follow_links")
        max_pages = self.cfg_int("max_pages", 20, 100) if follow else 1
        queue, seen = [start], set()
        while queue and len(seen) < max_pages:
            url = queue.pop(0).split("#")[0]
            if url in seen:
                continue
            seen.add(url)
            try:
                title, text, links = self._page(url)
            except ConnectorError:
                if url == start:
                    raise
                continue
            if text:
                yield SyncItem(
                    external_id=url, title=title or url, content=text, metadata={"url": url}
                )
            if follow:
                for href in links:
                    nxt = urljoin(url, href).split("#")[0]
                    if urlparse(nxt).hostname == host and nxt not in seen:
                        queue.append(nxt)


# ─── Google Sheets ───────────────────────────────────────────────────────────


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def google_access_token(service_account_json: str, scope: str) -> str:
    """OAuth de conta de serviço (JWT RS256) sem SDK do Google — só cryptography."""
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding

    try:
        sa = json.loads(service_account_json)
        key = serialization.load_pem_private_key(sa["private_key"].encode(), password=None)
        email_sa, token_uri = sa["client_email"], sa.get(
            "token_uri", "https://oauth2.googleapis.com/token"
        )
    except (ValueError, KeyError, TypeError) as exc:
        raise ConnectorError(
            "Service Account JSON inválido (confira o arquivo baixado do Google Cloud)."
        ) from exc
    now = int(time.time())
    header = _b64url(json.dumps({"alg": "RS256", "typ": "JWT"}).encode())
    claims = _b64url(
        json.dumps(
            {
                "iss": email_sa,
                "scope": scope,
                "aud": token_uri,
                "iat": now,
                "exp": now + 3600,
            }
        ).encode()
    )
    signature = key.sign(f"{header}.{claims}".encode(), padding.PKCS1v15(), hashes.SHA256())
    assertion = f"{header}.{claims}.{_b64url(signature)}"
    data = safe_http.post_json(
        token_uri,
        data={
            "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
            "assertion": assertion,
        },
    )
    if "access_token" not in data:
        raise ConnectorError("O Google não devolveu token para a conta de serviço.")
    return data["access_token"]


class GoogleSheetsConnector(BaseConnector):
    """
    Com Service Account: API oficial (planilha compartilhada com o e-mail da
    conta de serviço). Sem: exportação CSV — só planilha compartilhada como
    "qualquer pessoa com o link pode ver".
    """

    source_type = "google_sheets"
    required_fields = ["spreadsheet_id"]
    secret_fields = ["service_account_json"]
    ROWS_PER_DOC = 50

    def _rows(self) -> list[list[str]]:
        self.check_config()
        sheet_id = self.config["spreadsheet_id"].strip()
        tab = (self.config.get("sheet_name") or "").strip()
        if self.config.get("service_account_json"):
            token = google_access_token(
                self.config["service_account_json"],
                "https://www.googleapis.com/auth/spreadsheets.readonly",
            )
            rng = quote(tab or "A:ZZ", safe="")
            data = safe_http.get_json(
                f"https://sheets.googleapis.com/v4/spreadsheets/{quote(sheet_id)}/values/{rng}",
                headers={"Authorization": f"Bearer {token}"},
            )
            return [[str(c) for c in row] for row in data.get("values", [])]
        params = {"tqx": "out:csv"}
        if tab:
            params["sheet"] = tab
        resp = safe_http.request(
            "GET",
            f"https://docs.google.com/spreadsheets/d/{quote(sheet_id)}/gviz/tq",
            params=params,
        )
        if "text/csv" not in resp.headers.get("content-type", ""):
            raise ConnectorError(
                "A planilha não está pública. Compartilhe como 'qualquer pessoa com o link' "
                "ou informe a Service Account."
            )
        return list(csv.reader(io.StringIO(resp.text)))

    def test(self) -> str:
        rows = self._rows()
        cols = ", ".join(rows[0][:6]) if rows else "—"
        return f"Conectou: {max(len(rows) - 1, 0)} linha(s); colunas: {cols}."

    def fetch(self):
        rows = self._rows()
        if not rows:
            return
        header, body = rows[0], [r for r in rows[1:] if any(c.strip() for c in r)]
        tab = self.config.get("sheet_name") or "planilha"
        for start in range(0, min(len(body), MAX_ITEMS * self.ROWS_PER_DOC), self.ROWS_PER_DOC):
            block = body[start : start + self.ROWS_PER_DOC]
            lines = []
            for n, row in enumerate(block, start=start + 2):
                cells = [
                    f"{header[i] if i < len(header) else f'col{i + 1}'}: {v}"
                    for i, v in enumerate(row)
                    if v
                ]
                lines.append(f"Linha {n} — " + "; ".join(cells))
            end = start + len(block) + 1
            yield SyncItem(
                external_id=f"{tab}!{start + 2}-{end}",
                title=f"{self.source.name} — {tab} (linhas {start + 2}–{end})",
                content="\n".join(lines),
                metadata={"colunas": header},
            )


# ─── Notion ──────────────────────────────────────────────────────────────────

NOTION = "https://api.notion.com/v1"


def _notion_text(rich: list) -> str:
    return "".join(r.get("plain_text", "") for r in rich or [])


def _notion_prop(prop: dict) -> str:
    kind = prop.get("type")
    value = prop.get(kind)
    if kind in ("title", "rich_text"):
        return _notion_text(value)
    if kind in ("select", "status"):
        return (value or {}).get("name", "")
    if kind == "multi_select":
        return ", ".join(v.get("name", "") for v in value or [])
    if kind == "date":
        return (value or {}).get("start", "") or ""
    if kind in ("number", "checkbox", "url", "email", "phone_number"):
        return "" if value is None else str(value)
    if kind == "people":
        return ", ".join(p.get("name", "") for p in value or [])
    return ""


class NotionConnector(BaseConnector):
    source_type = "notion"
    required_fields = ["integration_token", "database_id"]
    secret_fields = ["integration_token"]
    MAX_PAGES = 300

    def _headers(self):
        return {
            "Authorization": f"Bearer {self.config['integration_token']}",
            "Notion-Version": "2022-06-28",
        }

    def _query(self, cursor=None) -> dict:
        body = {"page_size": 100}
        if cursor:
            body["start_cursor"] = cursor
        flt = self.config.get("filter_formula")
        if flt:
            try:
                body["filter"] = json.loads(flt) if isinstance(flt, str) else flt
            except ValueError as exc:
                raise ConnectorError("O filtro do Notion precisa ser JSON.") from exc
        db = self.config["database_id"].replace("-", "").strip()
        return safe_http.post_json(
            f"{NOTION}/databases/{db}/query", headers=self._headers(), json=body
        )

    def _blocks(self, page_id: str) -> list[str]:
        lines, cursor = [], None
        for _ in range(10):
            params = {"page_size": 100, **({"start_cursor": cursor} if cursor else {})}
            data = safe_http.get_json(
                f"{NOTION}/blocks/{page_id}/children", headers=self._headers(), params=params
            )
            for block in data.get("results", []):
                inner = block.get(block.get("type"), {}) or {}
                text = _notion_text(inner.get("rich_text"))
                if text:
                    lines.append(text)
            if not data.get("has_more"):
                break
            cursor = data.get("next_cursor")
        return lines

    def test(self) -> str:
        self.check_config()
        data = self._query()
        return f"Conectou: database com {len(data.get('results', []))}+ página(s)."

    def fetch(self):
        self.check_config()
        cursor, count = None, 0
        while count < self.MAX_PAGES:
            data = self._query(cursor)
            for page in data.get("results", []):
                count += 1
                props = page.get("properties", {})
                title = next(
                    (_notion_prop(p) for p in props.values() if p.get("type") == "title"), ""
                )
                prop_lines = [
                    f"{k}: {_notion_prop(p)}" for k, p in props.items() if _notion_prop(p)
                ]
                content = "\n".join(prop_lines + [""] + self._blocks(page["id"]))
                yield SyncItem(
                    external_id=page["id"],
                    title=title or page["id"],
                    content=content.strip(),
                    metadata={
                        "url": page.get("url", ""),
                        "editado_em": page.get("last_edited_time", ""),
                    },
                )
            if not data.get("has_more"):
                break
            cursor = data.get("next_cursor")


# ─── Slack ───────────────────────────────────────────────────────────────────

SLACK = "https://slack.com/api"


class SlackConnector(BaseConnector):
    """Um documento por canal por dia; incremental (mensagem antiga fica)."""

    source_type = "slack"
    required_fields = ["bot_token", "channel_ids"]
    secret_fields = ["bot_token"]
    full_snapshot = False

    def _call(self, method: str, **params) -> dict:
        data = safe_http.get_json(
            f"{SLACK}/{method}",
            headers={"Authorization": f"Bearer {self.config['bot_token']}"},
            params=params,
        )
        if not data.get("ok"):
            raise ConnectorError(
                f"Slack recusou '{method}': {data.get('error', 'erro desconhecido')}."
            )
        return data

    def test(self) -> str:
        self.check_config()
        team = self._call("auth.test").get("team", "")
        names = []
        for cid in self.cfg_list("channel_ids"):
            names.append(
                "#" + self._call("conversations.info", channel=cid)["channel"].get("name", cid)
            )
        return f"Conectou ao workspace {team}: {', '.join(names)}."

    def fetch(self):
        self.check_config()
        oldest = ""
        if self.source.last_synced_at:
            oldest = str(self.source.last_synced_at.timestamp() - 86400)  # 1 dia de folga
        threads = self.cfg_bool("include_threads", True)
        for cid in self.cfg_list("channel_ids"):
            name = self._call("conversations.info", channel=cid)["channel"].get("name", cid)
            days: dict[str, list[str]] = {}
            cursor = None
            for _ in range(20):
                data = self._call(
                    "conversations.history",
                    channel=cid,
                    limit=200,
                    oldest=oldest,
                    **({"cursor": cursor} if cursor else {}),
                )
                for msg in data.get("messages", []):
                    if msg.get("subtype") in ("channel_join", "channel_leave"):
                        continue
                    msgs = [msg]
                    if threads and msg.get("reply_count"):
                        msgs = self._call("conversations.replies", channel=cid, ts=msg["ts"]).get(
                            "messages", msgs
                        )
                    for m in msgs:
                        ts = float(m.get("ts", 0))
                        day = time.strftime("%Y-%m-%d", time.gmtime(ts))
                        hour = time.strftime("%H:%M", time.gmtime(ts))
                        days.setdefault(day, []).append(
                            f"{hour} {m.get('user', 'bot')}: {m.get('text', '')}"
                        )
                cursor = (data.get("response_metadata") or {}).get("next_cursor")
                if not data.get("has_more") or not cursor:
                    break
            for day, lines in sorted(days.items()):
                yield SyncItem(
                    external_id=f"{cid}:{day}",
                    title=f"#{name} — {day}",
                    content="\n".join(sorted(set(lines))),
                    metadata={"canal": name, "dia": day},
                )


# ─── E-mail (IMAP) ───────────────────────────────────────────────────────────


class EmailConnector(BaseConnector):
    """Últimos N e-mails da pasta, só leitura (EXAMINE). Incremental."""

    source_type = "email"
    required_fields = ["host", "user", "password"]
    secret_fields = ["password"]
    full_snapshot = False

    def _connect(self):
        self.check_config()
        host = self.config["host"].strip()
        port = self.cfg_int("port", 993, 65535)
        safe_http.check_host(host, port)
        try:
            conn = imaplib.IMAP4_SSL(host, port, timeout=20)
            conn.login(self.config["user"], self.config["password"])
        except (imaplib.IMAP4.error, OSError, socket.timeout) as exc:
            raise ConnectorError(f"Falha no IMAP: {exc}") from exc
        status, _ = conn.select(self.config.get("folder") or "INBOX", readonly=True)
        if status != "OK":
            conn.logout()
            raise ConnectorError("Pasta de e-mail não encontrada.")
        return conn

    def test(self) -> str:
        conn = self._connect()
        try:
            _, data = conn.search(None, "ALL")
            return f"Conectou: {len(data[0].split())} e-mail(s) na pasta."
        finally:
            conn.logout()

    def fetch(self):
        conn = self._connect()
        try:
            _, data = conn.search(None, "ALL")
            ids = data[0].split()[-self.cfg_int("max_emails", 100, 1000) :]
            for num in reversed(ids):
                _, parts = conn.fetch(num, "(RFC822)")
                raw = next((p[1] for p in parts if isinstance(p, tuple)), None)
                if not raw:
                    continue
                msg = email.message_from_bytes(raw, policy=email.policy.default)
                body = msg.get_body(preferencelist=("plain", "html"))
                text = body.get_content() if body else ""
                if body is not None and body.get_content_type() == "text/html":
                    text = html_to_text(text)[1]
                subject = str(msg.get("subject", "(sem assunto)"))
                header = f"De: {msg.get('from', '')}\nData: {msg.get('date', '')}"
                content = f"{header}\nAssunto: {subject}\n\n{text}"
                yield SyncItem(
                    external_id=str(msg.get("message-id") or num.decode()),
                    title=subject,
                    content=content,
                    metadata={"data": str(msg.get("date", ""))},
                )
        finally:
            conn.logout()


# ─── Webhook (recebe, não busca) ─────────────────────────────────────────────


class WebhookConnector(BaseConnector):
    """
    Nada a buscar: sistemas externos fazem POST em
    /api/v1/ingestion/webhooks/<public_id>/ (ver ingestion.sync.receive_webhook).
    """

    source_type = "webhook"
    required_fields = ["secret"]
    secret_fields = ["secret"]
    full_snapshot = False

    def test(self) -> str:
        self.check_config()
        return "Pronto pra receber: configure o sistema externo com a URL e o segredo abaixo."

    def fetch(self):
        return iter(())

    def item_from_payload(self, payload) -> SyncItem:
        field = self.config.get("expected_field") or ""
        id_field = self.config.get("id_field") or "id"
        if isinstance(payload, dict):
            content = dig(payload, field) if field else None
            content = str(content) if content not in (None, "") else "\n".join(flatten(payload))
            ident = payload.get(id_field)
            title = str(payload.get(self.config.get("title_field") or "title") or "")
        else:
            content, ident, title = str(payload), None, ""
        if not content.strip():
            raise ConnectorError("Payload sem conteúdo.")
        ident = ident or hashlib.sha256(content.encode()).hexdigest()[:24]
        return SyncItem(
            external_id=f"webhook:{ident}", title=title or f"Webhook {ident}", content=content
        )

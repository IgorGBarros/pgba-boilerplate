# backend_api/Api/ingestion/connectors/mcp.py
"""
Servidor MCP (Model Context Protocol) como fonte dos agentes — transporte
"Streamable HTTP" (JSON-RPC 2.0 por POST; resposta em JSON ou SSE).

    config = {
      "url": "https://mcp.exemplo.com/mcp",
      "auth_type": "bearer" | "api_key" | "none", "api_key": "<segredo>",
      "ferramentas_disponiveis": [...],   # cache do tools/list (botão "Descobrir")
      "ferramentas": [                    # o que UMA PESSOA liberou pros agentes
        {"nome": "buscar_cliente", "risco": "low"},
        {"nome": "criar_ticket", "risco": "high"},
      ],
    }

Mesma regra das consultas estruturadas (CLAUDE.md §1.6): a IA só usa as
ferramentas que um humano liberou, escolhe QUAL e os VALORES — nunca descobre
ferramenta nova sozinha. Cada ferramenta liberada vira a função
`fonte<id>_<nome>` no catálogo do orchestration, com o risco que a pessoa
escolheu: ferramenta que ESCREVE (sem `readOnlyHint`) nasce "medium", então o
Policy Engine (agency) segura em aprovação humana para agente sem autonomia.
Saída de rede por `safe_http` (anti-SSRF); texto devolvido passa por `redact_pii`.
"""
from __future__ import annotations

import itertools
import json
import re

from core.utils.lgpd import redact_pii
from ingestion.connectors import safe_http
from ingestion.connectors.base import BaseConnector, ConnectorError

PROTOCOL_VERSION = "2025-06-18"
TOOL_NAME_RE = re.compile(r"^[A-Za-z0-9_.\-]{1,64}$")
RISKS = ("low", "medium", "high", "critical")
MAX_TEXT = 20_000
MAX_TOOLS = 200
_ids = itertools.count(1)


def slug(name: str) -> str:
    s = re.sub(r"[^a-z0-9_]+", "_", name.lower()).strip("_")
    return (s or "ferramenta")[:40]


def _parse_body(resp, want_id: int) -> dict:
    """Resposta JSON ou SSE (`data: {...}` por evento) → a mensagem JSON-RPC do id pedido."""
    ctype = resp.headers.get("content-type", "")
    messages = []
    if "text/event-stream" in ctype:
        for block in resp.text.split("\n\n"):
            data = "\n".join(ln[5:].lstrip() for ln in block.splitlines() if ln.startswith("data:"))
            if data.strip():
                try:
                    messages.append(json.loads(data))
                except ValueError:
                    continue
    else:
        try:
            body = resp.json()
        except ValueError as exc:
            raise ConnectorError("O servidor MCP não respondeu JSON.") from exc
        messages = body if isinstance(body, list) else [body]
    for msg in messages:
        if isinstance(msg, dict) and msg.get("id") == want_id:
            if msg.get("error"):
                err = msg["error"]
                raise ConnectorError(f"MCP: {err.get('message', err)}")
            return msg.get("result") or {}
    raise ConnectorError("O servidor MCP não devolveu resposta para o pedido.")


def validate_tools(ferramentas, disponiveis=None) -> list[dict]:
    """Confere a lista liberada por uma pessoa — erro volta 400 pra tela."""
    if ferramentas in (None, ""):
        return []
    if not isinstance(ferramentas, list):
        raise ConnectorError("'ferramentas' deve ser uma lista.")
    known = {t.get("nome"): t for t in (disponiveis or []) if isinstance(t, dict)}
    seen, clean = set(), []
    for item in ferramentas:
        if isinstance(item, str):
            item = {"nome": item}
        if not isinstance(item, dict):
            raise ConnectorError("Ferramenta em formato inválido.")
        nome = str(item.get("nome", "")).strip()
        if not TOOL_NAME_RE.match(nome):
            raise ConnectorError(f"Nome de ferramenta inválido: '{nome}'.")
        if slug(nome) in seen:
            raise ConnectorError(f"Ferramenta '{nome}' repetida.")
        seen.add(slug(nome))
        info = known.get(nome, {})
        risco = str(item.get("risco") or ("low" if info.get("somente_leitura") else "medium"))
        if risco not in RISKS:
            raise ConnectorError(f"Risco '{risco}' inválido (use {', '.join(RISKS)}).")
        clean.append({"nome": nome, "risco": risco})
    return clean


class McpConnector(BaseConnector):
    source_type = "mcp"
    mode = "structured"
    required_fields = ["url"]
    secret_fields = ["api_key"]

    # ── transporte ──────────────────────────────────────────────────────────

    def _headers(self) -> dict:
        h = {"Accept": "application/json, text/event-stream", "Content-Type": "application/json"}
        auth = (self.config.get("auth_type") or "none").lower()
        key = self.config.get("api_key")
        if auth == "bearer" and key:
            h["Authorization"] = f"Bearer {key}"
        elif auth == "api_key" and key:
            h[self.config.get("api_key_header") or "X-API-Key"] = key
        return h

    def _post(self, payload: dict, session: str | None):
        headers = self._headers()
        if session:
            headers["Mcp-Session-Id"] = session
            headers["MCP-Protocol-Version"] = PROTOCOL_VERSION
        return safe_http.request(
            "POST", self.config["url"], headers=headers, content=json.dumps(payload)
        )

    def _session(self) -> str | None:
        self.check_config()
        rid = next(_ids)
        resp = self._post(
            {
                "jsonrpc": "2.0",
                "id": rid,
                "method": "initialize",
                "params": {
                    "protocolVersion": PROTOCOL_VERSION,
                    "capabilities": {},
                    "clientInfo": {"name": "pgba-agentes", "version": "1.0"},
                },
            },
            None,
        )
        _parse_body(resp, rid)
        session = resp.headers.get("mcp-session-id")
        self._post({"jsonrpc": "2.0", "method": "notifications/initialized"}, session)
        return session

    def _call(self, method: str, params: dict, session: str | None) -> dict:
        rid = next(_ids)
        resp = self._post(
            {"jsonrpc": "2.0", "id": rid, "method": method, "params": params}, session
        )
        return _parse_body(resp, rid)

    # ── ferramentas ─────────────────────────────────────────────────────────

    def discover(self) -> list[dict]:
        session = self._session()
        tools, cursor = [], None
        for _ in range(10):
            result = self._call("tools/list", {"cursor": cursor} if cursor else {}, session)
            tools += result.get("tools") or []
            cursor = result.get("nextCursor")
            if not cursor or len(tools) >= MAX_TOOLS:
                break
        out = []
        for t in tools[:MAX_TOOLS]:
            if not isinstance(t, dict) or not TOOL_NAME_RE.match(str(t.get("name", ""))):
                continue
            schema = t.get("inputSchema") or {}
            props = schema.get("properties") or {}
            out.append(
                {
                    "nome": t["name"],
                    "descricao": str(t.get("description") or t.get("title") or "")[:500],
                    "parametros": {
                        k: {
                            "tipo": (v or {}).get("type", "string"),
                            "descricao": str((v or {}).get("description", ""))[:200],
                        }
                        for k, v in list(props.items())[:30]
                    },
                    "obrigatorios": [p for p in (schema.get("required") or []) if p in props],
                    "somente_leitura": bool((t.get("annotations") or {}).get("readOnlyHint")),
                }
            )
        return out

    def test(self) -> str:
        tools = self.discover()
        names = ", ".join(t["nome"] for t in tools[:8])
        return f"Conectou: {len(tools)} ferramenta(s){': ' + names if names else ''}."

    def available(self) -> list[dict]:
        return self.config.get("ferramentas_disponiveis") or []

    def approved(self) -> list[dict]:
        """Liberadas por uma pessoa E ainda presentes no servidor (última descoberta)."""
        info = {t["nome"]: t for t in self.available()}
        out = []
        for item in validate_tools(self.config.get("ferramentas"), self.available()):
            t = info.get(item["nome"])
            if t:
                out.append({**t, "risco": item["risco"]})
        return out

    def queries(self) -> list[dict]:
        """Mesmo formato das consultas estruturadas (painel "Testar")."""
        return [
            {
                "nome": t["nome"],
                "descricao": t["descricao"] or t["nome"],
                "parametros": list(t["parametros"]),
                "risco": t["risco"],
            }
            for t in self.approved()
        ]

    @staticmethod
    def _coerce(value, tipo: str, nome: str):
        if value is None or value == "":
            return None
        if tipo in ("integer", "number"):
            try:
                n = float(value)
            except (TypeError, ValueError):
                raise ConnectorError(f"'{nome}' deve ser um número.")
            return int(n) if tipo == "integer" else n
        if tipo == "boolean":
            return (
                value
                if isinstance(value, bool)
                else str(value).lower() in ("1", "true", "sim", "yes")
            )
        if tipo in ("array", "object") and isinstance(value, str):
            try:
                return json.loads(value)
            except ValueError:
                if tipo == "array":
                    return [v.strip() for v in value.split(",") if v.strip()]
                raise ConnectorError(f"'{nome}' deve ser JSON.")
        return value if tipo in ("array", "object") else str(value)

    def run(self, nome: str, params: dict) -> dict:
        tool = next((t for t in self.approved() if t["nome"] == nome), None)
        if tool is None:
            raise ConnectorError(f"Ferramenta '{nome}' não está liberada para os agentes.")
        extra = set(params or {}) - set(tool["parametros"])
        if extra:
            raise ConnectorError(f"Parâmetro(s) desconhecido(s): {', '.join(sorted(extra))}.")
        args = {}
        for k, spec in tool["parametros"].items():
            v = self._coerce((params or {}).get(k), spec["tipo"], k)
            if v is not None:
                args[k] = v
        faltando = [p for p in tool["obrigatorios"] if p not in args]
        if faltando:
            raise ConnectorError(f"Faltou: {', '.join(faltando)}.")
        session = self._session()
        result = self._call("tools/call", {"name": nome, "arguments": args}, session)
        texts = [
            c.get("text", "")
            for c in (result.get("content") or [])
            if isinstance(c, dict) and c.get("type") == "text"
        ]
        texto = redact_pii("\n".join(texts))[:MAX_TEXT]
        if result.get("isError"):
            raise ConnectorError(f"A ferramenta respondeu erro: {texto[:300]}")
        out = {"ferramenta": nome, "resultado": texto}
        structured = result.get("structuredContent")
        if structured is not None:
            raw = json.dumps(structured, ensure_ascii=False, default=str)
            out["dados"] = json.loads(redact_pii(raw)) if len(raw) < MAX_TEXT else "(grande demais)"
        return {
            "colunas": ["resultado"],
            "linhas": [[texto or json.dumps(out.get("dados"), ensure_ascii=False)[:MAX_TEXT]]],
            "total_linhas": 1,
            "truncado": len("\n".join(texts)) > MAX_TEXT,
            **out,
        }

    def fetch(self):
        raise ConnectorError(
            "MCP não copia dados: os agentes usam as ferramentas liberadas na hora."
        )


def catalog_provider(tenant_id, source_ids):
    """Uma função por ferramenta liberada, só das fontes que o agente pode ver."""
    from ingestion.models import KnowledgeSource
    from orchestration.registry import QueryFunction

    qs = KnowledgeSource.objects.filter(tenant_id=tenant_id, is_active=True, source_type="mcp")
    if source_ids is not None:
        qs = qs.filter(id__in=source_ids)
    functions = []
    for source in qs:
        try:
            tools = McpConnector(source).approved()
        except Exception:  # config quebrada/segredo ilegível: fica fora do catálogo
            continue
        for t in tools:
            functions.append(
                QueryFunction(
                    name=f"fonte{source.id}_{slug(t['nome'])}",
                    description=f"[{source.name} · MCP] {t['descricao'] or t['nome']}",
                    parameters={
                        k: f"{v['tipo']}{' (obrigatório)' if k in t['obrigatorios'] else ''}"
                        + (f" — {v['descricao']}" if v["descricao"] else "")
                        for k, v in t["parametros"].items()
                    },
                    handler=_handler(source.id, t["nome"]),
                    risk=t["risco"],
                )
            )
    return functions


def _handler(source_id: int, nome: str):
    def run(tenant_id, **params):
        from ingestion.models import KnowledgeSource

        source = KnowledgeSource.objects.filter(
            id=source_id, tenant_id=tenant_id, is_active=True
        ).first()
        if source is None:
            raise ValueError("Fonte não encontrada.")
        try:
            result = McpConnector(source).run(nome, params)
        except ConnectorError as exc:
            raise ValueError(str(exc)) from exc
        return {k: v for k, v in result.items() if k in ("ferramenta", "resultado", "dados")}

    return run

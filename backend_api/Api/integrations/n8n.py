# backend_api/Api/integrations/n8n.py
"""
n8n — API pública (`/api/v1`, header `X-N8N-API-KEY`).

Credencial: `ServiceCredential(provider="n8n")`, `account_ref` = URL da
instância (ex.: https://n8n.suaempresa.com), token = API key (n8n →
Settings → n8n API). Toda chamada passa por `safe_http` (anti-SSRF); n8n na
rede interna só se o host estiver em CONNECTORS_ALLOWED_PRIVATE_HOSTS.

O painel lê workflows e execuções e liga/desliga workflow (ação de pessoa,
pela tela). Agente só LÊ (função `n8n_automacoes_resumo`).
"""
from __future__ import annotations

from ingestion.connectors import ConnectorError, safe_http
from integrations.models import ServiceCredential
from integrations.services import IntegrationConfigError, get_credential

MAX_PAGES = 10


class N8nError(Exception):
    pass


def _client(tenant_id) -> tuple[str, dict]:
    try:
        cred = get_credential(tenant_id, ServiceCredential.Provider.N8N)
    except IntegrationConfigError as exc:
        raise N8nError("n8n ainda não configurado (URL da instância + API key).") from exc
    base = (cred.account_ref or "").rstrip("/")
    if not base:
        raise N8nError("Falta a URL da instância do n8n.")
    if base.endswith("/api/v1"):
        base = base[: -len("/api/v1")]
    return base, {"X-N8N-API-KEY": cred.token, "Accept": "application/json"}


def _get(tenant_id, path: str, params: dict | None = None):
    base, headers = _client(tenant_id)
    try:
        return safe_http.get_json(f"{base}/api/v1{path}", headers=headers, params=params or {})
    except ConnectorError as exc:
        raise N8nError(str(exc)) from exc


def _paginate(tenant_id, path: str, params: dict, limit: int) -> list[dict]:
    out: list[dict] = []
    cursor = None
    for _ in range(MAX_PAGES):
        page = _get(
            tenant_id,
            path,
            {**params, "limit": min(limit, 250), **({"cursor": cursor} if cursor else {})},
        )
        out += page.get("data") or []
        cursor = page.get("nextCursor")
        if not cursor or len(out) >= limit:
            break
    return out[:limit]


def _trigger_kind(nodes: list[dict]) -> str:
    types = [str(n.get("type", "")) for n in nodes or []]
    if any(t.endswith(".webhook") for t in types):
        return "webhook"
    if any(t.endswith(".scheduleTrigger") or t.endswith(".cron") for t in types):
        return "agendado"
    if any(t.endswith(".manualTrigger") for t in types):
        return "manual"
    if any("trigger" in t.lower() for t in types):
        return "evento"
    return "outro"


def test_connection(tenant_id) -> str:
    wfs = _paginate(tenant_id, "/workflows", {}, 250)
    ativos = sum(1 for w in wfs if w.get("active"))
    return f"Conectou: {len(wfs)} workflow(s), {ativos} ativo(s)."


def list_workflows(tenant_id) -> list[dict]:
    wfs = _paginate(tenant_id, "/workflows", {}, 500)
    return [
        {
            "id": str(w.get("id")),
            "name": w.get("name", ""),
            "active": bool(w.get("active")),
            "archived": bool(w.get("isArchived")),
            "updated_at": w.get("updatedAt"),
            "created_at": w.get("createdAt"),
            "tags": [t.get("name", "") for t in (w.get("tags") or []) if isinstance(t, dict)],
            "nodes": len(w.get("nodes") or []),
            "trigger": _trigger_kind(w.get("nodes") or []),
            "node_types": sorted(
                {str(n.get("type", "")).split(".")[-1] for n in (w.get("nodes") or [])}
            )[:12],
        }
        for w in wfs
    ]


def list_executions(
    tenant_id, workflow_id: str | None = None, status: str | None = None, limit: int = 50
) -> list[dict]:
    params: dict = {}
    if workflow_id:
        params["workflowId"] = workflow_id
    if status in ("success", "error", "waiting", "running", "canceled"):
        params["status"] = status
    rows = _paginate(tenant_id, "/executions", params, limit)
    return [
        {
            "id": str(e.get("id")),
            "workflow_id": str(e.get("workflowId", "")),
            "status": e.get("status") or ("success" if e.get("finished") else "unknown"),
            "mode": e.get("mode", ""),
            "started_at": e.get("startedAt"),
            "stopped_at": e.get("stoppedAt"),
        }
        for e in rows
    ]


def set_active(tenant_id, workflow_id: str, active: bool) -> dict:
    base, headers = _client(tenant_id)
    action = "activate" if active else "deactivate"
    try:
        data = safe_http.post_json(
            f"{base}/api/v1/workflows/{workflow_id}/{action}", headers=headers
        )
    except ConnectorError as exc:
        raise N8nError(str(exc)) from exc
    return {"id": str(data.get("id", workflow_id)), "active": bool(data.get("active", active))}


def overview(tenant_id) -> dict:
    """Painel: workflows + últimas execuções + contagem por status."""
    workflows = list_workflows(tenant_id)
    executions = list_executions(tenant_id, limit=100)
    by_wf: dict[str, dict] = {}
    for e in executions:
        s = by_wf.setdefault(e["workflow_id"], {"success": 0, "error": 0, "other": 0, "last": None})
        key = e["status"] if e["status"] in ("success", "error") else "other"
        s[key] += 1
        if s["last"] is None:
            s["last"] = e
    for w in workflows:
        w["recent"] = by_wf.get(w["id"], {"success": 0, "error": 0, "other": 0, "last": None})
    return {
        "workflows": workflows,
        "executions": executions[:50],
        "totals": {
            "workflows": len(workflows),
            "active": sum(1 for w in workflows if w["active"]),
            "errors_recent": sum(1 for e in executions if e["status"] == "error"),
            "success_recent": sum(1 for e in executions if e["status"] == "success"),
        },
    }

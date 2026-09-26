# backend_api/Api/integrations/hostinger.py
"""
Hostinger — duas coisas diferentes:

1. **E-mail** (a caixa de cada setor): SMTP/IMAP, preset em
   `integrations.email.PRESETS["hostinger"]`. Não precisa de API.
2. **API da Hostinger** (hPanel → Perfil → API): token Bearer em
   `ServiceCredential(provider="hostinger")`. Usada só pra LER a conta —
   VPS e domínios — no painel administrativo. A API não cria caixa de
   e-mail: a caixa é criada no hPanel e só a senha vem pra cá.
"""
from __future__ import annotations

from ingestion.connectors import ConnectorError, safe_http
from integrations.models import ServiceCredential
from integrations.services import IntegrationConfigError, get_credential

BASE = "https://developers.hostinger.com"


class HostingerError(Exception):
    pass


def _get(tenant_id, path: str):
    try:
        cred = get_credential(tenant_id, ServiceCredential.Provider.HOSTINGER)
    except IntegrationConfigError as exc:
        raise HostingerError("API da Hostinger não configurada (token do hPanel).") from exc
    try:
        return safe_http.get_json(
            f"{BASE}{path}",
            headers={"Authorization": f"Bearer {cred.token}", "Accept": "application/json"},
        )
    except ConnectorError as exc:
        raise HostingerError(str(exc)) from exc


def _rows(data) -> list:
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        return data.get("data") or data.get("items") or []
    return []


def list_vps(tenant_id) -> list[dict]:
    out = []
    for vm in _rows(_get(tenant_id, "/api/vps/v1/virtual-machines")):
        if not isinstance(vm, dict):
            continue
        ipv4 = vm.get("ipv4") or []
        ip = ipv4[0].get("address", "") if ipv4 and isinstance(ipv4[0], dict) else ""
        out.append(
            {
                "id": vm.get("id"),
                "hostname": vm.get("hostname", ""),
                "state": vm.get("state", ""),
                "plan": vm.get("plan", ""),
                "ip": ip,
            }
        )
    return out


def list_domains(tenant_id) -> list[dict]:
    out = []
    for d in _rows(_get(tenant_id, "/api/domains/v1/portfolio")):
        if not isinstance(d, dict):
            continue
        out.append(
            {
                "domain": d.get("domain") or d.get("name", ""),
                "status": d.get("status", ""),
                "expires_at": d.get("expires_at") or d.get("expiration_date"),
            }
        )
    return out


def test_connection(tenant_id) -> str:
    vps = list_vps(tenant_id)
    return f"Conectou na API da Hostinger: {len(vps)} VPS na conta."

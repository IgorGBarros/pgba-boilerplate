# backend_api/Api/integrations/servers.py
"""
Servidores (VPS) — teste honesto de acesso: a porta SSH responde com o
banner `SSH-...`. NÃO autentica nem roda comando (o sistema não executa nada
remoto); a chave fica guardada cifrada pra quando houver deploy automatizado.
"""
from __future__ import annotations

import socket

from django.utils import timezone

from ingestion.connectors import ConnectorError, safe_http
from integrations.models import ServerConnection

TIMEOUT = 8


def check_server(server: ServerConnection) -> str:
    ok, msg = False, ""
    if not server.host:
        msg = "Sem endereço ainda — preencha o IP público da VPS quando ela existir."
    else:
        try:
            safe_http.check_host(server.host, server.ssh_port)
            with socket.create_connection((server.host, server.ssh_port), timeout=TIMEOUT) as sock:
                sock.settimeout(TIMEOUT)
                banner = sock.recv(256).decode(errors="replace").strip()
            if banner.startswith("SSH-"):
                ok, msg = True, f"SSH respondeu ({banner[:80]}). Login não testado."
            else:
                msg = f"A porta {server.ssh_port} respondeu, mas não é SSH."
        except ConnectorError as exc:
            msg = str(exc)
        except (OSError, socket.timeout) as exc:
            msg = (
                f"Sem resposta em {server.host}:{server.ssh_port} ({exc}). Na Oracle Cloud, "
                "confira a Security List/NSG liberando a porta 22."
            )
    server.last_check_at, server.last_check_ok, server.last_check_message = (
        timezone.now(),
        ok,
        msg[:500],
    )
    server.save(
        update_fields=["last_check_at", "last_check_ok", "last_check_message", "updated_at"]
    )
    return msg

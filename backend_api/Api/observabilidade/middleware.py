# backend_api/Api/observabilidade/middleware.py
"""Mede toda requisição da API por rota (sem ids), status e empresa."""
import re
import time

from observabilidade import coletor

GRUPO = re.compile(r"\(\?P<(\w+)>[^)]*\)")


def rota_legivel(route: str) -> str:
    """Rota do router do DRF vem em regex: `tickets/(?P<pk>[^/.]+)/$` → `tickets/<pk>/`."""
    return GRUPO.sub(r"<\1>", route).replace("^", "").replace("$", "")


class MetricasMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if not request.path.startswith("/api/"):
            return self.get_response(request)
        inicio = time.monotonic()
        status = 500
        try:
            response = self.get_response(request)
            status = response.status_code
            return response
        finally:
            try:
                match = getattr(request, "resolver_match", None)
                rota = (
                    f"/{rota_legivel(match.route)}" if match and match.route else request.path[:120]
                )
                user = getattr(request, "user", None)
                tenant = (
                    getattr(user, "tenant_id", None)
                    if getattr(user, "is_authenticated", False)
                    else None
                )
                coletor.registrar(
                    "api",
                    f"{request.method} {rota}",
                    int((time.monotonic() - inicio) * 1000),
                    erro=status >= 500,
                    erro_cliente=400 <= status < 500,
                    tenant_id=tenant,
                )
            except Exception:  # noqa: BLE001 — medir nunca quebra a resposta
                pass

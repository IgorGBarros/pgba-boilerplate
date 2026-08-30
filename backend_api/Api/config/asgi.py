# backend_api/Api/config/asgi.py
import os

from django.core.asgi import get_asgi_application

env = "dev" if os.environ.get("DEBUG") == "True" else "prod"
os.environ.setdefault("DJANGO_SETTINGS_MODULE", f"config.settings.{env}")

# get_asgi_application() precisa rodar ANTES de importar qualquer coisa
# que toque em models/apps (inclusive agency.routing) — populate() do
# app registry ainda não rodou antes disso.
django_asgi_app = get_asgi_application()

from channels.routing import ProtocolTypeRouter, URLRouter  # noqa: E402

import agency.routing  # noqa: E402
from agency.ws_auth import JWTAuthMiddleware  # noqa: E402

application = ProtocolTypeRouter({
    "http": django_asgi_app,
    "websocket": JWTAuthMiddleware(URLRouter(agency.routing.websocket_urlpatterns)),
})
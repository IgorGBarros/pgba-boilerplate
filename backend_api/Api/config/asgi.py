# backend_api/Api/config/asgi.py
import os

from django.core.asgi import get_asgi_application

env = "dev" if os.environ.get("DEBUG") == "True" else "prod"
os.environ.setdefault("DJANGO_SETTINGS_MODULE", f"config.settings.{env}")

application = get_asgi_application()

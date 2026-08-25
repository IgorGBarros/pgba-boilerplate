# backend_api/Api/config/wsgi.py
import os

from django.core.wsgi import get_wsgi_application

env = "dev" if os.environ.get("DEBUG") == "True" else "prod"
os.environ.setdefault("DJANGO_SETTINGS_MODULE", f"config.settings.{env}")

application = get_wsgi_application()

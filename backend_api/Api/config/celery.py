# backend_api/Api/config/celery.py
import os

from celery import Celery

env = "dev" if os.environ.get("DEBUG") == "True" else "prod"
os.environ.setdefault("DJANGO_SETTINGS_MODULE", f"config.settings.{env}")

app = Celery("pgba")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()

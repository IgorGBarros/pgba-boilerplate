
from .base import *
import os
from django.http import JsonResponse

DEBUG = False
SECURE_SSL_REDIRECT = os.environ.get("SECURE_SSL_REDIRECT", "True") == "True"
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_BROWSER_XSS_FILTER = True
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = "DENY"

CORS_ALLOWED_ORIGINS = os.environ.get("CORS_ALLOWED_ORIGINS", "https://seusite.com").split(",")
CORS_ALLOW_CREDENTIALS = True

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "verbose": {
            "format": "{levelname} {asctime} {module} {message}",
            "style": "{",
        },
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "verbose",
        },
    },
    "root": {
        "handlers": ["console"],
        "level": "INFO",
    },
}

def health_check(request):
    from django.db import connection
    try:
        connection.ensure_connection()
        return JsonResponse({"status": "ok", "db": "connected"}, status=200)
    except Exception as e:
        return JsonResponse({"status": "error", "db": str(e)}, status=503)

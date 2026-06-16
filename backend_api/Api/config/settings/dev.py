# backend_api/config/settings/dev.py
from .base import *
from datetime import timedelta  # ← Import adicionado

DEBUG = True
CORS_ALLOW_ALL_ORIGINS = True

# Logging mais verboso
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
        "level": "DEBUG",
    },
    "loggers": {
        "django": {
            "handlers": ["console"],
            "level": "INFO",
            "propagate": False,
        },
    },
}

ALLOWED_HOSTS = ["*"]
EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"

# JWT com expiry maior para testes
SIMPLE_JWT["ACCESS_TOKEN_LIFETIME"] = timedelta(hours=24)  # ← SIMPLE_JWT vem de base.py
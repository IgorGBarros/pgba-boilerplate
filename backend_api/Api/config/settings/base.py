from pathlib import Path
from datetime import timedelta
import os

# 📁 Paths
BASE_DIR = Path(__file__).resolve().parent.parent.parent
APPS_DIR = BASE_DIR / "Api"

# 🔐 Security (usando os.environ em vez de decouple)
SECRET_KEY = os.environ.get("SECRET_KEY", "django-insecure-dev-key-mude-em-prod")
DEBUG = os.environ.get("DEBUG", "True") == "True"
ALLOWED_HOSTS = os.environ.get("ALLOWED_HOSTS", "localhost,127.0.0.1").split(",")
CORS_ALLOWED_ORIGINS = os.environ.get("CORS_ALLOWED_ORIGINS", "http://localhost:3000").split(",")

# 📦 Apps
INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "channels",
    "rest_framework",
    "rest_framework_simplejwt",
    "corsheaders",
    "django_filters",
    "simple_history",
    "drf_spectacular",
    "core",
    "User",
    "payments",
    "harness",
    "integrations",
    "ingestion",
    "orchestration",
    "agency",
]

# 🔄 Middleware
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "core.middleware.tenant.TenantMiddleware",
]

ROOT_URLCONF = "config.urls"

# 🗄️ Database
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.environ.get("DB_NAME", "pgba"),
        "USER": os.environ.get("DB_USER", "pgba"),
        "PASSWORD": os.environ.get("DB_PASSWORD", "pgba"),
        "HOST": os.environ.get("DB_HOST", "localhost"),
        "PORT": os.environ.get("DB_PORT", "5432"),
        "CONN_MAX_AGE": int(os.environ.get("DB_CONN_MAX_AGE", "60")),
    }
}

# 🔐 Auth + JWT
AUTH_USER_MODEL = "User.CustomUser"

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework_simplejwt.authentication.JWTAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 20,
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(hours=1),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "ALGORITHM": "HS256",
    "SIGNING_KEY": SECRET_KEY,
    "AUTH_HEADER_TYPES": ("Bearer",),
}

# 📚 Swagger
SPECTACULAR_SETTINGS = {
    "TITLE": "PGBA DataLake API",
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
}

# 🛡️ LGPD
CPF_SALT = os.environ.get("CPF_SALT", "dev_salt")
ENCRYPTION_KEY = os.environ.get("ENCRYPTION_KEY", "")
DATA_RETENTION_DAYS = int(os.environ.get("DATA_RETENTION_DAYS", "730"))

# 📧 Email
EMAIL_BACKEND = os.environ.get("EMAIL_BACKEND", "django.core.mail.backends.console.EmailBackend")
DEFAULT_FROM_EMAIL = os.environ.get("DEFAULT_FROM_EMAIL", "noreply@pgba.com.br")

# 📁 Static/Media
STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"

# 🔄 Celery
CELERY_BROKER_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
CELERY_RESULT_BACKEND = os.environ.get("REDIS_URL", "redis://localhost:6379/0")

# 📡 Tempo real (WebSocket via Django Channels) — status de Agent/Task
# em tempo real, sem polling. Mesmo Redis do Celery (bancos lógicos
# diferentes, /1 em vez de /0, só para não misturar filas de mensagens
# com filas de tarefas assíncronas).
ASGI_APPLICATION = "config.asgi.application"
_REALTIME_REDIS_URL = os.environ.get("REALTIME_REDIS_URL", os.environ.get("REDIS_URL", "redis://localhost:6379/0").rsplit("/", 1)[0] + "/1")
CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels_redis.core.RedisChannelLayer",
        "CONFIG": {"hosts": [_REALTIME_REDIS_URL]},
    },
}

# 🧠 IA Local-First & RAG (módulo ingestion)
# Por padrão, tudo roda localmente via Ollama — nenhum dado do tenant sai
# para nuvem de terceiros. Trocar EMBEDDING_PROVIDER para "openai" (ou outra
# API compatível) é uma decisão explícita do time, nunca o default.
EMBEDDING_PROVIDER = os.environ.get("EMBEDDING_PROVIDER", "ollama")  # ollama | openai
EMBEDDING_MODEL = os.environ.get("EMBEDDING_MODEL", "nomic-embed-text")
EMBEDDING_DIMENSIONS = int(os.environ.get("EMBEDDING_DIMENSIONS", "768"))
CHAT_PROVIDER = os.environ.get("CHAT_PROVIDER", "ollama")  # ollama | openai | anthropic | groq | openrouter
OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_CHAT_MODEL = os.environ.get("OLLAMA_CHAT_MODEL", "llama3")

# Credenciais de fallback lidas do .env (usadas só quando não há
# AIProviderCredential configurada no banco — ver harness/providers.py e
# `python manage.py configure_ai_provider` para configuração sem redeploy).
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
OPENAI_BASE_URL = os.environ.get("OPENAI_BASE_URL", "")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
ANTHROPIC_BASE_URL = os.environ.get("ANTHROPIC_BASE_URL", "")
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
GROQ_BASE_URL = os.environ.get("GROQ_BASE_URL", "")
OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")
OPENROUTER_BASE_URL = os.environ.get("OPENROUTER_BASE_URL", "")

# 📓 Integração com Obsidian (fonte de conhecimento para o RAG)
# Caminho padrão sugerido para desenvolvimento local; cada KnowledgeSource
# pode sobrescrever com seu próprio vault_path em config['vault_path'].
OBSIDIAN_VAULT_PATH = os.environ.get("OBSIDIAN_VAULT_PATH", "")

# 🧭 Orquestração de IA (Q&A sobre dado estruturado — módulo orchestration)
# Catálogo de modelos por categoria. Sobrescreva no .env/settings do projeto
# para trocar os modelos sem tocar em código (ver orchestration/router.py).
AI_MODEL_CATALOG = {
    "fast": {"model": os.environ.get("AI_MODEL_FAST", "qwen2.5:14b"), "temperature": 0.25, "num_ctx": 2048},
    "standard": {"model": os.environ.get("AI_MODEL_STANDARD", "mistral-nemo:14b"), "temperature": 0.3, "num_ctx": 4096},
    "report": {"model": os.environ.get("AI_MODEL_REPORT", "deepseek-r1:14b"), "temperature": 0.2, "num_ctx": 4096},
}

# 🔐 Salt usado por core.models.ConsentRecord.hash_ip (nunca armazenar IP cru)
LGPD_IP_SALT = os.environ.get("LGPD_IP_SALT", "")

# 📝 Audit
SIMPLE_HISTORY_MIDDLEWARE = True

# 🌐 i18n
LANGUAGE_CODE = "pt-br"
TIME_ZONE = "America/Sao_Paulo"
USE_I18N = True
USE_TZ = True
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# 📄 Templates (Obrigatório para o Admin Django)
TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

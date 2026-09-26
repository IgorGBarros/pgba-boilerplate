from pathlib import Path
from datetime import timedelta
import os

# 📁 Paths
BASE_DIR = Path(__file__).resolve().parent.parent.parent
APPS_DIR = BASE_DIR / "Api"

# 🔐 Security (usando os.environ em vez de decouple)
SECRET_KEY = os.environ.get("SECRET_KEY", "django-insecure-dev-key-mude-em-prod")
DEBUG = os.environ.get("DEBUG", "False") == "True"
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
    "rest_framework_simplejwt.token_blacklist",
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
    "crm",
    "erp",
    "juridico",
    "marketing",
    "observabilidade",
    "helpdesk",
    "desenvolvimento",
    "controladoria",
    "datalake",
    "scraping",
    "compras",
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
    # Mede toda requisição /api/ (rota, status, tempo, empresa) — ver observabilidade
    "observabilidade.middleware.MetricasMiddleware",
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
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        "anon": "20/min",
        "user": "200/min",
        "auth": "10/min",
        "webhook": "120/min",
        # Links públicos de assinatura eletrônica (juridico) e verificação de documento
        "assinatura": "60/min",
        # Retorno do login OAuth das redes sociais e mídia pública (Instagram/TikTok buscam)
        "marketing_publico": "120/min",
        # Página pública de status (/api/v1/observabilidade/saude/)
        "status_publico": "30/min",
    },
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(hours=1),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=1),
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

# 🔑 Password validation
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 8}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# 🛡️ LGPD
CPF_SALT = os.environ.get("CPF_SALT", "dev_salt")
ENCRYPTION_KEY = os.environ.get("ENCRYPTION_KEY", "")

# Conectores externos (ingestion.connectors): rede interna é bloqueada (anti-SSRF);
# libere hosts específicos da sua rede aqui, separados por vírgula.
CONNECTORS_ALLOWED_PRIVATE_HOSTS = os.environ.get("CONNECTORS_ALLOWED_PRIVATE_HOSTS", "")
# SQLite só lê arquivos dentro desta pasta (vazio = SQLite desligado)
CONNECTORS_SQLITE_ROOT = os.environ.get("CONNECTORS_SQLITE_ROOT", "")

# Agendamentos do Celery Beat (serviço celery_beat do docker-compose)
CELERY_BEAT_SCHEDULE = {
    "conectores-sincronizacao-automatica": {
        "task": "ingestion.tasks.sync_due_sources_task",
        "schedule": 300.0,
    },
    # Caixa de entrada dos setores (IMAP, só leitura)
    "caixas-de-email-dos-setores": {
        "task": "integrations.tasks.fetch_inboxes_task",
        "schedule": 300.0,
    },
    # Publicações APROVADAS com horário marcado (marketing) — só publica o que
    # uma pessoa aprovou
    # Observabilidade: batimento, verificações de plataforma e de cada empresa,
    # incidentes automáticos (o setor de TI abre chamado)
    "observabilidade-verificacoes": {
        "task": "observabilidade.tasks.verificar_task",
        "schedule": 60.0,
    },
    "marketing-publicacoes-agendadas": {
        "task": "marketing.tasks.publicar_agendadas_task",
        "schedule": 60.0,
    },
}
DATA_RETENTION_DAYS = int(os.environ.get("DATA_RETENTION_DAYS", "730"))

# 🌐 Frontend URL (usado em e-mails de reset de senha, etc.)
FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:5173")
# Endereço PÚBLICO desta API (https://api.suaempresa.com). O retorno do login
# OAuth das redes cai aqui, e Instagram/TikTok buscam a mídia por este endereço.
# Vazio = usa o host da própria requisição (serve em dev, não pro Instagram).
PUBLIC_API_URL = os.environ.get("PUBLIC_API_URL", "")
META_GRAPH_VERSION = os.environ.get("META_GRAPH_VERSION", "v23.0")
LINKEDIN_API_VERSION = os.environ.get("LINKEDIN_API_VERSION", "")

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
OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "")  # vazio → providers.py usa DEFAULT_BASE_URLS["ollama"]="http://ollama:11434" (Docker). Fora do Docker: set OLLAMA_BASE_URL=http://localhost:11434 no .env
OLLAMA_CHAT_MODEL = os.environ.get("OLLAMA_CHAT_MODEL", "llama3")
# 45s (o padrão antigo, fixo no código) era curto demais pra gerar uma
# página inteira num modelo de alguns GB em CPU sem GPU — aumente aqui
# se seu hardware for mais lento (ou diminua se tiver GPU e quiser falhar
# rápido em vez de esperar).
CHAT_TIMEOUT_SECONDS = float(os.environ.get("CHAT_TIMEOUT_SECONDS", "120"))

# Credenciais de fallback lidas do .env (usadas só quando não há
# AIProviderCredential configurada no banco — ver harness/providers.py e
# `python manage.py configure_ai_provider` para configuração sem redeploy).
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
OPENAI_BASE_URL = os.environ.get("OPENAI_BASE_URL", "")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
# Preço por modelo (US$/milhão de tokens, entrada/saída) — sobrescreve a
# tabela de harness/pricing.py sem editar código. JSON, ex:
# {"groq:llama-3.3-70b": [0.59, 0.79], "openai:gpt-4o": [2.5, 10]}
AI_MODEL_PRICES = os.environ.get("AI_MODEL_PRICES", "")
ANTHROPIC_BASE_URL = os.environ.get("ANTHROPIC_BASE_URL", "")
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
GROQ_BASE_URL = os.environ.get("GROQ_BASE_URL", "")
OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")
OPENROUTER_BASE_URL = os.environ.get("OPENROUTER_BASE_URL", "")

# 📓 Integração com Obsidian (fonte de conhecimento para o RAG)
# Caminho padrão sugerido para desenvolvimento local; cada KnowledgeSource
# pode sobrescrever com seu próprio vault_path em config['vault_path'].
OBSIDIAN_VAULT_PATH = os.environ.get("OBSIDIAN_VAULT_PATH", "")

# 🕷️ Scraping — Google Maps (container gosom/google-maps-scraper)
# Suba com: docker compose up -d gmaps-scraper
# Repo de referência: https://github.com/Mahanaicoach/google-maps-scraper-kit
GMAPS_SCRAPER_URL = os.environ.get("GMAPS_SCRAPER_URL", "http://localhost:8181")
GMAPS_SCRAPER_API_KEY = os.environ.get("GMAPS_SCRAPER_API_KEY", "")
SCRAPING_TIMEOUT = int(os.environ.get("SCRAPING_TIMEOUT", "120"))

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

# 📈 Mercado
BRAPI_TOKEN = os.environ.get("BRAPI_TOKEN", "")

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
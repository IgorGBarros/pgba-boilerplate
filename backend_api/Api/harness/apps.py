# backend_api/Api/harness/apps.py
from django.apps import AppConfig


class HarnessConfig(AppConfig):
    """
    Harness de IA: a camada que faz `ingestion` e `orchestration`
    funcionarem de forma configurável e sem alucinação.

    Duas responsabilidades:
    1. Configuração de credenciais (`AIProviderCredential`): chaves de API
       e tokens de qualquer provedor (Ollama, OpenAI, Anthropic, Groq,
       OpenRouter) configuráveis pelo Django admin ou por comando de
       linha — nunca só por variável de ambiente hardcoded no código.
    2. Guardrails (`guardrails.py`): as regras que reduzem alucinação —
       recusar responder sem contexto, validar saída estruturada (JSON),
       checar se a resposta cita as fontes recuperadas.

    Não é o "Harness" (harness.io) de CI/CD — nome escolhido antes disso
    ficar claro na conversa com o time; é a camada de "arreio" (harness,
    no sentido literal) que mantém a IA sob controle.
    """

    default_auto_field = "django.db.models.BigAutoField"
    name = "harness"
    verbose_name = "Harness de IA (credenciais + guardrails)"

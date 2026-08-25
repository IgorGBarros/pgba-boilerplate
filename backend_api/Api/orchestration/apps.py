# backend_api/Api/orchestration/apps.py
from django.apps import AppConfig


class OrchestrationConfig(AppConfig):
    """
    Orquestração de IA sobre dados estruturados (Q&A sobre o banco, de
    qualquer vertical: estoque, CRM, financeiro...).

    Complementa o `ingestion` (RAG sobre conhecimento NÃO estruturado, tipo
    Obsidian): este app aqui responde perguntas sobre dado estruturado do
    próprio banco (Product, Sale, Ticket, o que for) SEM nunca deixar o LLM
    gerar ou executar SQL livre — ele só escolhe entre funções pré-aprovadas
    (ver `registry.py`). Essa é a lição de segurança P0 documentada no
    gestao_estoque (ai/services.py) que este app generaliza.
    """

    default_auto_field = "django.db.models.BigAutoField"
    name = "orchestration"
    verbose_name = "Orquestração de IA (Q&A estruturado)"

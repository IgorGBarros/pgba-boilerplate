# backend_api/Api/ingestion/apps.py
from django.apps import AppConfig


class IngestionConfig(AppConfig):
    """
    App de Ingestão & Memória (RAG).

    Responsável por transformar qualquer fonte de conhecimento (Obsidian,
    upload manual, URL, API) em memória semântica pesquisável por tenant,
    usando PostgreSQL + pgvector. Segue o princípio de Soberania de Dados:
    embeddings e respostas são geradas localmente via Ollama por padrão.
    """

    default_auto_field = "django.db.models.BigAutoField"
    name = "ingestion"
    verbose_name = "Ingestão & Memória (RAG)"

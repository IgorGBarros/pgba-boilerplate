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

    def ready(self):
        # Consultas cadastradas nos conectores de banco/CRM viram funções do
        # orchestration por tenant (ver ingestion.connectors.structured).
        from ingestion.connectors import mcp
        from ingestion.connectors.structured import catalog_provider
        from orchestration.registry import register_catalog_provider

        register_catalog_provider(catalog_provider)
        # Ferramentas liberadas dos servidores MCP (ingestion.connectors.mcp)
        register_catalog_provider(mcp.catalog_provider)

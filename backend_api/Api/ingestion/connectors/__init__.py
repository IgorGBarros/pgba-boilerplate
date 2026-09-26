# backend_api/Api/ingestion/connectors/__init__.py
"""
Conectores de fonte externa. Um por `KnowledgeSource.SourceType`:

- documents.py  — conteúdo que vira Document e entra na busca semântica
- structured.py — banco/CRM consultado na hora por consultas nomeadas
- mcp.py        — servidor MCP: só as ferramentas que uma pessoa liberou
- safe_http.py  — toda saída de rede (anti-SSRF)
- secrets.py    — segredos cifrados, nunca devolvidos pela API

Obsidian e upload manual continuam em ingestion.services (vêm de antes).
"""
from ingestion.connectors.base import BaseConnector, ConnectorError, SyncItem  # noqa: F401
from ingestion.connectors.documents import (
    EmailConnector,
    GoogleSheetsConnector,
    NotionConnector,
    RestApiConnector,
    SlackConnector,
    UrlConnector,
    WebhookConnector,
)
from ingestion.connectors.mcp import McpConnector
from ingestion.connectors.structured import HubSpotConnector, SalesforceConnector, SqlConnector

CONNECTORS = {
    cls.source_type: cls
    for cls in (
        RestApiConnector,
        UrlConnector,
        GoogleSheetsConnector,
        NotionConnector,
        SlackConnector,
        EmailConnector,
        WebhookConnector,
        SqlConnector,
        HubSpotConnector,
        SalesforceConnector,
        McpConnector,
    )
}


def get_connector_class(source_type: str):
    return CONNECTORS.get(source_type)


def get_connector(source) -> BaseConnector:
    cls = get_connector_class(source.source_type)
    if cls is None:
        raise ConnectorError(
            f"Tipo '{source.source_type}' não tem conector (Obsidian/upload têm fluxo próprio)."
        )
    return cls(source)

# backend_api/Api/ingestion/connectors/base.py
"""Contrato comum de todo conector de fonte externa."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable


class ConnectorError(Exception):
    """Falha explícita de um conector (config inválida, rede, credencial) — nunca em silêncio."""


@dataclass
class SyncItem:
    """Uma unidade de conteúdo trazida da fonte — vira um ingestion.Document."""

    external_id: str
    title: str
    content: str
    metadata: dict = field(default_factory=dict)


class BaseConnector:
    """
    `mode="documents"`: o conteúdo é sincronizado como Document e entra na
    busca semântica (RAG) — texto: páginas, mensagens, e-mails, linhas de planilha.

    `mode="structured"`: nada é copiado; os agentes consultam na hora, só por
    consultas nomeadas que um humano definiu (ver connectors.structured) —
    dado estruturado (banco, CRM) responde mal via RAG e o LLM nunca escreve a query.
    """

    source_type = ""
    mode = "documents"
    required_fields: list[str] = []
    secret_fields: list[str] = []
    # Snapshot completo: o que sumiu da fonte sai do índice. Incremental
    # (Slack, e-mail): documento antigo fica, só entram novos.
    full_snapshot = True

    def __init__(self, source):
        self.source = source
        self.config = source.full_config()

    def check_config(self) -> None:
        missing = [f for f in self.required_fields if not self.config.get(f)]
        if missing:
            raise ConnectorError(f"Campos obrigatórios ausentes: {', '.join(missing)}")

    def test(self) -> str:
        """Faz uma chamada real e barata; devolve uma frase do que encontrou."""
        raise NotImplementedError

    def fetch(self) -> Iterable[SyncItem]:
        raise NotImplementedError

    # Utilitários ---------------------------------------------------------

    def cfg_int(self, key: str, default: int, maximum: int) -> int:
        try:
            value = int(self.config.get(key) or default)
        except (TypeError, ValueError):
            raise ConnectorError(f"'{key}' deve ser um número.")
        return max(1, min(value, maximum))

    def cfg_bool(self, key: str, default: bool = False) -> bool:
        value = self.config.get(key)
        if value in (None, ""):
            return default
        if isinstance(value, bool):
            return value
        return str(value).strip().lower() in ("1", "true", "sim", "yes", "on")

    def cfg_list(self, key: str) -> list[str]:
        value = self.config.get(key) or []
        if isinstance(value, str):
            value = [v.strip() for v in value.split(",")]
        return [str(v).strip() for v in value if str(v).strip()]

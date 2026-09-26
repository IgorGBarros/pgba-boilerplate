# backend_api/Api/ingestion/connectors/structured.py
"""
Conectores de dado estruturado (mode="structured"): banco SQL, HubSpot e
Salesforce. Nada é copiado pra busca semântica — "quanto vendemos em março?"
responde mal com trechos de texto. Em vez disso, os agentes consultam NA HORA,
e só do jeito que um humano deixou (CLAUDE.md §1.6 — a IA nunca escreve SQL):

    config["consultas"] = [
      {"nome": "vendas_do_mes", "descricao": "Total vendido num mês",
       "consulta": "SELECT sum(total) FROM pedidos WHERE mes = :mes",
       "parametros": ["mes"]},
    ]

- quem cadastra o conector escreve e revisa cada consulta (com nome e descrição);
- o LLM só escolhe QUAL consulta e passa os VALORES dos parâmetros, que entram
  como parâmetro ligado (SQL) ou literal escapado e tipado (SOQL) — nunca como texto
  concatenado na query;
- execução só leitura (transação read-only / arquivo aberto em modo ro), com
  teto de linhas e timeout; célula de texto passa por `redact_pii`.

Cada consulta vira uma função no catálogo do orchestration (catálogo dinâmico
por tenant, `catalog_provider` abaixo), limitada às fontes que o agente pode
ver — o mesmo escopo da busca semântica (agency._rag_scope_for).
"""
from __future__ import annotations

import datetime as dt
import re
from decimal import Decimal
from pathlib import Path

from django.conf import settings

from core.utils.lgpd import redact_pii
from ingestion.connectors import safe_http
from ingestion.connectors.base import BaseConnector, ConnectorError

NAME_RE = re.compile(r"^[a-z][a-z0-9_]{1,40}$")
PARAM_RE = re.compile(r"(?<![:\w]):([a-zA-Z_]\w*)")
PARAM_TYPES = ("texto", "numero", "data")
MAX_ROWS = 1000


# ─── Definição e validação das consultas ─────────────────────────────────────


def parse_params(raw) -> dict[str, str]:
    """["mes", "valor:numero"] (ou "mes, valor:numero") → {"mes": "texto", "valor": "numero"}."""
    if isinstance(raw, str):
        raw = [p for p in raw.split(",")]
    out = {}
    for item in raw or []:
        name, _, kind = str(item).strip().partition(":")
        if not name:
            continue
        kind = kind.strip() or "texto"
        if kind not in PARAM_TYPES:
            raise ConnectorError(
                f"Tipo de parâmetro '{kind}' inválido (use {', '.join(PARAM_TYPES)})."
            )
        out[name.strip()] = kind
    return out


def validate_queries(source_type: str, consultas) -> list[dict]:
    """Confere cada consulta antes de salvar — erro aqui volta 400 pra tela."""
    if consultas in (None, ""):
        return []
    if not isinstance(consultas, list):
        raise ConnectorError("'consultas' deve ser uma lista.")
    seen, clean = set(), []
    for i, q in enumerate(consultas, start=1):
        if not isinstance(q, dict):
            raise ConnectorError(f"Consulta {i}: formato inválido.")
        nome = str(q.get("nome", "")).strip()
        if not NAME_RE.match(nome):
            raise ConnectorError(
                f"Consulta {i}: nome '{nome}' inválido — use minúsculas, números e _ "
                "(ex: vendas_do_mes)."
            )
        if nome in seen:
            raise ConnectorError(f"Consulta '{nome}' repetida.")
        seen.add(nome)
        descricao = str(q.get("descricao", "")).strip()
        if len(descricao) < 10:
            raise ConnectorError(
                f"Consulta '{nome}': descreva o que ela responde (a IA escolhe por aqui)."
            )
        params = parse_params(q.get("parametros"))
        item = {
            "nome": nome,
            "descricao": descricao,
            "parametros": [f"{k}:{v}" if v != "texto" else k for k, v in params.items()],
        }
        if source_type in ("sql", "salesforce"):
            texto = str(q.get("consulta", "")).strip().rstrip(";").strip()
            if ";" in texto:
                raise ConnectorError(f"Consulta '{nome}': só uma instrução, sem ';'.")
            if not re.match(r"^(select|with)\b", texto, re.I):
                raise ConnectorError(f"Consulta '{nome}': só consultas de leitura (SELECT).")
            if re.search(
                r"\b(insert|update|delete|drop|alter|create|truncate|grant|merge|call|copy)\b",
                texto,
                re.I,
            ):
                raise ConnectorError(f"Consulta '{nome}': contém comando de escrita.")
            usados = set(PARAM_RE.findall(texto))
            faltando = usados - set(params)
            if faltando:
                raise ConnectorError(
                    f"Consulta '{nome}': declare os parâmetros {', '.join(sorted(faltando))}."
                )
            item["consulta"] = texto
        elif source_type == "hubspot":
            objeto = str(q.get("objeto", "")).strip()
            if objeto not in HubSpotConnector.OBJECTS:
                raise ConnectorError(
                    f"Consulta '{nome}': objeto deve ser um de "
                    f"{', '.join(HubSpotConnector.OBJECTS)}."
                )
            item["objeto"] = objeto
            item["propriedades"] = str(q.get("propriedades", "")).strip()
            item["filtro_propriedade"] = str(q.get("filtro_propriedade", "")).strip()
            if item["filtro_propriedade"] and "valor" not in params:
                item["parametros"] = ["valor"]
        clean.append(item)
    return clean


def _coerce(value, kind: str, nome: str):
    if value is None:
        raise ConnectorError(f"Falta o parâmetro '{nome}'.")
    if kind == "numero":
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return value
        if isinstance(value, str) and re.fullmatch(r"-?\d+(\.\d+)?", value.strip()):
            return float(value) if "." in value else int(value)
        raise ConnectorError(f"'{nome}' deve ser um número.")
    if kind == "data":
        try:
            return dt.date.fromisoformat(str(value).strip()[:10])
        except ValueError:
            raise ConnectorError(f"'{nome}' deve ser uma data AAAA-MM-DD.")
    return str(value)[:500]


def _cell(value):
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (dt.date, dt.datetime, dt.time)):
        return value.isoformat()
    if isinstance(value, (bytes, bytearray, memoryview)):
        return "<binário>"
    if isinstance(value, str):
        return redact_pii(value)
    return value


def _table(columns: list[str], rows: list, limit: int, truncated: bool) -> dict:
    return {
        "colunas": columns,
        "linhas": [[_cell(v) for v in row] for row in rows[:limit]],
        "total_linhas": min(len(rows), limit),
        "truncado": truncated or len(rows) > limit,
    }


class StructuredConnector(BaseConnector):
    mode = "structured"

    def queries(self) -> list[dict]:
        return validate_queries(self.source_type, self.config.get("consultas") or [])

    def query(self, nome: str) -> dict:
        for q in self.queries():
            if q["nome"] == nome:
                return q
        raise ConnectorError(f"Consulta '{nome}' não existe neste conector.")

    def run(self, nome: str, params: dict) -> dict:
        q = self.query(nome)
        kinds = parse_params(q.get("parametros"))
        extra = set(params or {}) - set(kinds)
        if extra:
            raise ConnectorError(f"Parâmetro(s) desconhecido(s): {', '.join(sorted(extra))}.")
        values = {k: _coerce((params or {}).get(k), kind, k) for k, kind in kinds.items()}
        return self._execute(q, values)

    def _execute(self, q: dict, values: dict) -> dict:
        raise NotImplementedError

    def fetch(self):
        raise ConnectorError("Este conector não copia dados: os agentes consultam na hora.")


# ─── Banco SQL ───────────────────────────────────────────────────────────────


class SqlConnector(StructuredConnector):
    source_type = "sql"
    required_fields = ["database"]
    secret_fields = ["password"]
    ENGINES = ("postgresql", "mysql", "sqlite")

    @property
    def engine(self) -> str:
        engine = (self.config.get("engine") or "postgresql").lower()
        if engine not in self.ENGINES:
            raise ConnectorError(f"Banco '{engine}' não suportado (use {', '.join(self.ENGINES)}).")
        return engine

    def _connect(self):
        self.check_config()
        timeout = 15
        if self.engine == "sqlite":
            import sqlite3

            root = getattr(settings, "CONNECTORS_SQLITE_ROOT", "")
            if not root:
                raise ConnectorError(
                    "SQLite desativado: defina CONNECTORS_SQLITE_ROOT no servidor."
                )
            path = (Path(root) / self.config["database"]).resolve()
            if Path(root).resolve() not in path.parents or not path.is_file():
                raise ConnectorError("Arquivo SQLite fora da pasta permitida ou inexistente.")
            return sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=timeout)

        host = (self.config.get("host") or "").strip()
        if not host or not self.config.get("user"):
            raise ConnectorError("Informe host e usuário do banco.")
        default_port = 5432 if self.engine == "postgresql" else 3306
        port = self.cfg_int("port", default_port, 65535)
        safe_http.check_host(host, port)
        if self.engine == "postgresql":
            import psycopg2

            try:
                conn = psycopg2.connect(
                    host=host,
                    port=port,
                    dbname=self.config["database"],
                    user=self.config["user"],
                    password=self.config.get("password", ""),
                    connect_timeout=timeout,
                    sslmode="require" if self.cfg_bool("ssl", True) else "prefer",
                    options=(
                        f"-c statement_timeout={timeout * 1000} "
                        "-c default_transaction_read_only=on"
                    ),
                )
            except psycopg2.Error as exc:
                raise ConnectorError(
                    f"Não conectou no PostgreSQL: {str(exc).strip()[:200]}"
                ) from exc
            conn.set_session(readonly=True, autocommit=False)
            return conn
        try:
            import pymysql
        except ImportError as exc:
            raise ConnectorError(
                "Driver do MySQL (pymysql) não está instalado no servidor."
            ) from exc
        try:
            conn = pymysql.connect(
                host=host,
                port=port,
                database=self.config["database"],
                user=self.config["user"],
                password=self.config.get("password", ""),
                connect_timeout=timeout,
                read_timeout=timeout,
                ssl={"ssl": {}} if self.cfg_bool("ssl", True) else None,
            )
        except pymysql.MySQLError as exc:
            raise ConnectorError(f"Não conectou no MySQL: {exc}") from exc
        with conn.cursor() as cur:
            cur.execute("SET SESSION TRANSACTION READ ONLY")
        return conn

    def _sql(self, text: str) -> str:
        if self.engine == "sqlite":
            return text  # sqlite3 aceita :nome
        # DB-API pyformat: :mes → %(mes)s, e '%' literal vira '%%'
        return PARAM_RE.sub(lambda m: f"%({m.group(1)})s", text.replace("%", "%%"))

    def test(self) -> str:
        conn = self._connect()
        try:
            cur = conn.cursor()
            cur.execute("SELECT 1")
            cur.fetchall()
        finally:
            conn.close()
        return f"Conectou ({self.engine}); {len(self.queries())} consulta(s) cadastrada(s)."

    def _execute(self, q, values):
        limit = self.cfg_int("max_rows", 200, MAX_ROWS)
        conn = self._connect()
        try:
            cur = conn.cursor()
            try:
                cur.execute(self._sql(q["consulta"]), values)
            except Exception as exc:  # erro do banco (SQL, timeout) — mensagem curta pro log
                raise ConnectorError(
                    f"O banco recusou a consulta '{q['nome']}': {str(exc).strip()[:200]}"
                )
            columns = [d[0] for d in cur.description or []]
            rows = cur.fetchmany(limit + 1)
        finally:
            conn.rollback() if hasattr(conn, "rollback") else None
            conn.close()
        return _table(columns, [list(r) for r in rows], limit, truncated=False)


# ─── HubSpot ─────────────────────────────────────────────────────────────────


class HubSpotConnector(StructuredConnector):
    source_type = "hubspot"
    required_fields = ["api_key"]
    secret_fields = ["api_key"]
    OBJECTS = ("contacts", "companies", "deals", "tickets", "products", "line_items")
    API = "https://api.hubapi.com"

    def _headers(self):
        return {"Authorization": f"Bearer {self.config['api_key']}"}

    def test(self) -> str:
        self.check_config()
        safe_http.get_json(
            f"{self.API}/crm/v3/objects/contacts", headers=self._headers(), params={"limit": 1}
        )
        return f"Conectou ao HubSpot; {len(self.queries())} consulta(s) cadastrada(s)."

    def _execute(self, q, values):
        self.check_config()
        limit = self.cfg_int("max_rows", 100, 200)
        props = [p.strip() for p in q.get("propriedades", "").split(",") if p.strip()]
        body = {"limit": limit, "properties": props}
        if q.get("filtro_propriedade"):
            body["filterGroups"] = [
                {
                    "filters": [
                        {
                            "propertyName": q["filtro_propriedade"],
                            "operator": "EQ",
                            "value": str(values.get("valor", "")),
                        }
                    ]
                }
            ]
        data = safe_http.post_json(
            f"{self.API}/crm/v3/objects/{q['objeto']}/search", headers=self._headers(), json=body
        )
        results = data.get("results", [])
        columns = ["id"] + (
            props or sorted({k for r in results for k in (r.get("properties") or {})})
        )
        rows = [
            [r.get("id")] + [(r.get("properties") or {}).get(c) for c in columns[1:]]
            for r in results
        ]
        return _table(columns, rows, limit, truncated=bool((data.get("paging") or {}).get("next")))


# ─── Salesforce ──────────────────────────────────────────────────────────────


def soql_literal(value) -> str:
    """Valor → literal SOQL (string escapada; número/data sem aspas)."""
    if isinstance(value, dt.date):
        return value.isoformat()
    if isinstance(value, (int, float)):
        return repr(value)
    return "'" + str(value).replace("\\", "\\\\").replace("'", "\\'") + "'"


class SalesforceConnector(StructuredConnector):
    source_type = "salesforce"
    required_fields = ["client_id", "client_secret", "instance_url"]
    secret_fields = ["client_secret"]
    API_VERSION = "v60.0"

    def _token(self) -> tuple[str, str]:
        self.check_config()
        base = self.config["instance_url"].rstrip("/")
        data = safe_http.post_json(
            f"{base}/services/oauth2/token",
            data={
                "grant_type": "client_credentials",
                "client_id": self.config["client_id"],
                "client_secret": self.config["client_secret"],
            },
        )
        if "access_token" not in data:
            raise ConnectorError(
                "O Salesforce não devolveu token "
                "(habilite o Client Credentials Flow no Connected App)."
            )
        return data["access_token"], data.get("instance_url") or base

    def test(self) -> str:
        token, base = self._token()
        safe_http.get_json(
            f"{base}/services/data/{self.API_VERSION}/limits",
            headers={"Authorization": f"Bearer {token}"},
        )
        return f"Conectou ao Salesforce; {len(self.queries())} consulta(s) cadastrada(s)."

    def _execute(self, q, values):
        limit = self.cfg_int("max_rows", 200, 2000)
        soql = PARAM_RE.sub(lambda m: soql_literal(values[m.group(1)]), q["consulta"])
        if not re.search(r"\blimit\s+\d+", soql, re.I):
            soql += f" LIMIT {limit}"
        token, base = self._token()
        data = safe_http.get_json(
            f"{base}/services/data/{self.API_VERSION}/query",
            headers={"Authorization": f"Bearer {token}"},
            params={"q": soql},
        )
        records = data.get("records", [])
        columns = [k for k in (records[0] if records else {}) if k != "attributes"]
        rows = [
            [r.get(c) if not isinstance(r.get(c), dict) else str(r.get(c)) for c in columns]
            for r in records
        ]
        return _table(columns, rows, limit, truncated=not data.get("done", True))


# ─── Catálogo dinâmico pro orchestration ─────────────────────────────────────


def catalog_provider(tenant_id, source_ids):
    """
    Uma função por consulta cadastrada nos conectores estruturados do tenant,
    só das fontes em `source_ids` (None = todas, acesso total). Chamado pelo
    orchestration.registry a cada pergunta — o LLM vê só o que pode usar.
    """
    from ingestion.connectors import get_connector_class
    from ingestion.models import KnowledgeSource
    from orchestration.registry import QueryFunction

    qs = KnowledgeSource.objects.filter(
        tenant_id=tenant_id, is_active=True, source_type__in=["sql", "hubspot", "salesforce"]
    )
    if source_ids is not None:
        qs = qs.filter(id__in=source_ids)
    functions = []
    for source in qs:
        cls = get_connector_class(source.source_type)
        try:
            consultas = validate_queries(
                source.source_type, (source.config or {}).get("consultas") or []
            )
        except ConnectorError:
            continue
        for q in consultas:
            functions.append(
                QueryFunction(
                    name=f"fonte{source.id}_{q['nome']}",
                    description=f"[{source.name}] {q['descricao']}",
                    parameters={k: v for k, v in parse_params(q.get("parametros")).items()},
                    handler=_handler(cls, source.id, q["nome"]),
                    risk="low",
                )
            )
    return functions


def _handler(cls, source_id: int, nome: str):
    def run(tenant_id, **params):
        from ingestion.models import KnowledgeSource

        source = KnowledgeSource.objects.filter(
            id=source_id, tenant_id=tenant_id, is_active=True
        ).first()
        if source is None:
            raise ValueError("Fonte não encontrada.")
        try:
            return cls(source).run(nome, params)
        except ConnectorError as exc:
            raise ValueError(str(exc)) from exc

    return run

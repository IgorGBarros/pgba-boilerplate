# backend_api/Api/observabilidade/banco.py
"""
"Por que o banco caiu?" — traduz o erro do driver do Postgres numa causa e numa
ação, e mede a saúde do banco quando ele está de pé.

Funciona com o banco FORA: não usa o ORM pra nada que precise dele.
"""
from __future__ import annotations

import time

# (trechos da mensagem do driver, causa, ação) — em ordem: o primeiro que casar vence
PADROES = [
    (
        ("connection refused", "could not connect to server", "is the server running"),
        "O servidor do banco não está aceitando conexões: o container/serviço do Postgres "
        "está parado, reiniciando ou numa porta diferente.",
        "Veja se está de pé: `docker compose ps db`. Suba: `docker compose up -d db`. "
        "Se cair de novo, leia o motivo: `docker compose logs --tail 100 db` "
        "(disco cheio e falta de memória são os mais comuns).",
    ),
    (
        ("could not translate host name", "name or service not known", "nodename nor servname"),
        "O endereço do banco (DB_HOST) não existe na rede do backend.",
        "Confira DB_HOST no .env (no Docker é `db`) e se backend e banco estão na mesma rede.",
    ),
    (
        ("password authentication failed",),
        "Usuário ou senha do banco não conferem.",
        "DB_USER/DB_PASSWORD do .env têm que ser os mesmos com que o volume do Postgres foi "
        "criado. Trocar a senha no .env NÃO troca a senha de um banco que já existe.",
    ),
    (
        ("does not exist",),
        "O banco (DB_NAME) ou o usuário não existe no servidor.",
        "Confira DB_NAME/DB_USER no .env; crie o banco ou aponte para o certo.",
    ),
    (
        ("too many connections", "remaining connection slots", "too many clients"),
        "O banco atingiu o limite de conexões simultâneas.",
        "Reinicie os workers que seguram conexões (`docker compose restart backend "
        "celery_worker`) e investigue consultas presas; considere um pool (pgbouncer) ou "
        "subir `max_connections`.",
    ),
    (
        ("no space left on device", "could not extend file", "disk full"),
        "O disco do servidor do banco encheu.",
        "Libere espaço (logs, backups antigos, `docker system prune`) ou aumente o disco; o "
        "Postgres volta sozinho quando houver espaço.",
    ),
    (
        ("the database system is starting up", "in recovery mode", "shutting down"),
        "O banco está iniciando, desligando ou se recuperando de uma queda.",
        "Espere 1–2 minutos. Se não sair disso, veja `docker compose logs --tail 100 db`.",
    ),
    (
        ("timeout expired", "timed out", "server closed the connection unexpectedly"),
        "O banco não respondeu a tempo ou derrubou a conexão (sobrecarga, rede ou reinício).",
        "Veja CPU/memória do servidor e consultas longas; se o banco reiniciou, confira os "
        "logs dele (falta de memória costuma matar o processo).",
    ),
    (
        ("ssl",),
        "Problema na negociação SSL com o banco.",
        "Confira se o servidor exige SSL e a opção sslmode da conexão.",
    ),
]


def explicar(exc: BaseException | str) -> tuple[str, str]:
    msg = str(exc).lower()
    for trechos, causa, acao in PADROES:
        if any(t in msg for t in trechos):
            return causa, acao
    return (
        "O banco recusou a conexão por um motivo não catalogado.",
        "Leia o erro completo acima e os logs do banco: `docker compose logs --tail 100 db`.",
    )


def verificar() -> dict:
    """{status, ms, detalhe, causa, acao, dados} — nunca levanta."""
    from django.db import connection

    inicio = time.monotonic()
    try:
        connection.ensure_connection()
        with connection.cursor() as cur:
            cur.execute("SELECT 1")
            cur.fetchone()
            ms = int((time.monotonic() - inicio) * 1000)
            dados = _estatisticas(cur)
    except Exception as exc:  # noqa: BLE001 — qualquer erro do driver vira diagnóstico
        try:
            connection.close()
        except Exception:  # noqa: BLE001
            pass
        causa, acao = explicar(exc)
        return {
            "status": "falha",
            "ms": int((time.monotonic() - inicio) * 1000),
            "detalhe": str(exc).strip()[:600],
            "causa": causa,
            "acao": acao,
            "dados": {},
        }
    status, avisos = "ok", []
    uso = dados.get("conexoes", 0) / max(dados.get("max_conexoes") or 1, 1)
    if uso >= 0.8:
        status = "alerta"
        avisos.append(f"{int(uso * 100)}% das conexões em uso")
    if dados.get("consulta_mais_longa_s", 0) > 300:
        status = "alerta"
        avisos.append(f"consulta rodando há {int(dados['consulta_mais_longa_s'] // 60)} min")
    if dados.get("bloqueios_esperando", 0) > 5:
        status = "alerta"
        avisos.append(f"{dados['bloqueios_esperando']} consultas esperando bloqueio")
    if not dados.get("pgvector", True):
        status = "alerta"
        avisos.append("extensão pgvector ausente (busca semântica não funciona)")
    if dados.get("migracoes_pendentes"):
        status = "alerta"
        avisos.append(f"{dados['migracoes_pendentes']} migração(ões) pendente(s)")
    if ms > 1000:
        status = "alerta"
        avisos.append(f"lento ({ms} ms pra responder)")
    return {
        "status": status,
        "ms": ms,
        "detalhe": "; ".join(avisos) or f"respondendo em {ms} ms",
        "causa": "",
        "acao": ("Rode `python manage.py migrate`." if dados.get("migracoes_pendentes") else ""),
        "dados": dados,
    }


def _estatisticas(cur) -> dict:
    dados: dict = {}
    consultas = {
        "tamanho_mb": "SELECT pg_database_size(current_database()) / 1048576",
        "conexoes": "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()",
        "max_conexoes": "SELECT setting::int FROM pg_settings WHERE name = 'max_connections'",
        "consulta_mais_longa_s": (
            "SELECT COALESCE(EXTRACT(EPOCH FROM max(now() - query_start)), 0) "
            "FROM pg_stat_activity WHERE state = 'active' AND pid <> pg_backend_pid() "
            "AND datname = current_database()"
        ),
        "bloqueios_esperando": "SELECT count(*) FROM pg_locks WHERE NOT granted",
        "pgvector": "SELECT count(*) > 0 FROM pg_extension WHERE extname = 'vector'",
        "versao": "SHOW server_version",
    }
    for chave, sql in consultas.items():
        try:
            cur.execute(sql)
            valor = cur.fetchone()[0]
            dados[chave] = float(valor) if chave == "consulta_mais_longa_s" else valor
        except Exception:  # noqa: BLE001 — sem permissão pra uma estatística não é falha
            continue
    try:
        from django.db import connection
        from django.db.migrations.executor import MigrationExecutor

        plano = MigrationExecutor(connection).migration_plan(
            MigrationExecutor(connection).loader.graph.leaf_nodes()
        )
        dados["migracoes_pendentes"] = len(plano)
    except Exception:  # noqa: BLE001
        pass
    return dados

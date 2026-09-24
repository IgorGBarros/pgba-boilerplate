#!/bin/bash
# Cria o banco da Evolution API no mesmo Postgres do PGBA,
# caso ainda não exista. Roda automaticamente na primeira inicialização
# do container postgres (scripts em /docker-entrypoint-initdb.d/).
set -e

EVOLUTION_DB="${EVOLUTION_DB_NAME:-evolution_db}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    SELECT 'CREATE DATABASE ${EVOLUTION_DB}'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${EVOLUTION_DB}')
    \gexec
EOSQL

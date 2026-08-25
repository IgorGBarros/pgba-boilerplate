#!/bin/bash
# backend_api/entrypoint.sh
# Entrypoint canônico do container. Usa config/settings/{dev,prod}.py
# (ver Api/manage.py) — não depende de DNS de cluster nem de settings legado.
set -e

echo "Aguardando PostgreSQL em ${DB_HOST:-db}:${DB_PORT:-5432}..."
until python - <<'PY'
import os, socket, sys
host = os.environ.get("DB_HOST", "db")
port = int(os.environ.get("DB_PORT", "5432"))
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.settimeout(2)
try:
    s.connect((host, port))
    sys.exit(0)
except OSError:
    sys.exit(1)
PY
do
  echo "PostgreSQL não está pronto - aguardando..."
  sleep 2
done
echo "PostgreSQL disponível."

echo "Aplicando migrações..."
python manage.py migrate --noinput

echo "Coletando arquivos estáticos..."
python manage.py collectstatic --noinput || echo "[WARN] collectstatic falhou, continuando..."

echo "Iniciando Gunicorn..."
exec gunicorn --bind 0.0.0.0:8000 --workers 3 --timeout 120 config.wsgi:application

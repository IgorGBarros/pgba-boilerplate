#!/bin/bash
set -e
# Força a variável
export DJANGO_SETTINGS_MODULE=Api.settings
echo "Aguardando o PostgreSQL iniciar..."

# Loop até conseguir conectar na porta 5432 do host 'postgres'
while ! timeout 1 bash -c "</dev/tcp/postgres-service.app-ns.svc.cluster.local/5432" 2>/dev/null; do

  echo "PostgreSQL não está pronto - aguardando..."
  sleep 5
done

echo "PostgreSQL iniciado!"



echo "Aplicando migrações Django..."
python manage.py migrate --noinput


# Garante que a pasta exista
mkdir -p /app/static

# Coleta arquivos estáticos (crucial para o Django Admin!)
echo ">> Coletando estáticos..."
python manage.py collectstatic --noinput
echo ">> Estáticos coletados com sucesso"


echo "Iniciando servidor Gunicorn..."
exec gunicorn Api.wsgi:application --bind 0.0.0.0:8000





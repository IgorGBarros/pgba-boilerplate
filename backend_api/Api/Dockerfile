FROM python:3.12-slim

# Define a variável BASE_DIR (usada no container)
ENV BASE_DIR=/app

RUN apt-get update && \
    apt-get install -y --no-install-recommends netcat-openbsd && \
    apt-get clean && \
    postgresql-client \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Cria a pasta de arquivos estáticos
RUN mkdir -p $BASE_DIR/static

# Define o diretório de trabalho
WORKDIR $BASE_DIR

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt


COPY . .
# Torna o script executável
RUN chmod +x $BASE_DIR/wait-for-postgres.sh

# Comando principal
CMD ["sh", "-c", "$BASE_DIR/wait-for-postgres.sh"]

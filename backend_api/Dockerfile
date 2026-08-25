# backend_api/Dockerfile
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    BASE_DIR=/app

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        netcat-openbsd \
        postgresql-client \
        build-essential \
        libpq-dev && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR $BASE_DIR

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY Api/ ./Api/
COPY entrypoint.sh .
RUN chmod +x entrypoint.sh

WORKDIR $BASE_DIR/Api
RUN mkdir -p static

ENTRYPOINT ["/app/entrypoint.sh"]

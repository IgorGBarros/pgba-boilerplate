# Deploy

## Desenvolvimento local (Docker Compose — caminho recomendado)

```bash
cd backend_api
cp .env.example .env
# edite .env: SECRET_KEY, ENCRYPTION_KEY, DB_*, e credenciais de IA se for
# usar provedor de nuvem (senão Ollama local não precisa de nada)
docker compose up --build
```

Isso sobe `db` (Postgres+pgvector), `redis`, `backend`, `celery_worker`,
`celery_beat` e `ollama`. A API fica em `http://localhost:8000`.

Gere as chaves antes de colocar no `.env`:

```bash
python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"   # SECRET_KEY
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"                      # ENCRYPTION_KEY
```

## Sem Docker

```bash
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cd Api
python manage.py migrate
python manage.py runserver
```
Requer Postgres com a extensão `vector` disponível e, se for usar RAG,
Redis + um worker Celery rodando (`celery -A config worker --loglevel=info`)
e opcionalmente Ollama instalado localmente.

## Checklist antes de ir para produção

- [ ] `DEBUG=False` e `config.settings.prod` como `DJANGO_SETTINGS_MODULE`
      (já é automático se `DEBUG` não for `"True"` — ver `manage.py`)
- [ ] `SECRET_KEY` e `ENCRYPTION_KEY` únicos, nunca reaproveitados do `.env.example`
- [ ] `ALLOWED_HOSTS` e `CORS_ALLOWED_ORIGINS` restritos ao(s) domínio(s) reais
- [ ] `SECURE_SSL_REDIRECT=True`
- [ ] Banco de produção já com a extensão `vector` habilitada
      (a migration `ingestion/0001_enable_pgvector.py` cuida disso, mas
      confirme que o usuário do banco tem permissão para `CREATE EXTENSION`)
- [ ] Credenciais de IA de produção configuradas via
      `python manage.py configure_ai_provider` (não deixe só no `.env` em
      produção multi-tenant — ver DOCUMENTATION.md §7)
- [ ] Celery worker e beat rodando como serviços monitorados (não apenas
      `docker compose up` interativo)
- [ ] Backup do Postgres configurado (inclui os vetores — um restore sem
      a extensão `vector` ativa vai falhar)
- [ ] `python manage.py collectstatic` rodando no deploy (já incluso no
      `entrypoint.sh`)

## Kubernetes

Este boilerplate não inclui manifests de Kubernetes por padrão — o
caminho de deploy documentado e testado é Docker Compose (ou qualquer
orquestrador que rode a mesma imagem `backend_api/Dockerfile` +
`entrypoint.sh`). Se o projeto precisar de Kubernetes, monte os manifests
a partir da imagem do `Dockerfile` canônico e do `docker-compose.yml`
como referência de variáveis de ambiente — **não copie configuração de
outro projeto sem revisar**: um manifest antigo que existia numa versão
anterior deste boilerplate usava `postgres:15` sem a extensão `pgvector`
e uma variável `DJANGO_SETTINGS_MODULE` apontando para um módulo de
settings que não existe mais nesta estrutura; ambos os problemas
quebrariam o RAG e o boot da aplicação silenciosamente até alguém tentar
usar a IA ou subir o pod.

## Variáveis de ambiente — referência completa

Ver `backend_api/.env.example` para a lista completa e comentada. Grupos:

- **Django**: `DEBUG`, `SECRET_KEY`, `ALLOWED_HOSTS`
- **Banco**: `DB_ENGINE`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT`
- **Celery/Redis**: `REDIS_URL`
- **LGPD/criptografia**: `ENCRYPTION_KEY`
- **CORS/segurança**: `CORS_ALLOWED_ORIGINS`, `SECURE_SSL_REDIRECT`
- **RAG/embeddings**: `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`
- **Harness (IA)**: `CHAT_PROVIDER`, `OLLAMA_*`, `OPENAI_*`, `ANTHROPIC_*`, `GROQ_*`, `OPENROUTER_*` (fallback dev — produção deve preferir `configure_ai_provider`)
- **Orquestração**: `AI_MODEL_FAST`, `AI_MODEL_STANDARD`, `AI_MODEL_REPORT`
- **Obsidian**: `OBSIDIAN_VAULT_PATH`
- **Pagamentos**: `ASAAS_API_KEY`, `ASAAS_WEBHOOK_TOKEN` (só quando `payments/` for implementado)

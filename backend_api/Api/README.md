# PGBA Backend — API

Backend Django + DRF multi-tenant com auditoria (LGPD), fila assíncrona
(Celery) e um módulo de memória semântica (RAG) que indexa Obsidian e
qualquer outra fonte de conhecimento, usando PostgreSQL + pgvector.

> Ver também `/CLAUDE.md` na raiz do repositório: define o padrão de
> arquitetura e as regras que qualquer novo projeto derivado deste
> boilerplate (e qualquer IA assistindo o desenvolvimento) deve seguir.

## 🚀 Stack

- Python 3.12 · Django 4.2/5 · Django REST Framework
- PostgreSQL 16 + [pgvector](https://github.com/pgvector/pgvector)
- Celery + Redis (tarefas assíncronas: indexação, sync do Obsidian)
- JWT (`djangorestframework-simplejwt`)
- `django-simple-history` (auditoria) + `core.utils.lgpd` (mascaramento/criptografia)
- Ollama (LLM local, opcional) para embeddings e respostas RAG

## 📁 Estrutura

```
backend_api/
├── Dockerfile                # imagem canônica (build context: backend_api/)
├── docker-compose.yml        # db (pgvector) + redis + backend + worker + beat + ollama
├── entrypoint.sh
├── requirements.txt          # fonte única de dependências
├── .env.example
└── Api/
    ├── manage.py
    ├── config/                # settings, urls, celery, wsgi/asgi
    │   └── settings/{base,dev,prod}.py
    ├── core/                  # mixins (Tenant/Audit/SoftDelete), middleware, utils LGPD
    ├── User/                  # usuários, tenants, autenticação
    ├── ingestion/             # 🧠 RAG: KnowledgeSource, Document, DocumentChunk
    │   ├── services.py        # chunking, embeddings, sync Obsidian, busca semântica
    │   ├── tasks.py           # Celery: indexação e sync assíncronos
    │   └── management/commands/sync_obsidian.py
    └── payments/              # integração de pagamentos (stub — a implementar)
```

> A configuração legada `Api/Api/` (antiga base SQLite/Firebase) já foi
> removida — `manage.py` usa exclusivamente `config.settings.*`.

## 🔧 Rodando localmente

```bash
cp .env.example .env
# edite DB_*, SECRET_KEY, ENCRYPTION_KEY, etc.

docker compose up --build
```

Isso sobe: Postgres com pgvector, Redis, a API Django, o worker Celery,
o Celery Beat (sync periódico do Obsidian) e, opcionalmente, o Ollama.

Sem Docker:

```bash
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cd Api
python manage.py migrate
python manage.py runserver
```

## 🧭 Harness de IA (credenciais + anti-alucinação)

`harness/` é a camada que faz `ingestion` e `orchestration` funcionarem de
forma configurável e segura contra alucinação. Duas partes:

### 1. Configuração de credenciais (sem editar código nem redeploy)

Suporta Ollama (local, sem chave), OpenAI, Anthropic, Groq e OpenRouter.
Prioridade de resolução: credencial do tenant → credencial global do
projeto → variável de ambiente (`.env`, fallback de dev).

Pelo Django admin: `/admin/harness/aiprovidercredential/` — a chave nunca
é exibida depois de salva (só mascarada, ex: `sk-1•••••••••••••4a2b`).

Por linha de comando:

```bash
# Credencial global (Groq, todos os tenants sem chave própria usam esta)
python manage.py configure_ai_provider --provider groq --api-key gsk_... --model openai/gpt-oss-20b

# Credencial específica de um tenant (ex: cliente paga o próprio uso de OpenAI)
python manage.py configure_ai_provider --provider openai --api-key sk-... --tenant <uuid> --model gpt-4o-mini

# Ollama local não precisa de api-key
python manage.py configure_ai_provider --provider ollama --model llama3
```

### 2. Guardrails anti-alucinação (`harness/guardrails.py`)

- `require_grounded_context`: nunca gera resposta sem contexto real — se
  não há dado/RAG suficiente, devolve uma recusa explícita em vez de
  arriscar o LLM "responder mesmo assim" (é aí que ele mais alucina).
- `extract_json` + `validate_schema`: toda decisão estruturada do LLM
  (ex: qual função chamar em `orchestration`) é validada antes de ser usada.
- `citation_coverage`: heurística de auditoria — estima se a resposta
  parece de fato ancorada nas fontes recuperadas (não bloqueia, mas loga
  para revisão).

`ingestion.generate_answer` e `orchestration.answer_question` já usam
esses guardrails por padrão — qualquer nova função de IA no projeto deve
passar por eles também, nunca chamar o modelo direto.

## 🧠 RAG / Memória Semântica (`ingestion`)

### Conceito

```
KnowledgeSource (ex: vault do Obsidian)
        └── Document (uma nota / arquivo)
                └── DocumentChunk (pedaço + embedding vetorial)
```

Toda busca é escopada por `tenant_id` — um tenant nunca vê chunks de outro.

### Sincronizar um vault do Obsidian

Via linha de comando (útil em dev, sem depender do Celery):

```bash
python manage.py sync_obsidian \
    --tenant <uuid-do-tenant> \
    --path /caminho/para/o/vault \
    --name "Vault Principal" \
    --tags publico,docs   # opcional: só indexa notas com essas tags
```

Via API (assíncrono, dispara o Celery):

```
POST /api/v1/ingestion/sources/               # cria o KnowledgeSource
POST /api/v1/ingestion/sources/{id}/sync/      # dispara a sincronização
```

Notas com `private: true` no frontmatter, ou dentro de `.obsidian/`, são
sempre ignoradas.

### Consultar (RAG)

```
POST /api/v1/ingestion/query/
{
  "query": "Qual é a política de reembolso?",
  "top_k": 5,
  "generate_answer": true
}
```

A resposta sempre inclui os `sources` (chunks + documento + distância de
similaridade) — a resposta gerada (`answer`) é opcional e nunca substitui
a rastreabilidade até a fonte original.

### Upload manual de documento

```
POST /api/v1/ingestion/documents/upload/
{ "source_id": 1, "title": "...", "content": "..." }
```

### Configuração (`.env`)

| Variável | Padrão | Descrição |
|---|---|---|
| `EMBEDDING_PROVIDER` | `ollama` | `ollama` (local) ou `openai` (API externa) |
| `EMBEDDING_MODEL` | `nomic-embed-text` | modelo de embedding |
| `EMBEDDING_DIMENSIONS` | `768` | precisa bater com o modelo escolhido |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | endereço do Ollama |
| `OLLAMA_CHAT_MODEL` | `llama3` | modelo usado em `generate_answer` |
| `OBSIDIAN_VAULT_PATH` | — | caminho padrão de vault (opcional) |

## 🧭 Orquestração de IA sobre dado estruturado (`orchestration`)

Complementa o RAG do `ingestion`: responde perguntas sobre dados do
próprio banco (estoque, vendas, o que a vertical do projeto expuser) sem
nunca deixar o LLM gerar SQL — ele só escolhe entre funções pré-aprovadas.

```
POST /api/v1/orchestration/ask/
{ "question": "quantas unidades do produto X temos em estoque?" }
```

Toda vertical registra suas próprias funções seguras em
`orchestration/registry.py` (ver exemplo no próprio arquivo e em `/CLAUDE.md`
seção 5-6). Toda pergunta/resposta é auditada em `orchestration.QueryLog`.

## 🔐 LGPD

`core/utils/lgpd.py` fornece funções para mascarar e criptografar campos
sensíveis (CPF, e-mail, telefone). `ingestion` propositalmente **não**
armazena dados pessoais nos chunks — trate isso como responsabilidade de
quem alimenta o vault/fonte de conhecimento (não coloque PII em notas que
serão sincronizadas).

## 🛠️ Comandos úteis

```bash
python manage.py makemigrations
python manage.py migrate
python manage.py test
python manage.py sync_obsidian --tenant <uuid> --path <vault>
celery -A config worker --loglevel=info
celery -A config beat --loglevel=info
```

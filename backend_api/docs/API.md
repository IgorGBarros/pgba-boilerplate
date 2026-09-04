# API — Referência de Endpoints

Todos os endpoints (exceto obtenção/refresh de token) exigem
`Authorization: Bearer <access_token>` e resolvem `request.tenant_id` via
`core.middleware.tenant`. Respostas de erro seguem o formato padrão do
DRF (`{"detail": "..."}`) salvo indicação contrária.

## Autenticação (`User`)

Prefixo: `/api/v1/users/` (já ativo em `config/urls.py` por padrão).

| Método | Rota | Descrição |
|---|---|---|
| `POST` | `/api/v1/users/` | Cria um novo usuário |
| `POST` | `/api/v1/users/token/` | Obtém par de tokens JWT (access + refresh) |
| `POST` | `/api/v1/users/token/refresh/` | Renova o access token |
| `POST` | `/api/v1/users/firebase-login/` | Login via Firebase — **desabilitado por padrão**, requer `firebase-admin` no requirements.txt (ver DOCUMENTATION.md §13) |
| `GET` | `/api/v1/users/health/` | Health check específico do app de usuários (ver também `/health/` na raiz, para monitoramento geral do serviço) |
| `POST` | `/api/v1/users/password-reset/` | Solicita reset de senha por e-mail |
| `POST` | `/api/v1/users/password-reset-confirm/<uidb64>/<token>/` | Confirma o reset |

> Os paths dentro de `User/urls.py` são relativos (`token/`, não
> `api/token/`) — o prefixo `api/v1/users/` já vem inteiro de
> `config/urls.py`. Se algum path novo for adicionado a esse arquivo,
> nunca repita `api/` no início: o resultado duplicaria o prefixo.

## `ingestion` — RAG e Obsidian

Prefixo: `/api/v1/ingestion/`

| Método | Rota | Descrição |
|---|---|---|
| `GET`/`POST` | `sources/` | Lista/cria `KnowledgeSource` |
| `GET`/`PATCH`/`DELETE` | `sources/{id}/` | Detalhe/edição/remoção (soft delete) de uma fonte |
| `POST` | `sources/{id}/sync/` | Dispara sincronização assíncrona (hoje: só `source_type=obsidian`) |
| `GET` | `documents/` | Lista documentos indexados do tenant |
| `GET` | `documents/{id}/` | Detalhe de um documento |
| `POST` | `documents/upload/` | Upload manual de um documento avulso (fora do fluxo Obsidian) |
| `POST` | `query/` | Busca semântica + resposta opcional |

### `POST sources/`

```json
{
  "name": "Vault Principal",
  "source_type": "obsidian",
  "config": {"vault_path": "/vaults/cliente-x", "include_tags": ["publico"]}
}
```

### `POST documents/upload/`

```json
{
  "source_id": 1,
  "title": "Política de reembolso",
  "content": "texto completo do documento...",
  "metadata": {"categoria": "financeiro"}
}
```
Resposta: `202 Accepted` com o `Document` criado (`status: pending`) — a
indexação roda assíncrona via Celery (`ingestion.tasks.process_document_task`).

### `POST query/`

```json
{
  "query": "Qual é a política de reembolso?",
  "top_k": 5,
  "generate_answer": true
}
```

Resposta:
```json
{
  "query": "Qual é a política de reembolso?",
  "sources": [
    {"document_title": "...", "source_name": "...", "content": "...", "distance": 0.12}
  ],
  "answer": "texto gerado, ou omitido se generate_answer=false"
}
```
Se `generate_answer=true` e não houver contexto suficiente, `answer`
retorna o texto padrão de recusa (`harness.guardrails.NoAnswer.TEXT`) em
vez de erro — a chamada em si é `200 OK`.

## `orchestration` — Q&A sobre dado estruturado

Prefixo: `/api/v1/orchestration/`

| Método | Rota | Descrição |
|---|---|---|
| `POST` | `ask/` | Pergunta sobre dado estruturado do tenant |

### `POST ask/`

```json
{ "question": "quantas unidades do produto X temos em estoque?", "use_rag_context": true }
```

Resposta:
```json
{
  "answer": "Você tem 42 unidades do produto X em estoque.",
  "function_called": "total_itens_em_estoque",
  "sources": [],
  "status": "ok"
}
```

`status` pode ser `ok`, `function_error`, `llm_error` ou `rejected`
(guardrail de grounding bloqueou por falta de base). Em qualquer caso que
não seja `ok`, o HTTP status é `502` — mas o corpo sempre traz uma
`answer` amigável, nunca deixe a UI mostrar um erro cru.

## `harness` — credenciais de IA e geração de código

Credenciais são gerenciadas via Django admin
(`/admin/harness/aiprovidercredential/`) e comando de management
(`configure_ai_provider`) — trocar credencial de IA é uma operação
administrativa, não uma ação de usuário final.

O harness expõe **um** endpoint REST, usado pela automação de geração de
frontend (`frontend/scripts/generate-page.mjs`) e por qualquer outra
automação do projeto que precise de código/texto gerado por LLM:

| Método | Rota | Descrição |
|---|---|---|
| `POST` | `/api/v1/harness/generate/` | Gera código via o provedor configurado (`CHAT_PROVIDER`) |

### `POST generate/`

```json
{
  "prompt": "um card de boas-vindas com botão verde",
  "language": "tsx",
  "previous_code": "... (opcional, etapa de autocorreção)",
  "validation_error": "TS2304: ... (opcional, etapa de autocorreção)"
}
```

Resposta:
```json
{ "code": "export default function ...", "language": "tsx" }
```

`previous_code` + `validation_error` juntos ativam o modo de correção: em
vez do prompt original, o modelo recebe o código que falhou e o erro real
de validação (typecheck/lint/build), e é instruído a corrigir
especificamente aquilo — nunca "tente de novo" sem contexto. Erro de
provedor (`ProviderConfigError`) ou de extração de código retornam `502`
com `detail` explicando o motivo.

Este endpoint gera texto/código — **não executa nada**. Quem roda
typecheck/lint/build e decide se o resultado é aceitável é sempre o
chamador (o script Node, um agente, um comando de management), nunca o
Django.

## `agency` — Agentes & Setores (exemplo de vertical hierárquica)

Prefixo: `/api/v1/agency/`

| Método | Rota | Descrição |
|---|---|---|
| `GET`/`POST` | `sectors/` | Lista/cria setores (`knowledge_source` = cérebro secundário do setor) |
| `GET`/`PATCH`/`DELETE` | `sectors/{id}/` | Detalhe/edição/remoção de um setor |
| `GET`/`POST` | `agents/` | Lista/cria agentes (filtra por `?sector=<id>`). `access_level`: `operational`\|`sector_orchestrator`\|`general_orchestrator`\|`ceo`. `autonomy_level`: `0` Observer (padrão) a `4` Autonomous — ver `POST agents/{id}/ask/` e "Autonomia e Policy Engine" no `CLAUDE.md`. Cada agente traz `work_status`/`current_task` (estado ao vivo) e `last_active_at` (última interação — cobre o caso do status voltar a `idle` antes do próximo poll) |
| `GET`/`PATCH`/`DELETE` | `agents/{id}/` | Detalhe/edição/remoção de um agente |
| `POST` | `agents/{id}/ask/` | Pergunta via este agente (RAG escopado ao setor, exceto acesso total). Se a função escolhida tiver risco acima do que `autonomy_level` permite, a resposta volta com `status="pending_approval"` em vez de executar — ver `pending-approvals/` |
| `POST` | `agents/{id}/pause/` | Pausa o agente, preserva a tarefa atual no backlog |
| `GET`/`POST` | `sector-messages/request/` | Lista mensagens entre setores / solicita envio para outro setor (fica `pending`) |
| `GET` | `sector-messages/{id}/` | Detalhe de uma mensagem entre setores |
| `POST` | `sector-messages/{id}/relay/` | Um orquestrador (ou CEO) encaminha a mensagem pendente |
| `GET`/`POST` | `policy-rules/` | Lista/cria regras que liberam um agente `POLICY_EXECUTOR`+ a auto-executar um risco específico (configurável — nunca hardcoded) |
| `GET`/`PATCH`/`DELETE` | `policy-rules/{id}/` | Detalhe/edição/remoção de uma regra |
| `GET` | `pending-approvals/` | Fila de ações bloqueadas pela política, aguardando decisão humana (filtra por `?status=pending\|approved\|rejected`) |
| `POST` | `pending-approvals/{id}/decide/` | `{"approved": true\|false}` — se aprovado, executa a função de verdade agora (nunca antes) |
| `GET`/`POST` | `tasks/` | Lista/cria tarefas (filtra por `?status=` e `?agent=`) — ciclo de vida completo, complementar ao policy engine |
| `GET` | `tasks/{id}/` | Detalhe de uma tarefa, incluindo os `snapshots` (histórico de interrupções) |
| `POST` | `tasks/{id}/interrupt/` | `{"instructions": "..."}` — pausa a tarefa, salva snapshot do estado atual |
| `POST` | `tasks/{id}/adapt/` | `{"new_brief": "..."}` — só em tarefa pausada; monta novo prompt citando o snapshot |
| `POST` | `tasks/{id}/execute/` | Dispara a execução via o modelo configurado no harness (`CHAT_PROVIDER`/`OLLAMA_CHAT_MODEL`) — só a partir de `created`/`adapted` |
| `POST` | `tasks/{id}/approve/` | `{"files": {"path": "conteúdo"}, "trigger_git": true}` — se a tarefa tiver `project`, cria branch+PR real no GitHub |
| `POST` | `tasks/{id}/reject/` | `{"reason": "..."}` (opcional) |
| `GET` | `metrics/overview/` | Custo/tokens/chamadas totais do tenant + mensagens pendentes |
| `GET` | `metrics/sectors/` | Métricas agregadas por setor (com % de uso do orçamento e se tem cérebro próprio) |
| `GET` | `metrics/agents/` | Métricas por agente (filtra por `?sector=<id>`) |
| `GET` | `metrics/budgets/` | Só os setores com orçamento mensal definido |
| `GET` | `projects/` | Lista projetos comerciais criados (ver `POST projects/create/`) |
| `GET` | `projects/{id}/` | Detalhe de um projeto (status, link do repositório) |
| `POST` | `projects/create/` | Cria um projeto comercial simples: repositório GitHub + template `simple-commercial` |

### `POST agents/` — criando um agente

```json
{ "name": "Analista Jurídico", "role": "Analista", "sector": 1, "access_level": "operational" }
```

`sector` é obrigatório para `operational`/`sector_orchestrator`, e deve
ser omitido (`null`) para `general_orchestrator`/`ceo` — validado no
serializer (`400` caso contrário).

### `POST agents/{id}/ask/`

```json
{ "question": "quantas unidades do produto X temos em estoque?", "use_rag_context": true }
```

Resposta: mesmo formato de `orchestration/ask/` (`answer`, `function_called`,
`sources`, `status`) — este endpoint adiciona duas coisas: (1) grava
tokens/custo estimados em `AgentInteraction`; (2) restringe o contexto de
RAG ao "cérebro" do setor do agente (`Sector.knowledge_source`), a menos
que o agente tenha `access_level` de acesso total.

### Comunicação entre setores (sempre mediada)

```
POST sector-messages/request/
{ "from_agent_id": 5, "to_sector_id": 2, "content": "Preciso do relatório de despesas do trimestre." }
→ 202 { "id": 12, "status": "pending", ... }

POST sector-messages/12/relay/
{ "relaying_agent_id": 8 }              # precisa ser orquestrador (do setor envolvido) ou CEO/orq-geral
→ 200 { "id": 12, "status": "answered", "response": "...", "relayed_by_name": "..." }
```

Se `relaying_agent_id` não tiver permissão (é operacional, ou é
orquestrador de um setor não envolvido na mensagem), a resposta é `403`
com o motivo em `detail`, e a mensagem fica marcada `rejected`.

### `POST projects/create/` — "setor de Desenvolvimento, crie um projeto"

```json
{
  "requesting_agent_id": 3,
  "name": "loja-cliente-x",
  "description": "Landing page + checkout simples",
  "private": true
}
```

Resposta (`201`, sempre — mesmo em caso de falha na integração):
```json
{
  "id": 1, "name": "loja-cliente-x", "status": "ready",
  "github_repo_url": "https://github.com/sua-org/loja-cliente-x",
  "github_full_name": "sua-org/loja-cliente-x",
  "error_message": ""
}
```

Se não houver credencial do GitHub configurada (ver seção `integrations`
abaixo), `status` vem `"failed"` com `error_message` preenchido — nunca
um erro HTTP cru. `name` só aceita letras/números/`.`/`-`/`_` (vira o
nome do repositório).

### `GET metrics/sectors/`

```json
[
  {
    "sector_id": 1, "sector_name": "Backend", "agents_count": 3,
    "has_own_knowledge_base": true,
    "tokens": 15420, "cost_usd": 0.154, "budget_usd": 50.0,
    "usage_percent": 0.3, "status": "ok"
  }
]
```

`status` é `ok` (\<80%), `warn` (80–99%), `over` (≥100%) ou
`sem_orcamento` (setor sem `monthly_budget_usd` definido).

### Tempo real (WebSocket)

```
ws://<host>/ws/agency/?token=<JWT access token>
```

Token vai na URL, não em header `Authorization` — WebSocket nativo do
navegador não permite header customizado na conexão. Sem token válido,
fecha com código `4001`. Um cliente conectado recebe todo evento de
`Task`/`Agent`/`PendingApproval` do próprio tenant, formato `{"kind": "task"|"agent"|"pending_approval", ...}`
(mesmo shape de `TaskSerializer`/`AgentSerializer`). Ver "Tempo real
(Django Channels)" no `CLAUDE.md` para o design completo.

## `integrations` — credenciais de infraestrutura/deploy

Mesmo padrão do `harness` (credencial criptografada, resolvida por
tenant → global), mas para GitHub/Vercel/Render/Supabase — não expõe
endpoint REST (só admin/CLI, mesma decisão do `harness` para
`AIProviderCredential`):

```bash
python manage.py configure_service_credential --provider github \
    --token ghp_... --account-ref sua-org
```

Django admin: `/admin/integrations/servicecredential/` (token sempre mascarado).

## Convenções gerais

- Toda rota de escrita (`POST`/`PATCH`/`DELETE`) em app de negócio
  respeita `SoftDeleteMixin` — nada é removido fisicamente por padrão.
- Paginação segue o padrão DRF configurado em `config/settings/base.py`.
- `drf-spectacular` está instalado (gera schema OpenAPI a partir das
  views) mas as rotas `/api/schema/` e `/api/docs/` ainda não estão
  registradas em `config/urls.py` — adicione-as se quiser Swagger/Redoc
  automático:
  ```python
  from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView
  # em urlpatterns:
  path('api/schema/', SpectacularAPIView.as_view(), name='schema'),
  path('api/docs/', SpectacularSwaggerView.as_view(url_name='schema')),
  ```
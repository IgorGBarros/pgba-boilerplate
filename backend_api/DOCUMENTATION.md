# Documentação — PGBA Boilerplate

> Referência completa de arquitetura, features e conceitos. Para o
> contrato de regras que qualquer IA/dev deve seguir ao trabalhar neste
> repositório, ver `/CLAUDE.md`. Para prompt de onboarding pronto para
> colar numa sessão de IA, ver `/prompt-boilerplate-pgba.md` (gerado à
> parte, fora deste repositório). Para endpoints, ver `docs/API.md`. Para
> deploy, ver `docs/DEPLOY.md`. Para conformidade LGPD em detalhe, ver
> `docs/LGPD.md`.

## Índice

1. [O que é este boilerplate](#1-o-que-é-este-boilerplate)
2. [Arquitetura geral](#2-arquitetura-geral)
3. [Multi-tenancy: isolamento por tenant](#3-multi-tenancy-isolamento-por-tenant)
4. [Auditoria e soft delete](#4-auditoria-e-soft-delete)
5. [LGPD](#5-lgpd)
6. [IA — visão geral das duas camadas](#6-ia--visão-geral-das-duas-camadas)
7. [`harness`: credenciais e guardrails anti-alucinação](#7-harness-credenciais-e-guardrails-anti-alucinação)
8. [`ingestion`: RAG e integração com Obsidian](#8-ingestion-rag-e-integração-com-obsidian)
9. [`orchestration`: perguntas sobre dado estruturado](#9-orchestration-perguntas-sobre-dado-estruturado)
10. [Como a IA se comporta, passo a passo](#10-como-a-ia-se-comporta-passo-a-passo)
11. [Padrão de Vertical (módulo de domínio)](#11-padrão-de-vertical-módulo-de-domínio)
12. [Infraestrutura (Docker, Celery, Postgres+pgvector)](#12-infraestrutura-docker-celery-postgrespgvector)
13. [Autenticação e usuários](#13-autenticação-e-usuários)
14. [Pagamentos](#14-pagamentos)
15. [Frontend: scaffold real e integração](#15-frontend-scaffold-real-e-integração)
16. [Agentes de código e loop de feedback](#16-agentes-de-código-e-loop-de-feedback)
17. [Princípios GenAI4EU aplicados](#17-princípios-genai4eu-aplicados)
18. [Estrutura de diretórios completa](#18-estrutura-de-diretórios-completa)

---

## 1. O que é este boilerplate

O PGBA Boilerplate não é "um projeto" — é uma **plataforma multi-vertical**
para construir produtos de software com IA integrada, pensada para o
mercado brasileiro (LGPD nativa) e para funcionar com qualquer setor de
negócio sem precisar dar fork no core.

Pilares:

- **Multi-tenant desde o primeiro model.** Um deploy atende N clientes,
  com isolamento de dado garantido em toda camada (model, query, IA).
- **LGPD por padrão**, não como retrofit: mascaramento, criptografia de
  campo e registro de consentimento existem desde o `core`.
- **IA local-first e sem alucinação por padrão.** Ollama roda na própria
  infraestrutura; toda resposta de IA passa por guardrails explícitos
  antes de chegar ao usuário.
- **"Vertical" como unidade de customização.** O domínio de negócio de
  cada cliente (estoque, jurídico, saúde, imobiliário...) é um módulo
  plugável, nunca um fork do repositório.
- **Async por padrão** para tudo que é lento ou externo (Celery + Redis).

## 2. Arquitetura geral

```
                        ┌──────────────────────────┐
                        │        cliente (web/      │
                        │     mobile/API externa)   │
                        └─────────────┬──────────────┘
                                      │ JWT
                        ┌─────────────▼──────────────┐
                        │  autenticação DRF (JWT)     │
                        │  + TenantContextMixin        │  ← resolve tenant_id
                        │  (core.mixins, dentro de     │    DEPOIS da auth
                        │   initial() de cada view)    │
                        └─────────────┬──────────────┘
           ┌──────────────────────────┼───────────────────────────┐
           │                          │                           │
   ┌───────▼────────┐       ┌─────────▼─────────┐       ┌─────────▼─────────┐
   │   User (auth)   │       │   sua vertical    │       │   ingestion /      │
   │                 │       │ (estoque, crm...) │       │   orchestration    │
   └────────┬────────┘       └─────────┬─────────┘       └─────────┬─────────┘
            │                          │ registra funções           │ chat/embed
            │                          │ seguras em                 │
            │                          ▼                           ▼
            │                ┌───────────────────┐       ┌─────────────────┐
            │                │  orchestration/    │       │    harness       │
            │                │  registry.py       │◄──────┤ credenciais +    │
            │                └───────────────────┘       │ guardrails       │
            │                                              └────────┬────────┘
            │                                                       │
            └───────────────────────┬───────────────────────────────┘
                                     ▼
                     ┌───────────────────────────────┐
                     │  PostgreSQL 16 + pgvector       │
                     │  (todo dado, inclusive vetores) │
                     └───────────────────────────────┘
```

Cada app Django é uma camada com responsabilidade única:

| App | Responsabilidade |
|---|---|
| `core` | Mixins transversais (tenant/auditoria/soft-delete/`TenantContextMixin`), utilitários LGPD, `ConsentRecord` |
| `User` | Autenticação, usuários, roles, planos |
| `harness` | Credenciais de provedores de IA + guardrails anti-alucinação + endpoint de geração de código |
| `ingestion` | RAG: fontes de conhecimento (Obsidian, upload, URL) → busca semântica |
| `orchestration` | Q&A sobre dado estruturado do banco, via function-calling seguro |
| `agency` | Exemplo real de vertical: Agentes & Setores, métricas de custo/uso (ver §11) |
| `integrations` | Credenciais de serviços externos não-IA (GitHub, Vercel, Render, Supabase) |
| `payments` | Esqueleto de integração de pagamento (Asaas) — a implementar por projeto |
| `<sua-vertical>` | O domínio de negócio real do cliente — `agency` é o exemplo, cada projeto cria a sua |

## 3. Multi-tenancy: isolamento por tenant

Todo model de negócio herda `core.mixins.TenantMixin`, que adiciona um
campo `tenant_id` (UUID, indexado).

**`request.tenant_id` é resolvido por `core.mixins.TenantContextMixin`
— toda APIView/ViewSet nova precisa herdar dele.** Isso não é opcional
nem estilo: middleware comum de Django roda ANTES da autenticação do
DRF, então `request.user` (e portanto `request.user.tenant_id`) ainda
não existe nesse momento — um middleware nunca resolve isso de verdade
para uma request de API. `TenantContextMixin.initial()` roda DEPOIS da
autenticação, no lugar certo do ciclo de vida do DRF:

```python
from core.mixins import TenantContextMixin
from rest_framework.views import APIView

class MinhaView(TenantContextMixin, APIView):
    def get(self, request):
        tenant_id = request.tenant_id  # já resolvido de verdade aqui
```

`core/middleware/tenant.py` (`TenantMiddleware`) ainda existe no
`MIDDLEWARE`, mas é só para o caso raro de uma view Django "crua" (não-DRF)
autenticada por sessão — **nunca confie nele para uma APIView/ViewSet**.

Regra absoluta: **toda query filtra por `tenant_id` explicitamente**. Isso
vale em três lugares onde é fácil esquecer e onde o custo de esquecer é
alto:

- em `ingestion.semantic_search()` — sem isso, a busca vetorial devolveria
  chunks de conhecimento de outro cliente;
- em `orchestration.registry.execute()` — o `tenant_id` vem sempre do
  código Python, nunca do LLM, mesmo que o modelo "sugira" um filtro;
- em qualquer `AIProviderCredential` do `harness` — a resolução de
  credencial verifica o tenant antes de cair no default global.

## 4. Auditoria e soft delete

`core.mixins.AuditMixin` adiciona `django-simple-history` a qualquer
model — toda alteração fica registrada com quem mudou e quando, sem
código adicional na vertical.

`core.mixins.SoftDeleteMixin` adiciona `is_active` + `deleted_at`.
`.delete()` nunca remove a linha fisicamente — marca como inativa. Isso é
necessário tanto para auditoria quanto porque um `DELETE` físico
prematuro quebraria a trilha de consentimento LGPD associada ao registro.
`hard_delete()` existe para os casos raros (expurgo LGPD explícito) em que
a remoção física é necessária.

## 5. LGPD

Três peças:

1. **`core/utils/lgpd.py`** — funções de mascaramento (`mask_cpf`,
   `mask_email`, `mask_phone`) para exibição, e `encrypt_field`/
   `decrypt_field` (Fernet) para armazenamento de dado sensível.
2. **`core.models.ConsentRecord`** — registro formal de consentimento
   (Art. 8º e 12º da LGPD), multi-tenant, com versionamento de termo,
   revogação por finalidade e hash de IP (nunca IP em texto puro).
   `ConsentRecord.has_consent_for_purpose(tenant_id, user, "ai_training")`
   é a checagem central que qualquer vertical deve fazer antes de usar
   dado do titular para uma finalidade que não seja a operação essencial.
3. **`ingestion` propositalmente não trata PII** — chunks de RAG não
   devem conter dado pessoal; isso é responsabilidade de quem alimenta a
   fonte de conhecimento (não coloque PII em notas do Obsidian que serão
   sincronizadas).

Detalhes de conformidade (direitos do titular, base legal por finalidade,
retenção) em `docs/LGPD.md`.

## 6. IA — visão geral das duas camadas

O boilerplate tem **duas camadas de IA complementares**, que respondem
tipos diferentes de pergunta:

| | `ingestion` (RAG) | `orchestration` (Q&A estruturado) |
|---|---|---|
| Responde perguntas sobre | Conhecimento **não-estruturado** (documentos, notas do Obsidian, texto livre) | Dado **estruturado** do banco (contagens, totais, registros específicos) |
| Como recupera contexto | Busca por similaridade vetorial (`pgvector`, cosine distance) | Executa uma função pré-aprovada (nunca SQL gerado pela IA) |
| Exemplo de pergunta | "Qual é a nossa política de reembolso?" | "Quantas unidades do produto X temos em estoque?" |
| Endpoint | `POST /api/v1/ingestion/query/` | `POST /api/v1/orchestration/ask/` |

Ambas passam pelo mesmo `harness`: mesma resolução de credencial, mesmos
guardrails anti-alucinação, mesma filosofia de "nunca responder sem base
real".

## 7. `harness`: credenciais e guardrails anti-alucinação

### Credenciais configuráveis sem tocar em código

`harness.AIProviderCredential` guarda API key criptografada (Fernet) no
banco, por tenant ou global. Suporta Ollama (local, sem chave), OpenAI,
Anthropic, Groq e OpenRouter.

Ordem de resolução (`harness/providers.py:get_credential`):

```
1. Credencial ativa do tenant específico
2. Credencial ativa global do projeto (tenant_id nulo)
3. Variável de ambiente (.env) — só fallback de desenvolvimento
```

Duas formas de configurar, nenhuma delas exige editar código ou redeploy:

```bash
# Django admin
/admin/harness/aiprovidercredential/   # chave sempre mascarada na UI

# CLI
python manage.py configure_ai_provider --provider groq --api-key gsk_... --model openai/gpt-oss-20b
python manage.py configure_ai_provider --provider openai --api-key sk-... --tenant <uuid> --model gpt-4o-mini
python manage.py configure_ai_provider --provider ollama --model llama3   # sem api-key
```

### Cliente unificado

`harness/providers.py` expõe duas funções — **nenhum outro app deveria
montar uma requisição HTTP a um provedor de IA diretamente**:

```python
chat_completion(tenant_id, provider, model, messages, temperature=0.3, json_mode=False) -> str
embed(tenant_id, provider, model, text) -> list[float]
```

### Guardrails — o que efetivamente evita alucinação

`harness/guardrails.py` não é "prompt engineering bonito": são checagens
de código que rodam antes/depois de qualquer chamada de LLM.

| Função | O que faz | Onde é usada |
|---|---|---|
| `require_grounded_context(context)` | Levanta `GroundingError` se o contexto for vazio/curto. O chamador deve devolver `NoAnswer.TEXT` — **nunca deixa o LLM "tentar mesmo assim"** | `ingestion.generate_answer`, `orchestration.answer_question` |
| `extract_json(raw)` | Extrai JSON válido da resposta do modelo, mesmo com ruído (crases de markdown, texto antes/depois) | `orchestration._select_function` |
| `validate_schema(data, required_keys)` | Garante que a saída estruturada do LLM tem exatamente os campos/tipos esperados antes de ser usada para qualquer decisão | `orchestration._select_function` |
| `citation_coverage(answer, sources)` | Heurística (trigramas) que estima se a resposta parece ancorada nas fontes recuperadas — não bloqueia, loga para auditoria | Disponível para uso em monitoramento/QA |

`NoAnswer.TEXT` é a resposta padrão quando um guardrail bloqueia a
geração: *"Não encontrei informação suficiente na base de conhecimento ou
nos dados disponíveis para responder com segurança..."* — sempre melhor
que arriscar uma alucinação confiante.

## 8. `ingestion`: RAG e integração com Obsidian

### Modelo de dados

```
KnowledgeSource  →  Document  →  DocumentChunk (embedding pgvector, índice HNSW)
```

- **`KnowledgeSource`**: uma origem configurada por um tenant. Tipos:
  `obsidian`, `upload`, `url`, `api`. Tem um `config` (JSON) livre — para
  Obsidian, guarda `{"vault_path": "...", "include_tags": [...]}`.
- **`Document`**: uma unidade de conteúdo (uma nota, um arquivo). Guarda
  texto bruto, `content_hash` (SHA-256, evita reprocessar sem mudança),
  `metadata` (frontmatter, tags) e `status` (pending/processing/indexed/error).
- **`DocumentChunk`**: pedaço indexável do documento (chunking por
  parágrafo com overlap), com o vetor de embedding e `tenant_id`
  denormalizado (evita JOIN na busca e reforça isolamento).

### Como a sincronização do Obsidian funciona, passo a passo

`ingestion.services.sync_obsidian_source(source)`:

1. Varre `source.config["vault_path"]` recursivamente procurando `*.md`.
2. **Ignora sempre** a pasta `.obsidian/` (configuração interna do app,
   não é conteúdo).
3. Lê cada nota com `python-frontmatter` (separa YAML frontmatter do corpo).
4. **Ignora notas com `private: true`** no frontmatter — nunca indexadas,
   nunca chegam a um embedding.
5. Se `include_tags` estiver configurado na fonte, só indexa notas que
   tenham pelo menos uma dessas tags — permite sincronizar só uma parte
   pública do vault, nunca notas pessoais.
6. Calcula o hash SHA-256 do conteúdo. Se já existe um `Document` com esse
   `external_id` (caminho relativo no vault) e o hash não mudou, **pula**
   — não reembedda sem necessidade.
7. Se é novo ou mudou, cria/atualiza o `Document` e chama
   `index_document()`: quebra em chunks, gera embedding de cada um
   (`harness.providers.embed`) e persiste em `DocumentChunk`.
8. Atualiza `source.last_synced_at`.

O vault **nunca é escrito de volta** — é sempre fonte de verdade, o
boilerplate só lê.

### Disparando a sincronização

```bash
# CLI (síncrono, útil em dev sem Celery)
python manage.py sync_obsidian --tenant <uuid> --path /caminho/do/vault \
    --name "Vault Principal" --tags publico,docs

# API (assíncrono, via Celery)
POST /api/v1/ingestion/sources/               # cria a KnowledgeSource
POST /api/v1/ingestion/sources/{id}/sync/      # dispara orchestration.tasks.sync_obsidian_source_task
```

Em produção, `orchestration.tasks.sync_all_obsidian_sources_task` pode
ser agendada no Celery Beat (ex: a cada 15 min) para manter o vault
sincronizado automaticamente.

### Busca semântica e geração de resposta

```python
semantic_search(query, tenant_id, top_k=5) -> list[RetrievedChunk]
```

Usa `pgvector.django.CosineDistance`, sempre filtrado por `tenant_id`.
Retorna os chunks mais similares com `document_title`, `source_name` e
`distance` — a UI pode (e deve) exibir a fonte de cada resultado.

```python
generate_answer(query, context, tenant_id) -> str
```

Aplica `require_grounded_context` primeiro (guardrail 7); se passar,
monta um prompt com um system prompt que instrui o modelo a responder
*somente* com base no contexto e a admitir quando não sabe, e chama
`harness.providers.chat_completion`.

### Endpoints

| Método | Rota | O que faz |
|---|---|---|
| `POST` | `/api/v1/ingestion/sources/` | Cria uma `KnowledgeSource` |
| `POST` | `/api/v1/ingestion/sources/{id}/sync/` | Dispara sincronização assíncrona |
| `GET` | `/api/v1/ingestion/documents/` | Lista documentos do tenant |
| `POST` | `/api/v1/ingestion/documents/upload/` | Upload manual de um documento avulso |
| `POST` | `/api/v1/ingestion/query/` | Busca semântica + resposta opcional (`generate_answer: true`) |

## 9. `orchestration`: perguntas sobre dado estruturado

### O problema que este módulo resolve

Um projeto-irmão deste boilerplate (um sistema de gestão de estoque)
originalmente deixava o LLM **gerar SQL livre** para responder perguntas
sobre o banco, executando essa query direto no Postgres com a única
validação de que começasse com `SELECT`. Isso é, em tese, explorável por
prompt injection para vazar dado de outro tenant/cliente. `orchestration`
existe para tornar essa classe de bug **estruturalmente impossível**.

### Como funciona

```
pergunta do usuário
        │
        ▼
router.route(pergunta) ──► escolhe categoria (fast/standard/report) e modelo
        │
        ▼
LLM recebe o CATÁLOGO de funções permitidas (registry.catalog_for_prompt())
e escolhe UMA, respondendo em JSON: {"function": "...", "params": {...}}
        │
        ▼
harness.guardrails.extract_json + validate_schema  ← valida a escolha
        │
        ▼
registry.execute(function_name, tenant_id, params)  ← tenant_id vem do
        │                                              código Python,
        │                                              NUNCA do LLM
        ▼
resultado da função + contexto de RAG opcional (ingestion.semantic_search)
        │
        ▼
require_grounded_context  ← se nem função nem RAG deram nada, RECUSA
        │
        ▼
LLM usa o resultado + contexto SÓ para redigir a resposta em linguagem
natural — nunca para decidir o que consultar
        │
        ▼
tudo fica registrado em orchestration.QueryLog (pergunta, função chamada,
parâmetros, resultado, modelo, latência, status)
```

### Registrando uma função segura (o que cada vertical faz)

```python
from orchestration.registry import register_query_function

@register_query_function(
    name="total_itens_em_estoque",
    description="Retorna o total de unidades em estoque de um produto pelo nome.",
    parameters={"produto_nome": "string"},
)
def total_itens_em_estoque(tenant_id, produto_nome: str) -> dict:
    qtd = InventoryItem.objects.filter(
        tenant_id=tenant_id, product__name__icontains=produto_nome
    ).aggregate(total=Sum("quantity"))["total"] or 0
    return {"produto": produto_nome, "quantidade": qtd}
```

Assinatura sempre `func(tenant_id, **params) -> dict`. `params` vem do LLM
— trate como entrada não confiável (valide tipo/tamanho dentro da
função). `tenant_id` vem sempre do código chamador.

### Endpoint

```
POST /api/v1/orchestration/ask/
{ "question": "quantas unidades do produto X temos em estoque?", "use_rag_context": true }
```

Resposta sempre inclui `sources` (chunks do RAG usados, se houver) e
`function_called` — nunca só o texto da resposta, para manter
rastreabilidade.

## 10. Como a IA se comporta, passo a passo

Resumo prático de "o que a IA faz e não faz" neste boilerplate:

**Faz:**
- Responde perguntas com base em conhecimento indexado (RAG) ou dado real
  do banco (function-calling).
- Sempre expõe a fonte da informação (documento/chunk ou função
  executada) junto da resposta.
- Recusa explicitamente quando não há base suficiente, em vez de inventar.
- Registra toda interação estruturada (`QueryLog`) para auditoria.
- Roda localmente por padrão (Ollama) — dado do tenant não sai para
  nuvem de terceiros a menos que configurado explicitamente.

**Não faz (por design):**
- Não gera nem executa SQL.
- Não decide sozinha qual dado é seguro expor — isso é decidido por um
  humano no momento em que a função é escrita e revisada em `registry.py`.
- Não executa ações de negócio (escrever, cobrar, cancelar) — hoje o
  pipeline só responde perguntas. Uma vertical que precise de ação de IA
  deve implementar confirmação humana explícita antes de executar.
- Não treina/faz fine-tuning — a customização é via RAG (contexto
  injetado) e function-calling sobre função pré-aprovada.
- Não usa uma chave de API hardcoded no código — sempre resolvida via
  `harness`.

## 11. Padrão de Vertical (módulo de domínio)

Uma "vertical" é um app Django que representa o domínio de negócio real
de um cliente/projeto — o que faz este boilerplate deixar de ser genérico
e virar o produto de alguém.

```
minha_vertical/
├── models.py       # sempre TenantMixin + AuditMixin + SoftDeleteMixin
├── services.py      # regra de negócio pura, sem depender de request/DRF
├── serializers.py
├── views.py          # fino: valida entrada, chama services, serializa saída
├── tasks.py           # tudo lento/externo (IA, e-mail, webhook) é Celery
├── management/commands/
└── apps.py             # no ready(), importa e registra funções em orchestration.registry
```

Checklist ao criar uma vertical nova:
1. Models herdam os três mixins de `core`.
2. Se a vertical gera conteúdo pesquisável (relatórios, documentos), crie
   um `KnowledgeSource` e use `ingestion.services.index_document` — não
   reinvente busca semântica.
3. Registre funções seguras em `orchestration/registry.py` para que a IA
   possa responder perguntas sobre o dado da vertical.
4. Se usar dado pessoal para algo além da operação essencial, cheque
   `ConsentRecord.has_consent_for_purpose` antes.

### Exemplo real: `agency` (Agentes & Setores)

Incluído no repositório como referência funcional (não é um app vazio de
exemplo — roda de verdade, `manage.py check` e `makemigrations` passam).

Modela uma **hierarquia de empresa**, não só uma lista de agentes:
`CEO`/`Orquestrador-Geral` (sem setor, acesso total) → `Orquestrador de
Setor` (medeia só o próprio setor) → `Operacional` (só acessa o próprio
setor). Inspirado no conceito de escritório virtual de agentes de um
produto irmão deste ecossistema, mas **sem a cena 3D** — deliberado: o
que um boilerplate reutiliza entre projetos é o modelo de dados e as
métricas, a visualização 3D (`react-three-fiber`) é peso de dependência
específico de um produto. Ver `/CLAUDE.md`, seção 7, para o diagrama
completo da hierarquia e o fluxo de `SectorMessage` (comunicação entre
setores, sempre mediada — nunca direta).

Peças:
- `Agent.access_level` (`operational` / `sector_orchestrator` /
  `general_orchestrator` / `ceo`) + `CheckConstraint` no banco garantindo
  que só CEO/Orquestrador-Geral têm `sector=None`.
- `Sector.knowledge_source` — o "cérebro secundário" de cada setor
  (`ingestion.KnowledgeSource`). `agency.services._rag_scope_for(agent)`
  decide o que cada agente pode consultar: `None` (irrestrito) só para
  quem tem acesso total; agente comum recebe **lista vazia** (nunca
  irrestrito) se o setor não tiver cérebro configurado.
- `agency.services.ask_as_agent()` — nunca chama IA direto; sempre via
  `orchestration.answer_question(..., rag_source_ids=...)`. Depois
  registra o resultado em `AgentInteraction` com tokens/custo estimados
  — isso é o "cérebro principal" na prática: toda interação de todo
  agente cai ali, consultável sem filtro por quem tem acesso total.
- `SectorMessage` + `request_cross_sector_message()` /
  `relay_message()` — um setor nunca fala com outro sem passar por um
  agente com `can_relay=True`, e um Orquestrador de Setor só medeia
  mensagens que envolvam o próprio setor (`AccessDeniedError` caso
  contrário).
- `AgentInteraction` referencia `orchestration.QueryLog` por id solto
  (`query_log_id`), não por FK — `agency` depende de `orchestration`
  (core), nunca o contrário; inverter isso quebraria a camada.
- `agency/services.py` expõe `get_overview`, `get_sector_metrics`,
  `get_agent_metrics`, `get_budget_status` — o equivalente ao console
  "Overview / Setores / Agentes / Orçamentos" de um produto irmão, com
  dado real agregado de `AgentInteraction`, nunca mockado.

### Visibilidade de quem está trabalhando, sem 3D (`AgentStatusBoard`)

`frontend/src/components/AgentStatusBoard.tsx` — a alternativa
deliberadamente leve à cena 3D: um painel que faz polling em
`GET /api/v1/agency/agents/` a cada 4 segundos e mostra, agrupado por
setor, uma bolinha de status (`working` = verde pulsando, `idle` =
cinza, `paused` = amarelo) + `current_task` de cada agente.

Duas limitações conhecidas e como são cobertas:
- `ask_as_agent()` é síncrono — um agente só fica `work_status=working`
  pela duração real da chamada de IA. Se essa chamada for mais rápida que
  o intervalo de polling, a UI pode nunca "pegar" o instante em que
  esteve trabalhando.
- Para compensar, `AgentSerializer.last_active_at` (anotado no
  `AgentViewSet` via `Max("interactions__created_at")`, não é campo do
  model) mostra a última interação registrada mesmo que o status atual
  já tenha voltado para `idle` — a UI nunca parece "sempre ocioso" só por
  causa do timing do poll.

Aba "Agentes" em `App.tsx`.

### "Setor de Desenvolvimento cria um projeto" (`agency.Project` + `integrations`)

Um pedido de tipo diferente do resto: não é uma tela dentro do PGBA, é
um **produto separado** para o cliente comercializar.
`agency.services.create_project(tenant_id, requesting_agent_id, name, description)`:

1. Cria um `agency.Project` (`status=pending`).
2. Chama `integrations.services.create_project_repository()`, que resolve
   a credencial do GitHub (`integrations.ServiceCredential`, mesmo padrão
   de criptografia do `harness`, mas app separado — `integrations` é para
   infraestrutura/deploy, não IA) e cria o repositório via
   `integrations.github.create_repository()`.
3. Envia o template `simple-commercial`
   (`agency/project_templates/simple_commercial/`) arquivo por arquivo,
   via **Contents API do GitHub** (`PUT /repos/.../contents/{path}`) —
   não `git clone`+`push`, para não depender do binário `git` dentro do
   processo do Django.
4. Marca `status=ready` (com `github_repo_url`) ou `status=failed` (com
   `error_message`) — **nunca levanta exceção para o chamador**.

O template `simple-commercial` é **deliberadamente diferente** do
boilerplate PGBA: React+Vite+TS puro, `vercel.json` pronto, cliente
Supabase stub — sem multi-tenant, sem Django, sem RAG. Um produto simples
para vender a um cliente não precisa carregar o peso da plataforma
interna; se crescer a ponto de precisar, aí sim migra para o PGBA como
base. Fica dentro do app `agency` (não na raiz do repo) para garantir que
vai junto na imagem Docker (o `Dockerfile` só copia `Api/`).

Configuração: `python manage.py configure_service_credential --provider
github --token ghp_... --account-ref sua-org` (ou Django admin,
`/admin/integrations/servicecredential/`).

Endpoint: `POST /api/v1/agency/projects/create/` — ver `docs/API.md`.

## 12. Infraestrutura (Docker, Celery, Postgres+pgvector)

```
backend_api/
├── Dockerfile              # imagem canônica (build context: backend_api/)
├── docker-compose.yml       # db (pgvector) + redis + backend + celery_worker + celery_beat + ollama
├── entrypoint.sh             # aguarda Postgres, migra, coleta static, sobe gunicorn
└── Api/                        # projeto Django (manage.py aqui)
```

Serviços do `docker-compose.yml`:

| Serviço | Imagem | Papel |
|---|---|---|
| `db` | `pgvector/pgvector:pg16` | Postgres com a extensão `vector` já disponível |
| `redis` | `redis:7-alpine` | broker/backend do Celery |
| `backend` | build local | API Django (gunicorn) |
| `celery_worker` | build local | processa `ingestion.tasks` e `orchestration` (indexação, sync) |
| `celery_beat` | build local | agenda tarefas periódicas (ex: sync automático do Obsidian) |
| `ollama` | `ollama/ollama:latest` | LLM local para embeddings e chat — opcional, comente se preferir Ollama fora do Docker |

Subir tudo: `cp .env.example .env` (ajuste os valores) e `docker compose up --build`.

## 13. Autenticação e usuários

`User` app: `CustomUser` (email como identificador), `Role`, `Plan`, JWT
via `djangorestframework-simplejwt`, ativo por padrão em
`/api/v1/users/` (`token/`, `token/refresh/`, criação de usuário,
reset de senha — ver `docs/API.md` para a lista completa). Roles/planos
padrão são semeados por signal (`User/signals.py`) na primeira migração —
nomes neutros (Administrador/Membro/Convidado, Gratuito/Premium); ajuste
conforme o domínio real do projeto.

Há também um caminho de login via Firebase (`FirebaseLoginView`),
**opcional e não habilitado por padrão** — requer adicionar
`firebase-admin` ao `requirements.txt`, que não está lá por padrão porque
a estratégia de autenticação principal do boilerplate é JWT.

## 14. Pagamentos

`payments/` (e `payments/asaas/`) é hoje um **esqueleto** — os arquivos
`models.py`, `abstract.py`, `webhooks.py`, `asaas/service.py` estão vazios
de propósito, aguardando a implementação específica do gateway que o
projeto vai usar (Asaas é o exemplo mais comum no contexto brasileiro,
mas o esqueleto não impõe isso).

## 15. Frontend: scaffold real e integração

Existe um scaffold funcional em `/frontend` (React 18 + TypeScript + Vite
+ Tailwind), não só uma recomendação de stack:

```
frontend/
├── .agent/SKILL.md       # skill para agentes de código gerarem UI aqui
├── devserver/               # servidor local (SSE) que alimenta o admin panel — só dev
├── scripts/
│   ├── generator.mjs           # núcleo do loop de geração (usado pelo CLI e pelo devserver)
│   └── generate-page.mjs        # wrapper de terminal (npm run generate)
├── src/
│   ├── lib/
│   │   ├── api.ts                 # único ponto de chamada ao backend (auth, ingestion, orchestration)
│   │   └── devserver.ts            # cliente do devserver local (só geração, nunca produção)
│   ├── components/                  # KnowledgeChat.tsx, GeneratedRouter.tsx
│   ├── pages/
│   │   └── AdminCreate.tsx            # admin panel: formulário + terminal ao vivo (SSE)
│   ├── generated-config/routes.ts       # sobrescrito automaticamente pela geração
│   ├── App.tsx                            # navegação por abas: Conhecimento / Páginas geradas / Criar página
│   └── main.tsx
└── tailwind.config.ts       # tokens de cor/fonte — ajuste por projeto
```

`src/lib/api.ts` já implementa `queryKnowledge()` (RAG,
`/api/v1/ingestion/query/`) e `askStructured()` (Q&A estruturado,
`/api/v1/orchestration/ask/`), tipados, com tratamento de erro via
`ApiError`. `KnowledgeChat.tsx` é o componente de referência: mostra o
padrão esperado de loading/erro/vazio e **sempre exibe as fontes** junto
da resposta gerada — a mesma filosofia anti-alucinação do backend
aplicada à UI.

`App.tsx` navega por três abas: **Conhecimento** (`KnowledgeChat`),
**Páginas geradas** (`GeneratedRouter`, lê `generated-config/routes.ts`)
e **Criar página** (`AdminCreate` — o admin panel de geração, ver §16).

Rodar: `cd frontend && cp .env.example .env && npm install && npm run dev`.

Para **mobile**, o padrão de referência (validado em produção em outro
projeto do ecossistema) é React Native + Expo — sem scaffold próprio
neste repositório ainda; siga o mesmo padrão de cliente de API único do
frontend web.

## 16. Agentes de código e loop de feedback

Boa parte do frontend (e de código em geral) deste projeto é pensada para
ser gerada por um agente de codificação — Claude Code, Codex CLI, Kimi
CLI em modo agente, ou equivalente — não só digitada à mão.

> **Não confundir com `tech-leads-club/harness-toolkit`** (ferramenta
> externa, `npm i -g @tech-leads-club/harness-toolkit`): apesar do nome
> parecido, não tem relação com o `harness` deste repositório. É uma
> camada de segurança que roda como hook do próprio Claude Code/Cursor,
> bloqueando ações destrutivas do agente (leitura de `.env`/segredos,
> `git push --force`, comandos fora do repositório) antes de acontecerem.
> Opcional, por conta de cada desenvolvedor — ver `CLAUDE.md` seção 10
> para os comandos de instalação e configuração corretos para este repo.

### A skill (`frontend/.agent/SKILL.md`)

Todo agente deve ler esse arquivo antes de gerar ou alterar uma tela.
Ele cobre três coisas:

1. **Direção de design** — ancorar a tela no assunto real do produto,
   usar os tokens já definidos em `tailwind.config.ts` (não decoração
   solta), evitar os "três looks genéricos" para os quais LLMs sem
   instrução convergem (fundo creme + serifada; fundo quase-preto + um
   acento neon; layout tipo jornal com regras finas) — a menos que o
   briefing peça exatamente isso.
2. **Convenções técnicas obrigatórias** — cliente de API único
   (`src/lib/api.ts`), componentes um-arquivo-por-tela, fontes de IA
   sempre visíveis junto da resposta, alias `@/` para `src/`.
3. **O loop de feedback**, o núcleo do que faltava documentar:

   ```
   planejar → gerar → validar (npm run typecheck && lint && build)
            → autocorrigir se algo falhar → autocrítica → iterar
   ```

   `npm run build` passando é o piso mínimo para considerar a tarefa
   concluída — não o objetivo final. Se o ambiente do agente suportar
   screenshot (Claude Code e Codex conseguem via ferramentas de
   browser/preview), tirar um antes de finalizar é parte do processo.

### A automação scriptada (`npm run generate`)

Além do agente manual, existe uma via determinística para gerar uma
página isolada sem intervenção humana passo a passo:

```bash
npm run generate -- "um card de boas-vindas com botão verde"
```

`frontend/scripts/generate-page.mjs` chama `POST /api/v1/harness/generate/`
(`harness/views.py`, novo endpoint) — que por sua vez usa
`harness.providers.chat_completion` (mesma resolução de credencial de
sempre) e `harness.guardrails.extract_code_block` para extrair o TSX da
resposta do modelo. O script então:

1. Escreve o arquivo em `src/pages/`.
2. Roda `npm run typecheck`.
3. **Se falhar**, reenvia o código gerado + a mensagem de erro para o
   mesmo endpoint, pedindo uma correção (até 3 tentativas) — este é o
   loop de feedback de verdade que faltava num gerador irmão deste
   projeto (`create-ia-frontend`): lá, o código gerado era escrito em
   disco sem nenhuma validação depois, e a chamada de IA era hardcoded
   (Ollama + um modelo fixo) fora de qualquer sistema de credenciais.
4. Roda lint (não bloqueante) e atualiza `src/generated-config/routes.ts`.

Requer um token JWT em `frontend/.env` (`PGBA_ACCESS_TOKEN`) — a geração
de código é uma operação autenticada e tenant-scoped como qualquer outra
do `harness`, nunca um endpoint aberto.

Use esta via para telas isoladas e simples. Para telas que dependem de
outras partes do projeto (estado compartilhado, outros componentes),
prefira um agente de verdade seguindo o `SKILL.md`.

### O admin panel (`npm run dev:admin`)

A mesma automação, com formulário e progresso ao vivo no navegador em vez
de terminal — inspirado no fluxo "New Workspace" de um gerador irmão
deste projeto (`create-ia-frontend`), mas sem duplicar nenhuma lógica:

```bash
npm run dev:admin   # sobe Vite (5173) + devserver de geração (5174) juntos
```

`frontend/devserver/index.mjs` é um servidor Node só de desenvolvimento
(nunca exposto fora de `localhost`) que chama a MESMA função
`generatePage()` de `scripts/generator.mjs` que o CLI usa, e transmite
cada estágio (`plan` → `write` → `validate` → `routes` → `done`) via
Server-Sent Events. `src/pages/AdminCreate.tsx` se conecta a esse SSE e
mostra formulário (prompt + nome opcional), barra de progresso e um
"terminal" com os logs em tempo real — mesma UX do gerador irmão, mas
chamando `/api/v1/harness/generate/` de verdade em vez de um servidor
Express com Ollama hardcoded.

### Qual modelo o agente usa

Independente do modelo configurado em `harness` para
`ingestion`/`orchestration` em produção — são contextos diferentes. Para
o próprio agente de codificação, duas rotas já ficam disponíveis via
`harness` sem escrever código novo:

- **Ollama local** com um modelo de código (ex: `qwen2.5-coder`).
- **OpenRouter** (`provider=openrouter`, uma chave só para centenas de
  modelos de qualquer fornecedor). Para tarefas agênticas de código,
  **Kimi K2** (Moonshot AI — open-weight, forte em benchmarks de
  coding/tool-use, custo baixo) é uma opção configurável direto:
  ```bash
  python manage.py configure_ai_provider --provider openrouter \
      --api-key sk-or-... --model moonshotai/kimi-k2
  ```
  Troque `--model` por qualquer outro id de openrouter.ai/models sem
  mudar código em nenhum lugar.

## 17. Princípios GenAI4EU aplicados

Este boilerplate segue os princípios do desafio europeu GenAI4EU (apoio a
IA generativa confiável e centrada no humano para setores estratégicos da
indústria), traduzidos em decisões de engenharia:

| Princípio | Implementação |
|---|---|
| IA confiável, sem alucinação | `harness.guardrails` bloqueia geração sem contexto real; toda resposta cita fonte |
| Transparência e responsabilização | `orchestration.QueryLog` audita toda interação |
| Soberania tecnológica/dados | Ollama local por padrão; nuvem de terceiros é opt-in explícito, por tenant |
| Humano no centro | IA responde perguntas; ações de impacto exigem confirmação humana explícita na vertical |
| Conformidade regulatória (LGPD/EU AI Act) | `ConsentRecord` + `core.utils.lgpd` desde o design |
| Aplicável a qualquer setor | Padrão de Vertical — mesma plataforma atende qualquer indústria sem fork |

## 18. Estrutura de diretórios completa

```
pgba-boilerplate/
├── CLAUDE.md                      # contrato de arquitetura (regras para devs e IA)
├── frontend/                       # scaffold React+Vite+TS+Tailwind (opcional por projeto)
│   ├── .agent/SKILL.md               # skill para agentes de código gerarem UI
│   ├── devserver/                     # SSE local p/ admin panel (só dev, nunca exposto)
│   ├── scripts/generator.mjs           # núcleo do loop de geração (CLI + devserver)
│   ├── src/pages/AdminCreate.tsx        # admin panel: formulário + terminal ao vivo
│   └── src/lib/api.ts                    # cliente único de acesso ao backend
└── backend_api/
    ├── .env.example
    ├── Dockerfile
    ├── docker-compose.yml
    ├── entrypoint.sh
    ├── requirements.txt            # fonte única de dependências
    ├── docs/
    │   ├── API.md                   # referência de endpoints
    │   ├── DEPLOY.md                 # guia de deploy
    │   └── LGPD.md                     # conformidade em detalhe
    └── Api/
        ├── manage.py
        ├── pyproject.toml            # config black/isort/pytest
        ├── Makefile                   # atalhos de dev
        ├── .pre-commit-config.yaml     # hooks de lint
        ├── config/                      # settings, urls, celery, wsgi/asgi
        ├── core/                         # mixins, middleware de tenant, LGPD, ConsentRecord
        ├── User/                          # auth, usuários, roles, planos
        ├── harness/                        # credenciais de IA + guardrails + endpoint de geração
        ├── ingestion/                       # RAG: KnowledgeSource → Document → DocumentChunk
        ├── orchestration/                    # Q&A seguro sobre dado estruturado
        ├── agency/                            # exemplo de vertical: Agentes & Setores
        ├── payments/                           # esqueleto de pagamentos
        └── tests/                               # testes (pytest)
```
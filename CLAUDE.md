# CLAUDE.md — Padrão PGBA Boilerplate

Este arquivo é o contrato entre este repositório e qualquer pessoa (ou IA)
que o use como base para um novo projeto. Se você é uma IA lendo isso para
ajudar no desenvolvimento, trate estas regras como restrições rígidas, não
sugestões.

> Este boilerplate é uma **plataforma multi-vertical**: o core (tenant,
> LGPD, IA) é fixo e genérico; o que muda de cliente para cliente é o
> conjunto de **módulos de domínio** ("verticais") plugados nele — estoque,
> CRM, jurídico, saúde, imobiliário, o que for. Nunca fork o repositório
> para atender um cliente novo: adicione uma vertical. Ver seção 7.

## 1. Princípios não-negociáveis

1. **Isolamento por tenant é sagrado.** Todo model de negócio herda
   `TenantMixin` (`core/mixins.py`). Toda query em views/services/tasks
   filtra explicitamente por `tenant_id`. Isso vale especialmente para o
   módulo `ingestion`: um LLM que "vaza" contexto de um tenant para outro
   é uma falha de segurança, não um bug de UX.

   **Toda APIView/ViewSet nova herda de `core.mixins.TenantContextMixin`
   (antes de `APIView`/`ViewSet` no MRO) para que `request.tenant_id`
   exista de verdade.** Não use `core.middleware.tenant.TenantMiddleware`
   para isso — middleware de Django roda antes da autenticação do DRF,
   então `request.user` (e `tenant_id`) ainda não existe nesse ponto para
   uma request de API. Esse foi um bug real de produção neste boilerplate:
   todo endpoint tenant-scoped devolvia lista vazia até isso ser corrigido
   (ver DOCUMENTATION.md §3).
2. **LGPD por padrão, não por adição.** Dado sensível (CPF, e-mail,
   telefone, saúde) passa por `core/utils/lgpd.py` (mascaramento/
   criptografia). Nunca armazene PII em texto puro em `ingestion.Document`
   — essa tabela alimenta buscas semânticas e pode vazar para respostas de
   LLM.
3. **Local-first para IA.** `EMBEDDING_PROVIDER` e o LLM de chat usam
   Ollama (local) por padrão. Trocar para uma API de nuvem de terceiros
   (OpenAI, etc) é uma decisão explícita de infraestrutura — nunca o
   default de um novo ambiente.
4. **Toda mudança de schema tem migration versionada.** Não editar dados
   direto em produção. `python manage.py makemigrations` sempre antes de
   abrir PR.
5. **Auditoria automática.** Models que representam entidades de negócio
   usam `AuditMixin` (django-simple-history) e `SoftDeleteMixin` (nunca
   `DELETE` físico de dado de tenant, exceto rotina explícita de expurgo
   LGPD). No ViewSet, `core.mixins.SoftDeleteViewMixin` (antes do mixin de
   tenant no MRO) esconde o excluído da lista e faz o `DELETE` virar
   `is_active=False` — `ModelViewSet` puro apaga de verdade.
6. **A IA nunca gera nem executa SQL livre.** Toda pergunta sobre dado
   estruturado (`orchestration`) passa por uma lista fechada de funções
   pré-aprovadas por humano (`orchestration/registry.py`). O LLM escolhe
   QUAL função usar; o código Python decide o `tenant_id`. Esta regra
   existe porque a versão anterior de um projeto-irmão (gestão de
   estoque) permitiu SQL gerado pelo modelo e isso era, em tese,
   explorável por prompt injection para vazar dado de outro cliente — ver
   `orchestration/registry.py` para o relato completo.
7. **Toda interação de IA é auditável.** `orchestration.QueryLog` registra
   pergunta, função chamada, parâmetros, resultado e modelo usado — é o
   que torna o sistema revisável por humano e alinhado ao EU AI Act /
   GenAI4EU (ver seção 8).

## 2. Arquitetura de referência

```
KnowledgeSource → Document → DocumentChunk (embedding pgvector)
```

Esse padrão (fonte → unidade de conteúdo → pedaço vetorizado) é o mesmo
para Obsidian, upload manual, uma URL ou uma API externa. Novo tipo de
fonte = novo valor em `KnowledgeSource.SourceType` + uma classe em
`ingestion/connectors/` (ver §5b), nunca um novo conjunto de tabelas paralelo.

Camadas de um novo app de domínio:

```
app/
├── models.py       # sempre TenantMixin + AuditMixin + SoftDeleteMixin
├── services.py      # regra de negócio pura, sem depender de request/DRF
├── serializers.py
├── views.py          # fino: valida, chama services, serializa resposta
├── tasks.py           # tudo que é lento ou externo (embeddings, e-mail, webhook) é Celery
└── management/commands/  # operações administrativas/CLI
```

## 3. "Princípio Akita" — como uma IA deve tratar respostas de LLM

Nunca aceitar a primeira resposta de um LLM (embedding ou chat) como
verdade sem tratamento de erro explícito. Toda chamada a um provedor de
IA:

- passa pelo cliente único `harness/providers.py` (`chat_completion`,
  `embed`) — nunca uma requisição HTTP solta a Ollama/OpenAI/etc espalhada
  pelo código de uma vertical;
- passa pelos guardrails de `harness/guardrails.py` antes de a saída ser
  usada para qualquer decisão (`require_grounded_context`, `extract_json`
  + `validate_schema`);
- falha de forma explícita (`EmbeddingError` / `OrchestrationError` /
  `ProviderConfigError`), nunca em silêncio;
- em RAG, a resposta gerada **sempre** vem acompanhada dos chunks-fonte,
  para que qualquer afirmação seja rastreável até o documento de origem.

## 4. Harness de IA (`harness`) — credenciais e guardrails

`harness` é a camada que faz `ingestion` e `orchestration` funcionarem de
forma configurável e sem alucinação. Não confundir com harness.io (CI/CD)
— aqui "harness" é usado no sentido literal: o arreio que mantém a IA sob
controle.

**Credenciais** (`harness.AIProviderCredential`): API key/token de
qualquer provedor (Ollama, OpenAI, Anthropic, Groq, OpenRouter),
criptografados no banco (Fernet, `ENCRYPTION_KEY`), configuráveis por
tenant ou globalmente, sem editar código nem redeploy:

- Django admin: `/admin/harness/aiprovidercredential/` (chave sempre mascarada);
- CLI: `python manage.py configure_ai_provider --provider groq --api-key ... --model ...`.

Resolução de credencial: tenant específico → global do projeto →
variável de ambiente (`.env`, só fallback de dev). Nunca hardcode uma
chave em código.

**Guardrails** (`harness/guardrails.py`) — regras concretas anti-alucinação,
não "prompt bonito":

| Guardrail | O que faz |
|---|---|
| `require_grounded_context` | Bloqueia a geração se não há contexto real (RAG vazio E nenhuma função executada). Devolve recusa explícita em vez de deixar o LLM "tentar mesmo assim" — é exatamente aí que ele mais alucina. |
| `extract_json` + `validate_schema` | Toda decisão estruturada do LLM (ex: qual função chamar) é extraída e validada antes de ser usada — nunca `json.loads` cru e confiar. |
| `citation_coverage` | Heurística de auditoria: estima se a resposta parece ancorada nas fontes. Não bloqueia — loga para revisão humana. |

Qualquer função nova que chame um LLM no projeto **deve** passar por
`harness/providers.py` + `harness/guardrails.py`. Nunca duplicar lógica de
chamada HTTP a um provedor de IA em outro app.

## 5. Integração com Obsidian

O vault do Obsidian é tratado como uma `KnowledgeSource`, nunca como
banco de dados direto. Regras:

- notas com `private: true` no frontmatter nunca são indexadas;
- a pasta `.obsidian/` é sempre ignorada;
- `include_tags` no `config` da fonte permite indexar só um subconjunto
  do vault (ex: só `#publico`, nunca notas pessoais);
- o vault continua sendo a fonte de verdade — o boilerplate nunca escreve
  de volta no vault, só lê.

## 5b. Conectores externos (`ingestion/connectors/`)

Data Lake → Conectores. Cada `KnowledgeSource.source_type` tem uma classe
em `ingestion/connectors/`, em um de dois modos:

| Modo | Conectores | O que acontece |
|---|---|---|
| `documents` | REST API, URL, Google Sheets, Notion, Slack, E-mail (IMAP), Webhook (+ Obsidian/upload, que já existiam) | `fetch()` traz o conteúdo → `ingestion.sync.sync_source` grava `Document` (upsert por `external_id`, hash evita reindexar) → indexação no Celery → busca semântica dos agentes |
| `structured` | Banco SQL (PostgreSQL/MySQL/SQLite), HubSpot, Salesforce, **Servidor MCP** | nada é copiado; os agentes consultam **na hora**, só pelas consultas nomeadas (ou ferramentas MCP) que um humano liberou no conector |

Regras (não afrouxar):

- **Segredo nunca em texto puro nem na resposta da API**: `KnowledgeSource.secret_config`
  (Fernet, `ENCRYPTION_KEY`); `config` só tem o que não é segredo. A API
  devolve `••••1234` + `secrets_set`; mandar o mascarado de volta mantém o
  salvo (`connectors/secrets.py`). Sem `ENCRYPTION_KEY`, salvar segredo dá 400.
- **Toda saída de rede passa por `connectors/safe_http.py`** (anti-SSRF): só
  http/https, host tem que resolver pra IP público (IP literal conferido
  direto), redirect conferido a cada salto, teto de 10 MB. Banco e IMAP usam
  `check_host`. Rede interna só por lista: `CONNECTORS_ALLOWED_PRIVATE_HOSTS`.
  SQLite só dentro de `CONNECTORS_SQLITE_ROOT`.
- **LGPD**: todo texto vindo de fonte externa passa por
  `core.utils.lgpd.redact_pii` (e-mail, CPF, telefone) antes de virar
  `Document`; célula de texto de consulta estruturada também.
- **Consulta estruturada = §1.6**: o LLM escolhe QUAL consulta e os VALORES;
  SQL com parâmetro ligado, SOQL com literal escapado e tipado; só `SELECT`,
  uma instrução, transação read-only, teto de linhas. `registry.register_catalog_provider`
  (catálogo dinâmico por tenant) transforma cada consulta em função
  `fonte<id>_<nome>`, filtrada pelo mesmo escopo da busca semântica
  (`rag_source_ids`) — o `orchestration` não sabe o que é conector nem setor.
- **Sync**: `POST sources/{id}/sync/` (Celery; sem broker roda na hora),
  `sync_interval_minutes` + beat (`CELERY_BEAT_SCHEDULE`, a cada 5 min
  `sync_due_sources_task`). Snapshot completo (REST, URL, Sheets, Notion)
  tira da busca o que sumiu da fonte (exclusão lógica); Slack/e-mail são
  incrementais. Cada execução vira `SourceSyncRun`; erro fica em
  `last_sync_status`/`last_sync_message`, nunca em silêncio.
- **Webhook**: `POST /api/v1/ingestion/webhooks/<public_id>/`, sem login,
  prova por `X-Webhook-Signature: sha256=<HMAC do corpo>` (ou
  `X-Webhook-Secret`), 1 MB, throttle `webhook`.
- **Teste de conexão é chamada real** (`test-connection/`, e `test-config/`
  antes de salvar) — nunca "configuração salva" fingindo que testou.
- **Busca semântica ignora documento excluído e fonte desativada**
  (`semantic_search` filtra `document__is_active` e `document__source__is_active`).
  Excluir conector é lógico.

- **MCP** (`connectors/mcp.py`, transporte Streamable HTTP, JSON-RPC por
  `safe_http`, resposta JSON ou SSE): `mcp-discover/` lista as ferramentas do
  servidor (cache em `config.ferramentas_disponiveis`); `mcp-tools/` é a pessoa
  liberando quais os agentes usam e o **risco** de cada (`config.ferramentas`).
  Só liberada vira função `fonte<id>_<nome>` (catálogo dinâmico, mesmo escopo
  por setor), com o risco escolhido → Policy Engine. Ferramenta sem
  `readOnlyHint` nasce "medium" (vira aprovação pra agente sem autonomia).
  Parâmetro convertido pelo `inputSchema`; texto devolvido passa por `redact_pii`.

**Setor com várias fontes**: `Sector.knowledge_source` (cérebro principal) +
`Sector.extra_knowledge_sources` (M2M). `agency.services.sector_source_ids`
é a união; `_rag_scope_for` usa ela pra RAG E pras consultas estruturadas.
**Painel do conector** (`connectors.tsx` → `SourcePanel`, botão "Ver dados";
abre sozinho ao criar um conector, que já sincroniza): Resumo com o caminho
do dado — Conexão → Dados recebidos → Pesquisável pelos agentes → Setores
com acesso, atualizando ao vivo enquanto busca/indexa —, Registros (todos,
busca e página: `GET sources/{id}/records/`; ficha inteira como o agente lê,
`campo: valor` vira tabela: `records/{doc}/`), **O que o agente encontra**
(`POST sources/{id}/agent-preview/`: a MESMA `semantic_search` do agente,
restrita à fonte; sem embeddings cai em busca por palavra e AVISA — nunca
finge que foi a busca do agente), ou Consultas (com "Testar consulta") nos
estruturados, Execuções e **Quem acessa**
(`GET/POST /api/v1/agency/source-access/` — fica em `agency` porque
`ingestion` não sabe o que é setor; o POST só mexe nas fontes adicionais).

## 6. Orquestração de IA sobre dado estruturado (`orchestration`)

Complementa o `ingestion` (RAG sobre conhecimento não-estruturado). Este
módulo responde perguntas sobre o banco de dados de QUALQUER vertical
(estoque, CRM, financeiro...) sem nunca deixar o LLM tocar em SQL:

```
pergunta → router.route() escolhe categoria/modelo
         → LLM escolhe 1 função da lista fechada (registry.py) + parâmetros
         → Python executa a função (tenant_id vem do código, nunca do LLM)
         → resultado + contexto RAG opcional → LLM só redige a resposta final
         → tudo fica em orchestration.QueryLog (auditável)
```

Cada vertical registra suas próprias funções seguras:

```python
from orchestration.registry import register_query_function

@register_query_function(
    name="total_itens_em_estoque",
    description="Retorna o total de unidades em estoque de um produto pelo nome.",
    parameters={"produto_nome": "string"},
)
def total_itens_em_estoque(tenant_id, produto_nome: str) -> dict:
    ...  # sempre filtra por tenant_id
```

Nunca crie um segundo caminho de acesso a dado estruturado para IA fora
deste registro — se uma vertical precisa expor um novo dado à IA, a
função entra aqui, com nome e descrição claros, revisada por humano antes
do merge.

## 7. Padrão de Vertical (módulo de domínio plugável)

Uma "vertical" é um app Django de domínio de negócio (estoque, CRM,
jurídico, saúde, imobiliário...) que segue a mesma estrutura de qualquer
outro app deste boilerplate (seção 2) e, adicionalmente:

- registra suas funções seguras de IA em `orchestration/registry.py`
  (import feito em `apps.py.ready()` da própria vertical);
- se produzir documentos/relatórios que fazem sentido como conhecimento
  pesquisável, cria um `KnowledgeSource` do tipo apropriado e usa
  `ingestion.services.index_document` — não reinventa busca semântica;
- usa `core.models.ConsentRecord.has_consent_for_purpose()` antes de usar
  dado do titular para qualquer finalidade que não seja a operação
  essencial do serviço (ex: antes de incluir dado em treino de IA ou em
  agregados comerciais vendidos a terceiros);
- **toda `APIView`/`ViewSet` herda `core.mixins.TenantContextMixin`**
  (antes da classe base do DRF no MRO) — sem isso, `request.tenant_id`
  fica sempre vazio e qualquer filtro por tenant na queryset devolve
  lista vazia. Ver seção 1 e `agency/views.py` como referência de uso.

Exemplo de generalização: o app `inventory` de um projeto de gestão de
estoque expõe `Product`, `InventoryItem`, `Sale`. Um projeto jurídico
expõe `Processo`, `Peticao`, `Prazo`. A infraestrutura (tenant, LGPD, IA,
auditoria) é idêntica; só a vertical muda.

### Exemplo real neste repositório: `agency` (Agentes & Setores)

`backend_api/Api/agency/` é uma vertical completa e funcional incluída
como referência — modelo organizacional **hierárquico** de "equipe de
IA", inspirado no conceito de escritório virtual de agentes, mas
**deliberadamente sem a visualização 3D** (o que um boilerplate reutiliza
entre projetos é o modelo de dados e as métricas, não a cena 3D — peso de
dependência `react-three-fiber`/`three` sem reuso fora de um produto
específico).

**Hierarquia de acesso** (`Agent.access_level`):

```
CEO ──────────────┐  acesso total, sem setor (sector=None)
Orquestrador-Geral ┘  acesso total, sem setor — medeia qualquer par de setores

Orquestrador de Setor   pertence a 1 setor, só medeia mensagens que envolvam
                        o PRÓPRIO setor (origem ou destino)

Operacional             pertence a 1 setor, só acessa o "cérebro" (conhecimento
                        + dado) do próprio setor — nunca fala com outro setor
                        diretamente
```

Um `CheckConstraint` no banco (`agent_sector_matches_access_level`) já
impede o erro mais óbvio: CEO/Orquestrador-Geral com `sector` preenchido,
ou Operacional/Orquestrador-de-Setor com `sector=None`.

**"Cérebro principal" vs. "cérebro secundário"**: não são duas tabelas —
é uma questão de escopo de acesso ao mesmo `ingestion.KnowledgeSource`.
`Sector.knowledge_source` é o cérebro secundário daquele setor.
`agency.services._rag_scope_for(agent)` decide o que cada agente pode
consultar:
- CEO / Orquestrador-Geral → `None` (sem filtro — é o "cérebro principal": acesso a tudo)
- Operacional / Orquestrador de Setor → só o `knowledge_source` do próprio setor,
  ou **lista vazia** (nunca "sem restrição") se o setor não tiver um configurado

Isso é feito com uma extensão genérica em `ingestion.semantic_search()` e
`orchestration.answer_question()` (parâmetro opcional `source_ids`/
`rag_source_ids`) — nem `ingestion` nem `orchestration` sabem o que é um
"setor"; só ganharam a capacidade genérica de restringir a busca a fontes
específicas, e `agency` é quem decide o filtro.

**Setor nunca fala com outro setor direto** — sempre via `SectorMessage`:

```
setor A → request_cross_sector_message()  → SectorMessage(status=pending)
                                                    │
        um Orquestrador (de A, de B, ou Geral) ou o CEO chama relay_message()
                                                    │
                            valida permissão (AccessDeniedError se não pode)
                                                    │
                        executa a pergunta como o setor B (ask_as_agent, RAG
                        escopado ao cérebro de B) e marca status=answered
```

`agency.services.ask_as_agent()` nunca chama um provedor de IA
diretamente — sempre via `orchestration.answer_question()` — e registra
o resultado em `AgentInteraction` (tokens/custo estimados). Isso é, na
prática, o "cérebro principal": toda interação de todo agente de todo
setor cai ali, consultável sem restrição por quem tem acesso total.

Respeita a direção de dependência: `agency` (vertical) depende de
`orchestration`/`ingestion` (core); o inverso nunca acontece — por isso
`AgentInteraction` referencia o `QueryLog` por id solto (`query_log_id`),
não por FK.

Endpoints de métricas (`/api/v1/agency/metrics/overview|sectors|agents|budgets/`)
e de comunicação (`/api/v1/agency/sector-messages/request|{id}/relay/`) —
ver `docs/API.md` para o contrato completo.

**Navegação e tema da tela principal** (`frontend/src/App.tsx` +
`pages/Studio.tsx`, `lib/navigation.ts`): uma barra só no header —
**Empresa · Escritório 3D · Conhecimento · Projetos** (Gerar abre a partir
de Projetos; "Páginas geradas", configurações e tema ficam à direita). As
tarefas vivem dentro dos agentes, então Tarefas, Aprovações (com contador
ao vivo) e Atividade são sub-abas de **Empresa**, ao lado do Organograma —
não abas soltas no topo. O tema claro/escuro usa a paleta do Escritório 3D
(creme/pedra: `#f1eee8`/`#faf8f4` no claro, `#161412`/`#1f1c19` no escuro,
tokens em `src/index.css`); telas novas usam só os tokens semânticos
(`bg-surface`, `text-muted-foreground`, `border-border`...), nunca
`slate-*`/`zinc-*`/`white/10` fixos, que só funcionam num dos temas.

**Organograma (visão 2D)**: `frontend/src/components/empresa/overview.tsx`
(Empresa → Organograma) — Empresa → CEO/Orquestrador-Geral → cartões de
setor (faixa de cor por índice, como as salas da planta; chips de módulo,
IA do setor e cérebro; equipe com avatar e bolinha de `work_status`, a
tarefa atual em verde quando `working`; rodapé com custo do mês e barra
de orçamento), mais KPIs (agentes, trabalhando, pausados, custo do mês) e
indicador de tempo real. Como `ask_as_agent` é síncrono, um agente só
fica `working` pela duração da própria chamada; por isso o
`AgentViewSet` também anota `last_active_at`
(`Max("interactions__created_at")`), a última interação registrada.

**Visão 3D (Fase 3 — planta isométrica)**:
`frontend/src/components/builder/CompanyOffice3D.tsx` (item "Escritório
3D" do header) + `builder/office3d/` — Three.js via
`@react-three/fiber`/`@react-three/drei`, carregado sob demanda
(`React.lazy`, ~1MB só quem abre a aba paga). Cada `Sector` vira uma sala
(posição determinística em grade, cor fixa por índice — nunca aleatória);
CEO/Orquestrador-Geral ficam na sala CEO, e há uma Sala de Reunião fixa.

- **Câmera ortográfica isométrica** (`office3d/IsoCamera.tsx`): "planta de
  arquiteto", sem distorção de perspectiva; modos Isométrica/Planta/Frontal,
  zoom +/−/⌂ que enquadra tudo a partir do tamanho real do canvas.
- **Salas em corte** ("casa de boneca"): laje elevada, paredes do fundo/
  esquerda cheias, frente/direita baixas — dá pra ver dentro sem girar.
- **Uma mesa por agente**, com crachá (★ = CEO/orquestrador), monitor com
  textura gerada em canvas que acende quando o agente daquela mesa está
  `working`. O agente senta de frente pro monitor.
- **Cérebro central** (`office3d/BrainHub.tsx`): mesma regra de
  `_rag_scope_for()` — fio contínuo pra sala CEO (cérebro principal) e pra
  setores com `knowledge_source`; fio tracejado cinza pra setor sem
  `knowledge_source` (o RAG dele devolve vazio, a planta não finge conexão).
  Pulsos correm pelo fio só enquanto algum agente do setor está `working`.
- **Cérebro aberto** (`office3d/BrainGraph.tsx`): clicar no Cérebro abre
  o grafo das notas indexadas, no espírito da Graph view do Obsidian —
  nós = `ingestion.Document`, arestas = `[[wikilinks]]` resolvidos no
  backend (`GET /api/v1/ingestion/graph/?source=<id>`, `ingestion/graph.py`,
  funções puras; view filtra tenant e soft delete, devolve só um trecho de
  cada nota, nunca o conteúdo inteiro). Links são extraídos do `content`
  que o sync já grava — não precisa resync nem migration. Link pra nota
  que não está no banco do tenant (inexistente, `private: true`, fora de
  `include_tags`, de outro tenant) conta em `unresolved`, nunca vira nó.
  O painel da nota mostra "quem pode consultar" pela MESMA regra de
  `_rag_scope_for()` (CEO/Orquestrador-Geral + setores com aquele
  `knowledge_source`) — não existe registro de "quem leu" por nota, então
  a tela não inventa um. Layout de forças próprio, sem dependência nova.
- **Moldura clara** (`OfficeOverlays.tsx`): barra superior só com o que é
  da empresa (ao vivo, ocupação, comportamento, reunião, console,
  painéis); zoom/vistas ficam só na barra da cena. Painéis de agentes
  (agrupado por setor, com busca) e de atividade são cartões flutuantes.
- **Ações pela planta**: envelope pendente clicável → `office3d/MessageModal`
  (só oferece mediador que o backend aceita — um mediador sem permissão
  REJEITA a mensagem de vez); agente com `PendingApproval` ganha marcador
  ⚠ e a barra superior um contador → `office3d/ApprovalModal` (aprovar
  executa de verdade via `decide/`). Janela do agente tem "Perguntar a
  este agente" (`agents/{id}/ask/`) e a reunião usa respostas reais de
  cada participante (antes eram frases fixas geradas no navegador).
- **"Consultada por"** no painel da nota do Cérebro:
  `AgentInteraction.source_document_ids` guarda os documentos que o RAG
  usou em cada resposta; `GET /api/v1/agency/knowledge-usage/?document=<id>`
  agrega por agente. `index_document` grava `metadata.links`/`excerpt`,
  então o grafo não carrega o conteúdo das notas (só das antigas).
- **Cérebro "Por uso"**: mapa de calor com quantas vezes cada nota foi
  contexto de resposta (`GET /api/v1/agency/knowledge-usage/summary/`,
  agregado no Postgres com `jsonb_array_elements`) e filtros "nunca
  usadas" / "links quebrados" (`broken_links` por nó no `graph/` — o nome
  do link já está escrito na própria nota). Só lê: nunca escreve no vault.
- **IA sem credencial**: `GET /api/v1/agency/ai-status/`
  (`agency.services.sector_ai_status` → `harness.providers.provider_readiness`,
  que confere credencial + modelo pelas MESMAS regras de `chat_completion`,
  sem chamar o provedor). Setor com IA fixa sem chave ganha ⚠ na etiqueta,
  aviso na janela da sala e contador na barra — antes só se descobria ao
  rodar uma tarefa.
- **Custo por IA e orçamento mensal**: `AgentInteraction.provider/model/task`
  (`agency.services.record_interaction`, único lugar que calcula custo —
  `ask_as_agent` E `execute_task`, que antes não registrava custo nenhum).
  `metrics/sectors/` traz `month_cost_usd` e `month_by_provider`; o
  `usage_percent` agora compara com o gasto do MÊS (antes era o gasto de
  sempre contra um orçamento mensal). Etiqueta mostra `$NN%` a partir de
  80%, barra superior avisa, Console separa o mês por IA.
- **Quadro de tarefas na sala** (`office3d/RoomTaskBoard.tsx`): Fazendo /
  Revisar / Próximas / Feitas, com executar, pausar com instrução,
  retomar com novo pedido, aprovar e rejeitar — os mesmos endpoints de
  `tasks/`, cada botão só no status que o backend aceita. Aprovar aqui não
  manda arquivos, então não abre PR (isso continua no quadro do Studio).
- **Pedido para outro setor pela janela do agente**
  (`office3d/SendMessageForm.tsx` → `sector-messages/request/`): o
  envelope nasce pendente na porta de origem; alguém com permissão media.
- **Linha do tempo (replay do dia)**: `GET /api/v1/agency/timeline/`
  (interações, mudanças de status de Task via `Task.history`, fim de Task
  quando `progress` chega a 1.0, mensagens com `answered_at`/`rejected_at`,
  aprovações) → `office3d/replay.ts` calcula o estado da planta num
  instante; `ReplayBar` com play/velocidade. Ao vivo continua chegando por
  baixo; mediar/aprovar ficam desligados no replay. Limite honesto: pergunta
  avulsa não tem duração registrada, conta como trabalho só por 90s antes.
- **Desempenho**: móveis e bonecos com geometria fundida
  (`office3d/merge.ts`, cor por vértice — 1 draw call por peça),
  `ContactShadows` renderizada só quando a planta muda, `dpr` limitado e
  rótulos dos agentes escondidos com zoom afastado (`ZoomLevelMarker`).
  Medido com 60 agentes: ~12 mil → ~2,5 mil draw calls por quadro.
- **Etiquetas de KPI por setor** (`office3d/SectorCard.tsx`): uma linha só
  em cima da parede do fundo (nome, nº de agentes, ativos/pausados); o
  detalhe (cérebro do setor, Tasks fazendo/próximas/feitas) aparece no
  hover. Tudo de dado real (`listAgents`, `listTasks` + eventos
  `task`/`agent` do WebSocket). Clicar abre o `RoomModal`. Já foi um cartão
  grande fixo em pixel — com 12+ setores cobria o escritório inteiro.
- **Barra de vista no topo da cena** (Isométrica/Planta/Frontal, Cartões,
  Fios, zoom −/+/⌂): o container tem `calc(100vh - 56px)` (só o header)
  e o rodapé do canvas pode ficar fora da tela — por isso não fica embaixo.
  O `IsoCamera` reserva essa faixa ao enquadrar; o `OrbitControls` não
  recebe `target` por prop (seria reaplicado a cada re-render).
- **Colunas de salas adaptáveis** (`roomColumns`): até 5 colunas conforme
  a quantidade de setores, pra planta não virar uma torre estreita.
- **Tudo local**: sem HDR de CDN (`Environment` com `Lightformer`) e sem
  fonte baixada em runtime (rótulos 3D rasterizados em canvas,
  `office3d/textures.ts#labelTexture`) — sem rede, a cena ainda renderiza.

**Movimento sem atravessar parede** (`office3d/navigation.ts`, funções
puras): toda rota é montada só com trechos que existem na planta — mesa →
corredor interno entre colunas de mesas → faixa livre da frente da sala →
porta (dentro → fora) → passeio da fileira → corredor vertical entre
colunas de salas (`ROOM_GAP_X`) → passeio da fileira de destino → porta
de destino. Antes (Fase 2) o agente ia da mesa direto pro lado de fora da
porta, em diagonal, e descia reto atravessando as salas das fileiras de
baixo. O avatar tem sempre um lugar real (`seat`/`front`/`meeting`) e uma
mudança de status no meio do caminho espera ele chegar — nunca corta
caminho. Mesas ficam alinhadas à mesma grade de colunas e no máximo 3
fileiras (setor com muita gente ganha colunas mais estreitas), pra faixa
da frente e os corredores internos ficarem sempre livres.
`routeCrossesWall()` existe pra verificar isso: nenhum trecho de rota pode
cruzar parede fora do vão da porta.

**Envelopes entre setores** (`office3d/Envelopes.tsx` — a "Fase 2"
combinada): mostram `SectorMessage` respeitando a regra "setor nunca fala
direto com outro setor". Pendente = envelope parado piscando em cima da
porta do setor de origem (a fila real, com contador); respondida = **quem
mediou (`relayed_by`) vai a pé**: sai da mesa, entra na porta do setor de
origem e pega o envelope, leva até o setor de destino, espera a resposta
e traz o envelope verde de volta pra origem, depois volta pra mesa (rota
de `navigation.errandRoute()`, mesmas regras de nunca atravessar parede;
o envelope vai na mão dele, com etiqueta "✉ → destino" / "✉ ↩ resposta").
Vários recados pro mesmo mediador entram numa fila, um de cada vez. Se o
mediador não está na planta ou está em reunião, o envelope voa origem →
sala dele → destino, como antes. Rejeitada = fica vermelho e cai na
origem. Só anima transição vista ao vivo (ou com `answered_at` ≤ 20s no
carregamento) — histórico antigo não fica voando.

Mantido da Fase 2: reunião convocada pelo `MeetingModal` (agora cada agente
senta numa cadeira de verdade da mesa oval — `MEETING_SEATS` é a mesma
lista pra desenhar a cadeira e pra sentar), portas que abrem quando um
agente se aproxima, painéis de atividade/agentes e console.

Ideias de layout inspiradas no Agents Office
(github.com/ajsahni/agents-office), **sem copiar código** — a licença
dele (PolyForm Noncommercial + termos adicionais) proíbe incorporá-lo em
outro produto. Não traga código daquele repositório pra cá.

### Modelo de IA por setor (`Sector.default_provider` / `Agent.default_provider`)

Cada agente usa um provedor de IA resolvido por
`agency.services.resolve_agent_llm(agent)`, nesta ordem:
`Agent.default_provider` (exceção individual) → `Sector.default_provider`
→ provedor ativo do tenant (`harness.get_active_provider`, hoje Groq).
`ask_as_agent` e `execute_task` usam essa resolução; `orchestration.answer_question`
só ganhou os parâmetros genéricos `provider`/`model` (não sabe o que é setor).

Provedor fixado no agente ou no setor **não tem fallback**: sem credencial,
`harness.chat_completion` levanta `ProviderConfigError` e a tarefa falha
explícita — "setor X só com Claude" nunca vira "Claude quando der, Groq
quando não der". O setor **Desenvolvimento usa `anthropic` (Claude)**
(migração `0011_desenvolvimento_usa_claude` + `seed_company`); os demais
seguem o provedor do tenant. A chave continua em `configure_ai_provider`;
a escolha do setor em `python manage.py configure_sector_ai --sector
<slug> --provider <p> [--model <m>] | --clear | --list`, na API
(`PATCH sectors/{id}/`) ou no Escritório 3D (janela da sala → "IA do setor").

### Autonomia e Policy Engine (`Agent.autonomy_level` + `PolicyRule`)

Dimensão **independente** de `access_level`: aquela decide COM QUEM o
agente fala; `autonomy_level` decide O QUANTO ele age sozinho antes de
precisar de aprovação humana. Um CEO pode ter acesso total e autonomia
zero (só observa); um operacional de um setor só pode ter autonomia
total dentro dele.

```
Nível (Agent.autonomy_level)     Risco que executa sozinho
──────────────────────────────   ─────────────────────────────────────
OBSERVER (0, padrão)             só "low"
RECOMMENDER (1)                  só "low"
SUPERVISED_EXECUTOR (2)          só "low"
POLICY_EXECUTOR (3)              "low"/"medium"/"high" SE PolicyRule liberar
                                  — "critical" NUNCA, mesmo com regra
AUTONOMOUS (4)                   qualquer risco SE PolicyRule liberar,
                                  inclusive "critical"
```

Cada função registrada em `orchestration.registry` declara seu `risk`
("low" padrão/"medium"/"high"/"critical") no decorator:
`@register_query_function(..., risk="high")`. `PolicyRule` (tenant ou
setor específico) é a exceção configurável que libera um risco pra um
nível — nunca hardcode "este agente pode fazer X" no código Python.

Quando a política bloqueia, a função **não executa** — vira uma
`PendingApproval` (fila real, não decorativa: `POST
/api/v1/agency/pending-approvals/{id}/decide/`, ou pelo Django admin,
ação "Aprovar selecionadas"). Só quando aprovada a função roda de verdade,
via o mesmo `orchestration.registry.execute()` do fluxo automático — sem
isso, a aprovação seria só um status sem efeito real, e a promessa de
"human-in-the-loop de verdade" ficaria decorativa.

Onde a interceptação acontece: `orchestration.answer_question()` recebe
um `policy_check` opcional — uma função genérica `(nome, risco) ->
(bool, motivo)`. O `orchestration` não sabe o que é "autonomia", só chama
o callback antes de `registry.execute()`. Quem monta esse callback,
sabendo o que é `Agent.autonomy_level`, é `agency.policy.make_policy_check()`
— nunca o contrário, mantendo a regra de dependência (vertical conhece
core, nunca o inverso).

### Ciclo de vida de Task (`agency.tasks`) — intervir durante a execução

Complementar ao Policy Engine: aquele bloqueia **antes** de uma ação
executar; isto intervém **durante/depois** — pausar uma tarefa em
andamento, dar uma instrução nova sem perder o progresso, aprovar
disparando PR de verdade no GitHub, ou rejeitar. Adaptado do protótipo
`escritorio_virtual_agentes` (mesmo autor, projeto anterior — lá era
FastAPI + estado em memória + Obsidian; aqui é Django + Postgres, nunca
perde estado num restart).

```
CREATED → IN_PROGRESS → [CEO interrompe] → PAUSED_CEO
                       → [CEO dá nova instrução] → ADAPTED → (segue)
                       → APPROVED (dispara branch+PR se tiver Project)
                       → REJECTED
```

`interrupt_task()` salva um `TaskSnapshot` (brief/progresso/arquivos no
momento exato) **antes** de mudar o status — é esse snapshot que
`adapt_and_resume()` cita no novo prompt, pra quem for executar de novo
continuar do ponto onde parou, não do zero. `version` sobe a cada
interrupção; cada versão tem seu próprio snapshot.

`approve_task()` só dispara Git de verdade (branch nova + PR — nunca
commit direto na base, pra dar pra revisar/reverter uma tarefa isolada
das outras) se a Task tiver um `project` com `github_full_name`
preenchido. Falha de Git (token errado, repositório fora do ar) nunca
desfaz a aprovação já registrada — é uma decisão humana, não deveria ser
revertida por um problema de infraestrutura.

**`execute_task()`** é quem de fato roda a tarefa (faltava quando o resto
do ciclo foi escrito) — com a IA do agente (`resolve_agent_llm`: agente →
setor → tenant, ver "Modelo de IA por setor"). Só roda a
partir de `CREATED`/`ADAPTED`; se o CEO pausar/adaptar/decidir a Task
**enquanto o modelo ainda responde**, o resultado que chega depois é
descartado (a intervenção humana vale; o custo da chamada é registrado); resposta que não parseia como JSON cai
como texto puro com `needs_review=True` em vez de derrubar a tarefa
inteira; falha do provedor (Ollama fora do ar etc.) marca `REJECTED` e
sempre libera o agente (`work_status` volta a `idle`) — nunca fica
"working" pra sempre por causa de uma falha externa. Sem status
"aguardando revisão" dedicado no modelo: tarefa concluída fica
`IN_PROGRESS` com `progress=1.0`, que já é o que `approve_task`/
`reject_task` esperam (aceitam qualquer status que não seja
`APPROVED`/`REJECTED`).

**`report_task_result()`** é o caminho alternativo a `execute_task()` —
pra quando o trabalho real de uma Task acontece **fora do Django**
(hoje, o único caso real: geração de página via
`frontend/scripts/generator.mjs` no devserver, que roda Node de verdade
com acesso a sistema de arquivo e `npm run typecheck`/`lint` — o backend
Python não tem como fazer isso). Nunca chama modelo nenhum aqui, só
registra um resultado que já aconteceu:
`POST /api/v1/agency/tasks/{id}/report-result/` com
`{"success": bool, "result": {...}, "current_files": [...]}` — mesmas
regras de estado de `execute_task` (só a partir de `CREATED`/`ADAPTED`,
libera o agente ao final, publica em tempo real). Antes de começar, quem
roda fora pode chamar `POST tasks/{id}/start-external/`
(`start_external_task`): a Task vai pra `IN_PROGRESS` com
`runs_externally=True`, o agente aparece trabalhando, e a resposta traz
`ai_provider`/`ai_model` do agente — `report-result/` aceita fechar essa
Task enquanto ela não tiver resultado.

### Custo de IA com tokens reais (`harness.providers.track_usage` + `harness.pricing`)

Toda chamada de chat devolve os tokens que o **provedor informou** (não mais
"caracteres ÷ 4"). Quem precisa saber quanto custaram as chamadas feitas
por baixo abre `with track_usage() as usage:` (aninhável:
`orchestration` mede a dele pro `QueryLog`, `agency` mede a mesma pro
custo do agente). Preço por **modelo** em `harness/pricing.py` (Anthropic
com a tabela oficial; demais aproximados, ajustáveis em `AI_MODEL_PRICES`
no `.env`, sem editar código). `agency.services.record_interaction` é o
único lugar que registra custo de agente (`AgentInteraction.tokens_estimated`
diz se foi estimado). Modelos Claude atuais (Fable/Mythos, Opus/Sonnet 5+,
Opus 4.7/4.8) **recusam `temperature`** com 400 — `_chat_anthropic` não
manda pra eles.

### Tarefas do Desenvolvimento no Claude Code local (`devserver/lib/claudeCode.mjs`)

O backend (às vezes num container) não abre terminal nem edita o
repositório de ninguém — o **devserver** roda na máquina do dev e faz isso.
No Escritório 3D, a sala do Desenvolvimento tem, em cada tarefa, o botão do
Claude Code (`office3d/ClaudeCodePanel.tsx`):

- **Abrir no terminal**: janela com o Claude Code **interativo** já com o
  pedido da Task (Windows: PowerShell; macOS: Terminal; Linux: o primeiro
  terminal disponível ou `CLAUDE_CODE_TERMINAL`). Ao terminar, "Concluí"
  fecha a Task com os arquivos alterados (`git status`).
- **Rodar aqui**: `claude -p --output-format stream-json` em segundo plano,
  log ao vivo na tela, fecha a Task sozinho (`report-result/` com resumo,
  arquivos e o custo que o próprio Claude Code informa — `usage` entra no
  orçamento do setor).
- Opcional: "abrir automaticamente quando chegar tarefa nova" (por
  navegador, enquanto o Escritório estiver aberto).

Fluxo: `start-external/` (Task em andamento, agente trabalhando) →
`POST devserver /api/claude-code/run` → `report-result/`. O pedido nunca
entra na linha de comando (stdin ou arquivo temporário) — texto da Task
não vira comando. Endpoints protegidos por `DEVSERVER_SECRET`. Sem
`workspace`, trabalha no repositório do boilerplate; o prompt pede pra
validar e **não** fazer push (a Task passa por aprovação no Studio).

### Resumo do dia pelo CEO (`agency/summary.py`)

`POST /api/v1/agency/daily-summary/`: fatos montados em Python a partir da
linha do tempo e dos custos, numerados `[E#]`; o agente CEO (com a IA dele)
só redige e cita cada fato. Sem fatos, não chama o modelo; citação a fato
inexistente é removida e devolvida em `invalid_citations`.
`daily-summary/save/` guarda como nota numa `KnowledgeSource` própria
("Resumos do dia (CEO)", tipo manual — nunca no vault) e indexa pelo Celery.

### Setor "Desenvolvimento" e hierarquia de comunicação humano→agentes

Diferente dos outros 5 setores (que modelam a **empresa cliente**, ver
"Primeiro Vertical" no documento original), `Desenvolvimento` modela o
time que constrói **este próprio boilerplate** — criado via
`seed_company.py` junto com `Orquestrador de Desenvolvimento`
(`access_level=sector_orchestrator`), `AI Backend` e `AI Frontend`
(ambos `operational`).

**Regra de comunicação, definida pelo operador humano** (não é uma
constraint técnica nova — reaproveita 100% o `SectorMessage`/`relay()`
que já existe, testado, seção 7 acima): o humano só fala diretamente com
o `Orquestrador de Desenvolvimento`. Se o pedido é sobre o próprio
boilerplate, o orquestrador trata dentro do próprio time
(`AI Backend`/`AI Frontend`, ou delega pro Claude Code local rodar de
verdade). Se o pedido pertence a outro setor, ele usa
`request_cross_sector_message()` + `relay_message()` pra passar pro
orquestrador daquele setor — nunca o humano fala direto com o time de
outro setor, nunca um agente operacional media (`can_relay=False`
sempre rejeita com 403, já testado).

A tela "Gerar" do Studio (`GeneratePanel.tsx`) cria uma `Task` real pro
agente `AI Frontend` (`task_type="generate_page"`), chama
`start-external/`, passa `ai_provider`/`ai_model` dele ao devserver →
`generator.mjs` → `POST harness/generate/` (parâmetros opcionais
`provider`/`model` — o harness continua sem saber o que é setor) e fecha
com `report-result/` (sucesso com o arquivo gerado, ou erro). Resultado:
a geração usa a IA do setor Desenvolvimento (Claude) e **falha explícita
sem a chave da Anthropic**, como o resto do setor. Sem `AI Frontend`
cadastrado, gera como antes, sem Task (nunca inventa agente).

Com um projeto selecionado, o "Gerar" escreve **dentro dele** (antes ia
sempre pro app principal) e o preview é o servidor do próprio projeto
(`startWorkspace`, porta 4000+), abrindo na página gerada (`#/<nome>`).
Projeto novo e repositório do GitHub nascem do **mesmo** template
(`frontend/project-templates/simple_commercial/` — o devserver copia pra
`frontend/workspace/<nome>/`, o backend empurra pro GitHub; antes eram dois
templates diferentes e a árvore não batia). O template traz Tailwind com
os tokens do Studio, `src/pages/` + rotas geradas e
`.pgba/generate-prompt.md` — as regras de geração do projeto (ele não tem
`@/lib/api`; o prompt padrão do harness gerava código que nunca passava
no typecheck ali). No app principal, páginas geradas ficam em
`src/pages/generated/` (antes a lista incluía o próprio Studio).

### Tempo real (Django Channels) — substitui polling, não convive com ele

Toda mudança de `Task`/`Agent.work_status` é publicada via WebSocket
(`agency/realtime.py` → `agency/consumers.py`), não só gravada no banco.
Existe porque `CompanyOverview`/`CompanyOffice3D` faziam polling a cada
4-5s antes disso — funcional, mas nem em tempo real de verdade nem
barato em request.

```
ws://<host>/ws/agency/?ticket=<ticket de uso único>
```

O navegador pede um ticket (`POST /api/v1/agency/ws-ticket/`, UUID de uso
único com validade de 15s) e abre o WebSocket com ele na URL — API nativa
de WebSocket não permite header customizado, e o JWT na URL apareceria em
log de proxy. Validado em `agency/ws_auth.py` (ainda aceita `?token=<JWT>`
como fallback legado de dev); conexão sem credencial válida fecha com
código `4001`.

Um grupo Channels por tenant (`tenant_{uuid}`) — todo evento do tenant
chega pra qualquer cliente conectado. Mensagens: `{"kind": "task", ...}`,
`{"kind": "agent", ...}`, `{"kind": "pending_approval", ...}` ou
`{"kind": "sector_message", ...}` (criada/respondida/rejeitada — é o que
anima o envelope no Escritório 3D) — mesmo formato do
`TaskSerializer`/`AgentSerializer`/`PendingApprovalSerializer`/`SectorMessageSerializer`
(nunca um segundo formato de serialização pra WebSocket).
`agency/realtime.py` nunca deixa uma falha de broadcast (Redis fora do
ar, etc.) derrubar a operação principal — loga e segue.

Infraestrutura: `channels` + `channels-redis`, mesmo Redis do Celery
(banco lógico `/1`, separado do `/0` do Celery só pra não misturar fila
de mensagens com fila de tarefas assíncronas — `REALTIME_REDIS_URL` no
`.env` se precisar apontar em separado). `ASGI_APPLICATION` no
`config/asgi.py` roteia HTTP (Django normal) e WebSocket (Channels)
juntos — em produção, precisa rodar via `daphne`/`uvicorn`, não
`gunicorn` sozinho (gunicorn não fala ASGI/WebSocket nativamente).

### "Setor de Desenvolvimento cria um projeto" — `agency.Project` + `integrations`

Quando o pedido é "crie um projeto novo" (não uma tela dentro do PGBA,
mas um **produto separado** para o cliente comercializar), o fluxo é
outro, propositalmente mais simples que o resto da plataforma:

```
agency.services.create_project(tenant_id, requesting_agent_id, name, description)
        │
        ├─ cria Project (status=pending)
        ├─ integrations.services.create_project_repository()
        │       ├─ resolve ServiceCredential (provider="github", tenant → global)
        │       ├─ integrations.github.create_repository()  (POST /user/repos ou /orgs/{org}/repos)
        │       └─ integrations.github.push_template_files()  (PUT /repos/.../contents/{path}, um por arquivo)
        └─ Project.status = ready|failed (nunca levanta exceção pro chamador)
```

`integrations` é um app irmão do `harness`, mesmo padrão (credencial
criptografada, resolvida por tenant, configurável via
`python manage.py configure_service_credential --provider github --token ...`
ou Django admin) — mas para infraestrutura/deploy (GitHub, Vercel, Render,
Supabase), não IA. Nunca misture os dois: `harness` resolve "qual modelo
responde essa pergunta"; `integrations` resolve "qual token cria esse
repositório".

**O projeto criado usa o template `simple-commercial`
(`frontend/project-templates/simple_commercial/`), NUNCA o boilerplate
PGBA completo.** É deliberado: um produto simples para o cliente
comercializar (deploy em Vercel + Supabase, sem servidor próprio pra
manter) não precisa de multi-tenant, LGPD formal, RAG ou agentes — isso é
peso que só a plataforma interna (este boilerplate) justifica carregar.

O template mora fisicamente em `frontend/` — é conteúdo React/Vite/TS de
verdade, não deveria estar dentro da árvore do backend Python. O
Dockerfile do backend só copia `Api/` pra dentro da imagem, então
`docker-compose.yml` monta `frontend/project-templates` como volume
só-leitura em `/app/project-templates` no container do `backend`;
`agency.services._load_simple_commercial_template()` lê de lá (variável
`PROJECT_TEMPLATES_PATH`, só precisa ser setada rodando fora do Docker —
ver `.env.example`). Continua **100% Python + httpx**
(`integrations.github.push_template_files`) — nenhum `.mjs`/Node.js
participa desta etapa; não confundir com `frontend/scripts/generator.mjs`
(gera uma página dentro do app já em execução, fluxo completamente
diferente).

Repositório criado via **Contents API do GitHub** (`PUT .../contents/{path}`
por arquivo), não `git clone`+`push` — evita depender do binário `git`
dentro do processo do Django, mais frágil num backend web.

### Vertical `erp` — conceito SAP Business One

`backend_api/Api/erp/` + `frontend/src/components/empresa/erp*.tsx`
(Empresa → Módulos → ERP). Mesmas ideias do SAP B1, sem copiar nada dele:

- **Parceiro de negócio único** (`ParceiroNegocio`, `/erp/parceiros/`):
  cliente, fornecedor e lead numa tabela, com código por tipo (`C00001`,
  `F00001`, `L00001`). Era `erp.Fornecedor` (migração `0007`, `RenameModel`
  — dados e FKs preservados); `/erp/fornecedores/` continua, filtrado.
  `compras.Fornecedor` é outra coisa: a descoberta de fornecedor pra cotação.
  CPF sai mascarado na API (`mask_cpf`), mandar o valor mascarado de volta
  não apaga o CPF.
- **Itens** (`ItemEstoque.tipo_item`): `material` controla estoque (NCM pra
  NF-e); `servico` não tem saldo (código da LC 116 pra NFS-e) e
  `registrar_movimentacao` recusa. `erp.services.registrar_movimentacao` é
  o único lugar que mexe em saldo (antes a regra estava na view).
- **Todo documento carrega parceiro, projeto do CRM, centro de custo
  (`controladoria`) e setor (`agency.Sector`)** — `LancamentoFinanceiro`,
  `ContratoServico`, `Funcionario` (RH no setor do organograma).
  `TenantFKMixin` (serializers) recusa FK de outro tenant ou excluído.
- **Contrato de serviço** (`ContratoServico` + `ItemContrato`), com ou sem
  material: número `CT-AAAA-NNNN`, nome do projeto, breve descrição, início,
  fim, valor, periodicidade e dia de vencimento. Com linhas, o valor é a
  soma delas (`recalcular_valor`). Fluxo em `erp/services.py`:

  ```
  crm.Project (sera_contrato=True) → contrato_de_projeto() → rascunho
     → ativar() (material exige linha de material)
     → gerar_faturas()     LancamentoFinanceiro a receber, 1 por parcela
     → baixar_material()   saída de estoque, tudo ou nada (select_for_update)
     → gerar_nota_fiscal() NotaFiscal "rascunho" (não transmite)
  ```

  Integrações idempotentes por `LancamentoFinanceiro.referencia_origem`
  (única por tenant): `CT-2026-0001#3`, `pedido:12`.
- **CRM → contrato**: `Deal`/`Project.sera_contrato` (+ `contrato_com_material`),
  o negócio ganho passa pro projeto; o projeto marcado aparece em ERP →
  Contratos ("aguardando contrato", `contratos/projetos-pendentes/`) e o
  serializer do projeto devolve `contrato` quando já existe.
- **Compras → financeiro**: pedido de compra `entregue`
  (`compras.services.avancar_status_pedido`) vira conta a pagar
  (`erp.services.conta_a_pagar_do_pedido`).
- **Nota fiscal**: o ERP monta a NFS-e como rascunho e
  `GET /erp/fiscal/prontidao/` diz o que falta (dados da empresa em
  `DadosEmpresa`, `/erp/empresa/`). **Não transmite**: falta certificado A1
  e um emissor integrado — `docs/NOTA_FISCAL.md` tem o que precisa e o
  caminho recomendado (provedor de API via `integrations`).
- **IA dos setores**: `erp/ai_functions.py` registra `erp_contratos_resumo`,
  `erp_financeiro_resumo` e `erp_itens_abaixo_do_minimo` (só leitura, risco
  `low`) — é assim que o agente de qualquer setor consulta o ERP.
- **Tela**: `ErpCrud` (`erp-crud.tsx`) é o CRUD genérico (tabela, busca no
  servidor, filtros, formulário com erro por campo do DRF, exclusão lógica);
  cada aba só descreve campos e colunas (`erp-modulos.tsx`). Listas pedem
  `page_size=500` (`ErpPagination`) e avisam "mostrando N de M" se passar.

### Painel administrativo + integrações (`integrations` + `components/admin/`)

Abre pelo botão **Painel administrativo** na caixa **Empresa** do organograma
(ou pela engrenagem do header). `AdminPanelHost` vive em `App.tsx` e escuta
`openAdminPanel(section)` (`lib/adminPanel.ts`) — nada de prop por meia árvore.
Seções: Empresa (`DadosEmpresa` + prontidão da NF), IA (`AIProvidersPanel`),
E-mails dos setores, Caixa de saída, Automações (n8n), Hostinger, Servidores
(VPS), GitHub, Conectores e MCP (atalho pro Data Lake, `openEmpresaModule`) e
Aparência. API em `/api/v1/integrations/` (`integrations/views.py`).

- **Credenciais de serviço** (`ServiceCredential`, agora com `n8n` e
  `hostinger`): `credentials/` (POST cria/substitui, token volta só mascarado,
  mandar o mascarado de volta mantém) e `credentials/<p>/test/` — chamada real.
- **Caixa de e-mail por setor** (`EmailAccount`, uma ativa por setor; setor
  vazio = caixa padrão da empresa). Pode nascer **sem endereço** (status
  "aguardando e-mail") — o setor já tem a caixa reservada e os rascunhos
  esperam. Presets Hostinger (`smtp.hostinger.com:465`/`imap.hostinger.com:993`),
  Gmail, Outlook (`integrations/email.py#PRESETS`); senha cifrada (Fernet);
  `test/` faz login SMTP (e IMAP) de verdade; host passa pelo `check_host`.
- **E-mail de saída** (`OutboundEmail`, com histórico): agente/tela cria
  **rascunho**; só uma pessoa envia (`outbound-emails/{id}/send/`, Celery;
  sem broker envia na hora). Sem caixa pronta do setor (nem padrão) → 400 e o
  rascunho continua. Nunca sai por outra caixa sem dizer. Quando sai,
  `integrations.signals.email_sent` avisa quem criou (pela `origin`):
  `compras` marca a cotação/pedido como "enviado" (`compras.services.ao_enviar_email`).
- **Caixa de entrada** (`InboundEmail`): IMAP **só leitura** (`select(readonly)`
  + `BODY.PEEK[]` — nunca marca lido nem apaga no servidor), só UIDs novos
  (`EmailAccount.imap_last_uid`), HTML vira texto. Beat a cada 5 min
  (`integrations.tasks.fetch_inboxes_task`) + `email-accounts/{id}/fetch/`.
  Não entra na busca semântica (não é `ingestion.Document`).
- **IA responde e-mail**: `POST /api/v1/agency/email-reply/ {inbound, instructions?}`
  (`agency/email_reply.py`) — o agente do setor (operacional, senão o
  orquestrador; IA do setor) escreve com o e-mail + RAG escopado do setor.
  O corpo recebido entra higienizado e marcado como DADO (`<email>`), nunca
  instrução; o agente não chama função. Sai RASCUNHO (`written_by_ai`,
  `in_reply_to` → `In-Reply-To`/`References` no envio); uma pessoa envia.
  Custo em `record_interaction`.
- **Organograma**: envelope em cada cartão de setor com os não lidos
  (`email-accounts/overview/` → `unread`, a cada 60s; bolinha azul = rascunho
  esperando) → `admin/SectorMailbox.tsx`: Recebidos (ler marca lido, "Responder
  com IA" com orientação opcional ou "Responder eu mesmo"), Enviados (quem
  escreveu — IA ou pessoa — e quem aprovou) e Rascunhos.
- **Compras → fornecedor**: `orcamentos/{id}/rascunho-email/` (pedido de
  cotação com os itens) e `pedidos/{id}/rascunho-email/` (pedido fechado),
  pela caixa do setor Compras; na tela, `EmailDraftButton` abre o editor pra
  revisar e enviar ali mesmo.
- **IA**: `email_rascunho_setor` (agente escreve rascunho; risco "low" porque
  não envia) e `n8n_automacoes_resumo` (só lê) — `integrations/ai_functions.py`.
- **n8n** (`integrations/n8n.py`): API pública `/api/v1` com `X-N8N-API-KEY`,
  `account_ref` = URL da instância. Painel: workflows (gatilho deduzido dos nós),
  liga/desliga (pessoa), execuções por workflow, sucesso/erro recentes.
- **Hostinger** (`integrations/hostinger.py`): e-mail é SMTP/IMAP (acima); o
  token da API (hPanel) é opcional e só LÊ VPS/domínios. A API não cria caixa.
- **Servidores** (`ServerConnection`: Oracle Cloud/Hostinger/outro): host,
  porta, usuário e chave SSH cifrada; pode ser cadastrado antes de a VPS
  existir. `check/` só confere se a porta responde com banner `SSH-` — o
  sistema **não executa comando remoto** (deploy automatizado não existe ainda).

**Engrenagem (preferências do navegador)**: `lib/ThemeContext.tsx` (tema
claro/escuro/sistema, tamanho da fonte no `<html>` — tudo em rem escala junto,
família via `--font-body`/`--font-display`, fonte/quebra de linha do editor),
salvo em `localStorage` (`pgba-prefs`). Antes a engrenagem guardava um estado
do Studio que ninguém lia.

## 8. Princípios GenAI4EU aplicados

Este boilerplate segue os princípios do desafio europeu GenAI4EU (apoio a
IA generativa confiável, centrada no humano, para setores estratégicos da
indústria) traduzidos em regras de engenharia concretas:

| Princípio GenAI4EU | Como este boilerplate implementa |
|---|---|
| IA confiável, sem alucinação | `harness.guardrails` (seção 4) bloqueia geração sem contexto real; RAG sempre cita fonte; `orchestration` só responde com dado real de função registrada, nunca invenção |
| Transparência e responsabilização | `orchestration.QueryLog` audita toda interação; nada é "caixa-preta" |
| Soberania tecnológica / dados | Ollama local por padrão; nuvem de terceiros é opt-in explícito, credencial configurável por tenant via `harness` (seção 4) |
| Humano no centro / human-in-the-loop | A IA responde perguntas; ações de negócio de maior impacto continuam exigindo confirmação humana explícita na camada de vertical |
| Conformidade regulatória (EU AI Act / LGPD) | `core.models.ConsentRecord` + `core.utils.lgpd` cobrem consentimento e proteção de dado pessoal desde o design |
| Aplicável a qualquer setor estratégico | Padrão de Vertical (seção 7) — a mesma plataforma atende estoque, saúde, jurídico, indústria, etc, sem fork |

## 9. Stack de frontend/mobile de referência

Quando o projeto precisar de frontend/mobile (nem todo projeto precisa —
alguns são só API), o padrão de referência é:

- **Web**: React + Vite + TypeScript + Tailwind CSS — scaffold real em
  `/frontend`, já conectado ao backend (`frontend/src/lib/api.ts`).
- **Mobile**: React Native + Expo (sem scaffold próprio ainda — siga o
  mesmo padrão de cliente de API único do frontend web).

Motivo: é a stack já validada em produção em outro projeto do mesmo
ecossistema PGBA, com integração direta aos endpoints REST
(`/api/v1/<vertical>/...`, `/api/v1/ingestion/...`, `/api/v1/orchestration/ask/`).
Novos projetos podem usar outra stack se o cliente exigir, mas esta é o
default quando não há restrição.

## 10. Agentes de código e loop de feedback

Este boilerplate assume que boa parte do frontend (e de código em geral)
vai ser gerada por um agente de codificação — Claude Code, Codex CLI,
Kimi CLI em modo agente, ou equivalente — não só digitada à mão. Três
peças cuidam disso.

### Segurança na sessão do agente (`harness-toolkit`, ferramenta externa)

**Não confundir com o `harness` deste repositório** (credenciais de IA +
guardrails de geração) — `tech-leads-club/harness-toolkit` é uma
ferramenta externa e independente que atua em outra camada: hooks no
próprio Claude Code/Cursor, bloqueando ações destrutivas do agente ANTES
de acontecer, não depois. Relevante aqui porque já tivemos, nesta mesma
sessão de desenvolvimento, um token do GitHub colado sem querer no chat —
o `harness-toolkit` tem uma regra de piso (`secret-access`) que bloqueia
justamente um agente lendo `.env`/chaves SSH e devolvendo o conteúdo na
transcrição, entre outras 6 regras de piso (nunca desligáveis por config)
e 24 "rails" opcionais (lint/teste automático ao final do turno,
detecção de duplicação de código, etc).

A licença (Elastic License 2.0) não permite redistribuir o código-fonte
como serviço hospedado — por isso a integração aqui é **instalar a
ferramenta de verdade**, nunca copiar/reimplementar o que ela faz:

```bash
npm i -g @tech-leads-club/harness-toolkit && tlc harness install
# reinicie o Claude Code/Cursor, depois, na raiz deste repo:
tlc harness init --minimal
```

Comandos de lint/teste corretos para este repositório (a ferramenta pede
isso no assistente de setup, ou configure direto):

```bash
tlc harness gate test-command bash -c "cd backend_api/Api && python -m pytest"
tlc harness gate lint-command bash -c "cd backend_api/Api && flake8 --max-line-length=100 --extend-ignore=E203,W503 . && cd ../../frontend && npm run lint && npm run typecheck"
```

`tlc harness doctor` confirma que a instalação está ativa. Isso é
opcional e por conta de cada desenvolvedor/agente — não faz parte do
pipeline de CI deste boilerplate.

### `frontend/.agent/SKILL.md` — o que construir

A skill que qualquer agente deve ler antes de gerar ou alterar uma tela.
Define direção de design (ancorar no assunto real, usar os tokens do
`tailwind.config.ts`, nunca cair nos três "looks genéricos" que todo LLM
converge sem instrução), as convenções técnicas obrigatórias deste repo
(cliente de API único, exibição de fontes em resposta de IA) e o **loop
de feedback**:

```
planejar → gerar → validar (typecheck + lint + build) → autocorrigir
→ autocrítica → iterar até passar limpo
```

Isso não é opcional nem cosmético: `npm run build` passando é o piso
mínimo para considerar a tarefa concluída, não o objetivo final.

### Modelo usado pelo agente

Independente do harness de runtime. O agente que gera código pode (e
normalmente deve) usar um modelo forte em coding/tool-use — hoje isso é
mais fácil via **OpenRouter** (`harness`, `provider=openrouter`, uma
chave só para centenas de modelos), com **Kimi K2** (Moonshot AI,
open-weight, forte em benchmarks agênticos/coding) como uma opção
configurável sem editar código: `python manage.py configure_ai_provider
--provider openrouter --api-key ... --model moonshotai/kimi-k2`. Isso
não tem relação com qual modelo `orchestration`/`ingestion` usam em
produção — são contextos de uso diferentes, credenciais podem ser as
mesmas ou não.

Ao criar uma vertical nova com UI, o fluxo esperado é: descreva a tela
desejada para o agente → ele lê `frontend/.agent/SKILL.md` → gera →
valida → entrega. Se o agente pular a etapa de validação, trate como
tarefa incompleta, não como "pronto com ressalvas".

- **Automação scriptada (sem humano no loop)**: `frontend/scripts/generate-page.mjs`
  (`npm run generate -- "descrição"`) é a versão determinística do mesmo
  processo. Chama `POST /api/v1/harness/generate/` (`harness/views.py`) —
  o único ponto do projeto que fala com o provedor de IA para gerar
  código, reaproveitando a mesma resolução de credencial e os mesmos
  guardrails do resto do `harness` (`extract_code_block` em
  `guardrails.py`). Escreve o arquivo, roda `npm run typecheck`, e se
  falhar reenvia o código + o erro para o backend pedir correção (até 3
  tentativas) antes de atualizar as rotas. Existe porque um gerador
  irmão deste projeto (`create-ia-frontend`) fazia a mesma coisa mas sem
  nenhuma validação depois de escrever o arquivo, e com credencial de IA
  hardcoded fora do harness — os dois problemas que esta versão corrige.
  Use para telas isoladas e simples; para telas que dependem de outras
  partes do projeto, use um agente de verdade (Claude Code/Codex/Kimi).

## 11. Checklist ao clonar este repo para um novo projeto

- [ ] Renomear o tenant padrão / ajustar `User/models.py` conforme domínio
- [ ] Gerar novo `SECRET_KEY` e `ENCRYPTION_KEY`
- [ ] Configurar credenciais de IA via `python manage.py configure_ai_provider`
      (ou Django admin) em vez de deixar só no `.env` — ver seção 4
- [ ] Definir `EMBEDDING_DIMENSIONS` de acordo com o modelo de embedding escolhido
- [ ] Revisar `payments/` — hoje é stub, implementar conforme o gateway do projeto
- [ ] Criar a(s) vertical(is) do domínio do cliente (seção 7) e registrar suas
      funções seguras em `orchestration/registry.py`
- [ ] Rodar `python manage.py makemigrations && migrate` antes do primeiro deploy
- [ ] Configurar `OBSIDIAN_VAULT_PATH` (ou remover o Ollama do
      `docker-compose.yml` se o projeto não usar RAG)
- [ ] Se for usar o fluxo "setor de Desenvolvimento cria um projeto",
      configurar `python manage.py configure_service_credential
      --provider github --token ghp_... --account-ref sua-org` (ver
      seção 7, "Setor de Desenvolvimento cria um projeto")
- [ ] Ajustar `frontend/tailwind.config.ts` (tokens de cor/fonte) para a
      identidade do cliente antes de pedir a um agente para gerar telas —
      ver seção 10 e `frontend/.agent/SKILL.md`

## 12. O que este boilerplate deliberadamente NÃO faz

- Não decide qual LLM de produção usar (fica a critério do projeto).
- Não expõe `payments/` funcional — é esqueleto, cada projeto integra seu
  próprio gateway (Asaas, Stripe, etc).
- Não faz fine-tuning nem treina modelos — RAG (contexto injetado) e
  function-calling sobre função pré-aprovada, não treino, é o padrão de
  customização de IA aqui.
- Não deixa a IA executar ações de negócio de forma autônoma — hoje o
  pipeline (`orchestration`) só responde perguntas; qualquer ação
  (escrever, cobrar, cancelar) deve ser implementada com confirmação
  humana explícita na camada de vertical.

## 13. Aviso pra qualquer agente de código lendo isto — nunca invente rota/comando

Já aconteceu, de verdade, nesta base: um agente rodando com um modelo
local via Ollama (`-Provider ollama` no perfil PowerShell) recebeu uma
descrição do sistema e devolveu um "plano técnico" **plausível, bem
formatado, e majoritariamente inventado** — rotas, comandos e conceitos
que soam exatamente como algo que existiria aqui, mas nunca foram
escritos em nenhum arquivo. O padrão: ele acerta o diagnóstico
conceitual (ex: "a geração de página está desconectada dos agentes") e
erra a implementação específica (rotas, nomes de comando) sempre que não
leu o arquivo real primeiro — texto plausível preenchendo a lacuna de
não ter checado.

**Regra pra qualquer agente (Claude Code local incluso), antes de
afirmar como algo funciona**: rode `grep`/leia o arquivo real primeiro.
Nunca proponha uma rota, comando de management ou nome de função sem
confirmar que ele existe (`grep -rn "nome" backend_api/Api/`). Se não
achar, diga explicitamente "isso não existe ainda" em vez de descrever
como se existisse.

Confirmado, por grep real no código, que **não existem** (não invente
implementação em cima disso, mesmo que pareça fazer sentido):

- `POST /projects/{id}/activate` ou qualquer rota de "trocar de tenant"
  — trocar de projeto ativo é responsabilidade do **frontend** (estado
  local de qual `agency.Project` está selecionado), nunca uma troca de
  variável de ambiente global no backend. O tenant vem do JWT do
  usuário logado, não é algo que se "troca" numa sessão.
- `POST /harness/delegate/` — delegação entre setores é
  `agency.services.request_cross_sector_message()` +
  `relay_message()` (endpoints reais: `sector-messages/request/` e
  `sector-messages/{id}/relay/`), nada em `harness/`.
- `configure_ai_provider` escolhendo gateway de pagamento — esse
  comando só configura credencial de IA (`AIProviderCredential`).
  `payments/` é stub vazio (ver seção 12), sem nenhum comando de
  configuração ainda.
- Qualquer conceito de "identidade visual por projeto lida de
  `tailwind.config.ts` dinamicamente" — não existe no modelo
  `agency.Project`; o design de cada tela é responsabilidade da skill
  em `frontend/.agent/SKILL.md`, não um dado armazenado por projeto.
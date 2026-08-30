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
   LGPD).
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
fonte = novo valor em `KnowledgeSource.SourceType` + uma função de sync
em `ingestion/services.py`, nunca um novo conjunto de tabelas paralelo.

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

Se um projeto realmente precisar da visualização 3D, ela pode ser
construída como uma camada de apresentação por cima deste mesmo modelo de
dados — sem duplicar `Sector`/`Agent`.

**Sem 3D, mas com visibilidade de quem está trabalhando**:
`frontend/src/components/builder/CompanyOverview.tsx` (dentro do Studio,
aba "Empresa") — painel com polling mostrando `work_status` (bolinha
verde pulsando = `working`, com `current_task`) agrupado por setor, mais
KPIs agregados (total de agentes, trabalhando agora, custo total). Como
`ask_as_agent` é síncrono, um agente só fica `working` pela duração da
própria chamada — pode ser rápido demais para o poll pegar; por isso todo
agente também mostra `last_active_at` (anotado via
`Max("interactions__created_at")` no `AgentViewSet`), a última interação
registrada, para não parecer "sempre ocioso" por causa do timing do poll.

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
(`agency/project_templates/simple_commercial/`), NUNCA o boilerplate
PGBA completo.** É deliberado: um produto simples para o cliente
comercializar (deploy em Vercel + Supabase, sem servidor próprio pra
manter) não precisa de multi-tenant, LGPD formal, RAG ou agentes — isso é
peso que só a plataforma interna (este boilerplate) justifica carregar.
O template fica dentro do app `agency` (não na raiz do repo) de propósito:
garante que vai junto na imagem Docker, já que o `Dockerfile` só copia
`Api/`.

Repositório criado via **Contents API do GitHub** (`PUT .../contents/{path}`
por arquivo), não `git clone`+`push` — evita depender do binário `git`
dentro do processo do Django, mais frágil num backend web.

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
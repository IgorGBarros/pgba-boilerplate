# PGBA Boilerplate — Regras de Negócio, Passo a Passo

> Documento gerado a partir do código real (`agency/models.py`, `agency/policy.py`,
> `agency/tasks.py`, `agency/services.py`, `orchestration/`) — cada regra aqui
> descrita corresponde a código implementado e testado, não a plano futuro.
> Onde algo ainda não existe, está marcado explicitamente como **não implementado**.

---

## Índice

1. [Multi-tenancy e Identidade](#1-multi-tenancy-e-identidade)
2. [Hierarquia Organizacional (Setor → Agente)](#2-hierarquia-organizacional-setor--agente)
3. [Duas Dimensões Independentes de Controle](#3-duas-dimensões-independentes-de-controle)
4. [Classificação de Risco das Ações](#4-classificação-de-risco-das-ações)
5. [Policy Engine — Regra Completa, Nível por Nível](#5-policy-engine--regra-completa-nível-por-nível)
6. [PendingApproval — Fila de Aprovação Humana](#6-pendingapproval--fila-de-aprovação-humana)
7. [Task — Ciclo de Vida Completo](#7-task--ciclo-de-vida-completo)
8. [Comunicação Entre Setores (Mediada)](#8-comunicação-entre-setores-mediada)
9. [RAG Escopado por Setor](#9-rag-escopado-por-setor)
10. [Criação de Projeto Comercial](#10-criação-de-projeto-comercial)
11. [Tempo Real (WebSocket)](#11-tempo-real-websocket)
12. [Auditoria](#12-auditoria)
13. [O que ainda NÃO existe](#13-o-que-ainda-não-existe)

---

## 1. Multi-tenancy e Identidade

Todo modelo de negócio herda de `TenantMixin` (`core/mixins.py`), que adiciona um
campo `tenant_id` (UUID) e garante isolamento de dados entre clientes.

**Regra**: nenhuma query de negócio deve rodar sem `tenant_id` explícito. Toda
função de `agency.services`/`agency.tasks`/`agency.policy` recebe `tenant_id`
como primeiro parâmetro — nunca infere o tenant de uma sessão global.

**Como o `tenant_id` chega numa requisição HTTP**: `TenantContextMixin`
resolve o tenant a partir do usuário autenticado, no método `initial()` do
DRF — ou seja, **depois** da autenticação JWT rodar, nunca antes (bug histórico
já corrigido: middleware Django roda antes da autenticação DRF, então um
middleware de tenant nessa camada sempre via o usuário como anônimo).

---

## 2. Hierarquia Organizacional (Setor → Agente)

```
Sector (Comercial, Financeiro, TI, ...)
   └── Agent (N agentes por setor, ou 0 para papéis sem setor fixo)
```

### `Agent.access_level` — com quem o agente pode falar

| Nível | Significado |
|---|---|
| `operational` | Só atua dentro do próprio setor. **Constraint de banco**: um agente `operational` é **obrigado** a ter `sector` preenchido. |
| `sector_orchestrator` | Media comunicação envolvendo o **próprio** setor (origem ou destino), nunca entre dois setores terceiros. |
| `general_orchestrator` | Acesso total — media qualquer par de setores. |
| `ceo` | Acesso total, mesmo nível de mediação do orquestrador-geral. |

Propriedades derivadas usadas nas regras de mediação (seção 8):
- `agent.can_relay` → `True` para `sector_orchestrator`, `general_orchestrator`, `ceo`.
- `agent.has_full_access` → `True` para `general_orchestrator`, `ceo`.

---

## 3. Duas Dimensões Independentes de Controle

Esta é a regra estrutural mais importante do sistema: **`access_level` e
`autonomy_level` nunca se misturam.**

- `access_level` responde: **com quem** o agente pode falar.
- `autonomy_level` responde: **o quanto** o agente pode agir sozinho antes de
  precisar de aprovação humana.

Um agente pode ser CEO (acesso total) e ainda ter autonomia zero (só observa).
Um agente operacional de um setor só pode ter autonomia total dentro do que
aquele setor permite.

### `Agent.autonomy_level` (`IntegerChoices`, padrão sempre o mais seguro)

| Nível | Nome | Significado |
|---|---|---|
| `0` | **OBSERVER** | Só monitora/consulta risco baixo. **Padrão de todo agente novo** — autonomia maior é sempre opt-in explícito. |
| `1` | **RECOMMENDER** | Analisa e sugere, nunca executa sozinho acima de risco baixo. |
| `2` | **SUPERVISED_EXECUTOR** | Executa risco baixo sozinho; qualquer coisa acima exige aprovação humana. |
| `3` | **POLICY_EXECUTOR** | Auto-executa risco baixo/médio/alto **se** uma `PolicyRule` ativa cobrir; risco crítico **nunca** passa sozinho. |
| `4` | **AUTONOMOUS** | Auto-executa qualquer risco, inclusive crítico, **se** uma `PolicyRule` ativa cobrir. |

---

## 4. Classificação de Risco das Ações

Toda função registrada em `orchestration.registry` declara um risco no momento
do registro:

```python
@register_query_function(name="...", description="...", risk="high")
def minha_funcao(tenant_id, **params): ...
```

Valores válidos (`orchestration.registry.RISK_LEVELS`): `low` (padrão),
`medium`, `high`, `critical`. Se uma função não declarar risco, o padrão é
`low`. Se o Policy Engine encontrar um valor de risco desconhecido, trata como
`critical` — o lado mais restritivo é sempre o padrão seguro em caso de dúvida
(nunca o inverso).

---

## 5. Policy Engine — Regra Completa, Nível por Nível

Arquivo: `agency/policy.py`, função `evaluate_policy(agent, risk)`.

**Passo a passo da decisão**:

```
1. risco == "low"?
   → SIM, sempre permitido, para QUALQUER nível de autonomia (inclusive OBSERVER)
   → NÃO, continua para o passo 2

2. autonomy_level em {OBSERVER, RECOMMENDER, SUPERVISED_EXECUTOR}?
   → SIM: negado. Motivo: "Agente com autonomia '<nome>' não executa
     ações de risco '<risco>' sem aprovação humana."
   → NÃO, continua

3. autonomy_level == POLICY_EXECUTOR?
   → risco == "critical"? → NEGADO SEMPRE, mesmo com PolicyRule
     ("Risco 'critical' sempre exige aprovação humana, mesmo em
      Executor por Política.")
   → risco != "critical" → existe PolicyRule ativa cobrindo?
        SIM → PERMITIDO
        NÃO → NEGADO ("Nenhuma PolicyRule ativa libera risco '<risco>'
              para este setor/tenant.")

4. autonomy_level == AUTONOMOUS?
   → existe PolicyRule ativa cobrindo (incluindo "critical")?
        SIM → PERMITIDO
        NÃO → NEGADO ("Nenhuma PolicyRule ativa libera risco '<risco>'
              (nem em modo Autônomo).")
```

### Como uma `PolicyRule` "cobre" um risco

```python
PolicyRule.objects.filter(tenant_id=..., risk=..., is_active=True, min_autonomy_level__lte=agent.autonomy_level)
```

com uma regra extra de escopo por setor:
- Se o agente **tem** setor: a regra vale se for específica **daquele setor**
  OU for uma regra de **tenant inteiro** (`sector=None`).
- Se o agente **não tem** setor (CEO/orquestrador-geral): só conta regra de
  **tenant inteiro** (`sector=None`) — uma regra presa a um setor específico
  nunca vaza pra fora dele.

**Nunca hardcode** "este agente pode fazer X" em código Python — a régua é
sempre `autonomy_level` (do `Agent`) + `risk` (da função) + `PolicyRule`
(configurável via API/admin, nunca uma constante fixa).

### Onde essa checagem é chamada

`agency/services.py::ask_as_agent()` monta o callback via
`agency.policy.make_policy_check(agent)` e passa pro
`orchestration.services.answer_question(policy_check=...)`. O módulo
`orchestration` **não sabe** o que é autonomia — só chama um callback
genérico `(function_name, risk) -> (bool, motivo)` logo antes de
`registry.execute()`. Essa é a fronteira de dependência: `agency` conhece
`orchestration`, nunca o contrário.

---

## 6. PendingApproval — Fila de Aprovação Humana

Criada automaticamente quando `evaluate_policy` nega uma execução dentro de
`ask_as_agent`. Não é um status de `Task` — é um registro próprio, para ações
**pontuais** disparadas por uma pergunta a um agente (diferente do fluxo de
`Task`, que é supervisão de um trabalho maior — seção 7).

### Campos

| Campo | Significado |
|---|---|
| `agent` | Quem tentou executar. |
| `function_name` | Nome da função registrada que foi bloqueada. |
| `params` | Parâmetros que seriam usados na execução. |
| `risk` | Risco da função, no momento do bloqueio. |
| `reason` | Motivo devolvido pelo `PolicyDecision`. |
| `status` | `pending` → `approved` ou `rejected`. |
| `result` | Preenchido **só** se aprovado — o retorno real da execução. |
| `decided_by` | Usuário humano que decidiu. |

### Fluxo de decisão (`agency.services.decide_pending_approval`)

```
1. Busca o PendingApproval (erro se já foi decidido — nunca decide 2x)
2. registra decided_by + decided_at
3. Se approved=True:
     status = APPROVED
     result = registry.execute(function_name, tenant_id, params)  ← EXECUTA DE VERDADE, agora
     (se a execução falhar: result = {"error": "..."}, mas o status já fica APPROVED)
4. Se approved=False:
     status = REJECTED
     (a função NUNCA roda)
5. Publica em tempo real (agency.realtime.broadcast_pending_approval_update)
```

**Regra crítica**: aprovar não é decorativo. A função registrada roda pelo
mesmo caminho (`orchestration.registry.execute`) usado no fluxo automático —
nunca um atalho separado.

---

## 7. Task — Ciclo de Vida Completo

`Task` é para trabalho **supervisionável em múltiplas etapas**, com
possibilidade de o humano interromper no meio, redirecionar, e só então
aprovar. Diferente de `PendingApproval` (que bloqueia **antes** de uma ação
pontual rodar), `Task` acompanha algo maior, do início ao fim.

### Máquina de estados (`Task.Status`)

```
CREATED ──execute()──► IN_PROGRESS ──(sucesso)──► IN_PROGRESS (progress=1.0)
                             │                            │
                        interrupt()                 approve()/reject()
                             │                            │
                             ▼                            ▼
                       PAUSED_CEO                   APPROVED / REJECTED
                             │                        (terminal — nunca
                        adapt_and_resume()             muda de novo)
                             │
                             ▼
                          ADAPTED ──execute()──► IN_PROGRESS (de novo)
```

**Não existe status "aguardando revisão" dedicado.** Uma tarefa concluída com
sucesso simplesmente permanece `IN_PROGRESS`, com `progress=1.0` — e
`approve_task`/`reject_task` aceitam **qualquer** status que não seja já
`APPROVED`/`REJECTED`.

### Passo a passo de cada transição

**`create_task(tenant_id, agent_id, brief, task_type, project_id)`**
- Cria a `Task` em `CREATED`.
- Publica em tempo real.

**`execute_task(tenant_id, task_id)`**
1. Só roda se status for `CREATED` ou `ADAPTED` — qualquer outro status →
   `TaskStateError`.
2. Marca o `Agent` como `work_status=WORKING`, `current_task=brief[:255]` e
   publica isso em tempo real (**antes** de chamar o modelo — é assim que o
   frontend consegue mostrar "trabalhando agora" enquanto o LLM ainda está
   processando).
3. Marca a `Task` como `IN_PROGRESS`, publica.
4. Resolve `provider`/`model` das settings do Django — **mesma resolução**
   que `harness.views.GenerateCodeView` usa; nunca uma segunda forma de
   escolher modelo espalhada pelo projeto.
5. Chama `harness.providers.chat_completion` com um system prompt fixo
   (`DEFAULT_TASK_SYSTEM_PROMPT`) pedindo JSON estruturado
   (`plan`/`steps`/`output`/`needs_review`).
6. **Se o provedor falhar** (`ProviderConfigError`, ex: Ollama fora do ar):
   `Task.status = REJECTED`, `result = {"error": "..."}`, agente volta pra
   `IDLE`, e a exceção é relançada pro chamador saber que algo deu errado.
7. **Se a resposta não for JSON válido**: em vez de derrubar a tarefa
   inteira, cai como `{"output": <texto cru>, "needs_review": True,
   "parse_error": True}` — resposta malformada nunca falha a tarefa, só
   marca pra revisão humana mais cautelosa.
8. Ao final (sucesso ou parse-fallback): `progress = 1.0`, `result`
   preenchido, agente volta pra `IDLE`. Tudo publicado em tempo real.

**`interrupt_task(tenant_id, task_id, ceo_instructions)`**
1. Só funciona em `IN_PROGRESS` ou `CREATED`.
2. Cria um `TaskSnapshot` com o estado exato atual (`brief`, `progress`,
   `current_files`, `status`, e a própria instrução do CEO) **antes** de
   mudar qualquer coisa — nada do trabalho já feito é perdido.
3. `status = PAUSED_CEO`, `version += 1`.
4. Agente marcado `PAUSED`.

**`adapt_and_resume(tenant_id, task_id, new_brief)`**
1. Só funciona em `PAUSED_CEO`.
2. Busca o `TaskSnapshot` da versão **anterior** (`task.version - 1`) — se
   não existir, `TaskStateError`.
3. Monta um novo `brief` que **cita explicitamente** o brief anterior, o
   progresso salvo, os arquivos já produzidos, a nova diretriz do CEO, e uma
   instrução explícita: "continue a partir do progresso anterior, não
   descarte trabalho já feito."
4. `status = ADAPTED` — pronto para rodar `execute_task` de novo.

**`approve_task(tenant_id, task_id, files=None, trigger_git=True)`**
1. Bloqueia se já `APPROVED`/`REJECTED` (decisão humana é terminal, nunca
   redecidida).
2. `status = APPROVED`.
3. **Se** `files` foi passado, `trigger_git=True`, e a `Task` tem um
   `project` com `github_full_name` configurado: cria uma **branch nova**
   (`feat/task-<id>`) + **Pull Request de verdade** — nunca commit direto na
   branch principal.
4. Falha de integração com o Git **nunca desfaz a aprovação já registrada**
   — a decisão humana já aconteceu; um problema de infraestrutura não deveria
   reverter isso.
5. Retorna `{"task": Task, "pr_url": str | None}`.

**`reject_task(tenant_id, task_id, reason="")`**
- Mesma trava de "já decidida" do approve. `status = REJECTED`.

---

## 8. Comunicação Entre Setores (Mediada)

Um agente **nunca fala direto** com outro setor — sempre passa por um
orquestrador.

**Passo 1 — `request_cross_sector_message(tenant_id, from_agent_id, to_sector_id, content)`**
- Só registra o pedido (`status=pending`). Erro se `from_agent` já pertence
  ao setor de destino (não é uma mensagem "cruzada" nesse caso).

**Passo 2 — `relay_message(tenant_id, relaying_agent_id, message_id, answering_agent_id=None)`**

```
1. relaying_agent.can_relay é False?
   → REJEITADO: "Agente é operacional, não pode mediar."
     (agente operacional NUNCA media, sem exceção)

2. relaying_agent NÃO tem acesso total (não é general_orchestrator/ceo)?
   → o setor do relaying_agent precisa ser origem OU destino da mensagem
   → se não for nenhum dos dois: REJEITADO
     ("Orquestrador de <setor> não medeia mensagens entre outros setores.")

3. Quem responde:
   - se answering_agent_id foi passado: usa esse agente (precisa
     pertencer ao setor de destino)
   - senão: o orquestrador DO SETOR DE DESTINO, se existir
   - senão: qualquer agente ativo daquele setor
   - se não existir nenhum: erro ("setor não tem agente ativo")

4. Executa a pergunta via ask_as_agent() como se o agente respondente
   estivesse respondendo (RAG escopado ao setor dele — ver seção 9)

5. Marca a SectorMessage como ANSWERED, salva a resposta,
   quem mediou, e quando.
```

---

## 9. RAG Escopado por Setor

`agency/services.py::_rag_scope_for(agent)` decide de quais fontes de
conhecimento um agente pode puxar contexto:

- Agente com **acesso total** (`general_orchestrator`/`ceo`): sem restrição —
  pode buscar em qualquer `KnowledgeSource` do tenant.
- Qualquer outro agente: restrito ao `knowledge_source` do **próprio setor**
  (se o setor tiver um definido) — nunca vaza conhecimento de outro setor.

---

## 10. Criação de Projeto Comercial

`agency.services.create_project()` — cria um repositório GitHub **real** para
o cliente comercializar, usando o template `simple-commercial`
(`frontend/project-templates/simple_commercial/`, montado como volume
só-leitura no container do backend).

**Regra deliberada**: o projeto criado usa esse template simples (deploy
Vercel + Supabase), **nunca** o boilerplate PGBA completo — um produto para
cliente final não precisa de multi-tenant, LGPD formal, RAG ou agentes; isso é
peso que só a plataforma interna justifica carregar.

Fluxo: cria `Project(status=pending)` → chama
`integrations.services.create_project_repository()` (cria o repo no GitHub +
empurra os arquivos do template via API, nunca `git`/Node.js) → `status =
ready` ou `failed` (nunca lança exceção pro chamador — falha de integração
externa não deveria derrubar a operação).

---

## 11. Tempo Real (WebSocket)

Toda mudança de `Agent`, `Task` ou `PendingApproval` é publicada via Django
Channels, substituindo polling.

- **Conexão**: `ws://<host>/ws/agency/?token=<JWT>` — o token vai na URL
  porque WebSocket nativo do navegador não permite header `Authorization`
  customizado. Validado manualmente em `agency/ws_auth.py`, com a mesma lib
  (`rest_framework_simplejwt`) que autentica toda a API REST.
- **Escopo**: um grupo por tenant (`tenant_{uuid}`) — todo evento daquele
  tenant chega pra qualquer cliente conectado.
- **Formato**: `{"kind": "agent"|"task"|"pending_approval", ...}`, sempre o
  mesmo shape do serializer REST correspondente (nunca um segundo formato
  para WebSocket).
- **Resiliência**: `agency/realtime.py` nunca deixa uma falha de publicação
  (Redis fora do ar, etc.) derrubar a operação principal — só loga e segue.

---

## 12. Auditoria

- `AgentInteraction`: toda pergunta feita via `ask_as_agent` fica registrada
  com tokens estimados e custo estimado.
- `QueryLog` (`orchestration`): todo request de IA sobre dado estruturado —
  função chamada, parâmetros, resultado, status (`ok`/`function_error`/
  `llm_error`/`rejected`/`pending_approval`).
- `TaskSnapshot`: preserva o estado exato de uma `Task` a cada interrupção —
  nunca é apagado, mesmo depois de adaptado.
- `PendingApproval.decided_by`/`decided_at`: sempre registrado — nunca uma
  aprovação "anônima".
- Todos os modelos de `agency` usam `django-simple-history` (`AuditMixin`) —
  toda alteração gera um registro histórico completo.

---

## 13. O que ainda NÃO existe

Para não criar falsa impressão de completude — isto está no roadmap do
documento "Agentic Enterprise OS", mas **não foi implementado**:

- Motor de eventos de negócio (`lead.created`, `contract.approved`, etc.) —
  hoje o sistema é request/response, não orientado a eventos.
- Company Memory híbrida (grafo de conhecimento + event store).
- Business Process Engine genérico (hoje só existe o ciclo de vida fixo de
  `Task`, não um motor configurável de processos com steps/condições).
- AI Controller transversal de governança (hoje a governança é só o Policy
  Engine, que age no ponto de execução, não uma auditoria contínua separada).
- Agent Economics (TASKS_EXECUTED, TIME_SAVED, COST_SAVED, etc. como métricas
  agregadas de ROI).
- Qualquer agente setorial específico do documento (AI Seller, AI Buyer, AI
  CFO, etc.) — hoje `Agent` é genérico; nenhum papel de negócio tem lógica
  própria além do que o LLM produz a partir do `brief`.
- Machine Learning (previsões de demanda, churn, etc.).

---
name: pgba-frontend-design
description: Guia para agentes de código (Claude Code, Codex CLI, Kimi CLI/K2, ou qualquer outro) gerarem ou modificarem o frontend deste projeto — decisões de design, convenções técnicas do stack e o loop de geração→validação→correção a seguir.
---

# PGBA Frontend — Skill para Agentes de Código

Este arquivo é lido por um agente de codificação (Claude Code, Codex,
Kimi CLI em modo agente, ou qualquer assistente com acesso ao terminal)
antes de gerar ou alterar qualquer tela deste frontend. Se você é o
agente lendo isso: trate as seções "Convenções técnicas" e "Loop de
feedback" como obrigatórias; trate "Direção de design" como orientação a
seguir com julgamento, adaptando ao pedido específico do usuário.

## Por que este arquivo existe

Sem uma skill explícita, agentes de IA tendem a convergir para os mesmos
três ou quatro "looks" genéricos (fundo creme com serifada, fundo quase
preto com um acento neon, layout estilo jornal com regras finas) — bons
para alguns briefings, mas repetidos indistintamente de qual é o produto.
Esta skill existe para forçar uma decisão deliberada em vez do default, e
para que o resultado do agente já nasça consistente com o resto do
projeto (tokens do Tailwind, cliente de API, convenções de estado).

## Duas vias de geração: agente manual vs. automação scriptada

Este projeto tem duas formas de gerar frontend, e você (agente) deve
escolher a certa para a tarefa:

- **Você mesmo, seguindo este SKILL.md** — para qualquer pedido que exija
  julgamento de design, decisões de layout, ou mudanças que tocam mais de
  um arquivo. É o caminho padrão.
- **`npm run generate -- "descrição"`** — um script determinístico
  (`scripts/generate-page.mjs`) que chama o mesmo backend (`harness`) para
  gerar UMA página isolada e já roda o loop de validação sozinho
  (typecheck → autocorreção automática via nova chamada ao modelo → lint
  → atualização de rotas). Útil para prototipagem rápida de telas simples
  e isoladas, ou para você (agente) delegar a etapa mecânica de
  geração+validação em vez de fazer token a token. Não use para telas que
  dependem de outras telas/componentes já existentes — o script gera um
  arquivo novo isolado, não edita o projeto como um todo.

Se for usar a via automatizada, ainda leia o resto deste arquivo antes —
o backend usa o mesmo `DEFAULT_SYSTEM_PROMPT` inspirado nestas convenções
(ver `harness/views.py`), mas você deve revisar o resultado depois, não
tratar como definitivo só porque o typecheck passou (typecheck não
valida design, só sintaxe/tipos).

## Direção de design

Aja como quem já entende o domínio do produto, não como quem está
produzindo uma tela genérica de dashboard. Antes de desenhar qualquer
tela nova:

1. **Ancore no assunto real.** Se o pedido não deixar claro o que é o
   produto/tela, escolha explicitamente (nomeie o produto, o público, e a
   única tarefa daquela tela) antes de desenhar — e diga qual escolha
   fez. Um chat de suporte jurídico e um painel de estoque industrial não
   devem parecer o mesmo template com cores trocadas.
2. **Tokens vêm de `tailwind.config.ts`, não de decoração ad-hoc.** As
   cores `brand.*` e `surface.*` já definidas ali são o ponto de partida
   — ajuste os valores para a identidade do cliente/projeto (isso é
   esperado, é o objetivo de ser tokens), mas não introduza cor solta
   fora do sistema numa tela nova sem atualizar o token primeiro.
3. **Tipografia carrega a personalidade.** `font-display` (títulos) e
   `font-body` (texto) já estão separados no config — use-os com
   intenção, não intercambiavelmente.
4. **Estrutura é informação.** Numeração, divisores, rótulos devem
   corresponder a algo real no conteúdo (uma sequência de fato, um
   histórico). Não adicione "01 / 02 / 03" só porque parece bonito.
5. **Estado vazio e erro são parte do design, não um afterthought.**
   Toda tela que consome a API (praticamente todas) precisa de estado de
   loading, erro tratado (mostrando `ApiError.message`, nunca um erro
   cru) e vazio — ver `KnowledgeChat.tsx` (RAG), `GeneratedRouter.tsx`
   (navegação entre páginas geradas) e `AdminCreate.tsx` (formulário +
   progresso via SSE) como referências de padrão já existentes no projeto.
6. **Menos é mais por padrão.** Gaste ousadia num elemento só por tela.
   Prefira precisão de espaçamento a decoração. Anime só onde a animação
   comunica algo (uma revelação, uma transição de estado) — animação
   ambiente demais é o que mais denuncia "gerado por IA sem revisão".

## Convenções técnicas (obrigatórias)

- **Stack**: React 18 + TypeScript + Vite + Tailwind. Não introduza outro
  framework de UI, gerenciador de estado global pesado (Redux/MobX) ou
  CSS-in-JS sem necessidade explícita — o projeto é propositalmente
  simples por padrão.
- **Toda chamada de API passa por `src/lib/api.ts`.** Nunca `fetch` direto
  num componente. Se o endpoint que você precisa ainda não tem uma função
  lá, adicione uma seguindo o padrão existente (tipos de request/response
  explícitos, erros como `ApiError`).
- **Toda resposta de IA (RAG ou orchestration) exibe a fonte junto da
  resposta.** Isso não é opcional — é a mesma filosofia anti-alucinação
  do backend (`harness.guardrails`) aplicada à UI: nunca mostre só o
  texto gerado sem o `sources`/`function_called` que embasou.
- **Componentes ficam em `src/components/`, um arquivo por componente,
  nomeado pelo que ele mostra** (não `Component1.tsx`).
- **Alias `@/` aponta para `src/`** (configurado em `vite.config.ts` +
  `tsconfig.app.json`) — use-o em vez de caminhos relativos longos.
- **Autenticação**: o token JWT já é lido de `localStorage` em
  `src/lib/api.ts` (`pgba_access_token`). Não implemente um segundo
  mecanismo de armazenamento de sessão.

## Loop de feedback (geração → validação → correção)

Este é o processo que diferencia um agente que "parece" ter terminado de
um que de fato terminou — o mesmo padrão usado por Claude Code, Codex e
Kimi em modo agente:

```
1. PLANEJAR
   - Uma frase sobre o que a tela faz e para quem.
   - Que dado ela consome (qual função de src/lib/api.ts, ou uma nova).
   - Esboço rápido da hierarquia visual (pode ser texto/ASCII).

2. GERAR
   - Escreva o componente seguindo as convenções técnicas acima.

3. VALIDAR (nunca pule esta etapa)
   $ npm run typecheck   # erros de tipo são o sinal mais barato de bug
   $ npm run lint
   $ npm run build        # falha de build = a tarefa não está pronta

4. AUTOCORRIGIR
   - Se qualquer comando da etapa 3 falhar, leia o erro, corrija, volte
     ao passo 3. Não pare no primeiro erro achando que "o resto está ok"
     — rode de novo do zero até os três comandos passarem limpos.

5. AUTOCRÍTICA
   - Releia a tela pensando como o usuário que pediu: ela resolve
     exatamente o que foi pedido? Tem estado de loading/erro/vazio?
     A fonte da resposta de IA está visível?
   - Se o ambiente permitir screenshot (Claude Code e Codex conseguem via
     ferramentas de browser/preview), tire um antes de considerar pronto
     — like o SKILL.md de design do Claude Code coloca: uma imagem vale
     mais que mil tokens de descrição.

6. ITERAR
   - Se algo do passo 5 falhar, volte ao passo 2. Só reporte a tarefa
     como concluída depois que validação E autocrítica passarem.
```

Não entregue uma tela que só "parece pronta" — `npm run build` passando é
o piso mínimo, não a definição de pronto.

## Skills complementares

- `.agent/skills/react-performance.md` — regras de performance React
  adaptadas de `tech-leads-club/agent-skills` (MIT/Apache). O resumo curto
  já vai embutido no `DEFAULT_SYSTEM_PROMPT` da geração automática; leia o
  arquivo completo se estiver revisando ou otimizando manualmente.

Esse catálogo (`github.com/tech-leads-club/agent-skills`) tem dezenas de
outras skills — segurança, acessibilidade, PR review, SEO — organizadas
exatamente no mesmo formato `SKILL.md` que usamos aqui. Vale a pena
consultar antes de escrever uma skill nova do zero para este projeto.

## Modelos recomendados para este loop

Qualquer modelo com boas capacidades agênticas/de tool-use funciona. Duas
rotas já configuradas no `harness` do backend (não é preciso trocar chave
por modelo):

- **Local/gratuito**: Ollama com um modelo de código (ex: `qwen2.5-coder`).
- **Via OpenRouter** (`provider=openrouter` no `harness`, uma chave só):
  acesso a centenas de modelos com o mesmo formato de API. Para tarefas
  agênticas de código especificamente, **Kimi K2** (Moonshot AI) é uma
  opção open-weight forte em coding/tool-use e custo baixo — configure
  com `python manage.py configure_ai_provider --provider openrouter
  --api-key ... --model moonshotai/kimi-k2`. Troque o `--model` por
  qualquer outro disponível em openrouter.ai/models sem mudar código.

Este `SKILL.md` é sobre a IA *gerando* o frontend — diferente de
`harness`, que é sobre o frontend/backend *chamando* IA em produção. São
camadas independentes: o modelo que o agente usa para codificar não
precisa ser o mesmo configurado para `orchestration`/`ingestion` em
runtime.
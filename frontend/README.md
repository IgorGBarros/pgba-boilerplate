# PGBA Frontend

Scaffold mínimo React + Vite + TypeScript + Tailwind, já conectado ao
backend (`../backend_api`). Ponto de partida para uma vertical construir
a UI real do projeto — inclusive via agente de código.

## Rodando

```bash
cp .env.example .env   # ajuste VITE_API_URL se o backend não estiver em localhost:8000
npm install
npm run dev
```

## Painel de status dos agentes

Aba **"Agentes"** — `AgentStatusBoard.tsx`. Sem cena 3D: uma lista
agrupada por setor, com bolinha de status (verde pulsando = trabalhando
agora, cinza = ocioso, amarelo = pausado) e a tarefa atual, atualizando
sozinha a cada 4s (`GET /api/v1/agency/agents/`). Como as chamadas de IA
são síncronas, um agente pode "trabalhar" mais rápido que o intervalo de
polling — por isso cada card também mostra a última atividade registrada
(`last_active_at`), não só o status do instante.

## Geração automática de páginas

**Via CLI** (terminal):
```bash
# gere um token JWT primeiro (POST /api/v1/users/token/) e coloque em .env como PGBA_ACCESS_TOKEN
npm run generate -- "um card de boas-vindas com botão verde"
```

**Via admin panel** (formulário + terminal ao vivo no navegador):
```bash
npm run dev:admin   # sobe Vite (5173) + devserver de geração (5174) juntos
```
Abra `http://localhost:5173`, vá na aba **"Criar página"**, descreva a
tela e acompanhe o progresso em tempo real (SSE) — mesmo estilo do
`Home.tsx` do `create-ia-frontend`, mas chamando o backend real em vez de
um servidor Express com Ollama hardcoded. O `devserver/` é só para
desenvolvimento local (porta 5174, nunca exposto), existe só para dar ao
navegador acesso ao mesmo loop de geração que o CLI já faz — a lógica em
si é uma função só, `scripts/generator.mjs`, reaproveitada pelos dois.

Em ambos os casos: o script chama `POST /api/v1/harness/generate/` no
backend (mesmas credenciais/guardrails do resto do projeto — nunca uma
chamada solta a Ollama/OpenAI), escreve o `.tsx` em `src/pages/`, roda
`npm run typecheck`; se falhar, manda o código + o erro de volta ao
backend pedindo correção (até 3 tentativas), e só então atualiza
`src/generated-config/routes.ts`. As páginas geradas aparecem na aba
"Páginas geradas" do app.

Isso é a versão determinística/scriptada do mesmo loop que
`.agent/SKILL.md` pede a um agente de código (Claude Code, Codex, Kimi)
para seguir manualmente — útil para prototipagem rápida de telas
isoladas; para telas que dependem de outras partes do projeto, prefira
pedir a um agente de verdade.

## Para agentes de código (Claude Code, Codex, Kimi CLI, etc.)

Leia **`.agent/SKILL.md`** antes de gerar ou alterar qualquer tela — ele
define a direção de design, as convenções técnicas obrigatórias
(estrutura de componentes, cliente de API único em `src/lib/api.ts`,
exibição de fontes em respostas de IA) e o loop de
geração→validação→correção a seguir.

## Estrutura

```
frontend/
├── .agent/SKILL.md      # instruções para agentes de IA gerarem UI aqui
├── scripts/
│   └── generate-page.mjs   # geração automática de página (loop de validação embutido)
├── src/
│   ├── lib/api.ts             # único ponto de chamada ao backend
│   ├── components/             # um arquivo por componente
│   ├── pages/                   # páginas geradas (manual ou via npm run generate)
│   ├── generated-config/         # routes.ts, sobrescrito automaticamente
│   ├── App.tsx
│   └── main.tsx
├── tailwind.config.ts      # tokens de design (cores, fontes) — ajuste por projeto
└── vite.config.ts
```

## Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor de desenvolvimento |
| `npm run build` | Typecheck + build de produção |
| `npm run typecheck` | Só o typecheck (usado no loop de validação de agentes) |
| `npm run lint` | ESLint |
| `npm run preview` | Sobe o build de produção localmente |

---
name: react-performance
description: Regras de performance para React + Vite (SPA). Consulte ao escrever, revisar ou otimizar qualquer componente deste projeto.
source: Adaptado de "react-best-practices" (Vercel Engineering, MIT) via tech-leads-club/agent-skills — github.com/tech-leads-club/agent-skills. Reescrito e filtrado para um SPA Vite (sem Next.js/RSC).
---

# Performance em React — PGBA Frontend

Subconjunto das regras de performance da Vercel, adaptado pro nosso
contexto (Vite + SPA, sem Server Components/Server Actions — todo item
específico de Next.js foi removido). O resumo curto disto já está
embutido no `DEFAULT_SYSTEM_PROMPT` do `harness` (geração automática);
este arquivo é a versão completa, pra consulta manual.

## 1. Evitar cascata de requisições

- Duas chamadas independentes: `Promise.all()`, nunca uma esperando a
  outra terminar sem necessidade.
- Se uma depende parcialmente da outra, comece a que não depende
  primeiro e só espere (`await`) a dependente no ponto que precisa do
  resultado — não no topo da função.

## 2. Bundle e carregamento

- Componente pesado usado condicionalmente (modal, editor de código,
  syntax highlighter): `React.lazy()` + `Suspense`, nunca import estático
  — é exatamente o que já fizemos com o `Studio` no `App.tsx` (só quem
  abre a aba paga o custo de `framer-motion`/`cmdk`/`react-syntax-highlighter`).
- Evite importar de "barrel files" (`index.ts` que só reexporta tudo de
  uma pasta) quando o import direto do arquivo real está disponível —
  barrels frequentemente puxam módulos inteiros que não são usados.

## 3. Re-renderização

- **Nunca derive estado com `useEffect`** quando dá pra calcular direto
  no corpo do componente:
  ```tsx
  // ❌ evite
  useEffect(() => setTotal(a + b), [a, b]);
  // ✅ prefira
  const total = a + b;
  ```
- `setState` dentro de callback/closure: sempre a forma funcional
  (`setX((prev) => prev + 1)`), nunca capturar o valor antigo do estado
  fechado no escopo — evita bug de estado desatualizado E permite manter
  o callback estável entre renders.
- Valor inicial caro de `useState`: passe uma função, não o valor já
  calculado (`useState(() => calculoCaro())`, nunca
  `useState(calculoCaro())` — a segunda forma roda o cálculo em TODA
  renderização, mesmo que o resultado só seja usado uma vez).
- Lógica de interação (o que acontece quando o usuário clica/digita) vai
  no event handler, não em um `useEffect` que "reage" a uma mudança de
  estado causada pelo próprio handler.

## 4. Renderização condicional

- Prefira o ternário (`condição ? <A /> : null`) a `&&`
  (`condição && <A />`) quando o valor da condição pode ser `0` ou `NaN`
  — `0 && <A />` renderiza o texto "0" na tela, um bug clássico.

## 5. JavaScript no geral

- Saia cedo de funções (early return) em vez de aninhar `if/else` fundo.
- Cache leituras repetidas de propriedade/localStorage dentro de um loop
  numa variável local, não releia a cada iteração.
- Combine múltiplos `.filter().map()` encadeados num só loop quando o
  array for grande o suficiente pra importar.
- Use `Set`/`Map` para busca O(1) em vez de `.includes()`/`.find()`
  repetido dentro de um loop.

## Quando NÃO aplicar

Não otimize prematuramente componentes pequenos e chamados raramente
(ex: um modal de configurações que abre uma vez por sessão) — essas
regras importam em listas grandes, componentes que renderizam a cada
tecla digitada, ou código que roda em loop. Legibilidade vem antes de
performance quando o ganho é imensurável.

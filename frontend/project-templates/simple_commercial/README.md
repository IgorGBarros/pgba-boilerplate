# PROJECT_NAME_PLACEHOLDER

Projeto gerado pelo setor de Desenvolvimento a partir do template
`simple-commercial` do PGBA — **não é** o boilerplate PGBA completo
(sem multi-tenant, sem Django, sem RAG). É um scaffold leve, pensado para
sair do zero até em produção comercial rapidamente:

- **Frontend**: React + Vite + TypeScript, deploy em 1 clique na
  [Vercel](https://vercel.com/new) (já tem `vercel.json`).
- **Backend/dados**: [Supabase](https://supabase.com) (Postgres + Auth +
  Storage + Edge Functions) — sem servidor próprio para manter.
- Precisa de uma API própria mais robusta? Suba um serviço separado no
  [Render](https://render.com) e aponte o frontend para ele.

## Rodando localmente

```bash
cp .env.example .env   # preencha com as chaves do seu projeto Supabase
npm install
npm run dev
```

## Deploy

1. **Supabase**: crie um projeto em supabase.com, copie a URL e a
   `anon key` para `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`.
2. **Vercel**: importe este repositório em vercel.com/new, configure as
   mesmas variáveis de ambiente no painel do projeto, deploy automático a
   cada push.

## Por que este projeto é separado do PGBA Boilerplate

O PGBA é a plataforma interna da empresa (multi-tenant, LGPD, agentes,
RAG). Um projeto comercial simples para um cliente não precisa de nada
disso — precisa sair do zero rápido e barato de operar. Se este projeto
crescer a ponto de precisar de multi-tenant/IA/auditoria de verdade,
migre para o PGBA Boilerplate como base, não tente encaixar essas
features aqui.

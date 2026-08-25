#!/usr/bin/env node
// frontend/scripts/generate-page.mjs
//
// Uso:
//   npm run generate -- "um card de boas-vindas com botão verde"
//   npm run generate -- "tela de login" --name=Login
//
// Wrapper de terminal para `generator.mjs` — a mesma lógica que alimenta
// o admin panel (`frontend/src/pages/AdminCreate.tsx` via `devserver/`),
// só que aqui o progresso vai para o console em vez de SSE.
//
// Por que este script existe (contexto completo): há um gerador irmão
// deste projeto (create-ia-frontend) que resolve o mesmo problema —
// descrever uma página e receber o código — mas com duas lacunas: (1)
// chama Ollama direto, hardcoded, sem passar pelas credenciais/guardrails
// centralizados; (2) escreve o arquivo gerado em disco SEM rodar
// typecheck/lint/build depois. `generator.mjs` corrige as duas: só fala
// com IA via `/api/v1/harness/generate/` (harness do backend) e roda o
// loop typecheck → autocorreção → lint → rotas antes de considerar a
// página pronta.
import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import { generatePage } from "./generator.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);
  const nameFlag = args.find((a) => a.startsWith("--name="));
  const prompt = args.filter((a) => !a.startsWith("--")).join(" ").trim();

  if (!prompt) {
    fail('Uso: npm run generate -- "descrição da página" [--name=NomeDaPagina]');
  }

  try {
    await generatePage({
      root: ROOT,
      apiUrl: process.env.VITE_API_URL || "http://localhost:8000",
      accessToken: process.env.PGBA_ACCESS_TOKEN,
      prompt,
      name: nameFlag ? nameFlag.split("=")[1] : undefined,
      onLog: (stage, message) => console.log(`[${stage}] ${message}`),
    });
  } catch (err) {
    fail(err.message);
  }
}

main();

// api/lib/pgbaHarness.mjs
//
// Ponte com o backend PGBA Boilerplate — mesmo padrão do
// `pgba-boilerplate/frontend/scripts/generator.mjs`: NUNCA chama Ollama
// direto daqui. Toda geração de código passa por
// `POST /api/v1/harness/generate/`, que resolve credencial por tenant e
// aplica os guardrails anti-alucinação (harness.guardrails).
//
// Exige duas variáveis de ambiente (.env deste projeto, nunca hardcoded):
//   PGBA_API_URL      (padrão: http://localhost:8000)
//   PGBA_ACCESS_TOKEN (gere com POST /api/v1/users/token/)
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const PGBA_API_URL = process.env.PGBA_API_URL || "http://localhost:8000";
const MAX_ATTEMPTS = 3;

export class PgbaHarnessError extends Error {}

async function callHarness({ prompt, systemPrompt, previousCode, validationError }) {
  const token = process.env.PGBA_ACCESS_TOKEN;
  if (!token) {
    throw new PgbaHarnessError(
      "PGBA_ACCESS_TOKEN não configurado. Gere um token JWT (POST /api/v1/users/token/) " +
        "e coloque em .env como PGBA_ACCESS_TOKEN=... antes de gerar código.",
    );
  }

  const res = await fetch(`${PGBA_API_URL}/api/v1/harness/generate/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      prompt,
      language: "tsx",
      ...(systemPrompt ? { system_prompt: systemPrompt } : {}),
      ...(previousCode ? { previous_code: previousCode } : {}),
      ...(validationError ? { validation_error: validationError } : {}),
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new PgbaHarnessError(body.detail || `Backend respondeu ${res.status}`);
  }
  const data = await res.json();
  return data.code;
}

function toPascalCase(text) {
  return (
    text
      .replace(/[^a-zA-Z0-9 ]/g, " ")
      .split(" ")
      .filter(Boolean)
      .map((w) => w[0].toUpperCase() + w.slice(1))
      .join("")
      .slice(0, 60) || `Pagina${Date.now()}`
  );
}

function runTypecheck(projectDir) {
  // Não depende de um script "typecheck" no package.json do projeto
  // gerado (a maioria não tem) — chama o tsc local direto.
  try {
    execFileSync("npx", ["tsc", "--noEmit", "-p", "."], {
      cwd: projectDir,
      stdio: "pipe",
      encoding: "utf-8",
    });
    return { ok: true, output: "" };
  } catch (err) {
    const output = `${err.stdout || ""}\n${err.stderr || ""}`.trim();
    return { ok: false, output: output || err.message };
  }
}

const SYSTEM_PROMPT = `Você é um especialista em React + TypeScript + TailwindCSS gerando uma
página para um projeto criado pelo PGBA Boilerplate. Gere APENAS o código
completo do arquivo pedido, sem explicação antes ou depois. Regras
obrigatórias: use React.FC com export default; estilize com classes
Tailwind; sempre trate estado de loading e erro quando envolver dados
assíncronos.

Regras de performance (adaptadas das react-best-practices da Vercel para
um SPA Vite — ignore qualquer regra de Server Component/Server Action):
- Chamadas independentes usam Promise.all(), nunca await em sequência.
- Nunca derive estado com useEffect quando dá pra calcular no render.
- setState em callback sempre na forma funcional (setX(prev => ...)).
- Valor inicial caro de useState vem de uma função (useState(() => caro())).
- Ternário em vez de && quando o lado falso pode ser 0/NaN.
- Componente pesado condicional usa import() dinâmico (React.lazy).
- Early return em vez de if/else aninhado fundo.

Retorne o código dentro de um bloco \`\`\`tsx.`;

/**
 * Gera uma página dentro de um projeto já existente em generated-projects/,
 * roda o loop de validação (typecheck → autocorreção via harness → repete),
 * e retorna o caminho relativo do arquivo criado — nunca lança para quem
 * chama sem antes tentar `MAX_ATTEMPTS` vezes.
 */
export async function generateEntityInProject({ projectDir, prompt, onLog = () => {} }) {
  const pagesDir = path.join(projectDir, "src", "pages");
  fs.mkdirSync(pagesDir, { recursive: true });

  const pageName = toPascalCase(prompt);
  const relativePath = path.join("src", "pages", `${pageName}.tsx`);
  const filePath = path.join(projectDir, relativePath);

  if (fs.existsSync(filePath)) {
    throw new PgbaHarnessError(`Já existe uma página em ${relativePath}.`);
  }

  onLog(`🤔 IA Planejando — Tech Lead analisando pedido: "${prompt}"`);
  onLog(`🎯 Alvo: ${relativePath}`);

  let code = await callHarness({ prompt, systemPrompt: SYSTEM_PROMPT });
  let attempt = 1;

  while (attempt <= MAX_ATTEMPTS) {
    fs.writeFileSync(filePath, code, "utf-8");

    const check = runTypecheck(projectDir);
    if (check.ok) {
      onLog(`✅ Arquivo criado: ${relativePath}`);
      break;
    }

    onLog(`🧠 Correção aplicada — typecheck falhou na tentativa ${attempt}/${MAX_ATTEMPTS}, pedindo ajuste ao modelo.`);
    if (attempt === MAX_ATTEMPTS) {
      fs.unlinkSync(filePath);
      onLog(`❌ Erro: não foi possível gerar um componente válido em ${MAX_ATTEMPTS} tentativas.`);
      throw new PgbaHarnessError(`Falha após ${MAX_ATTEMPTS} tentativas:\n${check.output}`);
    }

    code = await callHarness({
      prompt,
      systemPrompt: SYSTEM_PROMPT,
      previousCode: code,
      validationError: check.output,
    });
    attempt += 1;
  }

  updateRoutes(projectDir);
  return relativePath.replace(/\\/g, "/");
}

function updateRoutes(projectDir) {
  const pagesDir = path.join(projectDir, "src", "pages");
  const routesFile = path.join(projectDir, "generated-config", "routes.ts");
  if (!fs.existsSync(pagesDir)) return;

  const files = fs.readdirSync(pagesDir).filter((f) => f.endsWith(".tsx"));
  const lines = ["// Gerado automaticamente — não edite à mão.", ""];
  files.forEach((f) => {
    const name = f.replace(".tsx", "");
    lines.push(`import ${name} from "../src/pages/${name}";`);
  });
  lines.push("", "export const routes = [");
  files.forEach((f) => {
    const name = f.replace(".tsx", "");
    lines.push(`  { path: "/${name.toLowerCase()}", component: "${name}" },`);
  });
  lines.push("];", "");

  fs.mkdirSync(path.dirname(routesFile), { recursive: true });
  fs.writeFileSync(routesFile, lines.join("\n"), "utf-8");
}

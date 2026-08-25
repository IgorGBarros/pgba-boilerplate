// frontend/scripts/generator.mjs
//
// Núcleo do loop de geração+validação — extraído para ser reutilizável
// tanto pelo CLI (`npm run generate`) quanto pelo dev-server que alimenta
// o admin panel (`frontend/src/pages/AdminCreate.tsx`). Uma única
// implementação do loop, dois jeitos de disparar (terminal ou UI).
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const MAX_ATTEMPTS = 3;

export function toPascalCase(text) {
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

async function callHarness({ apiUrl, accessToken, prompt, previousCode, validationError }) {
  if (!accessToken) {
    throw new Error(
      "PGBA_ACCESS_TOKEN não configurado. Gere um token JWT (POST /api/v1/users/token/) " +
        "e coloque em frontend/.env como PGBA_ACCESS_TOKEN=... antes de gerar páginas.",
    );
  }

  const res = await fetch(`${apiUrl}/api/v1/harness/generate/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      prompt,
      language: "tsx",
      ...(previousCode ? { previous_code: previousCode } : {}),
      ...(validationError ? { validation_error: validationError } : {}),
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Backend respondeu ${res.status}`);
  }

  const data = await res.json();
  return data.code;
}

function runCheck(root, command, args) {
  try {
    execFileSync(command, args, { cwd: root, stdio: "pipe", encoding: "utf-8" });
    return { ok: true, output: "" };
  } catch (err) {
    const output = `${err.stdout || ""}\n${err.stderr || ""}`.trim();
    return { ok: false, output: output || err.message };
  }
}

function updateRoutes(root) {
  const pagesDir = path.join(root, "src", "pages");
  const routesFile = path.join(root, "src", "generated-config", "routes.ts");
  const files = fs.readdirSync(pagesDir).filter((f) => f.endsWith(".tsx"));

  const lines = [
    "// frontend/src/generated-config/routes.ts",
    "// Gerado automaticamente — não edite à mão.",
    'import type { GeneratedRoute } from "./routes.types";',
    "",
  ];
  files.forEach((f) => {
    const name = f.replace(".tsx", "");
    lines.push(`import ${name} from "@/pages/${name}";`);
  });
  lines.push("", "export const routes: GeneratedRoute[] = [");
  files.forEach((f) => {
    const name = f.replace(".tsx", "");
    lines.push(`  { path: "/${name.toLowerCase()}", name: "${name}", component: ${name} },`);
  });
  lines.push("];", "");

  fs.mkdirSync(path.dirname(routesFile), { recursive: true });
  fs.writeFileSync(routesFile, lines.join("\n"), "utf-8");
  return path.relative(root, routesFile);
}

/**
 * Gera uma página, roda o loop de validação/autocorreção, atualiza rotas.
 *
 * @param {object} opts
 * @param {string} opts.root - diretório raiz do projeto frontend
 * @param {string} opts.apiUrl - VITE_API_URL do backend
 * @param {string} opts.accessToken - PGBA_ACCESS_TOKEN
 * @param {string} opts.prompt - descrição da página
 * @param {string} [opts.name] - nome explícito (PascalCase); senão derivado do prompt
 * @param {(stage: string, message: string) => void} [opts.onLog] - callback de progresso
 * @returns {Promise<{pageName: string, filePath: string, routesFile: string}>}
 */
export async function generatePage({ root, apiUrl, accessToken, prompt, name, onLog = () => {} }) {
  if (!prompt || !prompt.trim()) {
    throw new Error("prompt não pode ser vazio.");
  }

  const pagesDir = path.join(root, "src", "pages");
  const pageName = name || toPascalCase(prompt);
  const filePath = path.join(pagesDir, `${pageName}.tsx`);

  if (fs.existsSync(filePath)) {
    throw new Error(`Já existe uma página em src/pages/${pageName}.tsx. Escolha outro nome.`);
  }

  fs.mkdirSync(pagesDir, { recursive: true });
  onLog("plan", `Gerando "${pageName}" a partir de: "${prompt}"`);

  let code = await callHarness({ apiUrl, accessToken, prompt });
  let attempt = 1;

  while (attempt <= MAX_ATTEMPTS) {
    fs.writeFileSync(filePath, code, "utf-8");
    onLog("write", `Escrito src/pages/${pageName}.tsx (tentativa ${attempt}/${MAX_ATTEMPTS})`);

    onLog("validate", "Rodando typecheck...");
    const typecheck = runCheck(root, "npm", ["run", "typecheck"]);
    if (typecheck.ok) {
      onLog("validate", "Typecheck passou.");
      break;
    }

    onLog("validate", "Typecheck falhou — pedindo correção ao modelo.");
    if (attempt === MAX_ATTEMPTS) {
      fs.unlinkSync(filePath);
      throw new Error(
        `Não foi possível gerar um componente válido em ${MAX_ATTEMPTS} tentativas. ` +
          `Último erro:\n${typecheck.output}`,
      );
    }

    code = await callHarness({
      apiUrl,
      accessToken,
      prompt,
      previousCode: code,
      validationError: typecheck.output,
    });
    attempt += 1;
  }

  onLog("validate", "Rodando lint...");
  const lint = runCheck(root, "npm", ["run", "lint"]);
  if (!lint.ok) {
    onLog("validate", `⚠️ Lint com avisos/erros (não bloqueante):\n${lint.output}`);
  }

  const routesFile = updateRoutes(root);
  onLog("routes", `${routesFile} atualizado.`);
  onLog("done", `✅ "${pageName}" pronto.`);

  return { pageName, filePath, routesFile };
}

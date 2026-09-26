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

/**
 * Regras de geração do PRÓPRIO projeto (`.pgba/generate-prompt.md`, vem do
 * template simple_commercial): um projeto comercial não tem `@/lib/api` nem
 * os tokens do Studio, então o prompt padrão do harness (feito pro PGBA)
 * gerava código que nunca passava no typecheck ali. Sem o arquivo (app
 * principal), vale o prompt padrão do harness.
 */
function projectSystemPrompt(root) {
  const file = path.join(root, ".pgba", "generate-prompt.md");
  if (!fs.existsSync(file)) return undefined;
  return fs.readFileSync(file, "utf-8").slice(0, 4000);
}

function hasScript(root, name) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8"));
    return Boolean(pkg.scripts?.[name]);
  } catch {
    return false;
  }
}

async function callHarness({ apiUrl, accessToken, prompt, previousCode, validationError, provider, model, systemPrompt }) {
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
      // IA do agente que está gerando (ex: AI Frontend → setor
      // Desenvolvimento → Claude). Sem isso, vale o provedor do tenant.
      ...(provider ? { provider } : {}),
      ...(model ? { model } : {}),
      ...(systemPrompt ? { system_prompt: systemPrompt } : {}),
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

/**
 * Onde as páginas geradas moram. Projeto criado pelo Studio (tem `.pgba/`):
 * `src/pages/` — é o produto, toda página conta. App principal (o próprio
 * Studio): `src/pages/generated/` — antes era `src/pages/`, e a lista de
 * rotas geradas incluía Studio/GerarPage/AdminCreate, então o preview
 * "páginas geradas" abria o próprio Studio dentro dele.
 */
function pagesRelDir(root) {
  return fs.existsSync(path.join(root, ".pgba")) ? "src/pages" : "src/pages/generated";
}

function updateRoutes(root) {
  const pagesRel = pagesRelDir(root);
  const pagesDir = path.join(root, pagesRel);
  const importBase = `@/${pagesRel.replace(/^src\//, "")}`;
  const routesFile = path.join(root, "src", "generated-config", "routes.ts");
  const files = fs.existsSync(pagesDir) ? fs.readdirSync(pagesDir).filter((f) => f.endsWith(".tsx")).sort() : [];

  const lines = [
    "// src/generated-config/routes.ts",
    "// Gerado automaticamente — não edite à mão.",
    'import type { GeneratedRoute } from "./routes.types";',
    "",
  ];
  files.forEach((f) => {
    const name = f.replace(".tsx", "");
    lines.push(`import ${name} from "${importBase}/${name}";`);
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
 * @param {string} [opts.provider] - provedor de IA fixo (ex: "anthropic"); senão o do tenant
 * @param {string} [opts.model] - modelo; senão o padrão da credencial
 * @param {(stage: string, message: string) => void} [opts.onLog] - callback de progresso
 * @returns {Promise<{pageName: string, filePath: string, routesFile: string, route: string}>}
 */
export async function generatePage({ root, apiUrl, accessToken, prompt, name, provider, model, onLog = () => {} }) {
  if (!prompt || !prompt.trim()) {
    throw new Error("prompt não pode ser vazio.");
  }

  const pagesRel = pagesRelDir(root);
  const pagesDir = path.join(root, pagesRel);
  const pageName = name || toPascalCase(prompt);
  const filePath = path.join(pagesDir, `${pageName}.tsx`);

  if (fs.existsSync(filePath)) {
    throw new Error(`Já existe uma página em ${pagesRel}/${pageName}.tsx. Escolha outro nome.`);
  }

  fs.mkdirSync(pagesDir, { recursive: true });
  onLog("plan", `Gerando "${pageName}" a partir de: "${prompt}"`);

  const systemPrompt = projectSystemPrompt(root);
  let code = await callHarness({ apiUrl, accessToken, prompt, provider, model, systemPrompt });
  let attempt = 1;

  while (attempt <= MAX_ATTEMPTS) {
    fs.writeFileSync(filePath, code, "utf-8");
    onLog("write", `Escrito ${pagesRel}/${pageName}.tsx (tentativa ${attempt}/${MAX_ATTEMPTS})`);

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
      provider,
      model,
      systemPrompt,
    });
    attempt += 1;
  }

  if (hasScript(root, "lint")) {
    onLog("validate", "Rodando lint...");
    const lint = runCheck(root, "npm", ["run", "lint"]);
    if (!lint.ok) {
      onLog("validate", `⚠️ Lint com avisos/erros (não bloqueante):\n${lint.output}`);
    }
  }

  const routesFile = updateRoutes(root);
  onLog("routes", `${routesFile} atualizado.`);
  onLog("done", `✅ "${pageName}" pronto.`);

  // Caminho relativo à raiz do projeto (o Studio abre esse arquivo na árvore)
  // e a rota que o preview abre (#/<nome>, mesma regra de updateRoutes).
  return {
    pageName,
    filePath: path.relative(root, filePath).split(path.sep).join("/"),
    routesFile,
    route: `/${pageName.toLowerCase()}`,
  };
}

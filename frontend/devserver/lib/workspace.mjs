// frontend/devserver/lib/workspace.mjs
//
// Isto é o que faltava pra bater com o modelo real do Lovable: o Studio
// (devserver + Vite na 5173/5174) é o SERVIDOR PRINCIPAL — tem toda a
// automação (harness, credenciais, guardrails) sempre no ar. Cada projeto
// criado pela IA é um SERVIDOR SECUNDÁRIO: processo próprio, porta
// própria, isolado — nunca a mesma porta do principal. Antes disso, o
// "Gerar" do Studio só escrevia página dentro do próprio app principal
// (mesma porta 5173), o que não tem nada a ver com o modelo real.
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = path.resolve(__dirname, "..", "workspace-template");
const WORKSPACE_ROOT = path.resolve(__dirname, "..", "..", "workspace");

const PORT_RANGE_START = 4000;
const PORT_RANGE_END = 4099;

// name -> { port, process, status }
const runningWorkspaces = new Map();

function sanitizeName(name) {
  return String(name || "").trim().replace(/[^a-zA-Z0-9-_]/g, "-");
}

function copyTemplateRecursive(src, dest, workspaceName) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyTemplateRecursive(srcPath, destPath, workspaceName);
    } else {
      const content = fs.readFileSync(srcPath, "utf-8").replaceAll("__WORKSPACE_NAME__", workspaceName);
      fs.writeFileSync(destPath, content, "utf-8");
    }
  }
}

function findFreePort() {
  const usedPorts = new Set([...runningWorkspaces.values()].map((w) => w.port));
  for (let port = PORT_RANGE_START; port <= PORT_RANGE_END; port++) {
    if (!usedPorts.has(port)) return port;
  }
  throw new Error(`Nenhuma porta livre entre ${PORT_RANGE_START} e ${PORT_RANGE_END}.`);
}

export function listWorkspaces() {
  if (!fs.existsSync(WORKSPACE_ROOT)) return [];
  return fs
    .readdirSync(WORKSPACE_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      const running = runningWorkspaces.get(e.name);
      return { name: e.name, running: !!running, port: running?.port ?? null };
    });
}

export function workspacePath(name) {
  return path.join(WORKSPACE_ROOT, sanitizeName(name));
}

export function createWorkspace(name) {
  const safeName = sanitizeName(name);
  if (!safeName) throw new Error("Nome de projeto inválido.");

  const dest = workspacePath(safeName);
  if (fs.existsSync(dest)) {
    throw new Error(`Já existe um projeto local '${safeName}'.`);
  }

  copyTemplateRecursive(TEMPLATE_DIR, dest, safeName);

  // npm install roda de forma síncrona aqui de propósito — quem chamou
  // (endpoint HTTP) já está tratando isso como uma operação potencialmente
  // demorada e vai responder de forma assíncrona ao cliente.
  execSync("npm install --no-audit --no-fund", { cwd: dest, stdio: "pipe" });

  return { name: safeName, path: dest };
}

export function startWorkspace(name) {
  const safeName = sanitizeName(name);
  const dir = workspacePath(safeName);
  if (!fs.existsSync(dir)) throw new Error(`Projeto local '${safeName}' não encontrado.`);

  const existing = runningWorkspaces.get(safeName);
  if (existing) return { name: safeName, port: existing.port, alreadyRunning: true };

  const port = findFreePort();
  const child = spawn("npx", ["vite", "--port", String(port), "--strictPort"], {
    cwd: dir,
    stdio: "ignore",
    detached: false,
  });

  runningWorkspaces.set(safeName, { port, process: child, status: "starting" });

  child.on("exit", () => {
    runningWorkspaces.delete(safeName);
  });

  return { name: safeName, port, alreadyRunning: false };
}

export function stopWorkspace(name) {
  const safeName = sanitizeName(name);
  const running = runningWorkspaces.get(safeName);
  if (!running) return false;
  running.process.kill();
  runningWorkspaces.delete(safeName);
  return true;
}

export function isWorkspaceRunning(name) {
  return runningWorkspaces.has(sanitizeName(name));
}

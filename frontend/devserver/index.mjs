#!/usr/bin/env node
// frontend/devserver/index.mjs
//
// SERVIDOR PRINCIPAL (porta 5174) — toda a automação vive aqui, sempre no
// ar: geração via harness, credenciais, guardrails, e agora também o
// gerenciamento dos SERVIDORES SECUNDÁRIOS (um processo Vite próprio, em
// porta própria, por projeto criado pela IA — ver `lib/workspace.mjs`
// para o porquê disso existir separado do app principal).
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import { generatePage } from "../scripts/generator.mjs";
import {
  listWorkspaces,
  createWorkspace,
  startWorkspace,
  stopWorkspace,
  workspacePath,
} from "./lib/workspace.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = 5174;
const ALLOWED_ORIGIN = "http://localhost:5173";

const EXPLORER_ROOTS = ["src/pages", "src/components", "src/lib"];

function listFilesRecursive(rootDir, relBase = "") {
  const results = [];
  let entries;
  try {
    entries = fs.readdirSync(path.join(rootDir, relBase), { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const relPath = relBase ? `${relBase}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      results.push({ name: entry.name, type: "folder", path: relPath });
      results.push(...listFilesRecursive(rootDir, relPath));
    } else {
      results.push({ name: entry.name, type: "file", path: relPath });
    }
  }
  return results;
}

const jobClients = new Map();

function sendEvent(jobId, event) {
  const clients = jobClients.get(jobId);
  if (!clients) return;
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) res.write(payload);
}

function withCors(res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  withCors(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // --- Geração de página (principal OU dentro de um workspace secundário) ---

  if (req.method === "GET" && url.pathname === "/api/generate-stream") {
    const jobId = url.searchParams.get("jobId");
    if (!jobId) {
      res.writeHead(400);
      res.end("jobId obrigatório");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    if (!jobClients.has(jobId)) jobClients.set(jobId, new Set());
    jobClients.get(jobId).add(res);
    req.on("close", () => jobClients.get(jobId)?.delete(res));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/generate-page") {
    const raw = await readBody(req);
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return sendJson(res, 400, { error: "JSON inválido" });
    }

    const { prompt, name, jobId, accessToken, workspace } = payload;
    if (!prompt || !jobId) {
      return sendJson(res, 400, { error: "prompt e jobId são obrigatórios" });
    }

    // Sem `workspace`: gera no app principal (comportamento de sempre).
    // Com `workspace`: gera DENTRO do projeto secundário — mesma função,
    // só muda a raiz onde o arquivo é escrito e onde o typecheck roda.
    const targetRoot = workspace ? workspacePath(workspace) : ROOT;
    if (workspace && !fs.existsSync(targetRoot)) {
      return sendJson(res, 404, { error: `Projeto local '${workspace}' não encontrado.` });
    }

    sendJson(res, 202, { accepted: true, jobId });

    generatePage({
      root: targetRoot,
      apiUrl: process.env.VITE_API_URL || "http://localhost:8000",
      accessToken: accessToken || process.env.PGBA_ACCESS_TOKEN,
      prompt,
      name: name || undefined,
      onLog: (stage, message) => sendEvent(jobId, { stage, message }),
    })
      .then((result) => sendEvent(jobId, { stage: "complete", message: "ok", result }))
      .catch((err) => sendEvent(jobId, { stage: "error", message: err.message }));
    return;
  }

  // --- Árvore de arquivos / conteúdo (principal) ---

  if (req.method === "GET" && url.pathname === "/api/project-files") {
    const workspace = url.searchParams.get("workspace");
    const base = workspace ? workspacePath(workspace) : ROOT;
    if (!fs.existsSync(base)) return sendJson(res, 404, { error: "Projeto não encontrado", files: [] });

    const roots = workspace ? ["src/pages", "src/components"] : EXPLORER_ROOTS;
    const files = roots.flatMap((root) => {
      if (!fs.existsSync(path.join(base, root))) return [];
      const parts = root.split("/");
      return [{ name: parts[parts.length - 1], type: "folder", path: root }, ...listFilesRecursive(base, root)];
    });
    return sendJson(res, 200, { files });
  }

  if (req.method === "GET" && url.pathname === "/api/file-content") {
    const workspace = url.searchParams.get("workspace");
    const base = workspace ? workspacePath(workspace) : ROOT;
    const relPath = url.searchParams.get("path") || "";
    const fullPath = path.normalize(path.join(base, relPath));
    if (!fullPath.startsWith(path.normalize(base)) || !fs.existsSync(fullPath)) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(fs.readFileSync(fullPath, "utf-8"));
    return;
  }

  // --- Workspaces (projetos SECUNDÁRIOS: processo + porta próprios) ---

  if (req.method === "GET" && url.pathname === "/api/workspace") {
    return sendJson(res, 200, { workspaces: listWorkspaces() });
  }

  if (req.method === "POST" && url.pathname === "/api/workspace/create") {
    const raw = await readBody(req);
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return sendJson(res, 400, { error: "JSON inválido" });
    }
    try {
      // npm install roda aqui — pode levar alguns segundos.
      const result = createWorkspace(payload.name);
      return sendJson(res, 201, { success: true, ...result });
    } catch (err) {
      return sendJson(res, 400, { success: false, error: err.message });
    }
  }

  const startMatch = url.pathname.match(/^\/api\/workspace\/([^/]+)\/start$/);
  if (req.method === "POST" && startMatch) {
    try {
      const result = startWorkspace(decodeURIComponent(startMatch[1]));
      return sendJson(res, 200, { success: true, ...result });
    } catch (err) {
      return sendJson(res, 400, { success: false, error: err.message });
    }
  }

  const stopMatch = url.pathname.match(/^\/api\/workspace\/([^/]+)\/stop$/);
  if (req.method === "POST" && stopMatch) {
    const stopped = stopWorkspace(decodeURIComponent(stopMatch[1]));
    return sendJson(res, 200, { success: stopped });
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  console.log(`🔧 Servidor principal (devserver) rodando em http://localhost:${PORT}`);
  console.log("   Projetos secundários sobem em portas 4000-4099, sob demanda.");
  console.log("   (só para uso local — nunca exponha isto externamente)");
});

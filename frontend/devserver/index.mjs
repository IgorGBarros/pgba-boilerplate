#!/usr/bin/env node
// frontend/devserver/index.mjs
//
// Servidor de desenvolvimento local (porta 5174) que existe SÓ para dar
// ao admin panel (`AdminCreate.tsx`) uma visão em tempo real do loop de
// geração — que já existe e funciona via CLI (`npm run generate`), mas
// um `fetch` do navegador não pode chamar `execFileSync("npm", ...)`
// nem escrever arquivo em disco diretamente. Este servidor faz a ponte:
// roda a MESMA função `generatePage()` de `scripts/generator.mjs`
// (nenhuma lógica duplicada) e transmite cada estágio via
// Server-Sent Events para a UI.
//
// Não é um servidor de produção — só dev, só localhost, nunca exposto
// externamente. Sobe junto com o Vite via `npm run dev:admin`
// (concurrently).
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import { generatePage } from "../scripts/generator.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = 5174;
const ALLOWED_ORIGIN = "http://localhost:5173";

// Pastas mostradas na árvore de arquivos do Studio — deliberadamente só
// o que faz sentido editar/gerar (não expõe node_modules, config raiz etc).
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

// Clientes SSE conectados, por id de job.
const jobClients = new Map(); // jobId -> Set<ServerResponse>

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

const server = http.createServer(async (req, res) => {
  withCors(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // SSE: o admin panel se conecta aqui ANTES de disparar a criação, para
  // não perder nenhum evento (mesmo padrão do create-ia-frontend).
  if (req.method === "GET" && url.pathname === "/api/generate-stream") {
    const jobId = url.searchParams.get("jobId");
    if (!jobId) {
      res.writeHead(400);
      res.end("jobId obrigatório");
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    if (!jobClients.has(jobId)) jobClients.set(jobId, new Set());
    jobClients.get(jobId).add(res);

    req.on("close", () => {
      jobClients.get(jobId)?.delete(res);
    });
    return;
  }

  // Dispara a geração. Responde imediatamente (202); o progresso real
  // vai todo pelo SSE acima.
  if (req.method === "POST" && url.pathname === "/api/generate-page") {
    const raw = await readBody(req);
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "JSON inválido" }));
      return;
    }

    const { prompt, name, jobId, accessToken } = payload;
    if (!prompt || !jobId) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "prompt e jobId são obrigatórios" }));
      return;
    }

    res.writeHead(202, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ accepted: true, jobId }));

    // Roda em background; eventos vão para quem estiver ouvindo o SSE.
    generatePage({
      root: ROOT,
      apiUrl: process.env.VITE_API_URL || "http://localhost:8000",
      accessToken: accessToken || process.env.PGBA_ACCESS_TOKEN,
      prompt,
      name: name || undefined,
      onLog: (stage, message) => sendEvent(jobId, { stage, message }),
    })
      .then((result) => {
        sendEvent(jobId, { stage: "complete", message: "ok", result });
      })
      .catch((err) => {
        sendEvent(jobId, { stage: "error", message: err.message });
      });
    return;
  }

  // Árvore de arquivos (Studio) — só o que faz sentido navegar/editar.
  if (req.method === "GET" && url.pathname === "/api/project-files") {
    const files = EXPLORER_ROOTS.flatMap((root) => {
      if (!fs.existsSync(path.join(ROOT, root))) return [];
      const parts = root.split("/");
      return [
        { name: parts[parts.length - 1], type: "folder", path: root },
        ...listFilesRecursive(ROOT, root),
      ];
    });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ files }));
    return;
  }

  // Conteúdo de um arquivo específico (para o preview de código no Studio).
  if (req.method === "GET" && url.pathname === "/api/file-content") {
    const relPath = url.searchParams.get("path") || "";
    const fullPath = path.normalize(path.join(ROOT, relPath));
    if (!fullPath.startsWith(ROOT) || !fs.existsSync(fullPath)) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(fs.readFileSync(fullPath, "utf-8"));
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  console.log(`🔧 Dev-server de geração rodando em http://localhost:${PORT}`);
  console.log("   (só para o admin panel local — nunca exponha isto externamente)");
});

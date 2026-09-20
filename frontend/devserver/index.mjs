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
import { exec } from "node:child_process";
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
const terminalClients = new Map();

function sendEvent(jobId, event) {
  const clients = jobClients.get(jobId);
  if (!clients) return;
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) res.write(payload);
}

function withCors(res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
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
    const localPath = url.searchParams.get("localPath");
    // localPath (caminho absoluto ou relativo à home) tem precedência sobre workspace interno
    let base;
    if (localPath) {
      base = localPath.startsWith("~") ? path.join(process.env.HOME || "/root", localPath.slice(1)) : localPath;
    } else {
      base = workspace ? workspacePath(workspace) : ROOT;
    }
    if (!fs.existsSync(base)) return sendJson(res, 404, { error: "Projeto não encontrado", files: [] });

    let files;
    if (localPath) {
      // Tenta subpastas padrão React/TS; se nenhuma existir, lista o raiz do projeto
      const REACT_ROOTS = ["src/pages", "src/components", "src/lib", "src/hooks", "src/types", "src/utils", "src"];
      const foundRoots = REACT_ROOTS.filter((r) => fs.existsSync(path.join(base, r)));
      if (foundRoots.length > 0) {
        // Evita duplicar "src" quando subpastas de src já estão presentes
        const hasSrcSubs = foundRoots.some((r) => r.startsWith("src/"));
        const roots = hasSrcSubs ? foundRoots.filter((r) => r !== "src") : foundRoots;
        files = roots.flatMap((root) => {
          const parts = root.split("/");
          return [{ name: parts[parts.length - 1], type: "folder", path: root }, ...listFilesRecursive(base, root)];
        });
      } else {
        // Projeto com estrutura desconhecida — lista raiz completa (sem node_modules/.)
        files = listFilesRecursive(base);
      }
    } else {
      const roots = workspace ? ["src/pages", "src/components"] : EXPLORER_ROOTS;
      files = roots.flatMap((root) => {
        if (!fs.existsSync(path.join(base, root))) return [];
        const parts = root.split("/");
        return [{ name: parts[parts.length - 1], type: "folder", path: root }, ...listFilesRecursive(base, root)];
      });
    }
    return sendJson(res, 200, { files });
  }

  if (req.method === "GET" && url.pathname === "/api/file-content") {
    const workspace = url.searchParams.get("workspace");
    const localPath = url.searchParams.get("localPath");
    let base;
    if (localPath) {
      base = localPath.startsWith("~") ? path.join(process.env.HOME || "/root", localPath.slice(1)) : localPath;
    } else {
      base = workspace ? workspacePath(workspace) : ROOT;
    }
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

  // --- Salvar arquivo ---

  if (req.method === "POST" && url.pathname === "/api/save-file") {
    const raw = await readBody(req);
    let payload;
    try { payload = JSON.parse(raw); } catch { return sendJson(res, 400, { error: "JSON inválido" }); }
    const { path: relPath, content, workspace: ws, localPath: lp } = payload;
    if (!relPath || content === undefined) return sendJson(res, 400, { error: "path e content são obrigatórios" });
    let base;
    if (lp) {
      base = lp.startsWith("~") ? path.join(process.env.HOME || "/root", lp.slice(1)) : lp;
    } else {
      base = ws ? workspacePath(ws) : ROOT;
    }
    const fullPath = path.normalize(path.join(base, relPath));
    if (!fullPath.startsWith(path.normalize(base))) return sendJson(res, 403, { error: "Caminho não permitido" });
    try {
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content, "utf-8");
      return sendJson(res, 200, { success: true });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  // --- Terminal interativo (SSE) ---

  if (req.method === "GET" && url.pathname === "/api/terminal/stream") {
    const jobId = url.searchParams.get("jobId");
    if (!jobId) { res.writeHead(400); res.end("jobId obrigatório"); return; }
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    if (!terminalClients.has(jobId)) terminalClients.set(jobId, new Set());
    terminalClients.get(jobId).add(res);
    req.on("close", () => terminalClients.get(jobId)?.delete(res));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/terminal/run") {
    const raw = await readBody(req);
    let payload;
    try { payload = JSON.parse(raw); } catch { return sendJson(res, 400, { error: "JSON inválido" }); }
    const { command, jobId } = payload;
    if (!command || !jobId) return sendJson(res, 400, { error: "command e jobId são obrigatórios" });
    sendJson(res, 202, { accepted: true });
    const sendTerminal = (line, isError, done = false) => {
      const clients = terminalClients.get(jobId);
      if (!clients) return;
      const payload = `data: ${JSON.stringify({ line, isError, done })}\n\n`;
      for (const c of clients) c.write(payload);
    };
    exec(command, { shell: true, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (stdout) stdout.split("\n").filter(Boolean).forEach((l) => sendTerminal(l, false));
      if (stderr) stderr.split("\n").filter(Boolean).forEach((l) => sendTerminal(l, true));
      if (err && !stdout && !stderr) sendTerminal(err.message, true);
      sendTerminal("", false, true);
    });
    return;
  }

  // --- Git: status e commit ---

  if (req.method === "GET" && url.pathname === "/api/git/status") {
    const localPath = url.searchParams.get("localPath");
    const workspace = url.searchParams.get("workspace");
    let base;
    if (localPath) {
      base = localPath.startsWith("~") ? path.join(process.env.HOME || "/root", localPath.slice(1)) : localPath;
    } else {
      base = workspace ? workspacePath(workspace) : ROOT;
    }
    if (!fs.existsSync(base)) return sendJson(res, 404, { error: "Projeto não encontrado", files: [] });
    // Resolve git root so paths from `git status` são relativos a ele
    exec("git rev-parse --show-toplevel", { cwd: base }, (rootErr, rootOut) => {
      if (rootErr) return sendJson(res, 200, { files: [], error: "Não é um repositório git" });
      const gitRoot = rootOut.trim();
      exec("git status --porcelain", { cwd: gitRoot }, (err, stdout) => {
        if (err) return sendJson(res, 200, { files: [], error: err.message });
        const files = stdout.split("\n").filter(Boolean).map((line) => ({
          status: line.slice(0, 2).trim(),
          path: line.slice(3).trim(),
        }));
        sendJson(res, 200, { files, gitRoot });
      });
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/git/commit") {
    const raw = await readBody(req);
    let payload;
    try { payload = JSON.parse(raw); } catch { return sendJson(res, 400, { error: "JSON inválido" }); }
    const { files, message, localPath: lp, workspace: ws, jobId } = payload;
    if (!message || !jobId) return sendJson(res, 400, { error: "message e jobId são obrigatórios" });
    let base;
    if (lp) {
      base = lp.startsWith("~") ? path.join(process.env.HOME || "/root", lp.slice(1)) : lp;
    } else {
      base = ws ? workspacePath(ws) : ROOT;
    }
    if (!fs.existsSync(base)) return sendJson(res, 404, { error: "Projeto não encontrado" });

    sendJson(res, 202, { accepted: true, jobId });

    const sendGit = (line, isError, done = false) => {
      const clients = terminalClients.get(jobId);
      if (!clients) return;
      const data = `data: ${JSON.stringify({ line, isError, done })}\n\n`;
      for (const c of clients) c.write(data);
    };

    // Resolve git root antes de rodar qualquer comando — paths do status são
    // relativos ao root do repositório, não ao diretório do projeto.
    exec("git rev-parse --show-toplevel", { cwd: base }, (rootErr, rootOut) => {
      if (rootErr) {
        setTimeout(() => { sendGit("Erro: não é um repositório git", true); sendGit("", false, true); }, 200);
        return;
      }
      const gitRoot = rootOut.trim();
      const escapedMsg = message.replace(/"/g, '\\"');
      const addArgs = files && files.length > 0 ? files.map((f) => `"${f}"`).join(" ") : ".";
      const command = `git add ${addArgs} && git commit -m "${escapedMsg}" && git pull --rebase && git push`;

      // pequeno delay pra garantir que o SSE client já está conectado
      setTimeout(() => {
        exec(command, { shell: true, cwd: gitRoot, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
          if (stdout) stdout.split("\n").filter(Boolean).forEach((l) => sendGit(l, false));
          if (stderr) stderr.split("\n").filter(Boolean).forEach((l) => sendGit(l, false));
          if (err && !stdout && !stderr) sendGit(err.message, true);
          sendGit("", false, true);
        });
      }, 200);
    });
    return;
  }

  // --- Git: diff, log, revert ---

  if (req.method === "GET" && url.pathname === "/api/git/diff") {
    const localPath = url.searchParams.get("localPath");
    const workspace = url.searchParams.get("workspace");
    const filePath = url.searchParams.get("file") || "";
    let base;
    if (localPath) {
      base = localPath.startsWith("~") ? path.join(process.env.HOME || "/root", localPath.slice(1)) : localPath;
    } else {
      base = workspace ? workspacePath(workspace) : ROOT;
    }
    exec("git rev-parse --show-toplevel", { cwd: base }, (rootErr, rootOut) => {
      if (rootErr) return sendJson(res, 200, { diff: "" });
      const gitRoot = rootOut.trim();
      const target = filePath ? `-- "${filePath}"` : "";
      // Show staged + unstaged diff
      exec(`git diff HEAD ${target}`, { cwd: gitRoot, maxBuffer: 2 * 1024 * 1024 }, (err, stdout) => {
        return sendJson(res, 200, { diff: stdout || "" });
      });
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/git/log") {
    const localPath = url.searchParams.get("localPath");
    const workspace = url.searchParams.get("workspace");
    let base;
    if (localPath) {
      base = localPath.startsWith("~") ? path.join(process.env.HOME || "/root", localPath.slice(1)) : localPath;
    } else {
      base = workspace ? workspacePath(workspace) : ROOT;
    }
    exec("git rev-parse --show-toplevel", { cwd: base }, (rootErr, rootOut) => {
      if (rootErr) return sendJson(res, 200, { commits: [] });
      const gitRoot = rootOut.trim();
      exec(
        `git log --pretty=format:'{"hash":"%H","short":"%h","subject":"%s","author":"%an","date":"%ci"}' -30`,
        { cwd: gitRoot, maxBuffer: 1 * 1024 * 1024 },
        (err, stdout) => {
          if (err || !stdout.trim()) return sendJson(res, 200, { commits: [] });
          const commits = stdout.trim().split("\n").map((line) => {
            try { return JSON.parse(line); } catch { return null; }
          }).filter(Boolean);
          return sendJson(res, 200, { commits });
        }
      );
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/git/revert") {
    const raw = await readBody(req);
    let payload;
    try { payload = JSON.parse(raw); } catch { return sendJson(res, 400, { error: "JSON inválido" }); }
    const { file, localPath: lp, workspace: ws } = payload;
    if (!file) return sendJson(res, 400, { error: "file é obrigatório" });
    let base;
    if (lp) {
      base = lp.startsWith("~") ? path.join(process.env.HOME || "/root", lp.slice(1)) : lp;
    } else {
      base = ws ? workspacePath(ws) : ROOT;
    }
    exec("git rev-parse --show-toplevel", { cwd: base }, (rootErr, rootOut) => {
      if (rootErr) return sendJson(res, 400, { error: "Não é um repositório git" });
      const gitRoot = rootOut.trim();
      exec(`git checkout HEAD -- "${file}"`, { cwd: gitRoot }, (err) => {
        if (err) return sendJson(res, 500, { error: err.message });
        return sendJson(res, 200, { success: true });
      });
    });
    return;
  }

  // --- Arquivo: criar e deletar ---

  if (req.method === "POST" && url.pathname === "/api/file/create") {
    const raw = await readBody(req);
    let payload;
    try { payload = JSON.parse(raw); } catch { return sendJson(res, 400, { error: "JSON inválido" }); }
    const { path: relPath, isFolder, content, localPath: lp, workspace: ws } = payload;
    if (!relPath) return sendJson(res, 400, { error: "path é obrigatório" });
    let base;
    if (lp) {
      base = lp.startsWith("~") ? path.join(process.env.HOME || "/root", lp.slice(1)) : lp;
    } else {
      base = ws ? workspacePath(ws) : ROOT;
    }
    const fullPath = path.normalize(path.join(base, relPath));
    if (!fullPath.startsWith(path.normalize(base))) return sendJson(res, 403, { error: "Caminho não permitido" });
    try {
      if (isFolder) {
        fs.mkdirSync(fullPath, { recursive: true });
      } else {
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, content || "", "utf-8");
      }
      return sendJson(res, 200, { success: true });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  if (req.method === "DELETE" && url.pathname === "/api/file/delete") {
    const raw = await readBody(req);
    let payload;
    try { payload = JSON.parse(raw); } catch { return sendJson(res, 400, { error: "JSON inválido" }); }
    const { path: relPath, localPath: lp, workspace: ws } = payload;
    if (!relPath) return sendJson(res, 400, { error: "path é obrigatório" });
    let base;
    if (lp) {
      base = lp.startsWith("~") ? path.join(process.env.HOME || "/root", lp.slice(1)) : lp;
    } else {
      base = ws ? workspacePath(ws) : ROOT;
    }
    const fullPath = path.normalize(path.join(base, relPath));
    if (!fullPath.startsWith(path.normalize(base))) return sendJson(res, 403, { error: "Caminho não permitido" });
    try {
      fs.rmSync(fullPath, { recursive: true, force: true });
      return sendJson(res, 200, { success: true });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/file/rename") {
    const raw = await readBody(req);
    let payload;
    try { payload = JSON.parse(raw); } catch { return sendJson(res, 400, { error: "JSON inválido" }); }
    const { from: fromRel, to: toRel, localPath: lp, workspace: ws } = payload;
    if (!fromRel || !toRel) return sendJson(res, 400, { error: "from e to são obrigatórios" });
    let base;
    if (lp) {
      base = lp.startsWith("~") ? path.join(process.env.HOME || "/root", lp.slice(1)) : lp;
    } else {
      base = ws ? workspacePath(ws) : ROOT;
    }
    const fromFull = path.normalize(path.join(base, fromRel));
    const toFull = path.normalize(path.join(base, toRel));
    if (!fromFull.startsWith(path.normalize(base)) || !toFull.startsWith(path.normalize(base))) {
      return sendJson(res, 403, { error: "Caminho não permitido" });
    }
    try {
      fs.mkdirSync(path.dirname(toFull), { recursive: true });
      fs.renameSync(fromFull, toFull);
      return sendJson(res, 200, { success: true });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  // --- Busca global no projeto ---

  if (req.method === "GET" && url.pathname === "/api/search") {
    const localPath = url.searchParams.get("localPath");
    const workspace = url.searchParams.get("workspace");
    const query = url.searchParams.get("q") || "";
    if (!query.trim()) return sendJson(res, 200, { results: [] });
    let base;
    if (localPath) {
      base = localPath.startsWith("~") ? path.join(process.env.HOME || "/root", localPath.slice(1)) : localPath;
    } else {
      base = workspace ? workspacePath(workspace) : ROOT;
    }
    const searchDir = path.join(base, "src");
    if (!fs.existsSync(searchDir)) return sendJson(res, 200, { results: [] });
    const escaped = query.replace(/'/g, "'\\''");
    exec(
      `grep -rn --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" --include="*.css" --include="*.json" -i '${escaped}' . 2>/dev/null | head -100`,
      { cwd: searchDir, maxBuffer: 1 * 1024 * 1024 },
      (err, stdout) => {
        if (!stdout) return sendJson(res, 200, { results: [] });
        const results = stdout.trim().split("\n").filter(Boolean).map((line) => {
          const colonIdx1 = line.indexOf(":");
          const colonIdx2 = line.indexOf(":", colonIdx1 + 1);
          if (colonIdx1 < 0 || colonIdx2 < 0) return null;
          return {
            file: "src/" + line.slice(0, colonIdx1),
            line: parseInt(line.slice(colonIdx1 + 1, colonIdx2), 10) || 0,
            text: line.slice(colonIdx2 + 1).trim(),
          };
        }).filter(Boolean);
        return sendJson(res, 200, { results });
      }
    );
    return;
  }

  // --- Hash de arquivo (conflito ao salvar) ---

  if (req.method === "GET" && url.pathname === "/api/file/hash") {
    const localPath = url.searchParams.get("localPath");
    const workspace = url.searchParams.get("workspace");
    const filePath = url.searchParams.get("path") || "";
    if (!filePath) return sendJson(res, 400, { error: "path é obrigatório" });
    let base;
    if (localPath) {
      base = localPath.startsWith("~") ? path.join(process.env.HOME || "/root", localPath.slice(1)) : localPath;
    } else {
      base = workspace ? workspacePath(workspace) : ROOT;
    }
    const fullPath = path.normalize(path.join(base, filePath));
    if (!fullPath.startsWith(path.normalize(base))) return sendJson(res, 403, { error: "Caminho não permitido" });
    try {
      const stat = fs.statSync(fullPath);
      return sendJson(res, 200, { hash: `${stat.mtimeMs}_${stat.size}` });
    } catch {
      return sendJson(res, 404, { error: "Arquivo não encontrado" });
    }
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

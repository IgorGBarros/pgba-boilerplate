// frontend/src/lib/devserver.ts
/**
 * Cliente do dev-server local de geração (`frontend/devserver/`), que só
 * existe em desenvolvimento (`npm run dev:admin` — NÃO `npm run dev`
 * sozinho, que só sobe o Vite, sem esse servidor na 5174). Separado de
 * `src/lib/api.ts` de propósito: `api.ts` fala com o backend Django real
 * (produção também); este arquivo fala só com um processo local na porta
 * 5174 que nunca deve existir fora da máquina do desenvolvedor.
 *
 * Toda função aqui é tolerante a falha de rede (devserver fora do ar) —
 * nunca deixa uma promise rejeitada sem captura. Antes disso, rodar só
 * `npm run dev` (sem o devserver) inundava o console com
 * "Uncaught (in promise) TypeError: Failed to fetch" a cada 5s (o
 * intervalo de polling do Studio). Use `isDevServerReachable()` pra
 * avisar o usuário do motivo real, em vez de deixar isso silencioso.
 */
const DEV_SERVER_URL = "http://localhost:5174";

// Secret compartilhado com o devserver para proteger endpoints destrutivos.
// Defina VITE_DEVSERVER_SECRET no .env.local do frontend com o mesmo valor
// de DEVSERVER_SECRET no .env do devserver.
const DEVSERVER_SECRET = import.meta.env.VITE_DEVSERVER_SECRET ?? "";

let lastReachable = true;

export function isDevServerReachable(): boolean {
  return lastReachable;
}

function devserverHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  if (DEVSERVER_SECRET) headers["X-Devserver-Secret"] = DEVSERVER_SECRET;
  return headers;
}

async function safeFetch(input: string, init?: RequestInit): Promise<Response | null> {
  try {
    const res = await fetch(input, init);
    lastReachable = true;
    return res;
  } catch {
    lastReachable = false;
    return null;
  }
}

export interface GenerateLogEvent {
  stage: "plan" | "write" | "validate" | "routes" | "done" | "complete" | "error";
  message: string;
  result?: { pageName: string; filePath: string; routesFile: string };
}

export function connectGenerateStream(
  jobId: string,
  onEvent: (event: GenerateLogEvent) => void,
): EventSource {
  const source = new EventSource(`${DEV_SERVER_URL}/api/generate-stream?jobId=${jobId}`);
  source.onmessage = (e) => {
    onEvent(JSON.parse(e.data) as GenerateLogEvent);
  };
  source.onerror = () => {
    lastReachable = false;
  };
  return source;
}

export async function triggerGeneratePage(params: {
  jobId: string;
  prompt: string;
  name?: string;
  accessToken?: string;
  workspace?: string;
  /** IA do agente que gera (ex: AI Frontend → Claude); vazio = a do tenant. */
  provider?: string;
  model?: string;
}): Promise<void> {
  const res = await safeFetch(`${DEV_SERVER_URL}/api/generate-page`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res) {
    throw new Error("Dev-server não está respondendo. Rode 'npm run dev:admin' (não só 'npm run dev').");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Dev-server respondeu ${res.status}`);
  }
}

// --- Workspaces: projetos SECUNDÁRIOS, cada um com processo/porta próprios ---
// (o Studio em si — porta 5173/5174 — é o SERVIDOR PRINCIPAL, sempre no ar
// com toda a automação; um workspace é criado sob demanda, roda isolado.)

export interface Workspace {
  name: string;
  running: boolean;
  port: number | null;
}

export async function listWorkspaces(): Promise<Workspace[]> {
  const res = await safeFetch(`${DEV_SERVER_URL}/api/workspace`);
  if (!res || !res.ok) return [];
  const data = await res.json().catch(() => ({}));
  return data.workspaces ?? [];
}

export async function createWorkspace(name: string): Promise<{ name: string; path: string }> {
  const res = await safeFetch(`${DEV_SERVER_URL}/api/workspace/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res) throw new Error("Dev-server não está respondendo. Rode 'npm run dev:admin' (não só 'npm run dev').");
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) throw new Error(data.error || `Dev-server respondeu ${res.status}`);
  return data;
}

export async function startWorkspace(name: string): Promise<{ name: string; port: number; alreadyRunning: boolean }> {
  const res = await safeFetch(`${DEV_SERVER_URL}/api/workspace/${encodeURIComponent(name)}/start`, { method: "POST" });
  if (!res) throw new Error("Dev-server não está respondendo. Rode 'npm run dev:admin' (não só 'npm run dev').");
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) throw new Error(data.error || `Dev-server respondeu ${res.status}`);
  return data;
}

export async function stopWorkspace(name: string): Promise<boolean> {
  const res = await safeFetch(`${DEV_SERVER_URL}/api/workspace/${encodeURIComponent(name)}/stop`, { method: "POST" });
  if (!res) return false;
  const data = await res.json().catch(() => ({}));
  return !!data.success;
}

/**
 * Espera o processo Vite do workspace secundário realmente aceitar
 * conexões antes de apontar o iframe pra lá. `startWorkspace()` retorna
 * assim que o processo é criado (spawn é não-bloqueante) — o Vite ainda
 * leva um instante pra terminar de subir, principalmente no primeiro
 * boot. Sem isso, o preview mostraria erro de conexão por um instante.
 */
export async function waitForServerReady(url: string, attempts = 20, delayMs = 300): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    try {
      await fetch(url, { mode: "no-cors" });
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return false;
}

export interface ProjectFile {
  name: string;
  path: string;
  type: string;
}

export async function listProjectFiles(workspace?: string, localPath?: string): Promise<{ files: ProjectFile[]; error?: string }> {
  const params = new URLSearchParams();
  if (localPath) params.set("localPath", localPath);
  else if (workspace) params.set("workspace", workspace);
  const query = params.toString() ? `?${params}` : "";
  const res = await safeFetch(`${DEV_SERVER_URL}/api/project-files${query}`);
  if (!res) return { files: [], error: "Devserver não está respondendo. Rode 'npm run dev:admin'." };
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    return { files: [], error: data?.error ?? `HTTP ${res.status}` };
  }
  const data = await res.json().catch(() => ({}));
  return { files: data.files ?? [] };
}

export async function fetchFileContent(filePath: string, workspace?: string, localPath?: string): Promise<string> {
  const params = new URLSearchParams({ path: filePath });
  if (localPath) params.set("localPath", localPath);
  else if (workspace) params.set("workspace", workspace);
  const res = await safeFetch(`${DEV_SERVER_URL}/api/file-content?${params}`);
  if (!res || !res.ok) return "";
  return res.text();
}

export async function saveFileContent(
  filePath: string,
  content: string,
  workspace?: string,
  localPath?: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!lastReachable) {
    return { ok: false, error: "Dev-server não está respondendo. Rode 'npm run dev:admin'." };
  }
  const res = await safeFetch(`${DEV_SERVER_URL}/api/save-file`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: filePath, content, workspace, localPath }),
  });
  if (!res) {
    return { ok: false, error: "Dev-server não está respondendo. Rode 'npm run dev:admin'." };
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    return { ok: false, error: data.error ?? `Servidor retornou ${res.status}` };
  }
  return { ok: true };
}

export async function runTerminalCommand(command: string, jobId: string): Promise<void> {
  const res = await safeFetch(`${DEV_SERVER_URL}/api/terminal/run`, {
    method: "POST",
    headers: devserverHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ command, jobId }),
  });
  if (!res) throw new Error("Dev-server não está respondendo.");
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Dev-server respondeu ${res.status}`);
  }
}

export function connectTerminalStream(
  jobId: string,
  onOutput: (line: string, isError: boolean) => void,
  onDone?: () => void,
): EventSource {
  const source = new EventSource(`${DEV_SERVER_URL}/api/terminal/stream?jobId=${jobId}`);
  source.onmessage = (e) => {
    const data = JSON.parse(e.data) as { line: string; isError: boolean; done?: boolean };
    if (data.done) {
      source.close();
      onDone?.();
    } else {
      onOutput(data.line, data.isError);
    }
  };
  source.onerror = () => {
    lastReachable = false;
    source.close();
    onDone?.();
  };
  return source;
}

export async function renameFile(
  from: string,
  to: string,
  workspace?: string,
  localPath?: string,
): Promise<{ ok: boolean; error?: string }> {
  const res = await safeFetch(`${DEV_SERVER_URL}/api/file/rename`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, workspace, localPath }),
  });
  if (!res) return { ok: false, error: "Dev-server não está respondendo." };
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) return { ok: false, error: data.error ?? `Servidor retornou ${res.status}` };
  return { ok: true };
}

// --- Git: status e commit ---

export interface GitFileStatus {
  status: string;
  path: string;
}

export async function fetchGitStatus(workspace?: string, localPath?: string): Promise<GitFileStatus[]> {
  const params = new URLSearchParams();
  if (localPath) params.set("localPath", localPath);
  else if (workspace) params.set("workspace", workspace);
  const query = params.toString() ? `?${params}` : "";
  const res = await safeFetch(`${DEV_SERVER_URL}/api/git/status${query}`);
  if (!res || !res.ok) return [];
  const data = await res.json().catch(() => ({}));
  return data.files ?? [];
}

export async function fetchGitDiff(file?: string, workspace?: string, localPath?: string): Promise<string> {
  const params = new URLSearchParams();
  if (file) params.set("file", file);
  if (localPath) params.set("localPath", localPath);
  else if (workspace) params.set("workspace", workspace);
  const res = await safeFetch(`${DEV_SERVER_URL}/api/git/diff?${params}`);
  if (!res || !res.ok) return "";
  const data = await res.json().catch(() => ({}));
  return data.diff ?? "";
}

export interface GitCommit {
  hash: string;
  short: string;
  subject: string;
  author: string;
  date: string;
}

export async function fetchGitLog(workspace?: string, localPath?: string): Promise<GitCommit[]> {
  const params = new URLSearchParams();
  if (localPath) params.set("localPath", localPath);
  else if (workspace) params.set("workspace", workspace);
  const query = params.toString() ? `?${params}` : "";
  const res = await safeFetch(`${DEV_SERVER_URL}/api/git/log${query}`);
  if (!res || !res.ok) return [];
  const data = await res.json().catch(() => ({}));
  return data.commits ?? [];
}

export async function gitRevert(file: string, workspace?: string, localPath?: string): Promise<{ ok: boolean; error?: string }> {
  const res = await safeFetch(`${DEV_SERVER_URL}/api/git/revert`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file, workspace, localPath }),
  });
  if (!res) return { ok: false, error: "Dev-server não está respondendo." };
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) return { ok: false, error: data.error ?? `Servidor retornou ${res.status}` };
  return { ok: true };
}

export async function createFile(filePath: string, isFolder = false, content = "", workspace?: string, localPath?: string): Promise<{ ok: boolean; error?: string }> {
  const res = await safeFetch(`${DEV_SERVER_URL}/api/file/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: filePath, isFolder, content, workspace, localPath }),
  });
  if (!res) return { ok: false, error: "Dev-server não está respondendo." };
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) return { ok: false, error: data.error ?? `Servidor retornou ${res.status}` };
  return { ok: true };
}

export async function deleteFile(filePath: string, workspace?: string, localPath?: string): Promise<{ ok: boolean; error?: string }> {
  const res = await safeFetch(`${DEV_SERVER_URL}/api/file/delete`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: filePath, workspace, localPath }),
  });
  if (!res) return { ok: false, error: "Dev-server não está respondendo." };
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) return { ok: false, error: data.error ?? `Servidor retornou ${res.status}` };
  return { ok: true };
}

export interface SearchResult {
  file: string;
  line: number;
  text: string;
}

export async function searchFiles(query: string, workspace?: string, localPath?: string): Promise<SearchResult[]> {
  const params = new URLSearchParams({ q: query });
  if (localPath) params.set("localPath", localPath);
  else if (workspace) params.set("workspace", workspace);
  const res = await safeFetch(`${DEV_SERVER_URL}/api/search?${params}`);
  if (!res || !res.ok) return [];
  const data = await res.json().catch(() => ({}));
  return data.results ?? [];
}

export async function fetchFileHash(filePath: string, workspace?: string, localPath?: string): Promise<string | null> {
  const params = new URLSearchParams({ path: filePath });
  if (localPath) params.set("localPath", localPath);
  else if (workspace) params.set("workspace", workspace);
  const res = await safeFetch(`${DEV_SERVER_URL}/api/file/hash?${params}`);
  if (!res || !res.ok) return null;
  const data = await res.json().catch(() => ({}));
  return data.hash ?? null;
}

export async function gitCommit(params: {
  files?: string[];
  message: string;
  jobId: string;
  workspace?: string;
  localPath?: string;
}): Promise<void> {
  const res = await safeFetch(`${DEV_SERVER_URL}/api/git/commit`, {
    method: "POST",
    headers: devserverHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(params),
  });
  if (!res) throw new Error("Dev-server não está respondendo.");
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Dev-server respondeu ${res.status}`);
  }
}

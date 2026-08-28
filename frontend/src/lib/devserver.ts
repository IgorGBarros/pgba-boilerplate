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

let lastReachable = true;

export function isDevServerReachable(): boolean {
  return lastReachable;
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

export async function listProjectFiles(workspace?: string): Promise<ProjectFile[]> {
  const query = workspace ? `?workspace=${encodeURIComponent(workspace)}` : "";
  const res = await safeFetch(`${DEV_SERVER_URL}/api/project-files${query}`);
  if (!res || !res.ok) return [];
  const data = await res.json().catch(() => ({}));
  return data.files ?? [];
}

export async function fetchFileContent(path: string, workspace?: string): Promise<string> {
  const params = new URLSearchParams({ path });
  if (workspace) params.set("workspace", workspace);
  const res = await safeFetch(`${DEV_SERVER_URL}/api/file-content?${params}`);
  if (!res || !res.ok) return "";
  return res.text();
}
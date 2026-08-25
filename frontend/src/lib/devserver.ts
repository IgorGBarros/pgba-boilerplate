// frontend/src/lib/devserver.ts
/**
 * Cliente do dev-server local de geração (`frontend/devserver/`), que só
 * existe em desenvolvimento (`npm run dev:admin`). Separado de
 * `src/lib/api.ts` de propósito: `api.ts` fala com o backend Django real
 * (produção também); este arquivo fala só com um processo local na porta
 * 5174 que nunca deve existir fora da máquina do desenvolvedor.
 */
const DEV_SERVER_URL = "http://localhost:5174";

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
  return source;
}

export async function triggerGeneratePage(params: {
  jobId: string;
  prompt: string;
  name?: string;
  accessToken?: string;
}): Promise<void> {
  const res = await fetch(`${DEV_SERVER_URL}/api/generate-page`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Dev-server respondeu ${res.status}`);
  }
}

export interface ProjectFile {
  name: string;
  path: string;
  type: string;
}

export async function listProjectFiles(): Promise<ProjectFile[]> {
  const res = await fetch(`${DEV_SERVER_URL}/api/project-files`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.files ?? [];
}

export async function fetchFileContent(path: string): Promise<string> {
  const res = await fetch(`${DEV_SERVER_URL}/api/file-content?path=${encodeURIComponent(path)}`);
  if (!res.ok) return "";
  return res.text();
}

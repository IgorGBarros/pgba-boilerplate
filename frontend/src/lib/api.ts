// frontend/src/lib/api.ts
/**
 * Cliente único de acesso à API do backend PGBA. Qualquer componente que
 * precise falar com o backend importa daqui — nunca chame `fetch` direto
 * num componente (mesma filosofia do backend: um só ponto de entrada por
 * tipo de integração, ver harness/providers.py no lado Django).
 */
const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

function getAccessToken(): string | null {
  return localStorage.getItem("pgba_access_token");
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getAccessToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.detail ?? `Erro ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// --- Auth -------------------------------------------------------------

export async function login(email: string, password: string) {
  return request<{ access: string; refresh: string }>("/api/v1/users/token/", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

// --- ingestion (RAG) ----------------------------------------------------

export interface RagSource {
  document_title: string;
  source_name: string;
  content: string;
  distance: number;
}

export interface RagQueryResult {
  query: string;
  sources: RagSource[];
  answer?: string;
  answer_error?: string;
}

export async function queryKnowledge(
  query: string,
  opts: { topK?: number; generateAnswer?: boolean } = {},
): Promise<RagQueryResult> {
  return request<RagQueryResult>("/api/v1/ingestion/query/", {
    method: "POST",
    body: JSON.stringify({
      query,
      top_k: opts.topK ?? 5,
      generate_answer: opts.generateAnswer ?? true,
    }),
  });
}

// --- orchestration (Q&A sobre dado estruturado) --------------------------

export interface AskResult {
  answer: string;
  function_called: string | null;
  sources: { document: string; source: string }[];
  status: "ok" | "function_error" | "llm_error" | "rejected";
}

export async function askStructured(
  question: string,
  useRagContext = true,
): Promise<AskResult> {
  return request<AskResult>("/api/v1/orchestration/ask/", {
    method: "POST",
    body: JSON.stringify({ question, use_rag_context: useRagContext }),
  });
}

// --- agency (agentes & setores) -------------------------------------------

export type AgentWorkStatus = "idle" | "working" | "paused";
export type AgentAccessLevel = "operational" | "sector_orchestrator" | "general_orchestrator" | "ceo";

export interface Agent {
  id: number;
  sector: number | null;
  sector_name: string | null;
  name: string;
  role: string;
  access_level: AgentAccessLevel;
  work_status: AgentWorkStatus;
  current_task: string;
  last_active_at: string | null;
}

/**
 * Lista os agentes do tenant, com status de trabalho ao vivo
 * (`work_status`/`current_task`) e `last_active_at` (última interação
 * registrada, útil quando a tarefa já terminou antes do próximo poll —
 * ver AgentStatusBoard.tsx).
 */
export async function listAgents(sectorId?: number): Promise<Agent[]> {
  const query = sectorId ? `?sector=${sectorId}` : "";
  return request<Agent[]>(`/api/v1/agency/agents/${query}`);
}

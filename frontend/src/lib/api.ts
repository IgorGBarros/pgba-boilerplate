// frontend/src/lib/api.ts
/**
 * Cliente único de acesso à API do backend PGBA. Qualquer componente que
 * precise falar com o backend importa daqui — nunca chame `fetch` direto
 * num componente (mesma filosofia do backend: um só ponto de entrada por
 * tipo de integração, ver harness/providers.py no lado Django).
 */
import { getAccessToken } from "@/lib/auth";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

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

/**
 * Igual a `request`, mas para endpoints de LISTA. O DRF pagina por padrão
 * (`DEFAULT_PAGINATION_CLASS` nas settings do backend) — toda resposta de
 * `list()` de ModelViewSet vem como `{count, next, previous, results}`,
 * nunca um array direto. Sem isso, `.filter()`/`.map()` em cima do
 * resultado quebraria em runtime (mesmo bug que já corrigimos nos testes
 * Python e nos scripts PowerShell — aqui nunca tinha sido corrigido).
 */
async function requestList<T>(path: string): Promise<T[]> {
  const data = await request<T[] | { results: T[] }>(path);
  if (Array.isArray(data)) return data;
  return data.results ?? [];
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

export interface AgentAskResult {
  answer: string;
  function_called: string | null;
  sources: { document: string; source: string }[];
  status: "ok" | "function_error" | "llm_error" | "rejected" | "pending_approval";
  pending_function_params?: Record<string, unknown>;
}

/**
 * Pergunta via UM agente específico (RAG escopado ao setor dele, exceto
 * acesso total; sujeito ao Policy Engine — se a função exigir mais
 * autonomia do que o agente tem, `status` volta "pending_approval" em
 * vez de executar, e a ação some pra `listPendingApprovals()`).
 */
export async function askAsAgent(agentId: number, question: string, useRagContext = true): Promise<AgentAskResult> {
  return request<AgentAskResult>(`/api/v1/agency/agents/${agentId}/ask/`, {
    method: "POST",
    body: JSON.stringify({ question, use_rag_context: useRagContext }),
  });
}

// --- agency (agentes & setores) -------------------------------------------

export type AgentWorkStatus = "idle" | "working" | "paused";
export type AgentAccessLevel = "operational" | "sector_orchestrator" | "general_orchestrator" | "ceo";
export type AgentAutonomyLevel = 0 | 1 | 2 | 3 | 4;

export interface Agent {
  id: number;
  sector: number | null;
  sector_name: string | null;
  name: string;
  role: string;
  access_level: AgentAccessLevel;
  autonomy_level: AgentAutonomyLevel;
  work_status: AgentWorkStatus;
  current_task: string;
  last_active_at: string | null;
}

/**
 * Lista os agentes do tenant, com status de trabalho ao vivo
 * (`work_status`/`current_task`) e `last_active_at` (última interação
 * registrada, útil quando a tarefa já terminou antes do próximo poll —
 * ver CompanyOverview.tsx).
 */
export async function listAgents(sectorId?: number): Promise<Agent[]> {
  const query = sectorId ? `?sector=${sectorId}` : "";
  return requestList<Agent>(`/api/v1/agency/agents/${query}`);
}

// --- agency: setores e projetos (visão da empresa no Studio) --------------

export interface Sector {
  id: number;
  name: string;
  description: string;
  monthly_budget_usd: string;
  knowledge_source: number | null;
  agents_count: number;
}

export async function listSectors(): Promise<Sector[]> {
  return requestList<Sector>("/api/v1/agency/sectors/");
}

export async function createSector(params: { name: string; description?: string; monthlyBudgetUsd?: number }): Promise<Sector> {
  return request<Sector>("/api/v1/agency/sectors/", {
    method: "POST",
    body: JSON.stringify({
      name: params.name,
      description: params.description ?? "",
      monthly_budget_usd: params.monthlyBudgetUsd ?? 0,
    }),
  });
}

export type SectorBudgetStatus = "ok" | "warn" | "over" | "sem_orcamento";

export interface SectorMetric {
  sector_id: number;
  sector_name: string;
  agents_count: number;
  has_own_knowledge_base: boolean;
  tokens: number;
  cost_usd: number;
  budget_usd: number;
  usage_percent: number | null;
  status: SectorBudgetStatus;
}

export async function getSectorMetrics(): Promise<SectorMetric[]> {
  return request<SectorMetric[]>("/api/v1/agency/metrics/sectors/");
}

// --- ingestion: fontes de conhecimento (a "Dados corporativos" real) ------

export interface KnowledgeSource {
  id: number;
  name: string;
  source_type: string;
  is_active: boolean;
  last_synced_at: string | null;
}

export async function listKnowledgeSources(): Promise<KnowledgeSource[]> {
  return requestList<KnowledgeSource>("/api/v1/ingestion/sources/");
}

export type ProjectStatus = "pending" | "ready" | "failed";

export interface Project {
  id: number;
  name: string;
  description: string;
  requested_by: number | null;
  requested_by_name: string | null;
  status: ProjectStatus;
  github_repo_url: string;
  github_full_name: string;
  error_message: string;
  created_at: string;
}

export async function listProjects(): Promise<Project[]> {
  return requestList<Project>("/api/v1/agency/projects/");
}

export async function createProject(params: {
  requestingAgentId: number;
  name: string;
  description?: string;
  isPublic?: boolean;
}): Promise<Project> {
  return request<Project>("/api/v1/agency/projects/create/", {
    method: "POST",
    body: JSON.stringify({
      requesting_agent_id: params.requestingAgentId,
      name: params.name,
      description: params.description ?? "",
      private: !params.isPublic,
    }),
  });
}

// --- agency: tasks (ciclo de vida completo) --------------------------

export type TaskStatus = "created" | "in_progress" | "paused_ceo" | "adapted" | "approved" | "rejected";

export interface TaskSnapshot {
  version: number;
  context: Record<string, unknown>;
  created_at: string;
}

export interface Task {
  id: number;
  agent: number;
  agent_name: string;
  project: number | null;
  project_name: string | null;
  brief: string;
  status: TaskStatus;
  progress: number;
  current_files: string[];
  result: Record<string, unknown>;
  version: number;
  task_type: string;
  snapshots: TaskSnapshot[];
  created_at: string;
  updated_at: string;
}

export async function listTasks(params?: { status?: TaskStatus; agentId?: number }): Promise<Task[]> {
  const query = new URLSearchParams();
  if (params?.status) query.set("status", params.status);
  if (params?.agentId) query.set("agent", String(params.agentId));
  const qs = query.toString();
  return requestList<Task>(`/api/v1/agency/tasks/${qs ? `?${qs}` : ""}`);
}

export async function createTask(params: {
  agentId: number;
  brief: string;
  taskType?: string;
  projectId?: number;
}): Promise<Task> {
  return request<Task>("/api/v1/agency/tasks/", {
    method: "POST",
    body: JSON.stringify({
      agent_id: params.agentId,
      brief: params.brief,
      task_type: params.taskType ?? "",
      project_id: params.projectId ?? null,
    }),
  });
}

/** Dispara a execução via o modelo configurado no harness — só funciona a partir de created/adapted. */
export async function executeTask(taskId: number): Promise<Task> {
  return request<Task>(`/api/v1/agency/tasks/${taskId}/execute/`, { method: "POST" });
}

/** CEO pausa a tarefa no meio da execução, com uma instrução do que ajustar. */
export async function interruptTask(taskId: number, instructions: string): Promise<Task> {
  return request<Task>(`/api/v1/agency/tasks/${taskId}/interrupt/`, {
    method: "POST",
    body: JSON.stringify({ instructions }),
  });
}

/** Retoma uma tarefa pausada, com um novo brief — só funciona em paused_ceo. */
export async function adaptTask(taskId: number, newBrief: string): Promise<Task> {
  return request<Task>(`/api/v1/agency/tasks/${taskId}/adapt/`, {
    method: "POST",
    body: JSON.stringify({ new_brief: newBrief }),
  });
}

/** Se a tarefa tiver `project` vinculado, cria branch+PR real no GitHub — `pr_url` vem null senão. */
export async function approveTask(
  taskId: number,
  params?: { files?: Record<string, string>; triggerGit?: boolean },
): Promise<Task & { pr_url: string | null }> {
  return request<Task & { pr_url: string | null }>(`/api/v1/agency/tasks/${taskId}/approve/`, {
    method: "POST",
    body: JSON.stringify({ files: params?.files ?? {}, trigger_git: params?.triggerGit ?? true }),
  });
}

export async function rejectTask(taskId: number, reason?: string): Promise<Task> {
  return request<Task>(`/api/v1/agency/tasks/${taskId}/reject/`, {
    method: "POST",
    body: JSON.stringify({ reason: reason ?? "" }),
  });
}

// --- agency: pending approvals (policy engine) ------------------------

export interface PendingApproval {
  id: number;
  agent: number;
  agent_name: string;
  function_name: string;
  params: Record<string, unknown>;
  risk: string;
  reason: string;
  status: "pending" | "approved" | "rejected";
  result: Record<string, unknown> | null;
  decided_by: number | null;
  decided_by_email: string | null;
  created_at: string;
  decided_at: string | null;
}

export async function listPendingApprovals(status?: "pending" | "approved" | "rejected"): Promise<PendingApproval[]> {
  const query = status ? `?status=${status}` : "";
  return requestList<PendingApproval>(`/api/v1/agency/pending-approvals/${query}`);
}

/** Se aprovado, executa a função de verdade agora (nunca antes) — ver agency.services.decide_pending_approval. */
export async function decidePendingApproval(pendingId: number, approved: boolean): Promise<PendingApproval> {
  return request<PendingApproval>(`/api/v1/agency/pending-approvals/${pendingId}/decide/`, {
    method: "POST",
    body: JSON.stringify({ approved }),
  });
}
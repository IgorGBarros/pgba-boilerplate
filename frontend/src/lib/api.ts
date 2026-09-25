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
  if (res.status === 204 || res.headers.get("content-length") === "0") {
    return undefined as T;
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
  opts: { topK?: number; generateAnswer?: boolean; sourceId?: number } = {},
): Promise<RagQueryResult> {
  return request<RagQueryResult>("/api/v1/ingestion/query/", {
    method: "POST",
    body: JSON.stringify({
      query,
      top_k: opts.topK ?? 5,
      generate_answer: opts.generateAnswer ?? true,
      ...(opts.sourceId !== undefined ? { source_ids: [opts.sourceId] } : {}),
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
  instructions: string;
  default_model: string;
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

export async function createAgent(params: {
  name: string;
  role: string;
  access_level: AgentAccessLevel;
  autonomy_level?: AgentAutonomyLevel;
  sector?: number | null;
  model?: string;
}): Promise<Agent> {
  return request<Agent>("/api/v1/agency/agents/", {
    method: "POST",
    body: JSON.stringify({
      name: params.name,
      role: params.role,
      access_level: params.access_level,
      autonomy_level: params.autonomy_level ?? 0,
      sector: params.sector ?? null,
      model: params.model ?? "",
    }),
  });
}

export async function deleteAgent(id: number): Promise<void> {
  await request<unknown>(`/api/v1/agency/agents/${id}/`, { method: "DELETE" });
}

// --- agency: setores e projetos (visão da empresa no Studio) --------------

export interface Sector {
  id: number;
  name: string;
  description: string;
  monthly_budget_usd: string;
  knowledge_source: number | null;
  knowledge_source_name: string | null;
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

export async function deleteSector(id: number): Promise<void> {
  await request<unknown>(`/api/v1/agency/sectors/${id}/`, { method: "DELETE" });
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
  config: Record<string, unknown>;
  is_active: boolean;
  last_synced_at: string | null;
}

export async function listKnowledgeSources(): Promise<KnowledgeSource[]> {
  return requestList<KnowledgeSource>("/api/v1/ingestion/sources/");
}

export async function createKnowledgeSource(data: {
  name: string;
  source_type: string;
  config?: Record<string, unknown>;
}): Promise<KnowledgeSource> {
  return request<KnowledgeSource>("/api/v1/ingestion/sources/", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateKnowledgeSource(
  id: number,
  data: Partial<{ name: string; config: Record<string, unknown>; is_active: boolean }>,
): Promise<KnowledgeSource> {
  return request<KnowledgeSource>(`/api/v1/ingestion/sources/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function deleteKnowledgeSource(id: number): Promise<void> {
  await request<unknown>(`/api/v1/ingestion/sources/${id}/`, { method: "DELETE" });
}

export async function testKnowledgeSourceConnection(
  id: number,
): Promise<{ ok: boolean; message: string }> {
  return request<{ ok: boolean; message: string }>(
    `/api/v1/ingestion/sources/${id}/test-connection/`,
    { method: "POST" },
  );
}

export async function syncKnowledgeSource(id: number): Promise<void> {
  await request<unknown>(`/api/v1/ingestion/sources/${id}/sync/`, { method: "POST" });
}

export async function updateSector(id: number, data: Partial<{ knowledge_source: number | null }>): Promise<Sector> {
  return request<Sector>(`/api/v1/agency/sectors/${id}/`, { method: "PATCH", body: JSON.stringify(data) });
}

export type DocumentStatus = "pending" | "processing" | "indexed" | "error";

export interface KnowledgeDocument {
  id: number;
  source: number;
  source_name: string;
  external_id: string;
  title: string;
  status: DocumentStatus;
  error_message: string;
  metadata: { uploaded_filename?: string; extraction_warning?: string; [key: string]: unknown };
  indexed_at: string | null;
  updated_at: string;
}

export async function listDocuments(sourceId?: number): Promise<KnowledgeDocument[]> {
  const query = sourceId ? `?source=${sourceId}` : "";
  return requestList<KnowledgeDocument>(`/api/v1/ingestion/documents/${query}`);
}

/**
 * Upload de arquivo de verdade (PDF/imagem/documento) — nunca passa
 * pelo `request()` genérico, porque ele força
 * `Content-Type: application/json`, o que quebra o boundary do
 * multipart. Deixa o navegador montar o header sozinho.
 */
export async function uploadDocumentFile(sourceId: number, file: File): Promise<KnowledgeDocument & { extraction_warning: string }> {
  const token = getAccessToken();
  const formData = new FormData();
  formData.append("source_id", String(sourceId));
  formData.append("file", file);

  const res = await fetch(`${API_URL}/api/v1/ingestion/documents/upload-file/`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.detail ?? body.file?.[0] ?? `Erro ${res.status}`);
  }
  return res.json();
}

export type ProjectStatus = "pending" | "ready" | "failed";

export type ProjectOrigin = "created" | "imported";

export interface Project {
  id: number;
  name: string;
  description: string;
  origin: ProjectOrigin;
  workspace: string;
  local_path: string;
  requested_by: number | null;
  requested_by_name: string | null;
  status: ProjectStatus;
  github_repo_url: string;
  github_full_name: string;
  error_message: string;
  created_at: string;
}

export async function listAgencyProjects(): Promise<Project[]> {
  return requestList<Project>("/api/v1/agency/projects/");
}


export async function createAgencyProject(params: {
  requestingAgentId: number;
  name: string;
  description?: string;
  isPublic?: boolean;
  workspace?: string;
}): Promise<Project> {
  return request<Project>("/api/v1/agency/projects/create/", {
    method: "POST",
    body: JSON.stringify({
      requesting_agent_id: params.requestingAgentId,
      name: params.name,
      description: params.description ?? "",
      private: !params.isPublic,
      workspace: params.workspace ?? "",
    }),
  });
}


/** Registra um projeto que JÁ EXISTIA — nunca cria repositório novo, confirma de verdade que o repositório é acessível antes de marcar como pronto. */
export async function importProject(params: {
  requestingAgentId: number;
  name: string;
  githubFullName: string;
  description?: string;
  workspace?: string;
  localPath?: string;
}): Promise<Project> {
  return request<Project>("/api/v1/agency/projects/import/", {
    method: "POST",
    body: JSON.stringify({
      requesting_agent_id: params.requestingAgentId,
      name: params.name,
      github_full_name: params.githubFullName,
      description: params.description ?? "",
      workspace: params.workspace ?? "",
      local_path: params.localPath ?? "",
    }),
  });
}

/** Atualiza campos editáveis de um projeto (local_path, github_full_name, description, name). */
export async function updateAgencyProject(
  id: number,
  params: { name?: string; description?: string; localPath?: string; githubFullName?: string },
): Promise<Project> {
  const body: Record<string, string> = {};
  if (params.name !== undefined) body.name = params.name;
  if (params.description !== undefined) body.description = params.description;
  if (params.localPath !== undefined) body.local_path = params.localPath;
  if (params.githubFullName !== undefined) body.github_full_name = params.githubFullName;
  return request<Project>(`/api/v1/agency/projects/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(body),
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
  sector_name: string | null;
  project: number | null;
  project_name: string | null;
  project_github_url: string | null;
  brief: string;
  status: TaskStatus;
  progress: number;
  current_files: string[];
  result: Record<string, unknown>;
  version: number;
  task_type: string;
  workspace: string;
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
  workspace?: string;
}): Promise<Task> {
  return request<Task>("/api/v1/agency/tasks/", {
    method: "POST",
    body: JSON.stringify({
      agent_id: params.agentId,
      brief: params.brief,
      task_type: params.taskType ?? "",
      project_id: params.projectId ?? null,
      workspace: params.workspace ?? "",
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

/**
 * Fecha uma Task cujo trabalho de verdade aconteceu FORA do Django —
 * hoje, geração de página via devserver/generator.mjs (Node, roda
 * typecheck/lint de verdade, fora do alcance do backend Python). Nunca
 * chama modelo nenhum no backend — só registra o que já aconteceu.
 */
export async function reportTaskResult(
  taskId: number,
  params: { success: boolean; result: Record<string, unknown>; currentFiles?: string[] },
): Promise<Task> {
  return request<Task>(`/api/v1/agency/tasks/${taskId}/report-result/`, {
    method: "POST",
    body: JSON.stringify({
      success: params.success,
      result: params.result,
      current_files: params.currentFiles ?? [],
    }),
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

// --- agency: policy rules (governança configurável, §13) --------------

export type PolicyRuleRisk = "medium" | "high" | "critical";

export interface PolicyRule {
  id: number;
  sector: number | null;
  sector_name: string | null;
  risk: PolicyRuleRisk;
  min_autonomy_level: AgentAutonomyLevel;
  description: string;
  is_active: boolean;
  created_at: string;
}

export async function listPolicyRules(): Promise<PolicyRule[]> {
  return requestList<PolicyRule>("/api/v1/agency/policy-rules/");
}

export async function createPolicyRule(params: {
  sector: number | null;
  risk: PolicyRuleRisk;
  minAutonomyLevel: AgentAutonomyLevel;
  description?: string;
}): Promise<PolicyRule> {
  return request<PolicyRule>("/api/v1/agency/policy-rules/", {
    method: "POST",
    body: JSON.stringify({
      sector: params.sector,
      risk: params.risk,
      min_autonomy_level: params.minAutonomyLevel,
      description: params.description ?? "",
    }),
  });
}

export async function updatePolicyRule(id: number, params: { isActive: boolean }): Promise<PolicyRule> {
  return request<PolicyRule>(`/api/v1/agency/policy-rules/${id}/`, {
    method: "PATCH",
    body: JSON.stringify({ is_active: params.isActive }),
  });
}

export async function deletePolicyRule(id: number): Promise<void> {
  await request<void>(`/api/v1/agency/policy-rules/${id}/`, { method: "DELETE" });
}

// --- agency: comunicação entre setores (sempre mediada) ----------------

export type SectorMessageStatus = "pending" | "answered" | "rejected";

export interface SectorMessage {
  id: number;
  from_agent: number;
  from_agent_name: string;
  to_sector: number;
  to_sector_name: string;
  relayed_by: number | null;
  relayed_by_name: string | null;
  content: string;
  response: string;
  status: SectorMessageStatus;
  rejection_reason: string;
  created_at: string;
  answered_at: string | null;
}

export async function listSectorMessages(status?: SectorMessageStatus): Promise<SectorMessage[]> {
  const query = status ? `?status=${status}` : "";
  return requestList<SectorMessage>(`/api/v1/agency/sector-messages/${query}`);
}

/** Só registra o pedido (status=pending) — precisa de relay() por um orquestrador pra ser respondida. */
export async function requestSectorMessage(fromAgentId: number, toSectorId: number, content: string): Promise<SectorMessage> {
  return request<SectorMessage>("/api/v1/agency/sector-messages/request/", {
    method: "POST",
    body: JSON.stringify({ from_agent_id: fromAgentId, to_sector_id: toSectorId, content }),
  });
}

/** relayingAgentId precisa ter can_relay=true (sector_orchestrator/general_orchestrator/ceo) — operacional é rejeitado com 403. */
export async function relaySectorMessage(messageId: number, relayingAgentId: number, answeringAgentId?: number): Promise<SectorMessage> {
  return request<SectorMessage>(`/api/v1/agency/sector-messages/${messageId}/relay/`, {
    method: "POST",
    body: JSON.stringify({
      relaying_agent_id: relayingAgentId,
      ...(answeringAgentId ? { answering_agent_id: answeringAgentId } : {}),
    }),
  });
}
// --- orchestration: query logs (auditoria de interações de IA) -----------

export interface QueryLog {
  id: number;
  question: string;
  function_called: string | null;
  params: Record<string, unknown>;
  result: Record<string, unknown>;
  model_used: string;
  status: "ok" | "function_error" | "llm_error" | "rejected";
  created_at: string;
}

export async function listQueryLogs(params?: { status?: string; page?: number; pageSize?: number }): Promise<{ results: QueryLog[]; count: number }> {
  const q = new URLSearchParams();
  if (params?.status) q.set("status", params.status);
  if (params?.page) q.set("page", String(params.page));
  if (params?.pageSize) q.set("page_size", String(params.pageSize));
  const query = q.toString() ? `?${q}` : "";
  const data = await request<QueryLog[] | { results: QueryLog[]; count: number }>(`/api/v1/orchestration/query-logs/${query}`);
  if (Array.isArray(data)) return { results: data, count: data.length };
  return { results: data.results ?? [], count: (data as { count: number }).count ?? 0 };
}

// ─── CRM ──────────────────────────────────────────────────────────────────────

export type MainStage = "lead" | "deal" | "project";

export interface CRMStage {
  id: number;
  pipeline: number;
  main_stage: MainStage;
  name: string;
  position: number;
  color: string;
  is_won: boolean;
  is_lost: boolean;
  leads_count: number;
  deals_count: number;
  projects_count: number;
}

export interface CRMPipeline {
  id: number;
  name: string;
  is_default: boolean;
  stages: CRMStage[];
}

// ─── Custom Fields ────────────────────────────────────────────────────────────

export type CustomFieldType = "text" | "textarea" | "number" | "currency" | "date" | "select" | "multiselect" | "checkbox" | "email" | "phone" | "url";

export interface CustomFieldDefinition {
  id: number;
  entity_type: MainStage;
  name: string;
  key: string;
  field_type: CustomFieldType;
  options: string[];
  required: boolean;
  position: number;
  is_active: boolean;
  created_at: string;
}

export interface CustomFieldValue {
  id: number;
  field_def: number;
  field_name: string;
  field_key: string;
  field_type: CustomFieldType;
  entity_type: string;
  entity_id: number;
  value: unknown;
}

// ─── Lead ─────────────────────────────────────────────────────────────────────

export type LeadOutcome = "" | "convertido" | "perdido" | "cancelado";

export interface CRMLead {
  id: number;
  nome: string;
  empresa: string;
  email: string;
  telefone: string;
  cargo: string;
  valor_estimado: string | null;
  responsavel: string;
  origem: string;
  observacoes: string;
  outcome: LeadOutcome;
  pipeline: number | null;
  stage: number | null;
  position: number;
  stage_name: string | null;
  stage_main: MainStage | null;
  stage_color: string | null;
  stage_is_won: boolean | null;
  stage_is_lost: boolean | null;
  atividades_count: number;
  messages_count: number;
  deals_count: number;
  custom_fields: CustomFieldValue[];
  created_at: string;
}

export interface LeadMessage {
  id: number;
  role: "user" | "agent" | "system";
  content: string;
  created_at: string;
}

// ─── Deal ─────────────────────────────────────────────────────────────────────

export type DealOutcome = "" | "ganho" | "contrato_assinado" | "perdido" | "cancelado";

export interface CRMDeal {
  id: number;
  titulo: string;
  empresa: string;
  responsavel: string;
  valor: string | null;
  moeda: string;
  data_fechamento_previsto: string | null;
  observacoes: string;
  outcome: DealOutcome;
  lead: number | null;
  lead_nome: string | null;
  lead_empresa: string | null;
  pipeline: number | null;
  stage: number | null;
  position: number;
  stage_name: string | null;
  stage_main: MainStage | null;
  stage_color: string | null;
  stage_is_won: boolean | null;
  stage_is_lost: boolean | null;
  projects_count: number;
  custom_fields: CustomFieldValue[];
  created_at: string;
}

// ─── Project ──────────────────────────────────────────────────────────────────

export type ProjectOutcome = "" | "concluido" | "pausado" | "cancelado";

export interface CRMProject {
  id: number;
  titulo: string;
  empresa: string;
  responsavel: string;
  data_inicio: string | null;
  data_fim_previsto: string | null;
  data_fim_realizado: string | null;
  observacoes: string;
  outcome: ProjectOutcome;
  deal: number | null;
  deal_titulo: string | null;
  lead: number | null;
  lead_nome: string | null;
  pipeline: number | null;
  stage: number | null;
  position: number;
  stage_name: string | null;
  stage_main: MainStage | null;
  stage_color: string | null;
  stage_is_won: boolean | null;
  stage_is_lost: boolean | null;
  custom_fields: CustomFieldValue[];
  created_at: string;
}

// ─── Pipeline / Stage ─────────────────────────────────────────────────────────

export async function listCRMPipelines(): Promise<CRMPipeline[]> {
  return requestList<CRMPipeline>("/api/v1/crm/pipelines/");
}

export async function seedDefaultPipeline(): Promise<CRMPipeline> {
  return request<CRMPipeline>("/api/v1/crm/pipelines/seed-default/", { method: "POST" });
}

export async function createStage(data: Omit<CRMStage, "id" | "leads_count" | "deals_count" | "projects_count">): Promise<CRMStage> {
  return request<CRMStage>("/api/v1/crm/stages/", { method: "POST", body: JSON.stringify(data) });
}

export async function updateStage(id: number, data: Partial<CRMStage>): Promise<CRMStage> {
  return request<CRMStage>(`/api/v1/crm/stages/${id}/`, { method: "PATCH", body: JSON.stringify(data) });
}

export async function deleteStage(id: number): Promise<void> {
  await request<unknown>(`/api/v1/crm/stages/${id}/`, { method: "DELETE" });
}

// ─── Custom Fields API ────────────────────────────────────────────────────────

export async function listCustomFieldDefs(entityType?: MainStage): Promise<CustomFieldDefinition[]> {
  const q = entityType ? `?entity_type=${entityType}` : "";
  return requestList<CustomFieldDefinition>(`/api/v1/crm/custom-fields/${q}`);
}

export async function createCustomFieldDef(data: Omit<CustomFieldDefinition, "id" | "created_at">): Promise<CustomFieldDefinition> {
  return request<CustomFieldDefinition>("/api/v1/crm/custom-fields/", { method: "POST", body: JSON.stringify(data) });
}

export async function updateCustomFieldDef(id: number, data: Partial<CustomFieldDefinition>): Promise<CustomFieldDefinition> {
  return request<CustomFieldDefinition>(`/api/v1/crm/custom-fields/${id}/`, { method: "PATCH", body: JSON.stringify(data) });
}

export async function deleteCustomFieldDef(id: number): Promise<void> {
  await request<unknown>(`/api/v1/crm/custom-fields/${id}/`, { method: "DELETE" });
}

export async function bulkUpsertCustomFieldValues(values: Array<{
  field_def: number; entity_type: string; entity_id: number; value: unknown;
}>): Promise<CustomFieldValue[]> {
  return request<CustomFieldValue[]>("/api/v1/crm/custom-field-values/bulk-upsert/", {
    method: "POST",
    body: JSON.stringify({ values }),
  });
}

// ─── Leads ────────────────────────────────────────────────────────────────────

export async function listLeads(params?: { stage?: number; pipeline?: number; search?: string; outcome?: string }): Promise<CRMLead[]> {
  const q = new URLSearchParams();
  if (params?.stage) q.set("stage", String(params.stage));
  if (params?.pipeline) q.set("pipeline", String(params.pipeline));
  if (params?.search) q.set("search", params.search);
  if (params?.outcome !== undefined) q.set("outcome", params.outcome);
  const query = q.toString() ? `?${q}` : "";
  return requestList<CRMLead>(`/api/v1/crm/leads/${query}`);
}

export async function createLead(data: Partial<CRMLead>): Promise<CRMLead> {
  return request<CRMLead>("/api/v1/crm/leads/", { method: "POST", body: JSON.stringify(data) });
}

export async function updateLead(id: number, data: Partial<CRMLead>): Promise<CRMLead> {
  return request<CRMLead>(`/api/v1/crm/leads/${id}/`, { method: "PATCH", body: JSON.stringify(data) });
}

export async function deleteLead(id: number): Promise<void> {
  await request<unknown>(`/api/v1/crm/leads/${id}/`, { method: "DELETE" });
}

export async function moveLead(leadId: number, stageId: number): Promise<CRMLead> {
  return request<CRMLead>(`/api/v1/crm/leads/${leadId}/move/`, {
    method: "POST",
    body: JSON.stringify({ stage_id: stageId }),
  });
}

export async function getLeadMessages(leadId: number): Promise<LeadMessage[]> {
  return request<LeadMessage[]>(`/api/v1/crm/leads/${leadId}/messages/`);
}

export async function qualifyLead(leadId: number, message: string): Promise<{
  response: string;
  closing_suggested: boolean;
  lead_id: number;
}> {
  return request(`/api/v1/crm/leads/${leadId}/qualify/`, {
    method: "POST",
    body: JSON.stringify({ message }),
  });
}

export async function setLeadOutcome(leadId: number, outcome: LeadOutcome): Promise<CRMLead> {
  return request<CRMLead>(`/api/v1/crm/leads/${leadId}/set-outcome/`, {
    method: "POST",
    body: JSON.stringify({ outcome }),
  });
}

export async function convertLeadToDeal(leadId: number, data?: { titulo?: string; responsavel?: string; valor?: string }): Promise<CRMDeal> {
  return request<CRMDeal>(`/api/v1/crm/leads/${leadId}/convert-to-deal/`, {
    method: "POST",
    body: JSON.stringify(data ?? {}),
  });
}

export interface LeadObsidianNote {
  content: string | null;
  exists: boolean;
  path?: string;
  detail?: string;
}

export async function getLeadObsidianNote(leadId: number): Promise<LeadObsidianNote> {
  return request<LeadObsidianNote>(`/api/v1/crm/leads/${leadId}/obsidian-note/`);
}

export interface TokenUsageByChannel {
  channel: string;
  tokens_in: number;
  tokens_out: number;
  total_tokens: number;
  cost_usd: number;
  messages: number;
  leads: number;
}

export interface TokenUsageTopLead {
  lead__id: number;
  lead__nome: string;
  lead__empresa: string;
  lead__origem: string;
  tokens: number;
  cost_usd: number;
  messages: number;
}

export interface TokenUsageSummary {
  period_days: number;
  totals: {
    tokens_in: number;
    tokens_out: number;
    total_tokens: number;
    cost_estimated_usd: number;
    ai_messages: number;
    leads_with_ai: number;
  };
  by_channel: TokenUsageByChannel[];
  top_leads: TokenUsageTopLead[];
}

export async function getCRMTokenUsage(days = 30, channel?: string): Promise<TokenUsageSummary> {
  const params = new URLSearchParams({ days: String(days) });
  if (channel) params.set("channel", channel);
  return request<TokenUsageSummary>(`/api/v1/crm/token-usage/?${params}`);
}


// ─── Deals ────────────────────────────────────────────────────────────────────

export async function listDeals(params?: { stage?: number; pipeline?: number; search?: string; outcome?: string }): Promise<CRMDeal[]> {
  const q = new URLSearchParams();
  if (params?.stage) q.set("stage", String(params.stage));
  if (params?.pipeline) q.set("pipeline", String(params.pipeline));
  if (params?.search) q.set("search", params.search);
  if (params?.outcome !== undefined) q.set("outcome", params.outcome);
  const query = q.toString() ? `?${q}` : "";
  return requestList<CRMDeal>(`/api/v1/crm/deals/${query}`);
}

export async function createDeal(data: Partial<CRMDeal>): Promise<CRMDeal> {
  return request<CRMDeal>("/api/v1/crm/deals/", { method: "POST", body: JSON.stringify(data) });
}

export async function updateDeal(id: number, data: Partial<CRMDeal>): Promise<CRMDeal> {
  return request<CRMDeal>(`/api/v1/crm/deals/${id}/`, { method: "PATCH", body: JSON.stringify(data) });
}

export async function deleteDeal(id: number): Promise<void> {
  await request<unknown>(`/api/v1/crm/deals/${id}/`, { method: "DELETE" });
}

export async function moveDeal(dealId: number, stageId: number): Promise<CRMDeal> {
  return request<CRMDeal>(`/api/v1/crm/deals/${dealId}/move/`, {
    method: "POST",
    body: JSON.stringify({ stage_id: stageId }),
  });
}

export async function setDealOutcome(dealId: number, outcome: DealOutcome): Promise<CRMDeal> {
  return request<CRMDeal>(`/api/v1/crm/deals/${dealId}/set-outcome/`, {
    method: "POST",
    body: JSON.stringify({ outcome }),
  });
}

export async function convertDealToProject(dealId: number, data?: { titulo?: string }): Promise<CRMProject> {
  return request<CRMProject>(`/api/v1/crm/deals/${dealId}/convert-to-project/`, {
    method: "POST",
    body: JSON.stringify(data ?? {}),
  });
}

// ─── Projects ─────────────────────────────────────────────────────────────────

export async function listProjects(params?: { stage?: number; pipeline?: number; search?: string; outcome?: string }): Promise<CRMProject[]> {
  const q = new URLSearchParams();
  if (params?.stage) q.set("stage", String(params.stage));
  if (params?.pipeline) q.set("pipeline", String(params.pipeline));
  if (params?.search) q.set("search", params.search);
  if (params?.outcome !== undefined) q.set("outcome", params.outcome);
  const query = q.toString() ? `?${q}` : "";
  return requestList<CRMProject>(`/api/v1/crm/projects/${query}`);
}

export async function createProject(data: Partial<CRMProject>): Promise<CRMProject> {
  return request<CRMProject>("/api/v1/crm/projects/", { method: "POST", body: JSON.stringify(data) });
}

export async function updateProject(id: number, data: Partial<CRMProject>): Promise<CRMProject> {
  return request<CRMProject>(`/api/v1/crm/projects/${id}/`, { method: "PATCH", body: JSON.stringify(data) });
}

export async function deleteProject(id: number): Promise<void> {
  await request<unknown>(`/api/v1/crm/projects/${id}/`, { method: "DELETE" });
}

export async function moveProject(projectId: number, stageId: number): Promise<CRMProject> {
  return request<CRMProject>(`/api/v1/crm/projects/${projectId}/move/`, {
    method: "POST",
    body: JSON.stringify({ stage_id: stageId }),
  });
}

export async function setProjectOutcome(projectId: number, outcome: ProjectOutcome): Promise<CRMProject> {
  return request<CRMProject>(`/api/v1/crm/projects/${projectId}/set-outcome/`, {
    method: "POST",
    body: JSON.stringify({ outcome }),
  });
}

// ─── CRM Channels ─────────────────────────────────────────────────────────────

export type ChannelType = "whatsapp" | "telegram" | "landing_page" | "meta_ads";

export interface BusinessHoursDay {
  open: boolean;
  start: string;  // "HH:MM"
  end: string;    // "HH:MM"
}

export interface BusinessHours {
  enabled: boolean;
  timezone: string;
  schedule: {
    sun: BusinessHoursDay;
    mon: BusinessHoursDay;
    tue: BusinessHoursDay;
    wed: BusinessHoursDay;
    thu: BusinessHoursDay;
    fri: BusinessHoursDay;
    sat: BusinessHoursDay;
  };
}

export interface ChannelConfig {
  id: number;
  channel: ChannelType;
  is_active: boolean;
  is_paused: boolean;
  config: Record<string, string>;
  webhook_secret: string;
  welcome_message: string;
  quick_replies: string[];
  trigger_phrases: string[];
  target_pipeline: number | null;
  api_key?: string;
  api_key_masked: string;
  webhook_url: string;
  session_timeout_minutes: number;
  session_timeout_message: string;
  business_hours: BusinessHours | Record<string, never>;
  out_of_hours_message: string;
  created_at: string;
  updated_at: string;
}

export async function listChannels(): Promise<ChannelConfig[]> {
  const res = await request<ChannelConfig[] | { results: ChannelConfig[] }>("/api/v1/crm/channels/");
  return Array.isArray(res) ? res : (res as { results: ChannelConfig[] }).results ?? [];
}

export async function createChannel(data: Partial<ChannelConfig>): Promise<ChannelConfig> {
  return request<ChannelConfig>("/api/v1/crm/channels/", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateChannel(id: number, data: Partial<ChannelConfig>): Promise<ChannelConfig> {
  return request<ChannelConfig>(`/api/v1/crm/channels/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function deleteChannel(id: number): Promise<void> {
  return request(`/api/v1/crm/channels/${id}/`, { method: "DELETE" });
}

export async function testChannel(id: number): Promise<{ ok: boolean; message: string; channel: string }> {
  return request(`/api/v1/crm/channels/${id}/test/`, { method: "POST" });
}

// --- agency: agent metrics overview -------------------------------------

export interface AgentMetricsOverview {
  total_agents: number;
  working_now: number;
  paused: number;
  total_cost_usd: number;
}

export async function getAgentMetricsOverview(): Promise<AgentMetricsOverview> {
  return request<AgentMetricsOverview>("/api/v1/agency/metrics/overview/");
}

// Métricas por agente (tokens + custo)
export interface AgentMetric {
  agent_id: number;
  agent_name: string;
  sector_name: string | null;
  tokens: number;
  cost_usd: number;
  interactions_count: number;
}

export async function getAgentMetrics(): Promise<AgentMetric[]> {
  return request<AgentMetric[]>("/api/v1/agency/metrics/agents/");
}

// Deleção de projeto (agency)
export async function deleteAgencyProject(id: number): Promise<void> {
  await request<void>(`/api/v1/agency/projects/${id}/`, { method: "DELETE" });
}


// Atualização de agente (role + skills_md)
export async function updateAgent(
  id: number,
  params: { role?: string; skillsMd?: string; defaultModel?: string },
): Promise<Agent> {
  return request<Agent>(`/api/v1/agency/agents/${id}/`, {
    method: "PATCH",
    body: JSON.stringify({
      ...(params.role !== undefined ? { role: params.role } : {}),
      ...(params.skillsMd !== undefined ? { skills_md: params.skillsMd } : {}),
      ...(params.defaultModel !== undefined ? { default_model: params.defaultModel } : {}),
    }),
  });
}

export async function patchAgentAutonomy(id: number, autonomy_level: number): Promise<Agent> {
  return request<Agent>(`/api/v1/agency/agents/${id}/`, {
    method: "PATCH",
    body: JSON.stringify({ autonomy_level }),
  });
}


// ─── Harness: Credenciais de Provedor de IA ───────────────────────────────
export type AIProvider = "ollama" | "openai" | "anthropic" | "groq" | "openrouter";

export interface AIProviderCredential {
  id: number;
  provider: AIProvider;
  label: string;
  base_url: string;
  api_key_masked: string;
  default_model: string;
  is_active: boolean;
  updated_at: string;
}

export interface AIProviderCredentialInput {
  provider: AIProvider;
  label?: string;
  base_url?: string;
  api_key?: string;
  default_model?: string;
  is_active?: boolean;
}

export async function listAIProviders(): Promise<AIProviderCredential[]> {
  return request<AIProviderCredential[]>("/api/v1/harness/providers/");
}

export async function createAIProvider(data: AIProviderCredentialInput): Promise<AIProviderCredential> {
  return request<AIProviderCredential>("/api/v1/harness/providers/", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function deleteAIProvider(id: number): Promise<void> {
  await request<void>(`/api/v1/harness/providers/${id}/`, { method: "DELETE" });
}

// ─── CRM legacy types (usados por crm.tsx) ────────────────────────────────────

export type LeadStatus = "novo" | "contato" | "qualificado" | "proposta" | "negociacao" | "ganho" | "perdido";
export type LeadOrigem = "site" | "indicacao" | "social" | "evento" | "cold_outreach" | "outro";

export interface Lead {
  id: number;
  nome: string;
  empresa: string;
  email: string;
  telefone: string;
  cargo: string;
  valor_estimado: string | null;
  status: LeadStatus;
  responsavel: string;
  origem: LeadOrigem;
  observacoes: string;
  oportunidades_count: number;
  atividades_count: number;
  created_at: string;
}

export interface Contato {
  id: number;
  nome: string;
  empresa: string;
  cargo: string;
  email: string;
  telefone: string;
  lead: number | null;
  lead_nome: string;
  created_at: string;
}

export interface Oportunidade {
  id: number;
  titulo: string;
  lead: number;
  lead_nome: string;
  lead_empresa: string;
  valor: string;
  status: "prospeccao" | "qualificacao" | "proposta" | "negociacao" | "ganho" | "perdido";
  data_fechamento_previsto: string | null;
  observacoes: string;
  created_at: string;
}

export interface AtividadeCRM {
  id: number;
  titulo: string;
  tipo: "ligacao" | "email" | "reuniao" | "visita" | "proposta" | "outro";
  lead: number;
  lead_nome: string;
  responsavel: string;
  data_hora: string;
  resultado: string;
  created_at: string;
}

export async function listContatos(params?: Record<string, string>): Promise<Contato[]> {
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  return requestList<Contato>(`/api/v1/crm/contatos/${qs}`);
}
export async function createContato(data: Partial<Contato>): Promise<Contato> {
  return request<Contato>("/api/v1/crm/contatos/", { method: "POST", body: JSON.stringify(data) });
}
export async function deleteContato(id: number): Promise<void> {
  await request<void>(`/api/v1/crm/contatos/${id}/`, { method: "DELETE" });
}

export async function listOportunidades(params?: Record<string, string>): Promise<Oportunidade[]> {
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  return requestList<Oportunidade>(`/api/v1/crm/oportunidades/${qs}`);
}
export async function createOportunidade(data: Partial<Oportunidade>): Promise<Oportunidade> {
  return request<Oportunidade>("/api/v1/crm/oportunidades/", { method: "POST", body: JSON.stringify(data) });
}
export async function deleteOportunidade(id: number): Promise<void> {
  await request<void>(`/api/v1/crm/oportunidades/${id}/`, { method: "DELETE" });
}

export async function listAtividadesCRM(params?: Record<string, string>): Promise<AtividadeCRM[]> {
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  return requestList<AtividadeCRM>(`/api/v1/crm/atividades/${qs}`);
}
export async function createAtividadeCRM(data: Partial<AtividadeCRM>): Promise<AtividadeCRM> {
  return request<AtividadeCRM>("/api/v1/crm/atividades/", { method: "POST", body: JSON.stringify(data) });
}

// ─── ERP ──────────────────────────────────────────────────────────────────────

export interface Fornecedor {
  id: number;
  nome: string;
  cnpj: string;
  email: string;
  telefone: string;
  categoria: string;
  observacoes: string;
  created_at: string;
}

export interface OrdemCompra {
  id: number;
  numero: string;
  fornecedor: number;
  fornecedor_nome: string;
  status: "rascunho" | "aprovado" | "enviado" | "recebido" | "cancelado";
  valor_total: string;
  data_emissao: string;
  data_entrega_prevista: string | null;
  observacoes: string;
  created_at: string;
}

export interface ItemEstoque {
  id: number;
  codigo: string;
  nome: string;
  categoria: string;
  quantidade: number;
  quantidade_minima: number;
  unidade: string;
  custo_unitario: string;
  fornecedor: number | null;
  fornecedor_nome: string;
  localizacao: string;
  data_ultima_compra: string | null;
  custo_medio: string;
  valor_total: number;
  abaixo_minimo: boolean;
  created_at: string;
}

export interface LancamentoFinanceiro {
  id: number;
  descricao: string;
  tipo: "receita" | "despesa";
  valor: string;
  vencimento: string;
  status: "pendente" | "pago" | "vencido" | "cancelado";
  categoria: string;
  cliente: string;
  fornecedor_nome: string;
  numero_documento: string;
  created_at: string;
}

export interface Funcionario {
  id: number;
  nome: string;
  cargo: string;
  departamento: string;
  salario: string;
  data_admissao: string;
  data_demissao: string | null;
  status: "ativo" | "ferias" | "afastado" | "desligado";
  email: string;
  cpf: string;
  created_at: string;
}

export async function listFornecedores(): Promise<Fornecedor[]> {
  return requestList<Fornecedor>("/api/v1/erp/fornecedores/");
}
export async function createFornecedor(data: Partial<Fornecedor>): Promise<Fornecedor> {
  return request<Fornecedor>("/api/v1/erp/fornecedores/", { method: "POST", body: JSON.stringify(data) });
}
export async function deleteFornecedor(id: number): Promise<void> {
  await request<void>(`/api/v1/erp/fornecedores/${id}/`, { method: "DELETE" });
}

export async function listOrdensCompra(params?: Record<string, string>): Promise<OrdemCompra[]> {
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  return requestList<OrdemCompra>(`/api/v1/erp/ordens-compra/${qs}`);
}
export async function createOrdemCompra(data: Partial<OrdemCompra>): Promise<OrdemCompra> {
  return request<OrdemCompra>("/api/v1/erp/ordens-compra/", { method: "POST", body: JSON.stringify(data) });
}
export async function updateOrdemCompra(id: number, data: Partial<OrdemCompra>): Promise<OrdemCompra> {
  return request<OrdemCompra>(`/api/v1/erp/ordens-compra/${id}/`, { method: "PATCH", body: JSON.stringify(data) });
}

export async function listEstoque(params?: Record<string, string>): Promise<ItemEstoque[]> {
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  return requestList<ItemEstoque>(`/api/v1/erp/estoque/${qs}`);
}
export async function createItemEstoque(data: Partial<ItemEstoque>): Promise<ItemEstoque> {
  return request<ItemEstoque>("/api/v1/erp/estoque/", { method: "POST", body: JSON.stringify(data) });
}
export async function updateItemEstoque(id: number, data: Partial<ItemEstoque>): Promise<ItemEstoque> {
  return request<ItemEstoque>(`/api/v1/erp/estoque/${id}/`, { method: "PATCH", body: JSON.stringify(data) });
}

export interface MovimentacaoEstoque {
  id: number;
  item: number;
  item_nome: string;
  item_codigo: string;
  tipo: "entrada" | "saida" | "ajuste" | "transferencia";
  tipo_display: string;
  quantidade: number;
  quantidade_anterior: number;
  quantidade_posterior: number;
  valor_unitario: string | null;
  motivo: string;
  referencia: string;
  operador: string;
  created_at: string;
}

export async function listMovimentacoesEstoque(params?: Record<string, string>): Promise<MovimentacaoEstoque[]> {
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  return requestList<MovimentacaoEstoque>(`/api/v1/erp/movimentacoes-estoque/${qs}`);
}

export async function registrarMovimentacao(data: {
  item_id: number;
  tipo: MovimentacaoEstoque["tipo"];
  quantidade: number;
  valor_unitario?: number;
  motivo?: string;
  referencia?: string;
  operador?: string;
}): Promise<MovimentacaoEstoque> {
  return request<MovimentacaoEstoque>("/api/v1/erp/movimentacoes-estoque/registrar/", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function listLancamentosFinanceiros(params?: Record<string, string>): Promise<LancamentoFinanceiro[]> {
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  return requestList<LancamentoFinanceiro>(`/api/v1/erp/financeiro/${qs}`);
}
export async function createLancamentoFinanceiro(data: Partial<LancamentoFinanceiro>): Promise<LancamentoFinanceiro> {
  return request<LancamentoFinanceiro>("/api/v1/erp/financeiro/", { method: "POST", body: JSON.stringify(data) });
}
export async function updateLancamentoFinanceiro(id: number, data: Partial<LancamentoFinanceiro>): Promise<LancamentoFinanceiro> {
  return request<LancamentoFinanceiro>(`/api/v1/erp/financeiro/${id}/`, { method: "PATCH", body: JSON.stringify(data) });
}

export async function listFuncionarios(params?: Record<string, string>): Promise<Funcionario[]> {
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  return requestList<Funcionario>(`/api/v1/erp/funcionarios/${qs}`);
}
export async function createFuncionario(data: Partial<Funcionario>): Promise<Funcionario> {
  return request<Funcionario>("/api/v1/erp/funcionarios/", { method: "POST", body: JSON.stringify(data) });
}
export async function updateFuncionario(id: number, data: Partial<Funcionario>): Promise<Funcionario> {
  return request<Funcionario>(`/api/v1/erp/funcionarios/${id}/`, { method: "PATCH", body: JSON.stringify(data) });
}

// ─── Jurídico ─────────────────────────────────────────────────────────────────

export interface Processo {
  id: number;
  titulo: string;
  tipo: string;
  status: "em_andamento" | "ganho" | "perdido" | "acordo" | "arquivado";
  parte: string;
  advogado: string;
  foro: string;
  risco: "alto" | "medio" | "baixo";
  valor_causa: string;
  prazo_proximo: string | null;
  observacoes: string;
  created_at: string;
}

export interface ContratoJuridico {
  id: number;
  titulo: string;
  tipo: string;
  partes: string;
  data_inicio: string;
  data_fim: string | null;
  valor_anual: string;
  status: "vigente" | "expirando" | "vencido" | "negociacao" | "cancelado";
  renovacao: string;
  observacoes: string;
  created_at: string;
}

export interface Prazo {
  id: number;
  titulo: string;
  tipo: string;
  prazo: string;
  urgencia: "critica" | "alta" | "media" | "baixa";
  responsavel: string;
  descricao: string;
  processo: number | null;
  processo_titulo: string;
  contrato: number | null;
  contrato_titulo: string;
  concluido: boolean;
  created_at: string;
}

export async function listProcessos(params?: Record<string, string>): Promise<Processo[]> {
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  return requestList<Processo>(`/api/v1/juridico/processos/${qs}`);
}
export async function createProcesso(data: Partial<Processo>): Promise<Processo> {
  return request<Processo>("/api/v1/juridico/processos/", { method: "POST", body: JSON.stringify(data) });
}
export async function updateProcesso(id: number, data: Partial<Processo>): Promise<Processo> {
  return request<Processo>(`/api/v1/juridico/processos/${id}/`, { method: "PATCH", body: JSON.stringify(data) });
}
export async function deleteProcesso(id: number): Promise<void> {
  await request<void>(`/api/v1/juridico/processos/${id}/`, { method: "DELETE" });
}

export async function listContratosJuridico(params?: Record<string, string>): Promise<ContratoJuridico[]> {
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  return requestList<ContratoJuridico>(`/api/v1/juridico/contratos/${qs}`);
}
export async function createContratoJuridico(data: Partial<ContratoJuridico>): Promise<ContratoJuridico> {
  return request<ContratoJuridico>("/api/v1/juridico/contratos/", { method: "POST", body: JSON.stringify(data) });
}
export async function updateContratoJuridico(id: number, data: Partial<ContratoJuridico>): Promise<ContratoJuridico> {
  return request<ContratoJuridico>(`/api/v1/juridico/contratos/${id}/`, { method: "PATCH", body: JSON.stringify(data) });
}

export async function listPrazos(params?: Record<string, string>): Promise<Prazo[]> {
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  return requestList<Prazo>(`/api/v1/juridico/prazos/${qs}`);
}
export async function createPrazo(data: Partial<Prazo>): Promise<Prazo> {
  return request<Prazo>("/api/v1/juridico/prazos/", { method: "POST", body: JSON.stringify(data) });
}
export async function updatePrazo(id: number, data: Partial<Prazo>): Promise<Prazo> {
  return request<Prazo>(`/api/v1/juridico/prazos/${id}/`, { method: "PATCH", body: JSON.stringify(data) });
}

// ─── Helpdesk ─────────────────────────────────────────────────────────────────

export interface Ticket {
  id: number;
  titulo: string;
  descricao: string;
  solicitante: string;
  categoria: string;
  prioridade: "critica" | "alta" | "media" | "baixa";
  status: "aberto" | "em_atendimento" | "aguardando" | "resolvido" | "fechado";
  sla_horas: number;
  atendente: string;
  created_at: string;
  resolvido_em: string | null;
}

export interface EquipamentoTI {
  id: number;
  codigo: string;
  nome: string;
  tipo: string;
  usuario: string;
  setor: string;
  status: "ativo" | "manutencao" | "disponivel" | "descarte";
  ultima_revisao: string | null;
  observacoes: string;
  created_at: string;
}

export async function listTickets(params?: Record<string, string>): Promise<Ticket[]> {
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  return requestList<Ticket>(`/api/v1/helpdesk/tickets/${qs}`);
}
export async function createTicket(data: Partial<Ticket>): Promise<Ticket> {
  return request<Ticket>("/api/v1/helpdesk/tickets/", { method: "POST", body: JSON.stringify(data) });
}
export async function updateTicket(id: number, data: Partial<Ticket>): Promise<Ticket> {
  return request<Ticket>(`/api/v1/helpdesk/tickets/${id}/`, { method: "PATCH", body: JSON.stringify(data) });
}

export async function listEquipamentosTI(params?: Record<string, string>): Promise<EquipamentoTI[]> {
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  return requestList<EquipamentoTI>(`/api/v1/helpdesk/equipamentos/${qs}`);
}
export async function createEquipamentoTI(data: Partial<EquipamentoTI>): Promise<EquipamentoTI> {
  return request<EquipamentoTI>("/api/v1/helpdesk/equipamentos/", { method: "POST", body: JSON.stringify(data) });
}
export async function updateEquipamentoTI(id: number, data: Partial<EquipamentoTI>): Promise<EquipamentoTI> {
  return request<EquipamentoTI>(`/api/v1/helpdesk/equipamentos/${id}/`, { method: "PATCH", body: JSON.stringify(data) });
}

// ─── Desenvolvimento ──────────────────────────────────────────────────────────

export interface Sprint {
  id: number;
  nome: string;
  numero: number;
  data_inicio: string;
  data_fim: string;
  status: "planejado" | "ativo" | "concluido" | "cancelado";
  velocidade_planejada: number;
  pontos_concluidos: number;
  pontos_totais: number;
  created_at: string;
}

export interface SprintTask {
  id: number;
  sprint: number;
  sprint_nome: string;
  titulo: string;
  tipo: "feature" | "bug" | "chore";
  pontos: number;
  responsavel: string;
  status: "backlog" | "em_dev" | "review" | "done";
  prioridade: "alta" | "media" | "baixa";
  descricao: string;
  created_at: string;
}

export interface PullRequestDev {
  id: number;
  numero: number;
  titulo: string;
  autor: string;
  branch: string;
  status: "open" | "review" | "merged" | "closed";
  revisoes: number;
  conflitos: boolean;
  data_criacao: string;
  merged_em: string | null;
  created_at: string;
}

export interface Pipeline {
  id: number;
  nome: string;
  status: "success" | "running" | "failed" | "pending" | "cancelled";
  branch: string;
  duracao: string;
  commit_sha: string;
  autor: string;
  executado_em: string;
  created_at: string;
}

export async function listSprints(): Promise<Sprint[]> {
  return requestList<Sprint>("/api/v1/desenvolvimento/sprints/");
}
export async function createSprint(data: Partial<Sprint>): Promise<Sprint> {
  return request<Sprint>("/api/v1/desenvolvimento/sprints/", { method: "POST", body: JSON.stringify(data) });
}

export async function listSprintTasks(params?: Record<string, string>): Promise<SprintTask[]> {
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  return requestList<SprintTask>(`/api/v1/desenvolvimento/tasks/${qs}`);
}
export async function createSprintTask(data: Partial<SprintTask>): Promise<SprintTask> {
  return request<SprintTask>("/api/v1/desenvolvimento/tasks/", { method: "POST", body: JSON.stringify(data) });
}
export async function updateSprintTask(id: number, data: Partial<SprintTask>): Promise<SprintTask> {
  return request<SprintTask>(`/api/v1/desenvolvimento/tasks/${id}/`, { method: "PATCH", body: JSON.stringify(data) });
}

export async function listPullRequests(): Promise<PullRequestDev[]> {
  return requestList<PullRequestDev>("/api/v1/desenvolvimento/pull-requests/");
}
export async function createPullRequest(data: Partial<PullRequestDev>): Promise<PullRequestDev> {
  return request<PullRequestDev>("/api/v1/desenvolvimento/pull-requests/", { method: "POST", body: JSON.stringify(data) });
}
export async function updatePullRequest(id: number, data: Partial<PullRequestDev>): Promise<PullRequestDev> {
  return request<PullRequestDev>(`/api/v1/desenvolvimento/pull-requests/${id}/`, { method: "PATCH", body: JSON.stringify(data) });
}

export async function listPipelines(): Promise<Pipeline[]> {
  return requestList<Pipeline>("/api/v1/desenvolvimento/pipelines/");
}
export async function createPipeline(data: Partial<Pipeline>): Promise<Pipeline> {
  return request<Pipeline>("/api/v1/desenvolvimento/pipelines/", { method: "POST", body: JSON.stringify(data) });
}

// ─── Controladoria ────────────────────────────────────────────────────────────

export interface CentroCusto {
  id: number;
  nome: string;
  codigo: string;
  budget: string;
  realizado: string;
  tendencia: "up" | "down" | "stable";
  desvio: number;
  pct_consumido: number;
  created_at: string;
}

export interface EntradaAuditoria {
  id: number;
  usuario: string;
  modulo: string;
  acao: "CREATE" | "UPDATE" | "DELETE" | "LOGIN" | "EXPORT" | "VIEW";
  recurso: string;
  ip: string | null;
  detalhes: string;
  criticidade: "baixa" | "media" | "alta" | "critica";
  created_at: string;
}

export interface AlertaConformidade {
  id: number;
  titulo: string;
  severidade: "critico" | "alto" | "medio" | "baixo";
  tags: string[];
  descricao: string;
  prazo: string | null;
  status: "aberto" | "em_analise" | "resolvido" | "ignorado";
  created_at: string;
}

export async function listCentrosCusto(): Promise<CentroCusto[]> {
  return requestList<CentroCusto>("/api/v1/controladoria/centros-custo/");
}
export async function createCentroCusto(data: Partial<CentroCusto>): Promise<CentroCusto> {
  return request<CentroCusto>("/api/v1/controladoria/centros-custo/", { method: "POST", body: JSON.stringify(data) });
}
export async function updateCentroCusto(id: number, data: Partial<CentroCusto>): Promise<CentroCusto> {
  return request<CentroCusto>(`/api/v1/controladoria/centros-custo/${id}/`, { method: "PATCH", body: JSON.stringify(data) });
}

export async function listEntradasAuditoria(params?: Record<string, string>): Promise<EntradaAuditoria[]> {
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  return requestList<EntradaAuditoria>(`/api/v1/controladoria/auditoria/${qs}`);
}
export async function createEntradaAuditoria(data: Partial<EntradaAuditoria>): Promise<EntradaAuditoria> {
  return request<EntradaAuditoria>("/api/v1/controladoria/auditoria/", { method: "POST", body: JSON.stringify(data) });
}

export async function listAlertasConformidade(params?: Record<string, string>): Promise<AlertaConformidade[]> {
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  return requestList<AlertaConformidade>(`/api/v1/controladoria/alertas/${qs}`);
}
export async function updateAlertaConformidade(id: number, data: Partial<AlertaConformidade>): Promise<AlertaConformidade> {
  return request<AlertaConformidade>(`/api/v1/controladoria/alertas/${id}/`, { method: "PATCH", body: JSON.stringify(data) });
}

// ─── ERP Fiscal ───────────────────────────────────────────────────────────────

export interface NotaFiscal {
  id: number;
  numero: string;
  cliente: string;
  valor: string;
  cfop: string;
  status: "autorizada" | "pendente" | "cancelada" | "denegada";
  emissao: string;
  created_at: string;
}

export interface ObrigacaoFiscal {
  id: number;
  nome: string;
  orgao: string;
  vencimento: string;
  competencia: string;
  status: "pendente" | "entregue" | "vencida" | "agendada";
  created_at: string;
}

export async function listNotasFiscais(params?: Record<string, string>): Promise<NotaFiscal[]> {
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  return requestList<NotaFiscal>(`/api/v1/erp/notas-fiscais/${qs}`);
}
export async function createNotaFiscal(data: Partial<NotaFiscal>): Promise<NotaFiscal> {
  return request<NotaFiscal>("/api/v1/erp/notas-fiscais/", { method: "POST", body: JSON.stringify(data) });
}

export async function listObrigacoesFiscais(params?: Record<string, string>): Promise<ObrigacaoFiscal[]> {
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  return requestList<ObrigacaoFiscal>(`/api/v1/erp/obrigacoes-fiscais/${qs}`);
}
export async function createObrigacaoFiscal(data: Partial<ObrigacaoFiscal>): Promise<ObrigacaoFiscal> {
  return request<ObrigacaoFiscal>("/api/v1/erp/obrigacoes-fiscais/", { method: "POST", body: JSON.stringify(data) });
}

export interface LinhaDRE {
  id: number;
  conta: string;
  valor_atual: string;
  valor_anterior: string;
  tipo: "receita" | "deducao" | "subtotal" | "custo" | "despesa" | "imposto" | "resultado";
  competencia: string;
  ordem: number;
}

export interface BalancetePeriodo {
  id: number;
  competencia: string;
  ativo_total: string;
  passivo_total: string;
  patrimonio_liquido: string;
}

export async function listLinhasDRE(params?: Record<string, string>): Promise<LinhaDRE[]> {
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  return requestList<LinhaDRE>(`/api/v1/erp/linhas-dre/${qs}`);
}

export async function listBalancete(params?: Record<string, string>): Promise<BalancetePeriodo[]> {
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  return requestList<BalancetePeriodo>(`/api/v1/erp/balancete/${qs}`);
}

// ─── DataLake ─────────────────────────────────────────────────────────────────

export interface SyncEvent {
  id: number;
  source_name: string;
  added: number;
  updated: number;
  removed: number;
  duration_ms: number;
  duration: string;
  status: string;
  error_message: string;
  created_at: string;
}

export interface SchemaTable {
  name: string;
  rows: number;
  columns: { name: string; type: string; nullable: boolean; description: string }[];
  description: string;
}

export interface SchemaApp {
  id: string;
  label: string;
  tables: SchemaTable[];
}

export interface ObsidianNote {
  id: number;
  title: string;
  tags: string[];
  last_modified: string | null;
  chunks: number;
  has_embedding: boolean;
  status: "indexed" | "pending" | "excluded";
}

export async function listSyncEvents(): Promise<SyncEvent[]> {
  return requestList<SyncEvent>("/api/v1/datalake/sync-events/");
}

export async function fetchSchemaCatalog(): Promise<SchemaApp[]> {
  return request<SchemaApp[]>("/api/v1/datalake/schema/");
}

export async function listObsidianNotes(): Promise<ObsidianNote[]> {
  return request<ObsidianNote[]>("/api/v1/datalake/obsidian-notes/");
}

// ─── Scraping ─────────────────────────────────────────────────────────────────

export interface ScrapingJobResult {
  title: string;
  phone?: string;
  emails?: string[];
  website?: string;
  category?: string;
  address?: string;
  review_rating?: number | string;
  review_count?: number;
}

export interface ScrapingJob {
  id: number;
  job_type: string;
  status: "pending" | "running" | "done" | "failed";
  query: string;
  depth: number;
  result_count: number;
  results: ScrapingJobResult[];
  error_message: string;
  created_at: string;
}

export async function createGoogleMapsJob(query: string, depth: number, lat = "", lng = ""): Promise<ScrapingJob> {
  const { job_id } = await request<{ job_id: number }>("/api/v1/scraping/jobs/google-maps/", {
    method: "POST",
    body: JSON.stringify({ query, depth, lat, lng }),
  });
  return getScrapingJob(job_id);
}

export async function getScrapingJob(id: number): Promise<ScrapingJob> {
  return request<ScrapingJob>(`/api/v1/scraping/jobs/${id}/`);
}

export async function importScrapingJobToCRM(id: number, pipelineId?: number): Promise<{ imported: number }> {
  return request<{ imported: number }>(`/api/v1/scraping/jobs/${id}/import/`, {
    method: "POST",
    body: JSON.stringify(pipelineId ? { pipeline_id: pipelineId } : {}),
  });
}

export async function retryScrapingJob(id: number): Promise<ScrapingJob> {
  const res = await request<{ job_id: number }>(`/api/v1/scraping/jobs/${id}/retry/`, { method: "POST" });
  return getScrapingJob(res.job_id);
}

// ─── Compras ──────────────────────────────────────────────────────────────────

export interface FornecedorCompras {
  id: number;
  nome: string;
  categoria: string;
  telefone: string;
  email: string;
  endereco: string;
  cidade: string;
  estado: string;
  latitude: number | null;
  longitude: number | null;
  source: "manual" | "openstreetmap" | "indicado";
  osm_id: string;
  website: string;
  observacoes: string;
  nota_media: number;
  prazo_medio_dias: number | null;
  total_pedidos: number;
  pedidos_no_prazo: number;
  taxa_entrega_prazo: number | null;
  created_at: string;
}

export interface ItemNecessario {
  id: number;
  deal: number;
  nome: string;
  descricao: string;
  quantidade: number;
  unidade: string;
  tem_estoque: boolean;
  quantidade_estoque: number;
  categoria: string;
  quantidade_faltando: number;
}

export interface ItemOrcamento {
  id: number;
  orcamento: number;
  item_necessario: number | null;
  nome: string;
  quantidade: number;
  unidade: string;
  preco_unitario: number | null;
  subtotal: number;
}

export interface Orcamento {
  id: number;
  deal: number;
  fornecedor: number;
  fornecedor_nome: string;
  fornecedor_nota: number;
  status: "rascunho" | "enviado" | "recebido" | "aprovado" | "rejeitado";
  valor_total: number | null;
  prazo_entrega_dias: number | null;
  observacoes: string;
  aprovado_em: string | null;
  aprovado_por: string;
  enviado_em: string | null;
  resposta_em: string | null;
  recomendacao_motivo: string;
  score_recomendacao: number | null;
  itens: ItemOrcamento[];
  created_at: string;
}

export interface RecomendacaoOrcamento {
  orcamento_id: number;
  fornecedor_nome: string;
  valor_total: number;
  prazo_entrega_dias: number | null;
  motivo: string;
  score: number;
}

export interface CentralSuprimentosData {
  criticos: PedidoCompra[];
  pendentes_atencao: PedidoCompra[];
  em_transito: PedidoCompra[];
  entregues_mes: number;
  valor_em_andamento: number;
  orcamentos_aguardando_resposta: Orcamento[];
}

export interface PedidoCompra {
  id: number;
  orcamento: number;
  project: number | null;
  status: "criado" | "enviado" | "confirmado" | "em_transito" | "entregue" | "cancelado";
  numero_pedido: string;
  previsao_entrega: string | null;
  observacoes: string;
  confirmado_em: string | null;
  em_transito_em: string | null;
  entregue_em: string | null;
  fornecedor_nome: string;
  deal_titulo: string;
  valor_total: string | null;
  itens?: Array<{ nome: string; quantidade: number; unidade: string; preco_unitario: string | null; subtotal: number | null }>;
  em_atraso: boolean;
  proximo_status: string | null;
  created_at: string;
}

export async function listFornecedoresCompras(params?: { cidade?: string; search?: string }): Promise<FornecedorCompras[]> {
  const q = new URLSearchParams();
  if (params?.cidade) q.set("cidade", params.cidade);
  if (params?.search) q.set("search", params.search);
  return requestList<FornecedorCompras>(`/api/v1/compras/fornecedores/${q.toString() ? `?${q}` : ""}`);
}

export async function createFornecedorCompras(data: Partial<FornecedorCompras>): Promise<FornecedorCompras> {
  return request<FornecedorCompras>("/api/v1/compras/fornecedores/", { method: "POST", body: JSON.stringify(data) });
}

export async function updateFornecedorCompras(id: number, data: Partial<FornecedorCompras>): Promise<FornecedorCompras> {
  return request<FornecedorCompras>(`/api/v1/compras/fornecedores/${id}/`, { method: "PATCH", body: JSON.stringify(data) });
}

export async function deleteFornecedorCompras(id: number): Promise<void> {
  await request<void>(`/api/v1/compras/fornecedores/${id}/`, { method: "DELETE" });
}

export async function buscarFornecedoresOSM(material: string, cidade: string, raio_km = 10): Promise<FornecedorCompras[]> {
  return request<FornecedorCompras[]>("/api/v1/compras/fornecedores/buscar-osm/", {
    method: "POST",
    body: JSON.stringify({ material, cidade, raio_km }),
  });
}

export async function listItensNecessarios(dealId: number): Promise<ItemNecessario[]> {
  return requestList<ItemNecessario>(`/api/v1/compras/itens-necessarios/?deal=${dealId}`);
}

export async function createItemNecessario(data: Partial<ItemNecessario>): Promise<ItemNecessario> {
  return request<ItemNecessario>("/api/v1/compras/itens-necessarios/", { method: "POST", body: JSON.stringify(data) });
}

export async function updateItemNecessario(id: number, data: Partial<ItemNecessario>): Promise<ItemNecessario> {
  return request<ItemNecessario>(`/api/v1/compras/itens-necessarios/${id}/`, { method: "PATCH", body: JSON.stringify(data) });
}

export async function deleteItemNecessario(id: number): Promise<void> {
  await request<void>(`/api/v1/compras/itens-necessarios/${id}/`, { method: "DELETE" });
}

export async function listOrcamentos(dealId: number): Promise<Orcamento[]> {
  return requestList<Orcamento>(`/api/v1/compras/orcamentos/?deal=${dealId}`);
}

export async function listTodosOrcamentos(params?: { status?: string }): Promise<Orcamento[]> {
  const q = new URLSearchParams();
  if (params?.status) q.set("status", params.status);
  return requestList<Orcamento>(`/api/v1/compras/orcamentos/${q.toString() ? `?${q}` : ""}`);
}

export async function criarOrcamentoCompleto(dealId: number, fornecedorId: number, itens: object[]): Promise<Orcamento> {
  return request<Orcamento>("/api/v1/compras/orcamentos/criar-completo/", {
    method: "POST",
    body: JSON.stringify({ deal_id: dealId, fornecedor_id: fornecedorId, itens }),
  });
}

export async function updateOrcamento(id: number, data: Partial<Pick<Orcamento, "status" | "valor_total" | "prazo_entrega_dias" | "observacoes">>): Promise<Orcamento> {
  return request<Orcamento>(`/api/v1/compras/orcamentos/${id}/`, { method: "PATCH", body: JSON.stringify(data) });
}

export async function deleteOrcamento(id: number): Promise<void> {
  await request<void>(`/api/v1/compras/orcamentos/${id}/`, { method: "DELETE" });
}

export async function enviarOrcamento(id: number): Promise<Orcamento> {
  return request<Orcamento>(`/api/v1/compras/orcamentos/${id}/enviar/`, { method: "POST" });
}

export async function aprovarOrcamento(id: number, aprovado_por: string): Promise<Orcamento> {
  return request<Orcamento>(`/api/v1/compras/orcamentos/${id}/aprovar/`, {
    method: "POST",
    body: JSON.stringify({ aprovado_por }),
  });
}

export async function rejeitarOrcamento(id: number): Promise<Orcamento> {
  return request<Orcamento>(`/api/v1/compras/orcamentos/${id}/rejeitar/`, { method: "POST" });
}

export async function registrarRespostaOrcamento(
  id: number,
  data: { valor_total: number; prazo_entrega_dias: number; itens_precos?: object[]; observacoes?: string }
): Promise<Orcamento> {
  return request<Orcamento>(`/api/v1/compras/orcamentos/${id}/registrar-resposta/`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function gerarPedidoCompra(orcamentoId: number, projectId?: number): Promise<PedidoCompra> {
  return request<PedidoCompra>(`/api/v1/compras/orcamentos/${orcamentoId}/gerar-pedido/`, {
    method: "POST",
    body: JSON.stringify({ project_id: projectId ?? null }),
  });
}

export async function listPedidosCompra(params?: { project?: number; status?: string }): Promise<PedidoCompra[]> {
  const q = new URLSearchParams();
  if (params?.project) q.set("project", String(params.project));
  if (params?.status) q.set("status", params.status);
  return requestList<PedidoCompra>(`/api/v1/compras/pedidos/${q.toString() ? `?${q}` : ""}`);
}

export async function createPedidoCompra(data: {
  orcamento: number;
  status?: PedidoCompra["status"];
  numero_pedido?: string;
  previsao_entrega?: string;
  observacoes?: string;
  project?: number;
}): Promise<PedidoCompra> {
  return request<PedidoCompra>("/api/v1/compras/pedidos/", { method: "POST", body: JSON.stringify(data) });
}

export async function avancarStatusPedido(id: number): Promise<PedidoCompra> {
  return request<PedidoCompra>(`/api/v1/compras/pedidos/${id}/avancar-status/`, { method: "POST" });
}

export async function cancelarPedido(id: number): Promise<PedidoCompra> {
  return request<PedidoCompra>(`/api/v1/compras/pedidos/${id}/cancelar/`, { method: "POST" });
}

export async function recomendarFornecedor(dealId: number): Promise<RecomendacaoOrcamento> {
  return request<RecomendacaoOrcamento>(`/api/v1/compras/orcamentos/recomendar/?deal_id=${dealId}`);
}

export async function getCentralSuprimentos(): Promise<CentralSuprimentosData> {
  return request<CentralSuprimentosData>("/api/v1/compras/central-suprimentos/");
}

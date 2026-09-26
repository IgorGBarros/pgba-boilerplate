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
    throw new ApiError(res.status, body.detail ?? firstFieldError(body) ?? `Erro ${res.status}`, body);
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
    /** Corpo do erro do DRF — erros por campo ficam em `body.<campo>`. */
    public body: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** "campo: mensagem" do primeiro erro de validação do DRF (400 sem `detail`). */
function firstFieldError(body: Record<string, unknown>): string | undefined {
  for (const [field, value] of Object.entries(body ?? {})) {
    const msg = Array.isArray(value) ? value[0] : value;
    if (typeof msg === "string") return field === "non_field_errors" ? msg : `${field}: ${msg}`;
  }
  return undefined;
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
  /** Fontes adicionais além do cérebro principal (ex: HubSpot + Slack no Comercial). */
  extra_knowledge_sources: number[];
  extra_knowledge_source_names: string[];
  /** Todas as fontes que os agentes do setor consultam (principal + adicionais). */
  knowledge_source_ids: number[];
  agents_count: number;
  /** Provedor de IA fixo do setor ("anthropic", "groq"...). Vazio = provedor ativo do tenant. */
  default_provider: string;
  default_model: string;
}

/** Fontes que o setor consulta: principal + adicionais (o backend já manda somadas). */
export function sectorSourceIds(s: Pick<Sector, "knowledge_source" | "knowledge_source_ids">): number[] {
  return s.knowledge_source_ids ?? (s.knowledge_source != null ? [s.knowledge_source] : []);
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
  /** Gasto do mês corrente — é contra ele que o orçamento mensal é comparado. */
  month_cost_usd: number;
  /** Gasto do mês por provedor de IA ("" = interação anterior ao registro de provedor). */
  month_by_provider: ProviderCost[];
  /** Provedor fixo do setor ("" = o do tenant). */
  ai_provider: string;
}

export interface ProviderCost {
  provider: string;
  cost_usd: number;
  tokens: number;
  calls: number;
}

export async function getSectorMetrics(): Promise<SectorMetric[]> {
  return request<SectorMetric[]>("/api/v1/agency/metrics/sectors/");
}

/** Qual IA cada setor usa e se está pronta (credencial + modelo) — sem chamar o provedor. */
export interface AIStatusEntry {
  provider: string;
  ready: boolean;
  detail: string;
}

export interface AIStatus {
  tenant: AIStatusEntry;
  sectors: (AIStatusEntry & { sector_id: number; sector_name: string; model: string; source: "sector" | "tenant" })[];
  agents: (AIStatusEntry & { agent_id: number; agent_name: string; model: string })[];
}

export async function getAIStatus(): Promise<AIStatus> {
  return request<AIStatus>("/api/v1/agency/ai-status/");
}

// --- agency: linha do tempo (replay do dia no Escritório 3D) ---------------

export type TimelineEvent =
  | { kind: "interaction"; at: string; agent_id: number; agent_name: string; text: string; provider: string; cost_usd: number; task_id: number | null }
  | { kind: "task_status"; at: string; task_id: number; agent_id: number; status: TaskStatus; previous_status: TaskStatus | null; finished: boolean; text: string }
  | { kind: "task_finished"; at: string; task_id: number; agent_id: number; text: string }
  | {
      kind: "message_created" | "message_answered" | "message_rejected";
      at: string; message_id: number; agent_id: number; agent_name: string;
      from_sector_id: number | null; to_sector_id: number; to_sector_name: string; text: string; created_at: string;
      relayed_by_id?: number | null; relayed_by_name?: string | null;
    }
  | {
      kind: "approval_created" | "approval_decided";
      at: string; approval_id: number; agent_id: number; agent_name: string; text: string; risk: string;
      status?: "approved" | "rejected";
    };

export interface Timeline {
  since: string;
  until: string;
  events: TimelineEvent[];
  truncated: boolean;
}

/** Resumo do dia escrito pelo CEO, só com fatos registrados (cada fato: id "E#"). */
export interface DailySummaryFact {
  id: string;
  text: string;
  at: string | null;
}

export interface DailySummary {
  since: string;
  until: string;
  facts: DailySummaryFact[];
  summary: string;
  cited: string[];
  /** Citações a fatos que não existem — removidas do texto. */
  invalid_citations: string[];
  author: string | null;
  provider: string | null;
  model: string | null;
}

export async function getDailySummary(params?: { since?: string; until?: string }): Promise<DailySummary> {
  return request<DailySummary>("/api/v1/agency/daily-summary/", { method: "POST", body: JSON.stringify(params ?? {}) });
}

export async function saveDailySummary(params: { markdown: string; facts?: DailySummaryFact[]; day?: string }) {
  return request<{ document_id: number; source_id: number; indexing_queued: boolean }>(
    "/api/v1/agency/daily-summary/save/",
    { method: "POST", body: JSON.stringify(params) },
  );
}

export async function getTimeline(params?: { since?: string; until?: string }): Promise<Timeline> {
  const query = new URLSearchParams();
  if (params?.since) query.set("since", params.since);
  if (params?.until) query.set("until", params.until);
  const qs = query.toString();
  return request<Timeline>(`/api/v1/agency/timeline/${qs ? `?${qs}` : ""}`);
}

// --- ingestion: fontes de conhecimento (a "Dados corporativos" real) ------

export interface KnowledgeSource {
  id: number;
  name: string;
  source_type: string;
  /** Segredos (token, senha) voltam mascarados ("••••1234") — mandar de volta mantém o salvo. */
  config: Record<string, unknown>;
  /** Quais segredos estão salvos (cifrados no servidor). */
  secrets_set: string[];
  /** documents = copia pra busca dos agentes; structured = consultado na hora. */
  mode: "documents" | "structured";
  public_id: string;
  /** Só pra webhook: onde o sistema externo faz POST. */
  webhook_url: string;
  /** Sincronização automática a cada N minutos (null = manual). */
  sync_interval_minutes: number | null;
  last_sync_status: "" | "running" | "ok" | "error";
  last_sync_message: string;
  document_count: number;
  is_active: boolean;
  last_synced_at: string | null;
  created_at: string;
}

export async function listKnowledgeSources(): Promise<KnowledgeSource[]> {
  return requestList<KnowledgeSource>("/api/v1/ingestion/sources/");
}

export async function createKnowledgeSource(data: {
  name: string;
  source_type: string;
  config?: Record<string, unknown>;
  sync_interval_minutes?: number | null;
}): Promise<KnowledgeSource> {
  return request<KnowledgeSource>("/api/v1/ingestion/sources/", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateKnowledgeSource(
  id: number,
  data: Partial<{
    name: string;
    config: Record<string, unknown>;
    is_active: boolean;
    sync_interval_minutes: number | null;
  }>,
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

export async function syncKnowledgeSource(id: number): Promise<{ detail: string; queued: boolean }> {
  return request(`/api/v1/ingestion/sources/${id}/sync/`, { method: "POST" });
}

/** Testa uma configuração antes de salvar (com `id`, segredo mascarado = o salvo). */
export async function testKnowledgeSourceConfig(data: {
  source_type: string;
  config: Record<string, unknown>;
  id?: number;
}): Promise<{ ok: boolean; message: string }> {
  try {
    return await request("/api/v1/ingestion/sources/test-config/", { method: "POST", body: JSON.stringify(data) });
  } catch (err) {
    // 400 traz {ok:false, message} — é resultado do teste, não erro de tela
    if (err instanceof ApiError && typeof err.body?.message === "string") {
      return { ok: false, message: err.body.message };
    }
    throw err;
  }
}

export interface SourceSyncRun {
  id: number;
  trigger: "manual" | "schedule" | "webhook";
  status: "running" | "ok" | "error";
  started_at: string;
  finished_at: string | null;
  created: number;
  updated: number;
  unchanged: number;
  removed: number;
  message: string;
}

export interface ConnectorQuery {
  nome: string;
  descricao: string;
  consulta?: string;
  parametros: string[];
  objeto?: string;
  propriedades?: string;
  filtro_propriedade?: string;
}

export interface SourceOverview {
  documents: { active: number; by_status: Record<string, number>; removed: number };
  recent_documents: { id: number; title: string; status: string; updated_at: string; excerpt: string; error: string }[];
  runs: SourceSyncRun[];
  queries: ConnectorQuery[];
  /** Só conector MCP: ferramentas do servidor e quais estão liberadas. */
  mcp_tools?: McpTool[] | null;
}

export async function getSourceOverview(id: number): Promise<SourceOverview> {
  return request<SourceOverview>(`/api/v1/ingestion/sources/${id}/overview/`);
}

export interface SourceRecord {
  id: number;
  title: string;
  status: string;
  updated_at: string;
  excerpt: string;
  error: string;
}

export interface SourceRecordsPage {
  count: number;
  page: number;
  pages: number;
  results: SourceRecord[];
}

export async function listSourceRecords(id: number, page = 1, search = ""): Promise<SourceRecordsPage> {
  const qs = new URLSearchParams({ page: String(page) });
  if (search.trim()) qs.set("search", search.trim());
  return request<SourceRecordsPage>(`/api/v1/ingestion/sources/${id}/records/?${qs}`);
}

export interface SourceRecordDetail {
  id: number;
  external_id: string;
  title: string;
  status: string;
  error: string;
  content: string;
  metadata: Record<string, unknown>;
  chunks: number;
  indexed_at: string | null;
  updated_at: string;
}

export async function getSourceRecord(id: number, docId: number): Promise<SourceRecordDetail> {
  return request<SourceRecordDetail>(`/api/v1/ingestion/sources/${id}/records/${docId}/`);
}

export interface AgentPreview {
  /** "semantica" = a mesma busca do agente; "texto" = embeddings fora do ar, busca por palavra. */
  mode: "semantica" | "texto";
  notice: string;
  results: { document_id: number | null; title: string; excerpt: string; score: number }[];
}

export async function previewAgentSearch(id: number, question: string): Promise<AgentPreview> {
  return request<AgentPreview>(`/api/v1/ingestion/sources/${id}/agent-preview/`, {
    method: "POST",
    body: JSON.stringify({ question }),
  });
}

export interface QueryTable {
  colunas: string[];
  linhas: unknown[][];
  total_linhas: number;
  truncado: boolean;
}

export async function runSourceQuery(id: number, nome: string, params: Record<string, string>): Promise<QueryTable> {
  return request<QueryTable>(`/api/v1/ingestion/sources/${id}/run-query/`, {
    method: "POST",
    body: JSON.stringify({ nome, params }),
  });
}

export interface SourceAccess {
  source: number;
  /** CEO / Orquestrador-Geral: veem todas as fontes. */
  full_access: string[];
  sectors: { id: number; name: string; agents: number; access: "principal" | "adicional" | null }[];
}

export async function getSourceAccess(sourceId: number): Promise<SourceAccess> {
  return request<SourceAccess>(`/api/v1/agency/source-access/?source=${sourceId}`);
}

/** Define em quais setores a fonte entra como ADICIONAL (o cérebro principal não muda). */
export async function setSourceAccess(sourceId: number, sectors: number[]): Promise<SourceAccess> {
  return request<SourceAccess>("/api/v1/agency/source-access/", {
    method: "POST",
    body: JSON.stringify({ source: sourceId, sectors }),
  });
}

export async function updateSector(
  id: number,
  data: Partial<{ knowledge_source: number | null; default_provider: string; default_model: string }>,
): Promise<Sector> {
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

/** Nó do grafo do "Cérebro": uma nota/documento indexado (só um trecho, nunca o conteúdo inteiro). */
export interface KnowledgeGraphNode {
  id: number;
  title: string;
  path: string;
  folder: string;
  source: number;
  tags: string[];
  status: DocumentStatus;
  updated_at: string | null;
  excerpt: string;
  /** Links desta nota que não apontam pra nenhuma nota indexada (inexistente/privada). */
  broken_links: string[];
}

export interface KnowledgeGraph {
  nodes: KnowledgeGraphNode[];
  /** [de, para] — `[[wikilinks]]` do Obsidian resolvidos entre notas do tenant. */
  edges: Array<[number, number]>;
  /** Links para notas que não existem / não foram indexadas (privadas, fora de include_tags). */
  unresolved: number;
  truncated: boolean;
}

/** Quem usou uma nota como contexto de resposta (AgentInteraction.source_document_ids). */
export interface KnowledgeUsage {
  agent_id: number;
  agent_name: string;
  sector_name: string | null;
  count: number;
  last_at: string;
}

export async function getKnowledgeUsage(documentId: number): Promise<KnowledgeUsage[]> {
  return request<KnowledgeUsage[]>(`/api/v1/agency/knowledge-usage/?document=${documentId}`);
}

/** Uso de TODAS as notas de uma vez (mapa de calor do Cérebro): id → contagem. */
export async function getKnowledgeUsageSummary(days?: number): Promise<Record<string, { count: number; last_at: string }>> {
  const query = days ? `?days=${days}` : "";
  const res = await request<{ documents: Record<string, { count: number; last_at: string }> }>(
    `/api/v1/agency/knowledge-usage/summary/${query}`,
  );
  return res.documents;
}

export async function getKnowledgeGraph(sourceId?: number): Promise<KnowledgeGraph> {
  const query = sourceId ? `?source=${sourceId}` : "";
  return request<KnowledgeGraph>(`/api/v1/ingestion/graph/${query}`);
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
  /** Trabalho rodando fora do Django (ex: geração de página no devserver). */
  runs_externally: boolean;
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
 * Marca que o trabalho vai rodar FORA do Django (agente aparece
 * trabalhando) e devolve qual IA o agente usa — quem gera deve usar a
 * mesma (ex: setor Desenvolvimento → Claude). Fecha com reportTaskResult.
 */
export async function startExternalTask(taskId: number): Promise<Task & { ai_provider: string; ai_model: string }> {
  return request<Task & { ai_provider: string; ai_model: string }>(`/api/v1/agency/tasks/${taskId}/start-external/`, {
    method: "POST",
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
  rejected_at: string | null;
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
  /** Vai virar contrato de serviço no ERP (passa pro projeto criado a partir do negócio). */
  sera_contrato: boolean;
  contrato_com_material: boolean;
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
  /** Será faturado como contrato de serviço no ERP (aparece em ERP → Contratos). */
  sera_contrato: boolean;
  contrato_com_material: boolean;
  /** Contrato do ERP já criado a partir deste projeto. */
  contrato: { id: number; numero: string; status: ContratoStatus } | null;
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

/** Pronto = credencial + modelo resolvidos (sem chamar o provedor). source: de onde vem a chave. */
export interface AIProviderStatus {
  provider: AIProvider;
  ready: boolean;
  detail: string;
  source: "tenant" | "global" | "env" | null;
  default_model: string;
}

export async function getAIProviderStatus(): Promise<{ active_provider: string; providers: AIProviderStatus[] }> {
  return request("/api/v1/harness/providers/status/");
}

export type AIProviderTestResult =
  | { ok: true; model: string; reply: string; latency_ms: number; tokens_in: number; tokens_out: number }
  | { ok: false; error: string };

/** Uma chamada curta de verdade ao provedor (custa poucos tokens). */
export async function testAIProvider(provider: AIProvider, model?: string): Promise<AIProviderTestResult> {
  return request<AIProviderTestResult>("/api/v1/harness/providers/test/", {
    method: "POST",
    body: JSON.stringify({ provider, ...(model ? { model } : {}) }),
  });
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

/** Parceiro de negócio (SAP B1): cliente, fornecedor ou lead num cadastro só. */
export interface ParceiroNegocio {
  id: number;
  tipo: "cliente" | "fornecedor" | "lead";
  tipo_display: string;
  codigo: string;
  nome: string;
  nome_fantasia: string;
  /** CPF sai mascarado (LGPD); CNPJ sai inteiro. */
  cpf_cnpj: string;
  pessoa_fisica: boolean;
  inscricao_estadual: string;
  inscricao_municipal: string;
  email: string;
  telefone: string;
  categoria: string;
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  municipio: string;
  uf: string;
  codigo_municipio_ibge: string;
  observacoes: string;
  created_at: string;
}

/** Nome antigo: fornecedor é um parceiro com `tipo="fornecedor"`. */
export type Fornecedor = ParceiroNegocio;

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
  /** Material controla estoque; serviço não (código LC 116 pra NFS-e). */
  tipo_item: "material" | "servico";
  tipo_item_display: string;
  preco_venda: string;
  ncm: string;
  codigo_servico: string;
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
  data_pagamento: string | null;
  parceiro: number | null;
  parceiro_nome: string;
  contrato: number | null;
  contrato_numero: string;
  projeto: number | null;
  projeto_titulo: string;
  centro_custo: number | null;
  centro_custo_nome: string;
  setor: number | null;
  setor_nome: string;
  origem: "manual" | "contrato" | "compra";
  referencia_origem: string;
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
  /** Sai mascarado (LGPD). */
  cpf: string;
  setor: number | null;
  setor_nome: string;
  centro_custo: number | null;
  centro_custo_nome: string;
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
  numero_cnj: string;
  tipo: string;
  status: "em_andamento" | "suspenso" | "ganho" | "perdido" | "acordo" | "arquivado";
  fase: "conhecimento" | "recursal" | "execucao" | "encerrado";
  instancia: string;
  polo: "ativo" | "passivo" | "terceiro";
  cliente: number | null;
  cliente_nome: string;
  parte: string;
  parte_contraria: string;
  advogado: string;
  tribunal: string;
  foro: string;
  orgao_julgador: string;
  classe: string;
  assunto: string;
  data_distribuicao: string | null;
  risco: "alto" | "medio" | "baixo";
  probabilidade_perda: "provavel" | "possivel" | "remota";
  valor_causa: string;
  valor_estimado_perda: string;
  valor_provisionado: string;
  prazo_proximo: string | null;
  observacoes: string;
  ultima_sincronizacao: string | null;
  sincronizacao_msg: string;
  andamentos_count: number;
  ultimo_andamento: { data: string; descricao: string; origem: string } | null;
  created_at: string;
}

export interface Andamento {
  id: number;
  processo: number;
  data: string;
  descricao: string;
  origem: "manual" | "datajud";
  created_at: string;
}

export interface ContratoJuridico {
  id: number;
  titulo: string;
  tipo: string;
  parceiro: number | null;
  parceiro_nome: string;
  partes: string;
  responsavel: string;
  data_inicio: string;
  data_fim: string | null;
  aviso_dias: number;
  indice_reajuste: string;
  valor_anual: string;
  status: string;
  renovacao: "automatica" | "negociacao" | "nao_renovar";
  observacoes: string;
  dias_para_vencer: number | null;
  created_at: string;
}

export interface Prazo {
  id: number;
  titulo: string;
  tipo: string;
  prazo: string;
  data_inicio: string | null;
  dias: number | null;
  contagem: "uteis" | "corridos";
  urgencia: "critica" | "alta" | "media" | "baixa";
  responsavel: string;
  descricao: string;
  processo: number | null;
  processo_titulo: string;
  processo_numero: string;
  contrato: number | null;
  contrato_titulo: string;
  concluido: boolean;
  concluido_em: string | null;
  dias_restantes: number | null;
  created_at: string;
}

export interface PainelJuridico {
  processos_ativos: number;
  valor_em_disputa: string;
  provisao: string;
  contingencia_possivel: string;
  contingencia_remota: string;
  taxa_exito: number | null;
  encerrados: number;
  prazos_vencidos: number;
  prazos_7_dias: number;
  contratos_vigentes: number;
  contratos_vencendo_30: number;
  assinaturas_pendentes: number;
  por_tipo: { tipo: string; n: number }[];
  proximos_prazos: Prazo[];
  contratos_a_vencer: ContratoJuridico[];
}

export async function getPainelJuridico(): Promise<PainelJuridico> {
  return request<PainelJuridico>("/api/v1/juridico/painel/");
}
export async function listAndamentos(processo: number): Promise<Andamento[]> {
  return requestList<Andamento>(`/api/v1/juridico/andamentos/?processo=${processo}&page_size=500&ordering=-data`);
}
export async function createAndamento(data: { processo: number; data: string; descricao: string }): Promise<Andamento> {
  return request<Andamento>("/api/v1/juridico/andamentos/", { method: "POST", body: JSON.stringify(data) });
}
export async function syncDataJud(processo: number): Promise<{ novos: number; mensagem: string }> {
  return request(`/api/v1/juridico/processos/${processo}/sincronizar/`, { method: "POST" });
}
export async function calcularPrazo(inicio: string, dias: number, contagem: "uteis" | "corridos") {
  return request<{ vencimento: string; pulados: { data: string; motivo: string }[] }>(
    "/api/v1/juridico/prazos/calcular/", { method: "POST", body: JSON.stringify({ inicio, dias, contagem }) },
  );
}
export async function listPrazos(params?: Record<string, string>): Promise<Prazo[]> {
  const qs = new URLSearchParams({ page_size: "500", ...(params ?? {}) }).toString();
  return requestList<Prazo>(`/api/v1/juridico/prazos/?${qs}`);
}
export async function updatePrazo(id: number, data: Partial<Prazo>): Promise<Prazo> {
  return request<Prazo>(`/api/v1/juridico/prazos/${id}/`, { method: "PATCH", body: JSON.stringify(data) });
}

export interface ModeloDocumento {
  id: number;
  nome: string;
  tipo: string;
  descricao: string;
  corpo: string;
  campos: string[];
  created_at: string;
}
export interface DocumentoJuridico {
  id: number;
  titulo: string;
  tipo: string;
  status: "rascunho" | "final" | "em_assinatura" | "assinado";
  processo: number | null;
  processo_titulo: string;
  contrato: number | null;
  contrato_titulo: string;
  modelo: number | null;
  conteudo: string;
  nome_arquivo: string;
  tamanho: number;
  sha256: string;
  versao: number;
  tem_arquivo: boolean;
  assinaturas: { id: number; status: string }[];
  created_at: string;
  updated_at: string;
}
export async function listModelos(): Promise<ModeloDocumento[]> {
  return requestList<ModeloDocumento>("/api/v1/juridico/modelos/?page_size=500");
}
export async function criarModelosPadrao(): Promise<{ criados: number }> {
  return request("/api/v1/juridico/modelos/padrao/", { method: "POST" });
}
export async function gerarDocumento(modelo: number, data: { titulo?: string; processo?: number | null; contrato?: number | null; parceiro?: number | null }) {
  return request<DocumentoJuridico & { faltando: string[] }>(`/api/v1/juridico/modelos/${modelo}/gerar/`, {
    method: "POST", body: JSON.stringify(data),
  });
}
export async function listDocumentosJuridicos(params: Record<string, string> = {}): Promise<DocumentoJuridico[]> {
  const qs = new URLSearchParams({ page_size: "500", ...params }).toString();
  return requestList<DocumentoJuridico>(`/api/v1/juridico/documentos/?${qs}`);
}
export async function updateDocumentoJuridico(id: number, data: Partial<DocumentoJuridico>): Promise<DocumentoJuridico> {
  return request<DocumentoJuridico>(`/api/v1/juridico/documentos/${id}/`, { method: "PATCH", body: JSON.stringify(data) });
}
export async function deleteDocumentoJuridico(id: number): Promise<void> {
  await request<void>(`/api/v1/juridico/documentos/${id}/`, { method: "DELETE" });
}
/** Upload de PDF (multipart — não passa pelo `request`, que manda JSON). */
export async function uploadDocumentoJuridico(form: FormData): Promise<DocumentoJuridico> {
  const token = getAccessToken();
  const res = await fetch(`${API_URL}/api/v1/juridico/documentos/`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.detail ?? firstFieldError(body) ?? `Erro ${res.status}`, body);
  return body as DocumentoJuridico;
}
/** Baixa um arquivo (PDF) da API com o login — pra mostrar num <iframe> via blob URL. */
export async function fetchBlob(path: string, auth = true): Promise<Blob> {
  const token = auth ? getAccessToken() : null;
  const res = await fetch(`${API_URL}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.detail ?? `Erro ${res.status}`, body);
  }
  return res.blob();
}

export interface SignatarioInfo {
  id: number;
  nome: string;
  email: string;
  cpf_mascarado: string;
  papel: string;
  papel_display: string;
  ordem: number;
  status: "pendente" | "visualizou" | "assinou" | "recusou";
  convite_enviado_em: string | null;
  visualizado_em: string | null;
  assinado_em: string | null;
  ip: string | null;
  recusa_motivo: string;
}
export interface SolicitacaoAssinatura {
  id: number;
  documento: number;
  documento_titulo: string;
  titulo: string;
  mensagem: string;
  status: "rascunho" | "enviada" | "concluida" | "recusada" | "cancelada" | "expirada";
  provedor: string;
  exigir_codigo_email: boolean;
  ordem_sequencial: boolean;
  expira_em: string | null;
  hash_original: string;
  hash_assinado: string;
  enviada_em: string | null;
  concluida_em: string | null;
  criado_por: string;
  signatarios: SignatarioInfo[];
  assinados: { feitos: number; total: number };
  created_at: string;
  envio?: { convites_enviados: number; sem_email: boolean } | null;
}
export interface NovoSignatario {
  nome: string;
  email: string;
  cpf?: string;
  papel: string;
}
export async function listAssinaturas(params: Record<string, string> = {}): Promise<SolicitacaoAssinatura[]> {
  const qs = new URLSearchParams({ page_size: "500", ...params }).toString();
  return requestList<SolicitacaoAssinatura>(`/api/v1/juridico/assinaturas/?${qs}`);
}
export async function criarAssinatura(data: {
  documento: number; titulo?: string; mensagem?: string; exigir_codigo_email: boolean;
  ordem_sequencial: boolean; expira_dias: number; signatarios: NovoSignatario[];
}): Promise<SolicitacaoAssinatura> {
  return request<SolicitacaoAssinatura>("/api/v1/juridico/assinaturas/", { method: "POST", body: JSON.stringify(data) });
}
export async function cancelarAssinatura(id: number, motivo = ""): Promise<SolicitacaoAssinatura> {
  return request(`/api/v1/juridico/assinaturas/${id}/cancelar/`, { method: "POST", body: JSON.stringify({ motivo }) });
}
export async function linksAssinatura(id: number): Promise<{ signatario: number; nome: string; email: string; status: string; link: string }[]> {
  return request(`/api/v1/juridico/assinaturas/${id}/links/`);
}
export async function reenviarConvite(id: number, signatario: number): Promise<{ enviado: boolean }> {
  return request(`/api/v1/juridico/assinaturas/${id}/reenviar/`, { method: "POST", body: JSON.stringify({ signatario }) });
}
export async function eventosAssinatura(id: number): Promise<{
  trilha_integra: boolean;
  eventos: { id: number; tipo: string; detalhe: string; signatario_nome: string; ip: string | null; hash_encadeado: string; created_at: string }[];
}> {
  return request(`/api/v1/juridico/assinaturas/${id}/eventos/`);
}

// Página pública de assinatura (sem login)
export interface AssinarInfo {
  titulo: string;
  mensagem: string;
  empresa: string;
  remetente: string;
  hash_original: string;
  expira_em: string | null;
  status: string;
  exigir_codigo_email: boolean;
  pedir_cpf: boolean;
  signatario: { nome: string; email: string; papel: string; status: string };
  bloqueio: string | null;
  concluida: boolean;
  hash_assinado: string;
  outros: { nome: string; status: string }[];
}
async function publicRequest<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.detail ?? `Erro ${res.status}`, data);
  return data as T;
}
export const assinarPublico = {
  info: (token: string) => publicRequest<AssinarInfo>(`/api/v1/juridico/assinar/${token}/`),
  codigo: (token: string) => publicRequest<{ ok: boolean; email: string }>(`/api/v1/juridico/assinar/${token}/codigo/`, {}),
  assinar: (token: string, data: { nome: string; cpf?: string; codigo?: string; aceite: boolean }) =>
    publicRequest<{ ok: boolean; concluida: boolean; hash_assinado: string }>(`/api/v1/juridico/assinar/${token}/assinar/`, data),
  recusar: (token: string, motivo: string) => publicRequest<{ ok: boolean }>(`/api/v1/juridico/assinar/${token}/recusar/`, { motivo }),
  pdf: (token: string, assinada = false) => fetchBlob(`/api/v1/juridico/assinar/${token}/pdf/${assinada ? "?via=assinada" : ""}`, false),
};
export interface VerificacaoAssinatura {
  encontrado: boolean;
  hash: string;
  arquivo?: string;
  titulo?: string;
  status?: string;
  concluida_em?: string | null;
  hash_original?: string;
  hash_assinado?: string;
  trilha_integra?: boolean;
  signatarios?: { nome: string; papel: string; status: string; assinado_em: string | null; email: string }[];
}
export async function verificarDocumento(arquivo: File): Promise<VerificacaoAssinatura> {
  const form = new FormData();
  form.append("arquivo", arquivo);
  const res = await fetch(`${API_URL}/api/v1/juridico/verificar/`, { method: "POST", body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.detail ?? `Erro ${res.status}`, data);
  return data as VerificacaoAssinatura;
}

// ─── TI: helpdesk + observabilidade ───────────────────────────────────────────

export type PrioridadeChamado = "critica" | "alta" | "media" | "baixa";
export type StatusChamado = "aberto" | "em_atendimento" | "aguardando" | "resolvido" | "fechado";
export type StatusSaude = "ok" | "alerta" | "falha" | "desconhecido";

export interface Ticket {
  id: number;
  titulo: string;
  descricao: string;
  solicitante: string;
  categoria: string;
  prioridade: PrioridadeChamado;
  status: StatusChamado;
  sla_horas: number;
  prazo_sla: string | null;
  sla_restante_min: number | null;
  sla_estourado: boolean;
  atendente: string;
  setor: number | null;
  setor_nome: string;
  agente: number | null;
  agente_nome: string;
  agente_status: string;
  task: number | null;
  task_status: string;
  task_progresso: number | null;
  origem: "manual" | "incidente" | "agente" | "email";
  incidente_id: number | null;
  primeira_resposta_em: string | null;
  solucao: string;
  interacoes_count: number;
  created_at: string;
  resolvido_em: string | null;
}

export interface FatoTI { id: string; texto: string }
export interface SugestaoIA {
  resposta?: string;
  passos?: string[];
  perguntas?: string[];
  prioridade_sugerida?: string;
  encaminhar_para?: string;
  fatos?: FatoTI[];
  citacoes_invalidas?: string[];
  agente?: { id: number; nome: string };
  diagnostico?: DiagnosticoTI;
}
export interface DiagnosticoTI {
  causa_provavel?: string;
  evidencias?: string[];
  impacto?: string;
  acoes?: string[];
  prevencao?: string[];
  confianca?: string;
  fatos?: FatoTI[];
  citacoes_invalidas?: string[];
  agente?: { id: number; nome: string };
  gerado_em?: string;
  erro?: string;
}

export interface InteracaoChamado {
  id: number;
  ticket: number;
  tipo: "comentario" | "resposta" | "ia" | "sistema";
  tipo_display: string;
  autor: string;
  texto: string;
  dados: SugestaoIA;
  created_at: string;
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

export interface AgenteTI {
  id: number;
  nome: string;
  cargo: string;
  papel: string;
  nivel: string;
  work_status: string;
  tarefa_atual: string;
  chamados_abertos: number;
  tem_skill: boolean;
}
export interface EquipeTI {
  setor: { id: number; nome: string } | null;
  agentes: AgenteTI[];
  papeis: { papel: string; nome: string; cargo: string }[];
}

export interface PainelTI {
  abertos: number;
  por_status: Record<string, number>;
  por_prioridade: Record<string, number>;
  por_categoria: Record<string, number>;
  por_origem: Record<string, number>;
  sla_estourado: number;
  sla_vencendo: number;
  sem_resposta: number;
  mes: { abertos: number; resolvidos: number; no_prazo_pct: number | null; primeira_resposta_min: number | null; resolucao_min: number | null };
  tem_time: boolean;
}

export interface Componente {
  id: number;
  chave: string;
  grupo: string;
  nome: string;
  status: StatusSaude;
  detalhe: string;
  causa: string;
  acao: string;
  dados: Record<string, unknown>;
  ms: number | null;
  desde: string;
  verificado_em: string;
  plataforma: boolean;
  disponibilidade_24h: number | null;
}

export interface Incidente {
  id: number;
  chave: string;
  grupo: string;
  titulo: string;
  gravidade: "critica" | "alta" | "media" | "baixa";
  status: "aberto" | "resolvido";
  aberto_em: string;
  resolvido_em: string | null;
  duracao_min: number;
  detalhe: string;
  causa: string;
  acao: string;
  dados: Record<string, unknown>;
  diagnostico: DiagnosticoTI;
  chamado_id: number | null;
  reconhecido_por: string;
  reconhecido_em: string | null;
  plataforma: boolean;
  amostras?: { em: string; status: StatusSaude; ms: number | null }[];
}

export interface ResumoMetrica { total: number; erros: number; taxa_erro: number; ms_medio: number | null }
export interface PainelObs {
  staff: boolean;
  contagem: Record<StatusSaude, number>;
  componentes: Componente[];
  incidentes_abertos: Incidente[];
  api_24h: ResumoMetrica;
  ia_24h: ResumoMetrica;
  erros_abertos: number | null;
  ultima_verificacao: string | null;
}
export interface LinhaMetrica {
  chave: string;
  total: number;
  erros: number;
  erros_cliente: number;
  taxa_erro: number;
  ms_medio: number | null;
  ms_max: number;
}
export interface Metricas {
  tipo: "api" | "ia" | "http";
  horas: number;
  linhas: LinhaMetrica[];
  serie: { hora: string; total: number; erros: number; ms_medio: number | null }[];
}
export interface EventoErro {
  id: number;
  logger: string;
  nivel: string;
  mensagem: string;
  trace: string;
  origem: string;
  ocorrencias: number;
  primeiro: string;
  ultimo: string;
  resolvido: boolean;
}
export interface AgenteObs {
  id: number;
  nome: string;
  cargo: string;
  setor_id: number | null;
  setor: string;
  work_status: string;
  tarefa_atual: string;
  autonomia: number;
  chamadas: number;
  custo_usd: number;
  tokens: number;
  ultima_atividade: string | null;
  provedor: string;
  tarefas: Record<string, number>;
  falhas: number;
  presas: number;
  aprovacoes_pendentes: number;
  saude: StatusSaude;
}
export interface SetorObs {
  setor: string;
  setor_id: number | null;
  agentes: number;
  trabalhando: number;
  chamadas: number;
  custo_usd: number;
  falhas: number;
  alertas: number;
}
export interface SaudePublica {
  status: StatusSaude;
  verificado_em: string;
  componentes: { nome: string; status: StatusSaude; causa: string; acao: string }[];
}

const HD = "/api/v1/helpdesk";
const OBS = "/api/v1/observabilidade";
const tiPost = <T>(path: string, body: unknown = {}) => request<T>(path, { method: "POST", body: JSON.stringify(body) });
const tiQs = (p?: Record<string, string>) => (p && Object.keys(p).length ? "?" + new URLSearchParams(p).toString() : "");

export const ti = {
  // Chamados (cada um carrega uma Task real do agente de TI)
  chamados: (params?: Record<string, string>) => requestList<Ticket>(`${HD}/tickets/${tiQs({ page_size: "500", ...params })}`),
  chamado: (id: number) => request<Ticket>(`${HD}/tickets/${id}/`),
  abrir: (data: { titulo: string; descricao?: string; categoria?: string; prioridade?: string; solicitante?: string; setor?: number | null }) =>
    tiPost<Ticket>(`${HD}/tickets/`, data),
  interacoes: (id: number) => request<InteracaoChamado[]>(`${HD}/tickets/${id}/interacoes/`),
  atenderIA: (id: number, instrucoes = "") => tiPost<InteracaoChamado>(`${HD}/tickets/${id}/atender-ia/`, { instrucoes }),
  responder: (id: number, texto: string, aguardar = false) => tiPost<InteracaoChamado>(`${HD}/tickets/${id}/responder/`, { texto, aguardar }),
  comentar: (id: number, texto: string) => tiPost<InteracaoChamado>(`${HD}/tickets/${id}/comentar/`, { texto }),
  resolver: (id: number, solucao: string) => tiPost<Ticket>(`${HD}/tickets/${id}/resolver/`, { solucao }),
  reabrir: (id: number, motivo = "") => tiPost<Ticket>(`${HD}/tickets/${id}/reabrir/`, { motivo }),
  fechar: (id: number) => tiPost<Ticket>(`${HD}/tickets/${id}/fechar/`),
  atribuir: (id: number, papel: string) => tiPost<Ticket>(`${HD}/tickets/${id}/atribuir/`, { papel }),
  prioridade: (id: number, prioridade: string) => tiPost<Ticket>(`${HD}/tickets/${id}/prioridade/`, { prioridade }),
  painel: () => request<PainelTI>(`${HD}/painel/`),
  equipe: () => request<EquipeTI>(`${HD}/equipe/`),
  montarEquipe: () => tiPost<{ setor: number; setor_criado: boolean; criados: string[]; existentes: string[] }>(`${HD}/equipe/`),
  agentes: (horas = 24) => request<{ horas: number; agentes: AgenteObs[]; setores: SetorObs[] }>(`${HD}/agentes/?horas=${horas}`),
  diagnosticar: (incidenteId: number) => tiPost<DiagnosticoTI>(`${HD}/incidentes/${incidenteId}/diagnosticar/`),
  // Observabilidade
  obs: () => request<PainelObs>(`${OBS}/painel/`),
  verificar: () => tiPost<Componente[]>(`${OBS}/verificar/`),
  incidentes: (status?: string) => request<Incidente[]>(`${OBS}/incidentes/${tiQs(status ? { status } : undefined)}`),
  incidente: (id: number) => request<Incidente>(`${OBS}/incidentes/${id}/`),
  reconhecer: (id: number) => tiPost<Incidente>(`${OBS}/incidentes/${id}/`),
  metricas: (tipo: "api" | "ia" | "http", horas = 24) => request<Metricas>(`${OBS}/metricas/?tipo=${tipo}&horas=${horas}`),
  erros: (todos = false) => request<EventoErro[]>(`${OBS}/erros/${todos ? "?todos=1" : ""}`),
  resolverErros: (ids: number[]) => tiPost<{ resolvidos: number }>(`${OBS}/erros/`, { ids }),
};

/** Status público da plataforma — sem login (funciona com o banco fora). */
export async function saudePublica(): Promise<SaudePublica> {
  const res = await fetch(`${API_URL}${OBS}/saude/`);
  return (await res.json()) as SaudePublica;
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
  tipo: "nfse" | "nfe";
  tipo_display: string;
  numero: string;
  serie: string;
  cliente: string;
  parceiro: number | null;
  contrato: number | null;
  contrato_numero: string;
  lancamento: number | null;
  valor: string;
  cfop: string;
  codigo_servico: string;
  discriminacao: string;
  aliquota_iss: string;
  valor_iss: string;
  chave_acesso: string;
  /** `rascunho` = montada no ERP, não transmitida (ver docs/NOTA_FISCAL.md). */
  status: "rascunho" | "autorizada" | "pendente" | "cancelada" | "denegada";
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


// ─── ERP (SAP B1): CRUD genérico, contratos de serviço, dados fiscais ─────────
//
// Todo cadastro do ERP segue o mesmo contrato REST (ModelViewSet com exclusão
// lógica), então a tela usa estas 4 funções pra qualquer um deles em vez de
// uma função por recurso. `page_size` até 500 (erp.views.ErpPagination).

export type ErpResource =
  | "parceiros"
  | "estoque"
  | "financeiro"
  | "funcionarios"
  | "notas-fiscais"
  | "obrigacoes-fiscais"
  | "linhas-dre"
  | "balancete"
  | "contratos"
  | "contratos-itens"
  // Outros módulos com o mesmo CRUD genérico (ErpCrud): caminho completo depois de /api/v1/
  | `juridico/${"processos" | "andamentos" | "contratos" | "prazos" | "modelos" | "documentos"}`
  | "helpdesk/equipamentos";

/** "parceiros" → /api/v1/erp/parceiros ; "juridico/prazos" → /api/v1/juridico/prazos */
const erpBase = (resource: ErpResource) => (resource.includes("/") ? `/api/v1/${resource}` : `/api/v1/erp/${resource}`);

export interface ErpPage<T> {
  results: T[];
  count: number;
}

export async function erpList<T>(resource: ErpResource, params: Record<string, string> = {}): Promise<ErpPage<T>> {
  const qs = new URLSearchParams({ page_size: "500", ...params }).toString();
  const data = await request<T[] | { results: T[]; count: number }>(`${erpBase(resource)}/?${qs}`);
  if (Array.isArray(data)) return { results: data, count: data.length };
  return { results: data.results ?? [], count: data.count ?? 0 };
}
export async function erpCreate<T>(resource: ErpResource, data: Record<string, unknown>): Promise<T> {
  return request<T>(`${erpBase(resource)}/`, { method: "POST", body: JSON.stringify(data) });
}
export async function erpUpdate<T>(resource: ErpResource, id: number, data: Record<string, unknown>): Promise<T> {
  return request<T>(`${erpBase(resource)}/${id}/`, { method: "PATCH", body: JSON.stringify(data) });
}
/** Exclusão lógica no backend (`is_active=False`) — o histórico continua. */
export async function erpDelete(resource: ErpResource, id: number): Promise<void> {
  await request<void>(`${erpBase(resource)}/${id}/`, { method: "DELETE" });
}

export type ContratoStatus = "rascunho" | "ativo" | "suspenso" | "encerrado" | "cancelado";

export interface ItemContrato {
  id: number;
  contrato: number;
  item: number | null;
  item_codigo: string;
  tipo: "servico" | "material";
  descricao: string;
  quantidade: string;
  valor_unitario: string;
  valor_total: string;
  quantidade_baixada: string;
}

export interface ContratoServico {
  id: number;
  numero: string;
  nome_projeto: string;
  descricao: string;
  parceiro: number;
  parceiro_nome: string;
  projeto: number | null;
  projeto_titulo: string;
  com_material: boolean;
  data_inicio: string;
  data_fim: string;
  valor_total: string;
  periodicidade: "unica" | "mensal" | "trimestral" | "anual";
  dia_vencimento: number;
  status: ContratoStatus;
  status_display: string;
  centro_custo: number | null;
  centro_custo_nome: string;
  setor: number | null;
  setor_nome: string;
  responsavel: string;
  observacoes: string;
  itens: ItemContrato[];
  faturado: number;
  recebido: number;
  notas_fiscais: { id: number; numero: string; status: NotaFiscal["status"]; valor: number }[];
  created_at: string;
}

export interface ParcelaPrevista {
  parcela: number;
  total_parcelas: number;
  vencimento: string;
  valor: string;
}

export interface ProjetoAguardandoContrato {
  id: number;
  titulo: string;
  empresa: string;
  responsavel: string;
  data_inicio: string | null;
  data_fim_previsto: string | null;
  valor: number | null;
  contrato_com_material: boolean;
  observacoes: string;
}

export type ContratoAcao = "ativar" | "suspender" | "encerrar" | "cancelar";

export async function contratoAcao(id: number, acao: ContratoAcao): Promise<ContratoServico> {
  return request<ContratoServico>(`/api/v1/erp/contratos/${id}/${acao}/`, { method: "POST" });
}
export async function getContrato(id: number): Promise<ContratoServico> {
  return request<ContratoServico>(`/api/v1/erp/contratos/${id}/`);
}
export async function contratoParcelas(id: number): Promise<ParcelaPrevista[]> {
  return request<ParcelaPrevista[]>(`/api/v1/erp/contratos/${id}/parcelas/`);
}
export async function contratoGerarFaturas(
  id: number,
): Promise<{ criadas: LancamentoFinanceiro[]; contrato: ContratoServico }> {
  return request(`/api/v1/erp/contratos/${id}/gerar-faturas/`, { method: "POST" });
}
export async function contratoBaixarMaterial(
  id: number,
): Promise<{ movimentacoes: MovimentacaoEstoque[]; contrato: ContratoServico }> {
  return request(`/api/v1/erp/contratos/${id}/baixar-material/`, { method: "POST" });
}
export async function contratoGerarNotaFiscal(id: number, lancamento?: number): Promise<NotaFiscal> {
  return request<NotaFiscal>(`/api/v1/erp/contratos/${id}/gerar-nota-fiscal/`, {
    method: "POST",
    body: JSON.stringify(lancamento ? { lancamento } : {}),
  });
}
export async function listProjetosAguardandoContrato(): Promise<ProjetoAguardandoContrato[]> {
  return request<ProjetoAguardandoContrato[]>("/api/v1/erp/contratos/projetos-pendentes/");
}
export async function contratoDeProjeto(projeto: number): Promise<ContratoServico> {
  return request<ContratoServico>("/api/v1/erp/contratos/de-projeto/", {
    method: "POST",
    body: JSON.stringify({ projeto }),
  });
}

export interface DadosEmpresa {
  razao_social: string;
  nome_fantasia: string;
  cnpj: string;
  inscricao_municipal: string;
  inscricao_estadual: string;
  regime_tributario: "" | "mei" | "simples" | "presumido" | "real";
  cep: string;
  logradouro: string;
  numero: string;
  bairro: string;
  municipio: string;
  uf: string;
  codigo_municipio_ibge: string;
  codigo_servico_padrao: string;
  aliquota_iss_padrao: string;
  serie_nfse: string;
  email_fiscal: string;
}

export async function getDadosEmpresa(): Promise<DadosEmpresa> {
  return request<DadosEmpresa>("/api/v1/erp/empresa/");
}
export async function saveDadosEmpresa(data: Partial<DadosEmpresa>): Promise<DadosEmpresa> {
  return request<DadosEmpresa>("/api/v1/erp/empresa/", { method: "PUT", body: JSON.stringify(data) });
}

export interface ProntidaoNotaFiscal {
  pronto: boolean;
  itens: { id: string; label: string; ok: boolean; detalhe: string }[];
}

export async function getProntidaoNotaFiscal(): Promise<ProntidaoNotaFiscal> {
  return request<ProntidaoNotaFiscal>("/api/v1/erp/fiscal/prontidao/");
}

// --- integrations: painel administrativo --------------------------------------

export type CredentialProvider = "github" | "n8n" | "hostinger" | "datajud" | "moneyprinter" | "vercel" | "render" | "supabase";

export interface ServiceCredentialInfo {
  id: number;
  provider: CredentialProvider;
  label: string;
  account_ref: string;
  token_masked: string;
  configured: boolean;
  updated_at: string;
}

export async function listServiceCredentials(): Promise<ServiceCredentialInfo[]> {
  return request<ServiceCredentialInfo[]>("/api/v1/integrations/credentials/");
}
export async function saveServiceCredential(data: {
  provider: CredentialProvider;
  label?: string;
  account_ref?: string;
  token?: string;
}): Promise<ServiceCredentialInfo> {
  return request<ServiceCredentialInfo>("/api/v1/integrations/credentials/", { method: "POST", body: JSON.stringify(data) });
}
export async function removeServiceCredential(provider: CredentialProvider): Promise<void> {
  return request<void>(`/api/v1/integrations/credentials/${provider}/`, { method: "DELETE" });
}
export async function testServiceCredential(provider: CredentialProvider): Promise<{ ok: boolean; detail: string }> {
  return request(`/api/v1/integrations/credentials/${provider}/test/`, { method: "POST" });
}

export interface N8nWorkflow {
  id: string;
  name: string;
  active: boolean;
  archived: boolean;
  updated_at: string | null;
  created_at: string | null;
  tags: string[];
  nodes: number;
  trigger: "webhook" | "agendado" | "manual" | "evento" | "outro";
  node_types: string[];
  recent: { success: number; error: number; other: number; last: N8nExecution | null };
}
export interface N8nExecution {
  id: string;
  workflow_id: string;
  status: string;
  mode: string;
  started_at: string | null;
  stopped_at: string | null;
}
export interface N8nOverview {
  workflows: N8nWorkflow[];
  executions: N8nExecution[];
  totals: { workflows: number; active: number; errors_recent: number; success_recent: number };
}

export async function getN8nOverview(): Promise<N8nOverview> {
  return request<N8nOverview>("/api/v1/integrations/n8n/overview/");
}
export async function listN8nExecutions(workflow?: string, status?: string): Promise<N8nExecution[]> {
  const qs = new URLSearchParams();
  if (workflow) qs.set("workflow", workflow);
  if (status) qs.set("status", status);
  return request<N8nExecution[]>(`/api/v1/integrations/n8n/executions/?${qs}`);
}
export async function setN8nWorkflowActive(id: string, active: boolean): Promise<{ id: string; active: boolean }> {
  return request(`/api/v1/integrations/n8n/workflows/${encodeURIComponent(id)}/active/`, {
    method: "POST",
    body: JSON.stringify({ active }),
  });
}

export interface HostingerOverview {
  vps: { id: number | string; hostname: string; state: string; plan: string; ip: string }[];
  domains: { domain: string; status: string; expires_at: string | null }[];
  errors: string[];
}
export async function getHostingerOverview(): Promise<HostingerOverview> {
  return request<HostingerOverview>("/api/v1/integrations/hostinger/overview/");
}

export interface ServerConnection {
  id: number;
  name: string;
  provider: "oracle" | "hostinger" | "outro";
  host: string;
  ssh_port: number;
  username: string;
  region: string;
  purpose: string;
  notes: string;
  has_private_key: boolean;
  last_check_at: string | null;
  last_check_ok: boolean | null;
  last_check_message: string;
}
export async function listServers(): Promise<ServerConnection[]> {
  return requestList<ServerConnection>("/api/v1/integrations/servers/");
}
export async function saveServer(data: Partial<ServerConnection> & { private_key?: string }, id?: number): Promise<ServerConnection> {
  return request<ServerConnection>(`/api/v1/integrations/servers/${id ? `${id}/` : ""}`, {
    method: id ? "PATCH" : "POST",
    body: JSON.stringify(data),
  });
}
export async function deleteServer(id: number): Promise<void> {
  return request<void>(`/api/v1/integrations/servers/${id}/`, { method: "DELETE" });
}
export async function checkServer(id: number): Promise<ServerConnection & { ok: boolean; detail: string }> {
  return request(`/api/v1/integrations/servers/${id}/check/`, { method: "POST" });
}

export type EmailProvider = "hostinger" | "gmail" | "outlook" | "custom";
export interface EmailAccount {
  id: number;
  sector: number | null;
  sector_name: string;
  address: string;
  display_name: string;
  provider: EmailProvider;
  smtp_host: string;
  smtp_port: number;
  smtp_security: "ssl" | "starttls" | "none";
  imap_host: string;
  imap_port: number;
  username: string;
  has_password: boolean;
  signature: string;
  status: "pending" | "ready" | "error";
  configured: boolean;
  last_check_at: string | null;
  last_check_message: string;
  last_fetch_at: string | null;
  last_fetch_message: string;
}
export interface EmailOverview {
  default_account: EmailAccount | null;
  sectors: {
    sector: { id: number; name: string };
    agents: string[];
    account: EmailAccount | null;
    drafts: number;
    /** Recebidos ainda não lidos. */
    unread: number;
    sent: number;
  }[];
}
export async function getEmailOverview(): Promise<EmailOverview> {
  return request<EmailOverview>("/api/v1/integrations/email-accounts/overview/");
}
export async function getEmailPresets(): Promise<Record<EmailProvider, Partial<EmailAccount>>> {
  return request("/api/v1/integrations/email-accounts/presets/");
}
export async function saveEmailAccount(data: Partial<EmailAccount> & { password?: string }, id?: number): Promise<EmailAccount> {
  return request<EmailAccount>(`/api/v1/integrations/email-accounts/${id ? `${id}/` : ""}`, {
    method: id ? "PATCH" : "POST",
    body: JSON.stringify(data),
  });
}
export async function deleteEmailAccount(id: number): Promise<void> {
  return request<void>(`/api/v1/integrations/email-accounts/${id}/`, { method: "DELETE" });
}
export async function testEmailAccount(id: number): Promise<{ ok: boolean; detail: string; account: EmailAccount }> {
  // 400 também traz o detalhe e a conta atualizada — a tela mostra os dois
  try {
    return await request(`/api/v1/integrations/email-accounts/${id}/test/`, { method: "POST" });
  } catch (err) {
    if (err instanceof ApiError && err.body && "account" in err.body) {
      return err.body as unknown as { ok: boolean; detail: string; account: EmailAccount };
    }
    throw err;
  }
}

export interface OutboundEmail {
  id: number;
  sector: number | null;
  sector_name: string;
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  status: "draft" | "sending" | "sent" | "failed" | "cancelled";
  origin: string;
  requested_by: string;
  approved_by: string;
  from_address: string;
  sent_at: string | null;
  error: string;
  created_at: string;
  in_reply_to: number | null;
  /** Texto escrito por um agente (uma pessoa revisou e enviou). */
  written_by_ai: boolean;
}
export async function listOutboundEmails(status?: string, sector?: number): Promise<OutboundEmail[]> {
  const qs = new URLSearchParams();
  if (status) qs.set("status", status);
  if (sector) qs.set("sector", String(sector));
  return requestList<OutboundEmail>(`/api/v1/integrations/outbound-emails/?${qs}`);
}

export interface InboundEmail {
  id: number;
  sector: number | null;
  sector_name: string;
  to_address: string;
  message_id: string;
  from_address: string;
  from_name: string;
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  received_at: string;
  is_read: boolean;
  replies: { id: number; status: OutboundEmail["status"]; written_by_ai: boolean; requested_by: string; approved_by: string; sent_at: string | null }[];
}
export async function listInboundEmails(sector?: number, search = ""): Promise<InboundEmail[]> {
  const qs = new URLSearchParams({ page_size: "100" });
  if (sector) qs.set("sector", String(sector));
  if (search.trim()) qs.set("search", search.trim());
  return requestList<InboundEmail>(`/api/v1/integrations/inbound-emails/?${qs}`);
}
export async function markInboundRead(id: number, is_read = true): Promise<InboundEmail> {
  return request<InboundEmail>(`/api/v1/integrations/inbound-emails/${id}/`, { method: "PATCH", body: JSON.stringify({ is_read }) });
}
export async function fetchMailbox(accountId: number): Promise<{ ok: boolean; created: number; detail: string }> {
  return request(`/api/v1/integrations/email-accounts/${accountId}/fetch/`, { method: "POST" });
}
/** A IA do setor escreve a resposta — volta como rascunho pra uma pessoa revisar e enviar. */
export async function draftAiReply(inbound: number, instructions = ""): Promise<OutboundEmail> {
  return request<OutboundEmail>("/api/v1/agency/email-reply/", { method: "POST", body: JSON.stringify({ inbound, instructions }) });
}
export async function createOutboundEmail(data: Pick<OutboundEmail, "sector" | "to" | "subject" | "body"> & { cc?: string[]; in_reply_to?: number }): Promise<OutboundEmail> {
  return request<OutboundEmail>("/api/v1/integrations/outbound-emails/", { method: "POST", body: JSON.stringify(data) });
}
export async function updateOutboundEmail(id: number, data: Partial<Pick<OutboundEmail, "to" | "cc" | "subject" | "body">>): Promise<OutboundEmail> {
  return request<OutboundEmail>(`/api/v1/integrations/outbound-emails/${id}/`, { method: "PATCH", body: JSON.stringify(data) });
}
export async function sendOutboundEmail(id: number): Promise<OutboundEmail & { queued: boolean }> {
  return request(`/api/v1/integrations/outbound-emails/${id}/send/`, { method: "POST" });
}
export async function cancelOutboundEmail(id: number): Promise<OutboundEmail> {
  return request<OutboundEmail>(`/api/v1/integrations/outbound-emails/${id}/cancel/`, { method: "POST" });
}
export async function draftQuoteEmail(orcamentoId: number): Promise<OutboundEmail> {
  return request<OutboundEmail>(`/api/v1/compras/orcamentos/${orcamentoId}/rascunho-email/`, { method: "POST" });
}
export async function draftOrderEmail(pedidoId: number): Promise<OutboundEmail> {
  return request<OutboundEmail>(`/api/v1/compras/pedidos/${pedidoId}/rascunho-email/`, { method: "POST" });
}

// MCP (conector em ingestion)
export interface McpTool {
  nome: string;
  descricao: string;
  parametros: Record<string, { tipo: string; descricao: string }>;
  obrigatorios: string[];
  somente_leitura: boolean;
  liberada?: boolean;
  risco?: "low" | "medium" | "high" | "critical" | null;
}
export async function discoverMcpTools(sourceId: number): Promise<{ tools: McpTool[] }> {
  return request(`/api/v1/ingestion/sources/${sourceId}/mcp-discover/`, { method: "POST" });
}
export async function saveMcpTools(sourceId: number, ferramentas: { nome: string; risco: string }[]): Promise<{ ferramentas: { nome: string; risco: string }[] }> {
  return request(`/api/v1/ingestion/sources/${sourceId}/mcp-tools/`, { method: "POST", body: JSON.stringify({ ferramentas }) });
}

// ─── Marketing ───────────────────────────────────────────────────────────────

export type RedeSocial = "instagram" | "tiktok" | "youtube" | "facebook" | "linkedin" | "x" | "discord" | "twitch";
export type ProvedorOAuth = "meta" | "google" | "tiktok" | "linkedin" | "x" | "twitch";

export interface PerfilMarca {
  nome: string;
  ramo: string;
  descricao: string;
  publico_alvo: string;
  tom_de_voz: string;
  pilares: string[];
  diferenciais: string;
  evitar: string;
  hashtags: string;
  cta_padrao: string;
  site: string;
  idioma: string;
  cor_primaria: string;
  cor_secundaria: string;
  cor_texto: string;
  tem_logo: boolean;
  updated_at: string;
}
export interface RamoPreset { chave: string; nome: string; pilares: string[]; tom: string; aviso: string }

export interface RedeInfo {
  rede: RedeSocial;
  nome: string;
  limite: number;
  aceita: ("texto" | "imagem" | "video")[];
  exige_midia: boolean;
  provedor: ProvedorOAuth | null;
}
export interface ContaSocial {
  id: number;
  rede: RedeSocial;
  rede_nome: string;
  provedor: ProvedorOAuth | null;
  nome: string;
  usuario: string;
  conta_id: string;
  url: string;
  expira_em: string | null;
  config: Record<string, string>;
  status: "conectada" | "erro" | "expirada";
  mensagem: string;
  ultimo_teste: string | null;
  conectada_por: string;
  created_at: string;
}
export interface AppsRedes {
  redirect_uri: string;
  provedores: {
    provedor: ProvedorOAuth;
    nome: string;
    redes: RedeSocial[];
    portal: string;
    escopos: string[];
    app: { id: number; provedor: ProvedorOAuth; client_id: string; secret_definido: boolean; updated_at: string } | null;
  }[];
}
export interface Midia {
  id: number;
  tipo: "imagem" | "video";
  origem: "upload" | "criativo" | "corte" | "video_ia";
  origem_nome: string;
  titulo: string;
  formato: string;
  largura: number;
  altura: number;
  duracao: number;
  tamanho: number;
  mime: string;
  legenda_sugerida: string;
  dados: Record<string, unknown>;
  job: number | null;
  created_at: string;
}
export type StatusPublicacao = "rascunho" | "revisao" | "agendada" | "publicando" | "publicada" | "parcial" | "erro" | "cancelada";
export interface DestinoPublicacao {
  id: number;
  conta: number;
  rede: RedeSocial;
  conta_nome: string;
  texto: string;
  texto_final: string;
  limite: number | null;
  status: "pendente" | "publicando" | "publicado" | "erro";
  externo_id: string;
  url: string;
  erro: string;
  tentativas: number;
  publicado_em: string | null;
}
export interface Publicacao {
  id: number;
  titulo: string;
  texto: string;
  pilar: string;
  formato: "post" | "carrossel" | "reels" | "video" | "story" | "texto";
  gancho: string;
  hashtags: string;
  link: string;
  status: StatusPublicacao;
  status_nome: string;
  agendada_para: string | null;
  midias_ids: number[];
  midias_info: { id: number; tipo: "imagem" | "video"; titulo: string; formato: string }[];
  destinos: DestinoPublicacao[];
  escrita_por_ia: boolean;
  agente_nome: string;
  fontes: number[];
  ideia_visual: string;
  aprovada_por: string;
  aprovada_em: string | null;
  publicada_em: string | null;
  observacoes: string;
  created_at: string;
  avisos?: string[];
}
export interface PublicacaoInput {
  titulo?: string;
  texto?: string;
  pilar?: string;
  formato?: Publicacao["formato"];
  gancho?: string;
  hashtags?: string;
  link?: string;
  agendada_para?: string | null;
  midias_ids?: number[];
  contas?: number[];
  textos?: Record<string, string>;
  observacoes?: string;
}
export interface PainelMarketing {
  por_status: Partial<Record<StatusPublicacao, number>>;
  semana: number;
  aguardando_aprovacao: number;
  agendadas: number;
  com_erro: number;
  publicadas_mes: number;
  publicadas_30d_por_rede: Partial<Record<RedeSocial, number>>;
  dias_com_post_14d: number;
  proximas: Publicacao[];
  contas: { total: number; com_problema: number; redes: RedeSocial[] };
  jobs_ativos: number;
}
export interface TimeMarketing {
  setor: number | null;
  agentes: { id: number; nome: string; cargo: string; papel: string; nivel: string; work_status: string; tarefa: string }[];
  faltando: string[];
}
export interface ProntidaoMarketing {
  ffmpeg: boolean;
  yt_dlp: boolean;
  transcricao: string | null;
  moneyprinter: boolean;
  api_publica: string;
  criptografia: boolean;
  redirect_uri: string;
  time: boolean;
}
export interface JobVideo {
  id: number;
  tipo: "cortes" | "video_ia";
  status: "na_fila" | "baixando" | "transcrevendo" | "analisando" | "cortando" | "gerando" | "concluido" | "erro";
  status_nome: string;
  progresso: number;
  etapa: string;
  titulo: string;
  origem_url: string;
  origem_midia: number | null;
  parametros: Record<string, unknown>;
  resultado: Record<string, unknown>;
  erro: string;
  agente_nome: string;
  criado_por: string;
  midias: Midia[];
  created_at: string;
  concluido_em: string | null;
}
export interface Roteiro { titulo: string; roteiro: string; termos: string[]; legenda?: string; hashtags?: string[] }
export interface OpcoesCriativo {
  formatos: { chave: string; largura: number; altura: number; nome: string }[];
  modelos: { chave: string; nome: string }[];
}
export interface TextosCriativo {
  kicker?: string;
  titulo?: string;
  subtitulo?: string;
  destaque?: string;
  cta?: string;
  autor?: string;
  laminas?: { titulo: string; texto: string }[];
}

const MKT = "/api/v1/marketing";
const json = (body: unknown, method = "POST"): RequestInit => ({ method, body: JSON.stringify(body) });

async function upload<T>(path: string, form: FormData): Promise<T> {
  const token = getAccessToken();
  const res = await fetch(`${API_URL}${path}`, { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.detail ?? firstFieldError(body) ?? `Erro ${res.status}`, body);
  return body as T;
}

export const marketing = {
  painel: () => request<PainelMarketing>(`${MKT}/painel/`),
  time: () => request<TimeMarketing>(`${MKT}/time/`),
  montarTime: () => request<{ setor_criado: boolean; criados: string[]; existentes: string[] }>(`${MKT}/time/`, { method: "POST" }),
  prontidao: () => request<ProntidaoMarketing>(`${MKT}/prontidao/`),
  marca: () => request<PerfilMarca>(`${MKT}/marca/`),
  salvarMarca: (d: Partial<PerfilMarca>) => request<PerfilMarca>(`${MKT}/marca/`, json(d, "PATCH")),
  enviarLogo: (f: File) => { const fd = new FormData(); fd.append("arquivo", f); return upload<PerfilMarca>(`${MKT}/marca/logo/`, fd); },
  removerLogo: () => request<void>(`${MKT}/marca/logo/`, { method: "DELETE" }),
  ramos: () => request<RamoPreset[]>(`${MKT}/ramos/`),
  apps: () => request<AppsRedes>(`${MKT}/apps/`),
  salvarApp: (provedor: ProvedorOAuth, client_id: string, client_secret: string) =>
    request(`${MKT}/apps/`, json({ provedor, client_id, ...(client_secret ? { client_secret } : {}) })),
  removerApp: (provedor: ProvedorOAuth) => request<void>(`${MKT}/apps/${provedor}/`, { method: "DELETE" }),
  redes: () => request<RedeInfo[]>(`${MKT}/contas/redes/`),
  contas: () => request<ContaSocial[]>(`${MKT}/contas/`),
  conectar: (provedor: ProvedorOAuth) => request<{ url: string }>(`${MKT}/contas/conectar/`, json({ provedor })),
  conectarDiscord: (webhook_url: string, nome: string) => request<ContaSocial>(`${MKT}/contas/discord/`, json({ webhook_url, nome })),
  conectarManual: (d: { rede: RedeSocial; token: string; conta_id: string; nome?: string; usuario?: string }) =>
    request<ContaSocial & { teste: string }>(`${MKT}/contas/manual/`, json(d)),
  testarConta: (id: number) => request<{ ok: boolean; detail: string }>(`${MKT}/contas/${id}/testar/`, { method: "POST" }),
  configConta: (id: number, config: Record<string, string>) => request<ContaSocial>(`${MKT}/contas/${id}/`, json({ config }, "PATCH")),
  removerConta: (id: number) => request<void>(`${MKT}/contas/${id}/`, { method: "DELETE" }),
  midias: (params = "") => requestList<Midia>(`${MKT}/midias/?page_size=200${params}`),
  enviarMidia: (f: File, titulo = "") => { const fd = new FormData(); fd.append("arquivo", f); if (titulo) fd.append("titulo", titulo); return upload<Midia>(`${MKT}/midias/`, fd); },
  editarMidia: (id: number, d: Partial<Pick<Midia, "titulo" | "legenda_sugerida">>) => request<Midia>(`${MKT}/midias/${id}/`, json(d, "PATCH")),
  removerMidia: (id: number) => request<void>(`${MKT}/midias/${id}/`, { method: "DELETE" }),
  midiaPath: (id: number, miniatura = false) => `${MKT}/midias/${id}/arquivo/${miniatura ? "?miniatura=1" : ""}`,
  opcoesCriativo: () => request<OpcoesCriativo>(`${MKT}/criativos/`),
  criarCriativo: (d: { modelo: string; formatos: string[]; textos?: TextosCriativo; usar_ia?: boolean; tema?: string; laminas?: number; fundo?: number | null }) =>
    request<{ grupo: string; textos: TextosCriativo; midias: Midia[] }>(`${MKT}/criativos/`, json(d)),
  publicacoes: (params = "") => requestList<Publicacao>(`${MKT}/publicacoes/?page_size=500${params}`),
  publicacao: (id: number) => request<Publicacao>(`${MKT}/publicacoes/${id}/`),
  criarPublicacao: (d: PublicacaoInput) => request<Publicacao>(`${MKT}/publicacoes/`, json(d)),
  salvarPublicacao: (id: number, d: PublicacaoInput) => request<Publicacao>(`${MKT}/publicacoes/${id}/`, json(d, "PATCH")),
  removerPublicacao: (id: number) => request<void>(`${MKT}/publicacoes/${id}/`, { method: "DELETE" }),
  gerarPost: (d: { tema: string; contas: number[]; formato?: string; instrucoes?: string; agendada_para?: string | null; midias?: number[] }) =>
    request<Publicacao>(`${MKT}/publicacoes/gerar/`, json(d)),
  escreverPost: (id: number, d: { tema?: string; instrucoes?: string } = {}) => request<Publicacao>(`${MKT}/publicacoes/${id}/escrever/`, json(d)),
  conferir: (id: number) => request<{ erros: string[] }>(`${MKT}/publicacoes/${id}/conferir/`, { method: "POST" }),
  paraRevisao: (id: number) => request<Publicacao>(`${MKT}/publicacoes/${id}/revisao/`, { method: "POST" }),
  aprovar: (id: number, publicar_agora = false) => request<Publicacao>(`${MKT}/publicacoes/${id}/aprovar/`, json({ publicar_agora })),
  tentarDeNovo: (id: number) => request<Publicacao>(`${MKT}/publicacoes/${id}/publicar/`, { method: "POST" }),
  cancelar: (id: number) => request<Publicacao>(`${MKT}/publicacoes/${id}/cancelar/`, { method: "POST" }),
  voltarRascunho: (id: number) => request<Publicacao>(`${MKT}/publicacoes/${id}/voltar/`, { method: "POST" }),
  aprovarLote: (ids: number[]) => request<{ aprovadas: number[]; erros: Record<string, string> }>(`${MKT}/publicacoes/aprovar-lote/`, json({ ids })),
  escreverLote: (ids: number[], instrucoes = "") => request<{ ids: number[]; enfileirado: boolean }>(`${MKT}/publicacoes/escrever-lote/`, json({ ids, instrucoes })),
  planejar: (d: { inicio: string; semanas: number; por_semana: number; contas: number[]; objetivo: string; escrever: boolean; instrucoes?: string }) =>
    request<{ criadas: number[]; escrevendo: boolean; enfileirado: boolean | null }>(`${MKT}/publicacoes/planejar/`, json(d)),
  jobs: (params = "") => requestList<JobVideo>(`${MKT}/jobs/?page_size=100${params}`),
  job: (id: number) => request<JobVideo>(`${MKT}/jobs/${id}/`),
  removerJob: (id: number) => request<void>(`${MKT}/jobs/${id}/`, { method: "DELETE" }),
  cortes: (d: { url?: string; midia?: number; direitos: boolean; quantidade: number; minimo: number; maximo: number; estilo: string; legenda: boolean; gancho: boolean }) =>
    request<JobVideo>(`${MKT}/jobs/cortes/`, json(d)),
  roteiro: (tema: string, segundos: number, instrucoes = "") => request<Roteiro>(`${MKT}/jobs/roteiro/`, json({ tema, segundos, instrucoes })),
  videoIA: (d: { titulo: string; roteiro: string; termos: string[]; proporcao: string; voz: string; legenda: boolean; musica: boolean; legenda_post?: string; hashtags?: string }) =>
    request<JobVideo>(`${MKT}/jobs/video-ia/`, json(d)),
};


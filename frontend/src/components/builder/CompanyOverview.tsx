// frontend/src/components/builder/CompanyOverview.tsx
import { useEffect, useState } from "react";
import {
  Building2,
  Brain,
  Plus,
  Database,
  ShieldCheck,
  Users,
  DollarSign,
  UserCog,
  Settings,
  Code,
  X,
  Activity,
  PauseCircle,
  Wallet,
  MessageCircle,
  Loader2,
} from "lucide-react";
import {
  listAgents,
  listSectors,
  listProjects,
  getSectorMetrics,
  listKnowledgeSources,
  createSector,
  askAsAgent,
  type Agent,
  type Sector,
  type Project,
  type SectorMetric,
  type KnowledgeSource,
  type AgentAskResult,
  ApiError,
} from "@/lib/api";
import { useRealtime } from "@/lib/useRealtime";

// Setores/métricas/projetos/fontes mudam bem menos que work_status de
// agente — esse poll é só uma rede de segurança agora; o status ao vivo
// do agente vem pelo WebSocket (useRealtime), não mais por aqui.
const POLL_INTERVAL_MS = 30000;

const STATUS_DOT: Record<Agent["work_status"], string> = {
  working: "bg-green-400 animate-pulse",
  idle: "bg-slate-500",
  paused: "bg-yellow-400",
};

const BUDGET_COLOR: Record<SectorMetric["status"], string> = {
  ok: "text-green-400",
  warn: "text-yellow-400",
  over: "text-red-400",
  sem_orcamento: "text-slate-500",
};

// Ícone por palavra-chave no nome do setor — heurística de exibição só,
// nunca decide comportamento (setores são livres, criados pelo usuário).
function iconForSector(name: string) {
  const n = name.toLowerCase();
  if (n.includes("comercial") || n.includes("venda")) return Users;
  if (n.includes("financ")) return DollarSign;
  if (n.includes(" rh") || n.startsWith("rh") || n.includes("pessoa") || n.includes("recursos human")) return UserCog;
  if (n.includes("opera")) return Settings;
  if (n.includes("tecnolog") || n.includes("dev") || n.includes("desenvolv")) return Code;
  return Building2;
}

function formatUSD(n: number): string {
  return `$${n.toFixed(2)}`;
}

/**
 * A "visão da empresa" como diagrama hierárquico (Empresa → Orquestrador
 * → Setores → Dados → Governança), com criação de setor direto aqui —
 * setores não são fixos, cada empresa cria os que precisar.
 *
 * Tudo no diagrama é dado real (agency/ingestion), nunca inventado:
 * "Dados corporativos" mostra as KnowledgeSource de verdade cadastradas,
 * não categorias genéricas (ERP/CRM/BI) que o sistema não implementa.
 * "Governança" é estático porque reflete garantias arquiteturais sempre
 * ativas (TenantMixin, AuditMixin, ConsentRecord), não algo que se liga/desliga.
 */
export default function CompanyOverview() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [metrics, setMetrics] = useState<SectorMetric[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [creatingSector, setCreatingSector] = useState(false);
  const [askingAgent, setAskingAgent] = useState<Agent | null>(null);
  const [newSectorName, setNewSectorName] = useState("");
  const [newSectorDescription, setNewSectorDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  async function fetchAll() {
    try {
      const [agentsData, sectorsData, metricsData, projectsData, sourcesData] = await Promise.all([
        listAgents(),
        listSectors(),
        getSectorMetrics(),
        listProjects(),
        listKnowledgeSources(),
      ]);
      setAgents(agentsData);
      setSectors(sectorsData);
      setMetrics(metricsData);
      setProjects(projectsData);
      setSources(sourcesData);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao consultar a empresa.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  const { connected, lastAgentEvent } = useRealtime();

  // Substitui o agente inteiro pela versão nova assim que o evento chega
  // — nunca espera o próximo poll de 30s pra refletir work_status/
  // current_task mudando.
  useEffect(() => {
    if (!lastAgentEvent) return;
    setAgents((prev) => {
      const exists = prev.some((a) => a.id === lastAgentEvent.id);
      if (exists) return prev.map((a) => (a.id === lastAgentEvent.id ? lastAgentEvent : a));
      return [...prev, lastAgentEvent];
    });
  }, [lastAgentEvent]);

  async function handleCreateSector() {
    if (!newSectorName.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      await createSector({ name: newSectorName.trim(), description: newSectorDescription.trim() });
      setNewSectorName("");
      setNewSectorDescription("");
      setCreatingSector(false);
      await fetchAll();
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : "Falha ao criar setor.");
    } finally {
      setCreating(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4 p-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-card border border-white/10 bg-surface-raised" />
          ))}
        </div>
        <div className="mx-auto h-16 max-w-md animate-pulse rounded-card border border-white/10 bg-surface-raised" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-6">
        <p className="rounded-card border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</p>
      </div>
    );
  }

  const topOrchestrators = agents.filter((a) => a.access_level === "ceo" || a.access_level === "general_orchestrator");
  const workingCount = agents.filter((a) => a.work_status === "working").length;
  const pausedCount = agents.filter((a) => a.work_status === "paused").length;
  const totalCostUsd = metrics.reduce((sum, m) => sum + m.cost_usd, 0);

  return (
    <div className="space-y-6 overflow-y-auto p-4 sm:p-6">
      <div className="flex justify-end">
        <span className={`flex items-center gap-1.5 text-[11px] ${connected ? "text-green-400" : "text-slate-500"}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-green-400" : "bg-slate-600"}`} />
          {connected ? "Tempo real conectado" : "Reconectando..."}
        </span>
      </div>

      {/* Monitoramento — visão rápida de todos os agentes, sem precisar abrir cada setor */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-card border border-white/10 bg-surface-raised p-4">
          <div className="flex items-center gap-2 text-slate-500">
            <Users className="h-3.5 w-3.5" />
            <span className="text-[11px] uppercase tracking-wide">Agentes</span>
          </div>
          <p className="mt-1.5 text-2xl font-semibold text-slate-100">{agents.length}</p>
        </div>
        <div className="rounded-card border border-white/10 bg-surface-raised p-4">
          <div className="flex items-center gap-2 text-slate-500">
            <Activity className={`h-3.5 w-3.5 ${workingCount > 0 ? "text-green-400" : ""}`} />
            <span className="text-[11px] uppercase tracking-wide">Trabalhando agora</span>
          </div>
          <p className={`mt-1.5 text-2xl font-semibold ${workingCount > 0 ? "text-green-400" : "text-slate-100"}`}>{workingCount}</p>
        </div>
        <div className="rounded-card border border-white/10 bg-surface-raised p-4">
          <div className="flex items-center gap-2 text-slate-500">
            <PauseCircle className="h-3.5 w-3.5" />
            <span className="text-[11px] uppercase tracking-wide">Pausados</span>
          </div>
          <p className="mt-1.5 text-2xl font-semibold text-slate-100">{pausedCount}</p>
        </div>
        <div className="rounded-card border border-white/10 bg-surface-raised p-4">
          <div className="flex items-center gap-2 text-slate-500">
            <Wallet className="h-3.5 w-3.5" />
            <span className="text-[11px] uppercase tracking-wide">Custo total</span>
          </div>
          <p className="mt-1.5 text-2xl font-semibold text-slate-100">{formatUSD(totalCostUsd)}</p>
        </div>
      </div>

      {/* Empresa */}
      <div className="mx-auto flex max-w-md items-center gap-3 rounded-card border border-white/10 bg-surface-raised px-5 py-3">
        <Building2 className="h-6 w-6 shrink-0 text-slate-300" />
        <div>
          <p className="text-sm font-semibold text-slate-100">Empresa</p>
          <p className="text-xs text-slate-500">Visão estratégica</p>
        </div>
      </div>
      <div className="mx-auto h-6 w-px bg-white/15" />

      {/* Orquestrador-Geral / CEO */}
      <div className="mx-auto flex max-w-md items-center gap-3 rounded-card border border-brand-500/30 bg-brand-500/10 px-5 py-3">
        <Brain className="h-6 w-6 shrink-0 text-brand-500" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-100">Orquestrador-Geral</p>
          {topOrchestrators.length > 0 ? (
            <p className="truncate text-xs text-slate-400">
              {topOrchestrators.map((a) => a.name).join(", ")}
            </p>
          ) : (
            <p className="text-xs text-slate-500">Nenhum agente CEO/Orquestrador-Geral cadastrado ainda</p>
          )}
        </div>
      </div>
      <div className="mx-auto h-6 w-px bg-white/15" />

      {/* Setores */}
      <div className="flex flex-wrap justify-center gap-4">
        {sectors.map((sector) => {
          const sectorAgents = agents.filter((a) => a.sector === sector.id);
          const metric = metrics.find((m) => m.sector_id === sector.id);
          const Icon = iconForSector(sector.name);

          return (
            <div key={sector.id} className="flex w-full flex-col rounded-card border border-white/10 bg-surface-raised sm:w-64">
              <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2.5">
                <Icon className="h-4 w-4 shrink-0 text-brand-500" />
                <p className="truncate text-sm font-semibold text-slate-100">{sector.name}</p>
              </div>

              <div className="flex-1 space-y-1.5 p-3">
                {sectorAgents.length === 0 ? (
                  <p className="text-xs text-slate-500">Nenhum agente ainda.</p>
                ) : (
                  sectorAgents.map((agent) => (
                    <button
                      key={agent.id}
                      onClick={() => setAskingAgent(agent)}
                      className="flex w-full items-center gap-2 rounded-md bg-white/5 px-2 py-1.5 text-left transition hover:bg-white/10"
                    >
                      <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[agent.work_status]}`} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs text-slate-200">{agent.name}</p>
                        <p className="truncate text-[10px] text-slate-500">{agent.role}</p>
                      </div>
                      <MessageCircle className="h-3 w-3 shrink-0 text-slate-600" />
                    </button>
                  ))
                )}
              </div>

              <div className="border-t border-white/10 px-3 py-2 text-[11px]">
                {metric ? (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">{formatUSD(metric.cost_usd)} gastos</span>
                    <span className={BUDGET_COLOR[metric.status]}>
                      {metric.status === "sem_orcamento" ? "sem orçamento" : `${metric.usage_percent}% do orçamento`}
                    </span>
                  </div>
                ) : (
                  <span className="text-slate-600">sem dados de uso ainda</span>
                )}
              </div>
            </div>
          );
        })}

        {/* Criar setor novo, direto aqui */}
        {creatingSector ? (
          <div className="flex w-full flex-col gap-2 rounded-card border border-dashed border-brand-500/40 bg-surface-raised p-3 sm:w-64">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-slate-300">Novo setor</p>
              <button onClick={() => setCreatingSector(false)} className="text-slate-500 hover:text-slate-200">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <input
              value={newSectorName}
              onChange={(e) => setNewSectorName(e.target.value)}
              placeholder="Nome (ex: Jurídico)"
              className="rounded-md border border-white/10 bg-surface px-2 py-1.5 text-xs text-slate-100 focus:border-brand-500 focus:outline-none"
            />
            <textarea
              value={newSectorDescription}
              onChange={(e) => setNewSectorDescription(e.target.value)}
              placeholder="Descrição (opcional)"
              rows={2}
              className="resize-none rounded-md border border-white/10 bg-surface px-2 py-1.5 text-xs text-slate-100 focus:border-brand-500 focus:outline-none"
            />
            {createError && <p className="text-[11px] text-red-400">{createError}</p>}
            <button
              onClick={handleCreateSector}
              disabled={!newSectorName.trim() || creating}
              className="rounded-md bg-brand-500 px-2 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-40"
            >
              {creating ? "Criando..." : "Criar setor"}
            </button>
          </div>
        ) : (
          <button
            onClick={() => setCreatingSector(true)}
            className="flex w-full flex-col items-center justify-center gap-2 rounded-card border border-dashed border-white/15 py-6 text-slate-500 transition hover:border-brand-500/50 hover:text-brand-500 sm:w-64 sm:py-0"
          >
            <Plus className="h-5 w-5" />
            <span className="text-xs">Novo setor</span>
          </button>
        )}
      </div>

      <div className="mx-auto h-6 w-px bg-white/15" />

      {/* Dados corporativos (real: KnowledgeSource) */}
      <div className="mx-auto max-w-2xl rounded-card border border-white/10 bg-surface-raised p-4">
        <div className="mb-2 flex items-center gap-2">
          <Database className="h-4 w-4 text-slate-400" />
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Dados corporativos</p>
        </div>
        {sources.length === 0 ? (
          <p className="text-xs text-slate-500">Nenhuma fonte de conhecimento cadastrada ainda (ver aba Conhecimento).</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {sources.map((s) => (
              <span key={s.id} className="rounded-md bg-white/5 px-2 py-1 text-[11px] text-slate-300">
                {s.name} <span className="text-slate-500">({s.source_type})</span>
              </span>
            ))}
          </div>
        )}
        {projects.length > 0 && (
          <p className="mt-2 text-[11px] text-slate-500">{projects.length} projeto{projects.length !== 1 ? "s" : ""} criado{projects.length !== 1 ? "s" : ""} via agentes — ver aba Estúdio.</p>
        )}
      </div>

      {/* Governança — estático, reflete garantias arquiteturais sempre ativas */}
      <div className="mx-auto flex max-w-2xl items-center gap-2 rounded-card border border-white/10 bg-black/20 px-4 py-2.5 text-[11px] text-slate-500">
        <ShieldCheck className="h-4 w-4 shrink-0 text-slate-400" />
        Isolamento por tenant · Auditoria automática · LGPD (ConsentRecord) — sempre ativos, não configuráveis por aqui
      </div>

      {askingAgent && <AskAgentModal agent={askingAgent} onClose={() => setAskingAgent(null)} />}
    </div>
  );
}

interface AskAgentModalProps {
  agent: Agent;
  onClose: () => void;
}

/**
 * Único ponto da interface que chama agency.ask_as_agent — sem isso, o
 * Policy Engine, os níveis de autonomia e o RAG escopado por setor
 * nunca eram de fato exercitados por ninguém usando o Studio (só por
 * teste automatizado ou chamada manual de API).
 */
function AskAgentModal({ agent, onClose }: AskAgentModalProps) {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AgentAskResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await askAsAgent(agent.id, question.trim());
      setResult(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao perguntar ao agente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg space-y-4 rounded-card border border-white/10 bg-surface-raised p-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-100">Perguntar para {agent.name}</h3>
            <p className="text-[11px] text-slate-500">{agent.role}</p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-200">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            rows={3}
            required
            autoFocus
            placeholder="O que você quer perguntar a este agente?"
            className="w-full resize-none rounded-md border border-white/10 bg-surface px-3 py-2 text-sm text-slate-100 focus:border-brand-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={loading || !question.trim()}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:opacity-40"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
            {loading ? "Perguntando..." : "Perguntar"}
          </button>
        </form>

        {error && <p className="rounded-card border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>}

        {result && result.status === "pending_approval" && (
          <div className="rounded-card border border-yellow-500/20 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-400">
            Esta ação precisa de aprovação humana antes de executar — veja a aba
            "Aprovações". {result.answer}
          </div>
        )}

        {result && result.status === "ok" && (
          <div className="rounded-card border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-200">
            {result.answer}
            {result.function_called && (
              <p className="mt-1.5 text-[10px] text-slate-500">função usada: {result.function_called}</p>
            )}
          </div>
        )}

        {result && (result.status === "function_error" || result.status === "llm_error" || result.status === "rejected") && (
          <div className="rounded-card border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400">{result.answer}</div>
        )}
      </div>
    </div>
  );
}
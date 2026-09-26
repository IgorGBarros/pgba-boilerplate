// OfficeOverlays.tsx — Painéis HTML do Escritório 3D
// Adaptados dos componentes ActivityPanel / TopBar / RoomModal /
// MeetingModal / AgentModal do escritorio_virtual_agentes para usar
// os tipos reais de Agent/Sector do backend (via office-types.ts).
import { useEffect, useRef, useState } from "react";
import {
  Activity,
  Crown,
  ChevronRight,
  DoorOpen,
  Gauge,
  History,
  ListTodo,
  Loader2,
  PanelRight,
  ShieldAlert,
  Pause,
  Play,
  Send,
  TrendingUp,
  Users,
  X,
} from "lucide-react";
import {
  ApiError,
  askAsAgent,
  getSectorMetrics,
  updateSector,
  type AgentAskResult,
  type AIStatus,
  type Sector,
  type SectorMessage,
  type SectorMetric,
  type Task,
} from "@/lib/api";
import { PROVIDERS, PROVIDER_LABEL, formatUsd, providerName, sumByProvider } from "./office3d/providers";
import { ProviderCosts } from "./office3d/ProviderCosts";
import { RoomTaskBoard } from "./office3d/RoomTaskBoard";
import { SendMessageForm } from "./office3d/SendMessageForm";
import {
  getOrchestrators,
  getSectorAgents,
  getSectorOrchestrator,
  type ActivityLog,
  type MeetingMessage,
  type MeetingType,
  type OfficeAgent,
  type OfficeStatus,
  STATUS_DOT,
  STATUS_LABELS,
} from "./office-types";

// ─── Activity Panel ────────────────────────────────────────────────────────────

export function ActivityPanel({
  logs,
  open,
  onClose,
}: {
  logs: ActivityLog[];
  open: boolean;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState<OfficeStatus | "all">("all");
  const filtered = filter === "all" ? logs : logs.filter((l) => l.status === filter);

  if (!open) return null;

  return (
    <div className="absolute bottom-3 left-3 top-3 z-30 flex w-64 flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white/95 shadow-lg backdrop-blur-sm">
      <div className="border-b border-stone-100 px-3.5 pb-2.5 pt-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Activity className="size-3.5 text-stone-500" />
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-800">Atividade</h2>
            <span className="rounded-full bg-stone-100 px-1.5 font-mono text-[10px] text-stone-500">{logs.length}</span>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-800">
            <X className="size-3.5" />
          </button>
        </div>
        <div className="flex flex-wrap gap-1">
          {(["all", "working", "idle", "meeting", "paused"] as const).map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setFilter(st)}
              className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors ${
                filter === st ? "bg-stone-900 text-white" : "bg-stone-100 text-stone-500 hover:bg-stone-200"
              }`}
            >
              {st === "all" ? "Todos" : STATUS_LABELS[st]}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-1.5">
        {filtered.slice(0, 60).map((log) => (
          <div key={log.id} className="relative border-l border-stone-200 py-1.5 pl-3 ml-1.5">
            <span className={`absolute -left-[4.5px] top-2.5 size-2 rounded-full ring-2 ring-white ${STATUS_DOT[log.status]}`} />
            <div className="flex items-baseline gap-1.5">
              <span className="truncate text-[11px] font-semibold text-stone-800">{log.agentName}</span>
              <span className="ml-auto shrink-0 font-mono text-[9px] text-stone-400">
                {log.timestamp.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
            </div>
            <p className="text-[11px] leading-snug text-stone-600">{log.action}</p>
            <p className="text-[10px] text-stone-400">{log.room}</p>
          </div>
        ))}
        {filtered.length === 0 && (
          <p className="px-4 py-10 text-center text-[11px] text-stone-400">
            Nenhuma atividade ainda — mudanças de status dos agentes aparecem aqui em tempo real.
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Top Bar ───────────────────────────────────────────────────────────────────

const AUTONOMY_SLIDER_LABELS = ["Baixo", "Médio", "Alto"] as const;
const AUTONOMY_SLIDER_DESC   = ["Observador", "Executor", "Autônomo"] as const;

export function OfficeTopBar({
  agents,
  connected,
  paused,
  autonomySlider,
  activityOpen,
  panelOpen,
  onTogglePause,
  onAutonomyChange,
  onCallMeeting,
  onEndMeeting,
  onToggleActivity,
  onTogglePanel,
  onOpenConsole,
  pendingApprovals = 0,
  onOpenApprovals,
  budgetAlerts = 0,
  aiProblems = 0,
  replaying = false,
  onToggleReplay,
}: {
  agents: OfficeAgent[];
  connected: boolean;
  paused: boolean;
  autonomySlider: number;
  activityOpen: boolean;
  panelOpen: boolean;
  onTogglePause: () => void;
  onAutonomyChange: (v: number) => void;
  onCallMeeting: () => void;
  onEndMeeting: () => void;
  onToggleActivity: () => void;
  onTogglePanel: () => void;
  onOpenConsole: () => void;
  pendingApprovals?: number;
  onOpenApprovals?: () => void;
  /** Setores com gasto do mês ≥ 80% do orçamento. */
  budgetAlerts?: number;
  /** Setores cuja IA não tem credencial/modelo configurado. */
  aiProblems?: number;
  replaying?: boolean;
  onToggleReplay?: () => void;
}) {
  const active = agents.filter((a) => a.status === "working" || a.status === "thinking").length;
  const inMeeting = agents.filter((a) => a.status === "meeting").length;
  const pausedCount = agents.filter((a) => a.status === "paused").length;
  const occupancy = agents.length > 0 ? Math.round((active / agents.length) * 100) : 0;
  const hasMeeting = inMeeting > 0;

  // Zoom e vistas ficam na barra da própria cena (CompanyOffice3D) — aqui
  // só o que é sobre a EMPRESA: estado ao vivo, ocupação, comportamento,
  // reunião, console e painéis.
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-stone-200 bg-[#faf8f4] px-4 py-2">
      {/* Título + ao vivo */}
      <div className="flex items-center gap-2">
        <span
          className={`size-2 rounded-full ${connected ? "animate-pulse bg-emerald-500" : "bg-amber-500"}`}
          title={connected ? "Tempo real conectado (WebSocket)" : "Reconectando — usando polling"}
        />
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-800">Escritório</span>
        <span className="text-[10px] text-stone-400">{connected ? "ao vivo" : "reconectando…"}</span>
      </div>

      {/* KPIs */}
      <div className="flex items-center gap-3 text-[11px] text-stone-500">
        <span>
          <b className="font-mono text-sm text-stone-900">{active}</b>
          <span className="text-stone-400">/{agents.length}</span> trabalhando
        </span>
        {hasMeeting && (
          <span>
            <b className="font-mono text-sm text-violet-600">{inMeeting}</b> em reunião
          </span>
        )}
        {pausedCount > 0 && (
          <span>
            <b className="font-mono text-sm text-amber-600">{pausedCount}</b> pausado{pausedCount > 1 ? "s" : ""}
          </span>
        )}
        <span className="flex items-center gap-1.5" title="Agentes trabalhando agora ÷ total de agentes">
          Ocupação
          <span className="h-1.5 w-16 overflow-hidden rounded-full bg-stone-200">
            <span className="block h-full rounded-full bg-emerald-500 transition-all duration-500" style={{ width: `${occupancy}%` }} />
          </span>
          <span className="font-mono text-[10px] text-stone-700">{occupancy}%</span>
        </span>
      </div>

      {/* Comportamento (autonomia) */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-wider text-stone-400">Comportamento</span>
        <div className="flex rounded-full border border-stone-200 bg-white p-0.5">
          {AUTONOMY_SLIDER_LABELS.map((label, i) => (
            <button
              key={label}
              type="button"
              onClick={() => onAutonomyChange(i)}
              title={AUTONOMY_SLIDER_DESC[i]}
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                autonomySlider === i ? "bg-stone-900 text-white" : "text-stone-500 hover:text-stone-900"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="text-[10px] italic text-stone-400">{AUTONOMY_SLIDER_DESC[autonomySlider]}</span>
      </div>

      {/* Ações */}
      <div className="ml-auto flex items-center gap-1.5">
        {aiProblems > 0 && (
          <span
            title="Setor(es) com IA fixa sem credencial ou modelo — as chamadas deles falham até configurar (configure_ai_provider). Passe o mouse na etiqueta do setor."
            className="flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-700"
          >
            ⚠ IA sem credencial · {aiProblems}
          </span>
        )}
        {budgetAlerts > 0 && (
          <button
            type="button"
            onClick={onOpenConsole}
            title="Setores com gasto do mês acima de 80% do orçamento"
            className="flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800 transition hover:bg-amber-100"
          >
            $ orçamento · {budgetAlerts} setor{budgetAlerts > 1 ? "es" : ""}
          </button>
        )}
        {pendingApprovals > 0 && (
          <button
            type="button"
            onClick={onOpenApprovals}
            disabled={!onOpenApprovals}
            title={onOpenApprovals ? "Ações bloqueadas pela política de autonomia esperando decisão humana" : "Pendentes naquele instante (replay)"}
            className="flex items-center gap-1.5 rounded-full border border-orange-300 bg-orange-50 px-3 py-1 text-[11px] font-semibold text-orange-700 transition hover:bg-orange-100 disabled:cursor-default disabled:hover:bg-orange-50"
          >
            <ShieldAlert className="size-3.5" />
            {pendingApprovals} {pendingApprovals === 1 ? "aprovação" : "aprovações"}
          </button>
        )}
        <button
          type="button"
          onClick={onCallMeeting}
          className="flex items-center gap-1.5 rounded-full bg-stone-900 px-3 py-1 text-[11px] font-semibold text-white transition hover:bg-stone-700"
        >
          <Users className="size-3.5" />
          Reunião
        </button>
        {hasMeeting && (
          <button
            type="button"
            onClick={onEndMeeting}
            className="flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-[11px] font-semibold text-violet-700 transition hover:bg-violet-100"
          >
            <DoorOpen className="size-3.5" />
            Encerrar reunião
          </button>
        )}
        <button
          type="button"
          onClick={onOpenConsole}
          className="flex items-center gap-1.5 rounded-full border border-stone-200 bg-white px-3 py-1 text-[11px] font-medium text-stone-700 transition hover:bg-stone-50"
          title="Console — custo do mês por setor e por IA"
        >
          <Gauge className="size-3.5" />
          Console
        </button>
        {onToggleReplay && (
          <button
            type="button"
            onClick={onToggleReplay}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium transition ${
              replaying ? "border-sky-300 bg-sky-50 text-sky-800 hover:bg-sky-100" : "border-stone-200 bg-white text-stone-700 hover:bg-stone-50"
            }`}
            title="Rever o dia: quem trabalhou, mensagens e aprovações"
          >
            <History className="size-3.5" />
            {replaying ? "Voltar ao vivo" : "Linha do tempo"}
          </button>
        )}

        <span className="mx-1 h-4 w-px bg-stone-200" />

        <button
          type="button"
          onClick={onToggleActivity}
          title="Painel de atividade"
          className={`rounded-full p-1.5 transition ${activityOpen ? "bg-stone-900 text-white" : "text-stone-500 hover:bg-stone-200 hover:text-stone-900"}`}
        >
          <Activity className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={onTogglePanel}
          title="Painel de agentes"
          className={`rounded-full p-1.5 transition ${panelOpen ? "bg-stone-900 text-white" : "text-stone-500 hover:bg-stone-200 hover:text-stone-900"}`}
        >
          <PanelRight className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={onTogglePause}
          className="rounded-full p-1.5 text-stone-500 transition hover:bg-stone-200 hover:text-stone-900"
          title={paused ? "Retomar atualização" : "Pausar atualização (polling)"}
        >
          {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
        </button>
      </div>
    </div>
  );
}

// ─── Moldura comum dos diálogos (tema claro, cobre só a área do escritório) ─────

function OfficeDialog({
  open,
  onClose,
  icon,
  title,
  subtitle,
  width = "max-w-md",
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  icon?: React.ReactNode;
  title: string;
  subtitle?: React.ReactNode;
  width?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-stone-900/25 p-4" onClick={onClose}>
      <div
        className={`flex max-h-[88%] w-full ${width} flex-col overflow-hidden rounded-2xl border border-stone-200 bg-[#faf8f4] shadow-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 border-b border-stone-200 px-4 py-3">
          {icon}
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-800">{title}</p>
            {subtitle && <div className="text-xs text-stone-500">{subtitle}</div>}
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-1 text-stone-400 hover:bg-stone-200 hover:text-stone-800">
            <X className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-xs text-stone-600">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-stone-200 px-4 py-2.5">{footer}</div>}
      </div>
    </div>
  );
}

function AgentAvatarDot({ agent, size = 28 }: { agent: OfficeAgent; size?: number }) {
  return (
    <span
      className="relative flex shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
      style={{ background: agent.appearance.shirtColor, width: size, height: size }}
    >
      {agent.initials}
      <span className={`absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-white ${STATUS_DOT[agent.status]}`} />
    </span>
  );
}

function BudgetBar({ percent, status }: { percent: number; status: SectorMetric["status"] }) {
  const color = status === "over" ? "#ef4444" : status === "warn" ? "#f59e0b" : "#10b981";
  return (
    <div className="flex items-center gap-2" title="Gasto do mês ÷ orçamento mensal do setor">
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-stone-100">
        <span className="block h-full rounded-full" style={{ width: `${Math.min(percent, 100)}%`, background: color }} />
      </span>
      <span className="font-mono text-[10px]" style={{ color }}>{percent.toFixed(0)}%</span>
      {status !== "ok" && (
        <span className="text-[10px] font-semibold" style={{ color }}>{status === "over" ? "estourou" : "perto do limite"}</span>
      )}
    </div>
  );
}

// ─── Room Modal ────────────────────────────────────────────────────────────────

export function RoomModal({
  sector,
  sectorId,
  sectorName,
  agents,
  open,
  onClose,
  onAgentClick,
  onSectorUpdated,
  tasks = [],
  onTaskUpdated,
  metric,
  aiStatus,
}: {
  /** Setor real (null na sala CEO / reunião). */
  sector: Sector | null;
  sectorId: number | null;
  sectorName: string;
  agents: OfficeAgent[];
  open: boolean;
  onClose: () => void;
  onAgentClick?: (a: OfficeAgent) => void;
  onSectorUpdated?: (s: Sector) => void;
  /** Todas as Tasks — filtradas aqui pelos agentes da sala. */
  tasks?: Task[];
  onTaskUpdated?: (t: Task) => void;
  /** Custo do mês do setor (metrics/sectors). */
  metric?: SectorMetric | null;
  /** Status da IA do setor (ai-status) — sem credencial = aviso. */
  aiStatus?: AIStatus["sectors"][number] | null;
}) {
  // id -2 = sala CEO: quem não tem setor (CEO / Orquestrador-Geral)
  const roomAgents = agents.filter((a) => (sectorId === -2 ? a.sectorId == null : a.sectorId === sectorId));
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setProvider(sector?.default_provider ?? "");
    setModel(sector?.default_model ?? "");
    setSaveMsg(null);
  }, [open, sector]);

  const dirty = !!sector && (provider !== (sector.default_provider ?? "") || model !== (sector.default_model ?? ""));

  const save = async () => {
    if (!sector) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const updated = await updateSector(sector.id, { default_provider: provider, default_model: model });
      onSectorUpdated?.(updated);
      setSaveMsg({ ok: true, text: "Salvo. As próximas chamadas deste setor já usam essa IA." });
    } catch (e) {
      setSaveMsg({ ok: false, text: e instanceof ApiError ? e.message : "Falha ao salvar." });
    } finally {
      setSaving(false);
    }
  };

  const working = roomAgents.filter((a) => a.status === "working").length;
  const roomAgentIds = new Set(roomAgents.map((a) => a.id));
  const roomTasks = tasks.filter((t) => roomAgentIds.has(t.agent));

  return (
    <OfficeDialog
      open={open}
      onClose={onClose}
      width="max-w-2xl"
      icon={<span className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-stone-200 text-stone-700"><DoorOpen className="size-4" /></span>}
      title={`Sala · ${sectorName}`}
      subtitle={`${roomAgents.length} ${roomAgents.length === 1 ? "agente" : "agentes"} · ${working} trabalhando`}
    >
      {aiStatus && !aiStatus.ready && (
        <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-800">
          <b>⚠ A IA deste setor ({providerName(aiStatus.provider)}) não está pronta.</b> As chamadas dos agentes daqui
          falham até configurar — sem cair em outro provedor.
          <span className="mt-0.5 block font-mono text-[10px] text-red-700/80">{aiStatus.detail}</span>
        </div>
      )}
      <div className="space-y-1">
        {roomAgents.length === 0 && <p className="py-4 text-center text-stone-400">Nenhum agente nesta sala.</p>}
        {roomAgents.map((agent) => (
          <button
            key={agent.id}
            type="button"
            onClick={() => onAgentClick?.(agent)}
            className="flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left hover:bg-white"
          >
            <AgentAvatarDot agent={agent} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1 text-[12px] font-medium text-stone-900">
                {(agent.isOrchestrator || agent.access_level === "ceo") && <Crown className="size-3 text-amber-500" />}
                <span className="truncate">{agent.name}</span>
              </span>
              <span className="block truncate text-[10px] text-stone-500">
                {agent.status === "working" ? <span className="text-emerald-700">{agent.currentTask}</span> : `${STATUS_LABELS[agent.status]} · ${agent.role}`}
              </span>
            </span>
            <ChevronRight className="size-3 text-stone-300" />
          </button>
        ))}
      </div>

      {onTaskUpdated && roomAgents.length > 0 && (
        <div className="mt-4">
          <p className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-stone-500">
            <ListTodo className="size-3" /> Tarefas
          </p>
          <RoomTaskBoard tasks={roomTasks} agents={roomAgents} onTaskUpdated={onTaskUpdated} />
        </div>
      )}

      {metric && (
        <div className="mt-4 rounded-xl border border-stone-200 bg-white px-3 py-2.5">
          <p className="mb-1 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-stone-500">
            Custo do mês
            <span className="font-mono normal-case tracking-normal text-stone-800">
              {formatUsd(metric.month_cost_usd)}
              {metric.budget_usd > 0 && <span className="text-stone-400"> / {formatUsd(metric.budget_usd)}</span>}
            </span>
          </p>
          {metric.usage_percent !== null && (
            <BudgetBar percent={metric.usage_percent} status={metric.status} />
          )}
          <div className="mt-2">
            <ProviderCosts rows={metric.month_by_provider} />
          </div>
        </div>
      )}

      {sector && (
        <div className="mt-4 rounded-xl border border-stone-200 bg-white px-3 py-2.5">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-stone-500">IA do setor</p>
          <p className="mb-2 text-[11px] text-stone-500">
            Fixar um provedor faz todos os agentes do setor usarem só ele — sem cair em outro se a chave faltar.
            A chave de API continua em <code>configure_ai_provider</code>.
          </p>
          <div className="flex gap-2">
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="h-8 flex-1 rounded-lg border border-stone-200 bg-white px-2 text-xs text-stone-800"
            >
              <option value="">Padrão do tenant</option>
              {PROVIDERS.map((p) => <option key={p} value={p}>{PROVIDER_LABEL[p]}</option>)}
            </select>
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={!provider}
              placeholder={provider ? "modelo (opcional)" : "—"}
              className="h-8 flex-1 rounded-lg border border-stone-200 bg-white px-2 font-mono text-[11px] text-stone-800 disabled:bg-stone-50"
            />
          </div>
          {saveMsg && (
            <p className={`mt-2 rounded px-2 py-1 text-[11px] ${saveMsg.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{saveMsg.text}</p>
          )}
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={save}
              disabled={!dirty || saving}
              className="rounded-full bg-stone-900 px-3 py-1 text-[11px] font-semibold text-white hover:bg-stone-700 disabled:opacity-40"
            >
              {saving ? "Salvando…" : "Salvar IA do setor"}
            </button>
          </div>
        </div>
      )}
    </OfficeDialog>
  );
}

// ─── Agent Modal ───────────────────────────────────────────────────────────────

const LEVEL_LABEL: Record<string, string> = {
  ceo: "CEO",
  general_orchestrator: "Orquestrador-Geral",
  sector_orchestrator: "Orquestrador de setor",
  operational: "Operacional",
};
const AUTONOMY_LABEL = ["Observador", "Recomendador", "Executor supervisionado", "Executor por política", "Autônomo"];

export function AgentModal({
  agent,
  open,
  onClose,
  sectors = [],
  onMessageSent,
}: {
  agent: OfficeAgent | null;
  open: boolean;
  onClose: () => void;
  sectors?: Sector[];
  /** Pedido para outro setor registrado (envelope pendente na porta). */
  onMessageSent?: (m: SectorMessage) => void;
}) {
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<AgentAskResult | null>(null);
  const [askError, setAskError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuestion(""); setAnswer(null); setAskError(null); setAsking(false);
  }, [open, agent?.id]);

  if (!agent) return null;

  const ask = async () => {
    if (!question.trim()) return;
    setAsking(true); setAnswer(null); setAskError(null);
    try {
      setAnswer(await askAsAgent(agent.id, question.trim()));
    } catch (e) {
      setAskError(e instanceof ApiError ? e.message : "Falha ao perguntar ao agente.");
    } finally {
      setAsking(false);
    }
  };

  const rows: Array<[string, React.ReactNode]> = [
    ["Status", <span key="s" className="flex items-center gap-1.5"><span className={`size-2 rounded-full ${STATUS_DOT[agent.status]}`} />{STATUS_LABELS[agent.status]}</span>],
    ["Nível", LEVEL_LABEL[agent.access_level] ?? agent.access_level],
    ["Autonomia", AUTONOMY_LABEL[agent.autonomy_level] ?? agent.autonomy_level],
    ["Setor", agent.sectorId == null ? "Diretoria (sem setor)" : agent.sectorName],
    ["Tarefa atual", agent.currentTask],
  ];

  return (
    <OfficeDialog
      open={open}
      onClose={onClose}
      icon={<AgentAvatarDot agent={agent} size={32} />}
      title={agent.name}
      subtitle={agent.role}
    >
      <dl className="divide-y divide-stone-100 rounded-xl border border-stone-200 bg-white">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-3 px-3 py-2">
            <dt className="text-[11px] text-stone-500">{k}</dt>
            <dd className="text-right text-[12px] font-medium text-stone-800">{v}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-4">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-stone-500">Perguntar a este agente</p>
        <p className="mb-2 text-[11px] text-stone-500">
          Resposta de verdade, com o cérebro e a IA do setor dele. Ações acima da autonomia dele viram aprovação pendente.
        </p>
        <div className="flex gap-2">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !asking && ask()}
            placeholder="Ex: qual o status das entregas desta semana?"
            className="h-8 flex-1 rounded-lg border border-stone-200 bg-white px-2.5 text-xs text-stone-800 outline-none focus:border-stone-400"
          />
          <button
            type="button"
            onClick={ask}
            disabled={asking || !question.trim()}
            className="flex items-center gap-1 rounded-lg bg-stone-900 px-3 text-xs font-semibold text-white hover:bg-stone-700 disabled:opacity-40"
          >
            {asking ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
          </button>
        </div>
        {askError && <p className="mt-2 rounded bg-red-50 px-2 py-1 text-red-700">{askError}</p>}
        {answer && (
          <div className={`mt-2 rounded-xl border px-3 py-2 ${answer.status === "pending_approval" ? "border-orange-200 bg-orange-50" : "border-stone-200 bg-white"}`}>
            <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-stone-800">{answer.answer}</p>
            {answer.function_called && <p className="mt-1 font-mono text-[10px] text-stone-400">função: {answer.function_called}</p>}
            {answer.sources.length > 0 && (
              <p className="mt-1 text-[10px] text-stone-500">Fontes: {answer.sources.map((s) => s.document).join(" · ")}</p>
            )}
          </div>
        )}
      </div>

      {onMessageSent && (
        <div className="mt-4">
          <SendMessageForm agent={agent} sectors={sectors} onSent={onMessageSent} />
        </div>
      )}
    </OfficeDialog>
  );
}

// ─── Draggable floating panel ──────────────────────────────────────────────────

function useDrag(initialX: number, initialY: number) {
  const [pos, setPos] = useState({ x: initialX, y: initialY });
  const dragging = useRef(false);
  const origin = useRef({ mx: 0, my: 0, px: 0, py: 0 });

  const onMouseDown = (e: React.MouseEvent) => {
    dragging.current = true;
    origin.current = { mx: e.clientX, my: e.clientY, px: pos.x, py: pos.y };
    e.preventDefault();
  };

  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!dragging.current) return;
      setPos({
        x: origin.current.px + e.clientX - origin.current.mx,
        y: origin.current.py + e.clientY - origin.current.my,
      });
    };
    const up = () => { dragging.current = false; };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
  }, []);

  return { pos, onMouseDown };
}

// ─── Meeting Modal ─────────────────────────────────────────────────────────────

/** Quantos participantes respondem cada mensagem (cada resposta = 1 chamada de IA real). */
const MEETING_MAX_ANSWERS = 6;

export function MeetingModal({
  open,
  onClose,
  agents,
  sectors,
  onStartMeeting,
  onEndMeeting,
}: {
  open: boolean;
  onClose: () => void;
  agents: OfficeAgent[];
  sectors: Sector[];
  onStartMeeting?: (ids: number[]) => void;
  onEndMeeting?: () => void;
}) {
  const [meetingType, setMeetingType] = useState<MeetingType>("all-sectors");
  const [selectedSectorId, setSelectedSectorId] = useState<number | null>(sectors[0]?.id ?? null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [messages, setMessages] = useState<Array<MeetingMessage & { pending?: boolean; failed?: boolean }>>([]);
  const [input, setInput] = useState("");
  const [meetingStarted, setMeetingStarted] = useState(false);
  const [waiting, setWaiting] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setSelectedIds([]);
    setMessages([]);
    setInput("");
    setMeetingStarted(false);
    setWaiting(0);
    setMeetingType("all-sectors");
    if (sectors.length > 0) setSelectedSectorId(sectors[0]!.id);
  }, [open, sectors]);

  // Auto-seleção pelas regras hierárquicas (CLAUDE.md §7)
  useEffect(() => {
    if (meetingStarted) return;
    if (meetingType === "all-sectors") {
      setSelectedIds(getOrchestrators(agents).map((a) => a.id));
    } else if (selectedSectorId != null) {
      const orch = getSectorOrchestrator(agents, selectedSectorId);
      const operacionais = getSectorAgents(agents, selectedSectorId);
      setSelectedIds([...(orch ? [orch.id] : []), ...operacionais.map((a) => a.id)]);
    }
  }, [meetingType, selectedSectorId, agents, meetingStarted]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const toggle = (id: number) => {
    if (meetingType === "all-sectors") {
      const a = agents.find((x) => x.id === id);
      if (a && !a.isOrchestrator && a.access_level !== "ceo") return;
    }
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const system = (message: string) => ({
    id: crypto.randomUUID(), agentId: "system", agentName: "Sistema", message, timestamp: new Date(), type: "system" as const,
  });

  const startMeeting = () => {
    if (selectedIds.length === 0) return;
    setMeetingStarted(true);
    onStartMeeting?.(selectedIds);
    const names = agents.filter((a) => selectedIds.includes(a.id)).map((a) => a.name).join(", ");
    const typeLabel = meetingType === "all-sectors"
      ? "Reunião geral (orquestradores)"
      : `Reunião do setor ${sectors.find((s) => s.id === selectedSectorId)?.name ?? ""}`;
    setMessages([system(`${typeLabel} · participantes: ${names}`)]);
  };

  const endMeeting = () => {
    setMessages((prev) => [...prev, system("Reunião encerrada. Agentes voltando às suas salas.")]);
    onEndMeeting?.();
    setTimeout(onClose, 1500);
  };

  // Cada participante responde DE VERDADE (POST agents/{id}/ask/ — mesma IA,
  // cérebro e política de autonomia do agente). Antes eram frases fixas
  // geradas no navegador, sem nenhuma chamada ao backend.
  const sendMessage = () => {
    const text = input.trim();
    if (!text || waiting > 0) return;
    setInput("");
    const responders = agents.filter((a) => selectedIds.includes(a.id)).slice(0, MEETING_MAX_ANSWERS);
    const placeholders = responders.map((a) => ({
      id: `${Date.now()}-${a.id}`, agentId: String(a.id), agentName: a.name,
      message: "pensando…", timestamp: new Date(), type: "response" as const, pending: true,
    }));
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), agentId: "user", agentName: "Você", message: text, timestamp: new Date(), type: "task" },
      ...(selectedIds.length > MEETING_MAX_ANSWERS
        ? [system(`Só os ${MEETING_MAX_ANSWERS} primeiros participantes respondem cada mensagem (cada resposta é uma chamada de IA).`)]
        : []),
      ...placeholders,
    ]);
    setWaiting(responders.length);
    responders.forEach((a, i) => {
      const pid = placeholders[i]!.id;
      askAsAgent(a.id, text)
        .then((r) => {
          const suffix = r.status === "pending_approval" ? "\n⚠ Precisa de aprovação humana antes de executar." : "";
          setMessages((prev) => prev.map((m) => (m.id === pid ? { ...m, message: r.answer + suffix, pending: false, timestamp: new Date() } : m)));
        })
        .catch((e) => {
          const msg = e instanceof ApiError ? e.message : "não conseguiu responder agora";
          setMessages((prev) => prev.map((m) => (m.id === pid ? { ...m, message: `(erro: ${msg})`, pending: false, failed: true } : m)));
        })
        .finally(() => setWaiting((w) => w - 1));
    });
  };

  const visibleAgents = meetingType === "all-sectors"
    ? agents.filter((a) => a.isOrchestrator || a.access_level === "ceo")
    : agents.filter((a) => a.sectorId === selectedSectorId || a.access_level === "ceo");

  const { pos, onMouseDown } = useDrag(
    Math.max(0, window.innerWidth / 2 - 310),
    Math.max(0, window.innerHeight / 2 - 300),
  );

  if (!open) return null;

  const agentById = new Map(agents.map((a) => [String(a.id), a]));

  return (
    <div
      style={{ position: "fixed", left: pos.x, top: pos.y, zIndex: 9999, width: 620, maxHeight: "85vh" }}
      className="flex flex-col overflow-hidden rounded-2xl border border-stone-200 bg-[#faf8f4] text-stone-700 shadow-2xl"
    >
      <div
        className="flex cursor-grab select-none items-center gap-2 border-b border-stone-200 px-4 py-2.5 active:cursor-grabbing"
        onMouseDown={onMouseDown}
        title="Arraste para ver os agentes indo até a sala de reunião"
      >
        <Users className="size-4 text-stone-600" />
        <span className="flex-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-800">
          {meetingStarted ? "Reunião em andamento" : "Convocar reunião"}
        </span>
        <button type="button" onClick={onClose} className="rounded-full p-1 text-stone-400 hover:bg-stone-200 hover:text-stone-800">
          <X className="size-4" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4 text-xs">
        {!meetingStarted ? (
          <div className="space-y-4">
            <div className="flex gap-2">
              {([
                { id: "all-sectors", label: "Todos os setores", sub: "Só orquestradores participam" },
                { id: "single-sector", label: "Um setor", sub: "Orquestrador + agentes do setor" },
              ] as const).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setMeetingType(t.id)}
                  className={`flex-1 rounded-xl border px-3 py-2 text-left transition ${
                    meetingType === t.id ? "border-stone-900 bg-stone-900 text-white" : "border-stone-200 bg-white text-stone-700 hover:border-stone-400"
                  }`}
                >
                  <span className="block text-[12px] font-semibold">{t.label}</span>
                  <span className={`block text-[10px] ${meetingType === t.id ? "text-stone-300" : "text-stone-500"}`}>{t.sub}</span>
                </button>
              ))}
            </div>

            {meetingType === "single-sector" && (
              <div className="flex flex-wrap gap-1.5">
                {sectors.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSelectedSectorId(s.id)}
                    className={`rounded-full px-3 py-1 text-[11px] font-medium transition ${
                      selectedSectorId === s.id ? "bg-stone-900 text-white" : "border border-stone-200 bg-white text-stone-600 hover:bg-stone-100"
                    }`}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            )}

            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-stone-500">Participantes · {selectedIds.length}</p>
              <div className="grid grid-cols-4 gap-1.5">
                {visibleAgents.map((agent) => {
                  const disabled = meetingType === "all-sectors" && !agent.isOrchestrator && agent.access_level !== "ceo";
                  const on = selectedIds.includes(agent.id);
                  return (
                    <button
                      key={agent.id}
                      type="button"
                      onClick={() => !disabled && toggle(agent.id)}
                      className={`flex items-center gap-2 rounded-xl border px-2 py-1.5 text-left transition ${
                        disabled ? "cursor-not-allowed opacity-40" : on ? "border-stone-900 bg-white" : "border-stone-200 bg-white/60 opacity-70 hover:opacity-100"
                      }`}
                    >
                      <AgentAvatarDot agent={agent} size={24} />
                      <span className="min-w-0">
                        <span className="block truncate text-[11px] font-medium text-stone-900">{agent.name}</span>
                        <span className="block truncate text-[9px] text-stone-500">{LEVEL_LABEL[agent.access_level] ?? agent.role}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-[11px] text-stone-500">
                Cada mensagem na reunião é respondida pelos participantes de verdade (IA de cada setor).
              </span>
              <button
                type="button"
                onClick={startMeeting}
                disabled={selectedIds.length === 0}
                className="rounded-full bg-stone-900 px-4 py-1.5 text-[12px] font-semibold text-white hover:bg-stone-700 disabled:opacity-40"
              >
                Iniciar reunião
              </button>
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-[260px] max-h-[380px] flex-1 space-y-2.5 overflow-y-auto pb-2">
              {messages.map((msg) => {
                if (msg.type === "system") {
                  return (
                    <p key={msg.id} className="mx-auto w-fit max-w-[90%] rounded-full bg-stone-100 px-3 py-1 text-center text-[10px] text-stone-500">
                      {msg.message}
                    </p>
                  );
                }
                if (msg.type === "task") {
                  return (
                    <div key={msg.id} className="ml-auto w-fit max-w-[75%] rounded-2xl rounded-tr-sm bg-stone-900 px-3 py-2 text-[12px] text-white">
                      {msg.message}
                    </div>
                  );
                }
                const who = agentById.get(msg.agentId);
                return (
                  <div key={msg.id} className="flex max-w-[85%] gap-2">
                    {who && <AgentAvatarDot agent={who} size={22} />}
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold text-stone-500">{msg.agentName}</p>
                      <div className={`whitespace-pre-wrap rounded-2xl rounded-tl-sm border px-3 py-2 text-[12px] ${
                        msg.failed ? "border-red-200 bg-red-50 text-red-700" : "border-stone-200 bg-white text-stone-800"
                      }`}>
                        {msg.pending ? <span className="flex items-center gap-1.5 text-stone-400"><Loader2 className="size-3 animate-spin" />pensando…</span> : msg.message}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            <div className="flex gap-2 border-t border-stone-200 pt-3">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendMessage()}
                placeholder={waiting > 0 ? `Aguardando ${waiting} resposta(s)…` : "Pergunte ou passe uma pauta aos participantes…"}
                disabled={waiting > 0}
                className="h-9 flex-1 rounded-lg border border-stone-200 bg-white px-3 text-[12px] text-stone-800 outline-none focus:border-stone-400 disabled:bg-stone-50"
              />
              <button
                type="button"
                onClick={sendMessage}
                disabled={!input.trim() || waiting > 0}
                className="rounded-lg bg-stone-900 px-3 text-white hover:bg-stone-700 disabled:opacity-40"
              >
                <Send className="size-4" />
              </button>
              <button
                type="button"
                onClick={endMeeting}
                className="rounded-lg border border-stone-200 bg-white px-3 text-[11px] font-semibold text-stone-700 hover:bg-stone-100"
              >
                Encerrar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Agents Info Panel (direita) ───────────────────────────────────────────────

export function AgentInfoPanel({
  agents,
  open,
  onClose,
  onAgentClick,
}: {
  agents: OfficeAgent[];
  open: boolean;
  onClose: () => void;
  onAgentClick: (agent: OfficeAgent) => void;
}) {
  const [query, setQuery] = useState("");
  if (!open) return null;

  const q = query.trim().toLowerCase();
  const visible = q
    ? agents.filter((a) => `${a.name} ${a.role} ${a.sectorName}`.toLowerCase().includes(q))
    : agents;
  // Agrupa por setor; CEO/Orquestrador-Geral (sem setor) viram "Diretoria", no topo
  const groups = new Map<string, OfficeAgent[]>();
  for (const a of visible) {
    const key = a.sectorId == null ? "Diretoria" : a.sectorName;
    groups.set(key, [...(groups.get(key) ?? []), a]);
  }
  const order = [...groups.keys()].sort((a, b) => (a === "Diretoria" ? -1 : b === "Diretoria" ? 1 : a.localeCompare(b)));
  const working = agents.filter((a) => a.status === "working").length;

  return (
    <div className="absolute bottom-3 right-3 top-3 z-30 flex w-72 flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white/95 shadow-lg backdrop-blur-sm">
      <div className="border-b border-stone-100 px-3.5 pb-2.5 pt-3">
        <div className="flex items-center justify-between">
          <div className="flex items-baseline gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-800">Agentes</p>
            <span className="text-[10px] text-stone-400">{agents.length} · {working} trabalhando</span>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-800">
            <X className="size-3.5" />
          </button>
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar agente, função ou setor"
          className="mt-2 h-7 w-full rounded-full border border-stone-200 bg-stone-50 px-3 text-[11px] text-stone-800 outline-none focus:border-stone-400"
        />
      </div>
      <div className="flex-1 overflow-y-auto pb-2">
        {order.map((group) => (
          <div key={group}>
            <p className="sticky top-0 z-10 bg-white/95 px-3.5 pb-1 pt-2.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-stone-400">
              {group} · {groups.get(group)!.length}
            </p>
            {groups.get(group)!.map((agent) => (
              <button
                key={agent.id}
                type="button"
                className="flex w-full items-center gap-2.5 px-3.5 py-1.5 text-left transition hover:bg-stone-50"
                onClick={() => onAgentClick(agent)}
              >
                <span
                  className="relative flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                  style={{ background: agent.appearance.shirtColor }}
                >
                  {agent.initials}
                  <span className={`absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-white ${STATUS_DOT[agent.status]}`} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1">
                    {(agent.isOrchestrator || agent.access_level === "ceo") && <Crown className="size-3 shrink-0 text-amber-500" />}
                    <span className="truncate text-[12px] font-medium text-stone-900">{agent.name}</span>
                  </span>
                  <span className="block truncate text-[10px] text-stone-500">
                    {agent.status === "working" && agent.currentTask !== "Sem tarefa ativa"
                      ? <span className="text-emerald-700">{agent.currentTask}</span>
                      : `${STATUS_LABELS[agent.status]} · ${agent.role}`}
                  </span>
                </span>
                <ChevronRight className="size-3 shrink-0 text-stone-300" />
              </button>
            ))}
          </div>
        ))}
        {visible.length === 0 && <p className="px-4 py-8 text-center text-[11px] text-stone-400">Nenhum agente encontrado.</p>}
      </div>
    </div>
  );
}

// ─── Console Modal ─────────────────────────────────────────────────────────────

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function formatCost(usd: number): string {
  if (usd === 0) return "US$ 0,00";
  return `US$ ${usd.toFixed(4)}`;
}

export function ConsoleModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [metrics, setMetrics] = useState<SectorMetric[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    getSectorMetrics()
      .then(setMetrics)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Falha ao carregar métricas."))
      .finally(() => setLoading(false));
  }, [open]);

  const totalTokens = metrics.reduce((s, m) => s + m.tokens, 0);
  const totalCost = metrics.reduce((s, m) => s + m.cost_usd, 0);
  const monthByProvider = sumByProvider(metrics.map((m) => m.month_by_provider ?? []));
  const monthTotal = metrics.reduce((s, m) => s + (m.month_cost_usd ?? 0), 0);

  return (
    <OfficeDialog
      open={open}
      onClose={onClose}
      width="max-w-lg"
      icon={<span className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-stone-200 text-stone-700"><TrendingUp className="size-4" /></span>}
      title="Console"
      subtitle="Custo estimado do mês por setor e por IA"
    >
      {loading ? (
        <p className="py-8 text-center text-stone-400">Carregando métricas…</p>
      ) : error ? (
        <p className="rounded bg-red-50 px-3 py-2 text-red-700">{error}</p>
      ) : metrics.length === 0 ? (
        <p className="py-8 text-center text-stone-400">Nenhum dado ainda — aparece depois das primeiras interações dos agentes.</p>
      ) : (
        <div className="space-y-2">
          <div className="rounded-xl border border-stone-200 bg-white px-3 py-2.5">
            <p className="mb-1.5 flex justify-between text-[10px] font-semibold uppercase tracking-wider text-stone-500">
              Este mês, por IA
              <b className="font-mono normal-case tracking-normal text-stone-900">{formatUsd(monthTotal)}</b>
            </p>
            <ProviderCosts rows={monthByProvider} />
          </div>
          <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
            <div className="grid grid-cols-4 gap-2 border-b border-stone-100 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-stone-400">
              <span className="col-span-2">Setor · orçamento do mês</span>
              <span className="text-right">Mês</span>
              <span className="text-right">Total</span>
            </div>
            {metrics.map((m) => (
              <div key={m.sector_id} className="grid grid-cols-4 items-center gap-2 border-b border-stone-50 px-3 py-2 last:border-0">
                <div className="col-span-2 flex items-center gap-2">
                  <span className="truncate text-[12px] font-medium text-stone-800">{m.sector_name}</span>
                  {m.ai_provider && (
                    <span className="shrink-0 rounded-full bg-stone-100 px-1.5 text-[9px] text-stone-500">{providerName(m.ai_provider)}</span>
                  )}
                  {m.usage_percent !== null && (
                    <span className="flex items-center gap-1" title="Uso do orçamento mensal do setor">
                      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-stone-100">
                        <span
                          className="block h-full rounded-full"
                          style={{
                            width: `${Math.min(m.usage_percent, 100)}%`,
                            backgroundColor: m.status === "over" ? "#ef4444" : m.status === "warn" ? "#f59e0b" : "#10b981",
                          }}
                        />
                      </span>
                      <span className="font-mono text-[9px] text-stone-400">{m.usage_percent.toFixed(0)}%</span>
                    </span>
                  )}
                </div>
                <span className="text-right font-mono text-[11px] text-stone-800">{formatUsd(m.month_cost_usd ?? 0)}</span>
                <span className="text-right font-mono text-[11px] text-stone-500" title={`${formatTokens(m.tokens)} tokens desde o início`}>{formatCost(m.cost_usd)}</span>
              </div>
            ))}
          </div>
          <div className="flex justify-between rounded-xl bg-stone-900 px-3 py-2 text-[12px] text-white">
            <span className="font-semibold">Total</span>
            <span className="flex gap-5 font-mono">
              <span>{formatTokens(totalTokens)} tokens</span>
              <b>{formatCost(totalCost)}</b>
            </span>
          </div>
          <p className="text-[10px] text-stone-400">
            Custo estimado pela tabela aproximada do backend (agency.services), não pela fatura do provedor. O orçamento
            é mensal: compara com o gasto do mês corrente. Chamadas da diretoria (sem setor) não entram por setor.
          </p>
        </div>
      )}
    </OfficeDialog>
  );
}

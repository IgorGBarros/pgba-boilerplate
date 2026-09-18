// OfficeOverlays.tsx — Painéis HTML do Escritório 3D
// Adaptados dos componentes ActivityPanel / TopBar / RoomModal /
// MeetingModal / AgentModal do escritorio_virtual_agentes para usar
// os tipos reais de Agent/Sector do backend (via office-types.ts).
import { useEffect, useRef, useState } from "react";
import {
  AlertOctagon,
  Crown,
  CheckCircle2,
  ChevronRight,
  DoorOpen,
  Gauge,
  Minus,
  Pause,
  Play,
  Plus,
  Send,
  Users,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Sector } from "@/lib/api";
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
    <div className="absolute left-0 top-0 flex h-full w-60 flex-col border-r border-white/10 bg-[#0d1117]/90 backdrop-blur-sm">
      <div className="border-b border-white/10 p-3">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xs font-bold tracking-widest text-white">📡 ATIVIDADES</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="size-3.5" />
          </button>
        </div>
        <div className="flex flex-wrap gap-1">
          {(["all", "working", "thinking", "idle", "meeting", "blocked", "paused"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setFilter(s)}
              className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors ${
                filter === s
                  ? "bg-indigo-600 text-white"
                  : "bg-white/5 text-slate-400 hover:bg-white/10"
              }`}
            >
              {s === "all" ? "Todos" : STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 space-y-1 overflow-y-auto p-2">
        {filtered.slice(0, 50).map((log) => (
          <div
            key={log.id}
            className="rounded-lg bg-white/5 p-2 transition-colors hover:bg-white/8"
          >
            <div className="flex items-center gap-1.5">
              <span className={`size-2 shrink-0 rounded-full ${STATUS_DOT[log.status]}`} />
              <span className="truncate text-xs font-semibold text-white">{log.agentName}</span>
              <span className="ml-auto shrink-0 font-mono text-[10px] text-slate-500">
                {log.timestamp.toLocaleTimeString("pt-BR", {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </span>
            </div>
            <p className="mt-0.5 pl-3.5 text-[11px] text-slate-400">{log.action}</p>
            <p className="pl-3.5 text-[10px] text-slate-600">{log.room}</p>
          </div>
        ))}
        {filtered.length === 0 && (
          <p className="py-8 text-center text-xs text-slate-500">Nenhuma atividade</p>
        )}
      </div>
    </div>
  );
}

// ─── Top Bar ───────────────────────────────────────────────────────────────────

export function OfficeTopBar({
  agents,
  connected,
  paused,
  speed,
  zoom,
  activityOpen,
  panelOpen,
  onTogglePause,
  onSpeedChange,
  onZoomIn,
  onZoomOut,
  onCallMeeting,
  onEndMeeting,
  onToggleActivity,
  onTogglePanel,
}: {
  agents: OfficeAgent[];
  connected: boolean;
  paused: boolean;
  speed: number;
  zoom: number;
  activityOpen: boolean;
  panelOpen: boolean;
  onTogglePause: () => void;
  onSpeedChange: (v: number) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onCallMeeting: () => void;
  onEndMeeting: () => void;
  onToggleActivity: () => void;
  onTogglePanel: () => void;
}) {
  const active = agents.filter((a) => a.status === "working" || a.status === "thinking").length;
  const inMeeting = agents.filter((a) => a.status === "meeting").length;
  const efficiency = agents.length > 0 ? Math.round((active / agents.length) * 100) : 0;
  const hasMeeting = inMeeting > 0;

  const speedPresets = [
    { label: "1x", value: 30_000 },
    { label: "2x", value: 15_000 },
    { label: "5x", value: 6_000 },
  ];

  const effColor =
    efficiency >= 70 ? "#4ade80" : efficiency >= 40 ? "#facc15" : "#f87171";

  return (
    <div className="flex items-center gap-2 bg-[#0d1117] px-3 py-1.5 border-b border-white/10">
      {/* Play/Pause */}
      <button
        type="button"
        onClick={onTogglePause}
        className="rounded-md bg-white/10 p-1.5 text-white transition hover:bg-white/20"
        title={paused ? "Retomar" : "Pausar simulação"}
      >
        {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
      </button>

      {/* Speed */}
      <div className="flex items-center gap-0.5">
        {speedPresets.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => onSpeedChange(p.value)}
            className={`rounded px-2 py-0.5 text-xs font-bold transition-colors ${
              speed === p.value
                ? "bg-indigo-600 text-white"
                : "bg-white/10 text-slate-300 hover:bg-white/20"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="h-4 w-px bg-white/15" />

      {/* Counts */}
      <span className="text-xs font-bold text-white">
        Trabalhando:{" "}
        <span className="text-green-400">{active}</span>
      </span>
      {hasMeeting && (
        <span className="text-xs font-bold text-white">
          Reunião:{" "}
          <span className="text-purple-400">{inMeeting}</span>
        </span>
      )}

      <div className="h-4 w-px bg-white/15" />

      {/* Efficiency bar */}
      <div className="flex w-28 items-center gap-1.5 text-xs">
        <span className="shrink-0 text-slate-400">Eficiência</span>
        <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${efficiency}%`, backgroundColor: effColor }}
          />
        </div>
        <span className="shrink-0 w-8 text-right font-mono text-[10px]" style={{ color: effColor }}>
          {efficiency}%
        </span>
      </div>

      <div className="h-4 w-px bg-white/15" />

      {/* Meeting controls */}
      <button
        type="button"
        onClick={onCallMeeting}
        className="flex items-center gap-1.5 rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-bold text-white transition hover:bg-indigo-500"
      >
        <Users className="size-3.5" />
        Reunião
      </button>
      {hasMeeting && (
        <>
          <button
            type="button"
            onClick={() => {}}
            className="flex items-center gap-1 rounded-md bg-red-600/80 px-2 py-1 text-xs font-bold text-white transition hover:bg-red-500"
            title="CEO interrompe reunião"
          >
            <AlertOctagon className="size-3.5" />
            CEO: Pausar
          </button>
          <button
            type="button"
            onClick={onEndMeeting}
            className="flex items-center gap-1 rounded-md bg-white/10 px-2 py-1 text-xs font-bold text-white transition hover:bg-white/20"
          >
            <DoorOpen className="size-3.5" />
            Encerrar
          </button>
        </>
      )}

      {/* Console */}
      <button
        type="button"
        disabled
        className="ml-auto flex items-center gap-1.5 rounded-md bg-white/5 px-2.5 py-1 font-mono text-xs uppercase tracking-wider text-slate-500"
        title="Console (em breve)"
      >
        <Gauge className="size-3.5" />
        Console
      </button>

      {/* Zoom */}
      <div className="flex items-center gap-0.5">
        <button type="button" onClick={onZoomOut} className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-white">
          <Minus className="size-3.5" />
        </button>
        <span className="w-10 text-center font-mono text-[10px] text-slate-400">
          {Math.round(zoom * 100)}%
        </span>
        <button type="button" onClick={onZoomIn} className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-white">
          <Plus className="size-3.5" />
        </button>
      </div>

      <div className="h-4 w-px bg-white/15" />

      {/* Toggle side panels */}
      <button
        type="button"
        onClick={onToggleActivity}
        title="Painel de atividades"
        className={`rounded p-1 text-xs transition ${activityOpen ? "bg-indigo-600/30 text-indigo-400" : "text-slate-500 hover:bg-white/10 hover:text-white"}`}
      >
        📡
      </button>
      <button
        type="button"
        onClick={onTogglePanel}
        title="Painel de agentes"
        className={`rounded p-1 transition ${panelOpen ? "bg-indigo-600/30 text-indigo-400" : "text-slate-500 hover:bg-white/10 hover:text-white"}`}
      >
        <Users className="size-3.5" />
      </button>

      {/* Connection */}
      <div className={`size-2 rounded-full ${connected ? "bg-green-500" : "bg-red-500"}`} title={connected ? "Ao vivo" : "Reconectando"} />
    </div>
  );
}

// ─── Room Modal ────────────────────────────────────────────────────────────────

export function RoomModal({
  sectorId,
  sectorName,
  agents,
  open,
  onClose,
}: {
  sectorId: number | null;
  sectorName: string;
  agents: OfficeAgent[];
  open: boolean;
  onClose: () => void;
}) {
  const roomAgents = agents.filter((a) => a.sectorId === sectorId);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Sala: {sectorName}</DialogTitle>
        </DialogHeader>
        <div className="mt-2 space-y-2">
          {roomAgents.length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Nenhum agente nesta sala
            </p>
          )}
          {roomAgents.map((agent) => (
            <div key={agent.id} className="flex items-center gap-3 rounded-lg bg-secondary p-3">
              <span className={`size-2.5 shrink-0 rounded-full ${STATUS_DOT[agent.status]}`} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{agent.name}</p>
                <p className="truncate text-xs text-muted-foreground">{agent.currentTask}</p>
              </div>
              <span className="shrink-0 text-[10px] font-medium text-muted-foreground">
                {STATUS_LABELS[agent.status]}
              </span>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Agent Modal ───────────────────────────────────────────────────────────────

const seniorityLabel: Record<string, string> = {
  ceo: "👑 CEO",
  general_orchestrator: "🥇 Orq. Geral",
  sector_orchestrator: "🥈 Orq. Setor",
  operational: "🥉 Operacional",
};

export function AgentModal({
  agent,
  open,
  onClose,
}: {
  agent: OfficeAgent | null;
  open: boolean;
  onClose: () => void;
}) {
  if (!agent) return null;
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[380px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div
              className="flex size-12 items-center justify-center rounded-full text-sm font-bold text-white"
              style={{ backgroundColor: agent.appearance.shirtColor }}
            >
              {agent.initials}
            </div>
            <div>
              <p className="text-base font-bold">{agent.name}</p>
              <p className="text-xs font-normal text-muted-foreground">{agent.role}</p>
            </div>
          </DialogTitle>
        </DialogHeader>
        <div className="mt-2 space-y-3">
          <div className="flex items-center justify-between rounded-lg bg-secondary p-3">
            <span className="text-xs text-muted-foreground">Status</span>
            <div className="flex items-center gap-1.5">
              <span className={`size-2.5 rounded-full ${STATUS_DOT[agent.status]}`} />
              <span className="text-xs font-semibold">{STATUS_LABELS[agent.status]}</span>
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg bg-secondary p-3">
            <span className="text-xs text-muted-foreground">Nível</span>
            <span className="text-xs font-semibold">
              {seniorityLabel[agent.access_level] ?? agent.access_level}
            </span>
          </div>
          <div className="flex items-center justify-between rounded-lg bg-secondary p-3">
            <span className="text-xs text-muted-foreground">Setor</span>
            <span className="text-xs font-semibold">{agent.sectorName}</span>
          </div>
          <div className="rounded-lg bg-secondary p-3">
            <span className="text-xs text-muted-foreground">Tarefa Atual</span>
            <p className="mt-1 text-sm font-medium">{agent.currentTask}</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Meeting Modal ─────────────────────────────────────────────────────────────

function TinyAvatar({
  agent,
  selected,
  disabled,
}: {
  agent: OfficeAgent;
  selected: boolean;
  disabled?: boolean;
}) {
  return (
    <div
      className={`relative flex size-10 items-center justify-center rounded-full text-[10px] font-bold transition-all ${
        disabled
          ? "cursor-not-allowed opacity-30"
          : selected
          ? "scale-110 ring-2 ring-primary"
          : "opacity-60"
      }`}
      style={{ backgroundColor: agent.appearance.shirtColor }}
    >
      <span className="text-white">{agent.initials}</span>
      {agent.isOrchestrator && (
        <Crown className="absolute -left-1 -top-1 size-3.5 text-yellow-400" />
      )}
      {selected && (
        <CheckCircle2 className="absolute -right-1 -top-1 size-4 fill-primary-foreground text-primary" />
      )}
    </div>
  );
}

function agentResponse(agent: OfficeAgent): string {
  if (agent.access_level === "ceo")
    return "Entendido. Vou alinhar com os stakeholders e garantir os recursos necessários.";
  if (agent.isOrchestrator)
    return "Vou coordenar o fluxo e distribuir as tarefas para minha equipe.";
  return "Entendido! Vou começar imediatamente e reportar o progresso.";
}

export function MeetingModal({
  open,
  onClose,
  agents,
  sectors,
}: {
  open: boolean;
  onClose: () => void;
  agents: OfficeAgent[];
  sectors: Sector[];
}) {
  const [meetingType, setMeetingType] = useState<MeetingType>("all-sectors");
  const [selectedSectorId, setSelectedSectorId] = useState<number | null>(
    sectors[0]?.id ?? null,
  );
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [messages, setMessages] = useState<MeetingMessage[]>([]);
  const [input, setInput] = useState("");
  const [meetingStarted, setMeetingStarted] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Reset ao abrir
  useEffect(() => {
    if (!open) return;
    setSelectedIds([]);
    setMessages([]);
    setInput("");
    setMeetingStarted(false);
    setMeetingType("all-sectors");
    if (sectors.length > 0) setSelectedSectorId(sectors[0]!.id);
  }, [open, sectors]);

  // Auto-seleção baseada no tipo de reunião e regras hierárquicas (CLAUDE.md §7)
  useEffect(() => {
    if (meetingStarted) return;
    if (meetingType === "all-sectors") {
      const ids = getOrchestrators(agents).map((a) => a.id);
      setSelectedIds(ids);
    } else if (selectedSectorId != null) {
      const orch = getSectorOrchestrator(agents, selectedSectorId);
      const operacionais = getSectorAgents(agents, selectedSectorId);
      setSelectedIds([
        ...(orch ? [orch.id] : []),
        ...operacionais.map((a) => a.id),
      ]);
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
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const startMeeting = () => {
    if (selectedIds.length === 0) return;
    setMeetingStarted(true);
    const names = agents
      .filter((a) => selectedIds.includes(a.id))
      .map((a) => a.name)
      .join(", ");
    const typeLabel =
      meetingType === "all-sectors"
        ? "🌐 Reunião Geral (Orquestradores)"
        : `📋 Reunião do setor: ${sectors.find((s) => s.id === selectedSectorId)?.name ?? ""}`;
    setMessages([
      {
        id: crypto.randomUUID(),
        agentId: "system",
        agentName: "Sistema",
        message: `${typeLabel}\nParticipantes: ${names}`,
        timestamp: new Date(),
        type: "system",
      },
    ]);
  };

  const endMeeting = () => {
    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        agentId: "system",
        agentName: "Sistema",
        message: "📍 Reunião encerrada. Agentes retornando às suas salas.",
        timestamp: new Date(),
        type: "system",
      },
    ]);
    setTimeout(onClose, 1800);
  };

  const sendMessage = () => {
    if (!input.trim()) return;
    const userMsg: MeetingMessage = {
      id: crypto.randomUUID(),
      agentId: "user",
      agentName: "CEO",
      message: input,
      timestamp: new Date(),
      type: "task",
    };
    setMessages((prev) => [...prev, userMsg]);
    const selected = agents.filter((a) => selectedIds.includes(a.id));
    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        ...selected.slice(0, 4).map((a, i) => ({
          id: crypto.randomUUID(),
          agentId: String(a.id),
          agentName: a.name,
          message: agentResponse(a),
          timestamp: new Date(Date.now() + (i + 1) * 800),
          type: "response" as const,
        })),
      ]);
    }, 1000);
    setInput("");
  };

  const visibleAgents =
    meetingType === "all-sectors"
      ? agents.filter((a) => a.isOrchestrator || a.access_level === "ceo")
      : agents.filter(
          (a) => a.sectorId === selectedSectorId || a.access_level === "ceo",
        );

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-[650px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="size-5 text-primary" />
            {meetingStarted ? "Reunião em Andamento" : "Convocar Reunião"}
          </DialogTitle>
        </DialogHeader>

        {!meetingStarted ? (
          <div className="space-y-4">
            {/* Tipo */}
            <div className="space-y-2">
              <p className="text-sm font-semibold">Tipo de Reunião:</p>
              <div className="flex gap-2">
                {(
                  [
                    {
                      id: "all-sectors",
                      label: "🌐 Todos os Setores",
                      sub: "Apenas orquestradores participam",
                    },
                    {
                      id: "single-sector",
                      label: "📋 Setor Específico",
                      sub: "Orquestrador + agentes do setor",
                    },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setMeetingType(t.id)}
                    className={`flex-1 rounded-lg border px-3 py-2.5 text-xs font-semibold transition-all ${
                      meetingType === t.id
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-secondary text-foreground hover:border-primary/50"
                    }`}
                  >
                    {t.label}
                    <span className="mt-0.5 block text-[9px] font-normal opacity-80">
                      {t.sub}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Seletor de setor */}
            {meetingType === "single-sector" && (
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">Selecione o setor:</p>
                <div className="flex flex-wrap gap-1.5">
                  {sectors.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setSelectedSectorId(s.id)}
                      className={`rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                        selectedSectorId === s.id
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary text-foreground hover:bg-secondary/80"
                      }`}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Aviso hierarquia */}
            {meetingType === "all-sectors" && (
              <div className="flex items-start gap-2 rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-2.5">
                <span className="mt-0.5 shrink-0 text-yellow-500">⚠️</span>
                <p className="text-[10px] text-yellow-600 dark:text-yellow-400">
                  Em reuniões gerais, apenas <strong>orquestradores</strong> participam.
                  Agentes operacionais permanecem em suas salas.
                </p>
              </div>
            )}

            {/* Seleção de participantes */}
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Participantes ({selectedIds.length}):
              </p>
              <div className="grid grid-cols-5 gap-3">
                {visibleAgents.map((agent) => {
                  const disabled =
                    meetingType === "all-sectors" &&
                    !agent.isOrchestrator &&
                    agent.access_level !== "ceo";
                  return (
                    <button
                      key={agent.id}
                      type="button"
                      onClick={() => !disabled && toggle(agent.id)}
                      className={`flex flex-col items-center gap-1 rounded-lg p-2 transition-colors ${
                        disabled ? "cursor-not-allowed" : "hover:bg-secondary"
                      }`}
                    >
                      <TinyAvatar
                        agent={agent}
                        selected={selectedIds.includes(agent.id)}
                        disabled={disabled}
                      />
                      <span className="text-center text-[10px] font-medium leading-tight">
                        {agent.name}
                      </span>
                      <span className="text-[9px] text-muted-foreground">
                        {agent.isOrchestrator
                          ? "🎯 Orq."
                          : agent.access_level === "ceo"
                          ? "👑 CEO"
                          : agent.role}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-muted-foreground">
                {selectedIds.length} participante(s)
              </span>
              <button
                type="button"
                onClick={startMeeting}
                disabled={selectedIds.length === 0}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity disabled:opacity-40 hover:opacity-90"
              >
                Iniciar Reunião
              </button>
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            {/* Participantes */}
            <div className="flex gap-1.5 overflow-x-auto border-b border-border pb-3">
              {agents
                .filter((a) => selectedIds.includes(a.id))
                .map((a) => (
                  <div
                    key={a.id}
                    className="flex shrink-0 items-center gap-1 rounded-full bg-secondary px-2 py-1"
                  >
                    <div
                      className="flex size-5 items-center justify-center rounded-full text-[8px] font-bold text-white"
                      style={{ backgroundColor: a.appearance.shirtColor }}
                    >
                      {a.initials}
                    </div>
                    <span className="text-[10px] font-medium">{a.name}</span>
                    {a.isOrchestrator && (
                      <Crown className="size-3 text-yellow-400" />
                    )}
                  </div>
                ))}
            </div>

            {/* Chat */}
            <div className="min-h-[250px] max-h-[350px] flex-1 space-y-3 overflow-y-auto py-3">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex gap-2 ${
                    msg.type === "system"
                      ? "justify-center"
                      : msg.type === "task"
                      ? "justify-end"
                      : "justify-start"
                  }`}
                >
                  {msg.type === "system" ? (
                    <span className="whitespace-pre-line rounded-full bg-secondary px-3 py-1.5 text-center text-[10px] text-muted-foreground">
                      {msg.message}
                    </span>
                  ) : msg.type === "task" ? (
                    <div className="max-w-[75%] rounded-2xl rounded-tr-sm bg-primary px-3 py-2 text-primary-foreground">
                      <div className="mb-0.5 flex items-center gap-1">
                        <Crown className="size-3" />
                        <span className="text-[9px] font-bold">CEO</span>
                      </div>
                      <p className="text-xs">{msg.message}</p>
                    </div>
                  ) : (
                    <div className="max-w-[75%]">
                      <span className="text-[10px] font-semibold text-muted-foreground">
                        {msg.agentName}
                      </span>
                      <div className="rounded-2xl rounded-tl-sm bg-secondary px-3 py-2">
                        <p className="text-xs">{msg.message}</p>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="flex gap-2 border-t border-border pt-3">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendMessage()}
                placeholder="Descreva a tarefa para os agentes..."
                className="flex-1 rounded-lg bg-secondary px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-primary"
              />
              <button
                type="button"
                onClick={sendMessage}
                disabled={!input.trim()}
                className="rounded-lg bg-primary px-3 py-2 text-primary-foreground disabled:opacity-40 hover:opacity-90"
              >
                <Send className="size-4" />
              </button>
              <button
                type="button"
                onClick={endMeeting}
                className="rounded-lg bg-destructive px-3 py-2 text-xs font-semibold text-destructive-foreground hover:opacity-90"
              >
                Encerrar
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
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
  if (!open) return null;
  return (
    <div className="absolute right-0 top-0 flex h-full w-64 flex-col border-l border-white/10 bg-[#0d1117]/90 backdrop-blur-sm">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <p className="text-xs font-bold tracking-widest text-white">AGENTS INFO</p>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-white">
          <X className="size-4" />
        </button>
      </div>
      <div className="flex-1 divide-y divide-white/5 overflow-y-auto">
        {agents.map((agent) => (
          <button
            key={agent.id}
            type="button"
            className="w-full px-4 py-3 text-left transition hover:bg-white/5"
            onClick={() => onAgentClick(agent)}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-xs font-bold text-white">{agent.name}</p>
                <p className="truncate text-[10px] text-slate-400">{agent.role}</p>
              </div>
              <ChevronRight className="mt-0.5 size-3 shrink-0 text-slate-600" />
            </div>
            <div className="mt-1.5 flex items-center justify-between text-[10px]">
              <div className="flex items-center gap-1">
                <span className={`size-1.5 rounded-full ${STATUS_DOT[agent.status]}`} />
                <span style={{ color: agent.status === "working" ? "#4ade80" : agent.status === "paused" ? "#facc15" : "#64748b" }}>
                  {STATUS_LABELS[agent.status]}
                </span>
              </div>
              <span className="text-slate-500">{agent.sectorName}</span>
            </div>
            {agent.status === "working" && agent.currentTask !== "Sem tarefa ativa" && (
              <p className="mt-0.5 truncate text-[10px] text-slate-500">{agent.currentTask}</p>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

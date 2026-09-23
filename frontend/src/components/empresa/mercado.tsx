// frontend/src/components/empresa/mercado.tsx
// Página de detalhe do setor "Inteligência de Mercado" — também funciona para qualquer setor,
// mas tem visualizações especiais (gráfico de candles, ciclo de pregão, painel de risco) quando
// o setor é de inteligência de mercado.
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BarChart2,
  Brain,
  CheckCircle,
  Clock,
  Shield,
  TrendingDown,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusDot } from "@/components/empresa/shared";
import { listAgents, type Agent, type Sector } from "@/lib/api";
import type { AgentStatus } from "@/lib/pgba-data";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isMercadoSector(name: string) {
  const n = name.toLowerCase();
  return n.includes("mercado") || n.includes("inteligência de mercado") || n.includes("trading");
}

type CyclePhase = "pre" | "trading" | "post" | "closed";

function getTradingPhase(): CyclePhase {
  const now = new Date();
  // Horário de Brasília (UTC-3)
  const brtOffset = -3 * 60;
  const localOffset = now.getTimezoneOffset();
  const brtMs = now.getTime() + (brtOffset - (-localOffset)) * 60 * 1000;
  const brt = new Date(brtMs);
  const h = brt.getHours();
  const m = brt.getMinutes();
  const t = h * 60 + m;
  // B3: pré-abertura 7h00–9h50, pregão 9h50–17h30, pós 17h30–17h50
  if (t >= 7 * 60 && t < 9 * 60 + 50) return "pre";
  if (t >= 9 * 60 + 50 && t < 17 * 60 + 30) return "trading";
  if (t >= 17 * 60 + 30 && t < 17 * 60 + 50) return "post";
  return "closed";
}

const PHASE_LABELS: Record<CyclePhase, string> = {
  pre: "Pré-abertura",
  trading: "Pregão ativo",
  post: "Pós-pregão",
  closed: "Mercado fechado",
};

const PHASE_COLORS: Record<CyclePhase, string> = {
  pre: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  trading: "bg-green-500/20 text-green-400 border-green-500/30",
  post: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  closed: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
};

// Mapeia papel do agente para ícone
function AgentRoleIcon({ role, name }: { role: string; name: string }) {
  const n = (role + name).toLowerCase();
  if (n.includes("orquestr")) return <Brain className="size-4 text-primary" />;
  if (n.includes("guardião") || n.includes("risco")) return <Shield className="size-4 text-orange-400" />;
  if (n.includes("executor")) return <Zap className="size-4 text-yellow-400" />;
  if (n.includes("auditor")) return <CheckCircle className="size-4 text-blue-400" />;
  if (n.includes("estrateg")) return <TrendingUp className="size-4 text-green-400" />;
  if (n.includes("coletor") || n.includes("dados")) return <Activity className="size-4 text-purple-400" />;
  if (n.includes("macro")) return <BarChart2 className="size-4 text-cyan-400" />;
  if (n.includes("técnico") || n.includes("tecnico")) return <TrendingDown className="size-4 text-pink-400" />;
  if (n.includes("fluxo")) return <Activity className="size-4 text-indigo-400" />;
  return <Users className="size-4 text-muted-foreground" />;
}

const AUTONOMY_LABELS = ["Observador", "Recomendador", "Sup. Executor", "Policy Exec.", "Autônomo"];

// ─── SVG Mini Candlestick Chart ───────────────────────────────────────────────

function CandleChart() {
  // Dados fixos representando um dia típico — só visual
  const candles = useMemo(() => {
    const seed = [
      { o: 50, h: 56, l: 48, c: 54 },
      { o: 54, h: 59, l: 52, c: 57 },
      { o: 57, h: 60, l: 53, c: 55 },
      { o: 55, h: 58, l: 50, c: 52 },
      { o: 52, h: 55, l: 48, c: 53 },
      { o: 53, h: 62, l: 52, c: 61 },
      { o: 61, h: 65, l: 59, c: 63 },
      { o: 63, h: 67, l: 61, c: 64 },
      { o: 64, h: 68, l: 60, c: 62 },
      { o: 62, h: 66, l: 58, c: 65 },
      { o: 65, h: 70, l: 64, c: 69 },
      { o: 69, h: 73, l: 67, c: 71 },
    ];
    return seed;
  }, []);

  const W = 360;
  const H = 120;
  const PAD = 12;
  const all = candles.flatMap((c) => [c.h, c.l]);
  const min = Math.min(...all) - 2;
  const max = Math.max(...all) + 2;
  const scaleY = (v: number) => H - PAD - ((v - min) / (max - min)) * (H - PAD * 2);
  const cw = (W - PAD * 2) / candles.length;

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      style={{ maxHeight: 120 }}
    >
      {/* Grid lines */}
      {[0.25, 0.5, 0.75].map((t) => (
        <line
          key={t}
          x1={PAD}
          y1={PAD + (1 - t) * (H - PAD * 2)}
          x2={W - PAD}
          y2={PAD + (1 - t) * (H - PAD * 2)}
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={1}
        />
      ))}
      {/* VWAP line */}
      <polyline
        points={candles
          .map((c, i) => `${PAD + i * cw + cw / 2},${scaleY((c.o + c.c) / 2)}`)
          .join(" ")}
        fill="none"
        stroke="#60a5fa"
        strokeWidth={1.5}
        strokeDasharray="4 2"
        opacity={0.6}
      />
      {/* Candles */}
      {candles.map((c, i) => {
        const bull = c.c >= c.o;
        const color = bull ? "#22c55e" : "#ef4444";
        const x = PAD + i * cw;
        const cx2 = x + cw / 2;
        const bodyTop = scaleY(Math.max(c.o, c.c));
        const bodyBot = scaleY(Math.min(c.o, c.c));
        const bodyH = Math.max(1, bodyBot - bodyTop);
        return (
          <g key={i}>
            <line x1={cx2} y1={scaleY(c.h)} x2={cx2} y2={scaleY(c.l)} stroke={color} strokeWidth={1.2} />
            <rect
              x={x + cw * 0.18}
              y={bodyTop}
              width={cw * 0.64}
              height={bodyH}
              fill={bull ? color : "transparent"}
              stroke={color}
              strokeWidth={1.2}
              rx={1}
            />
          </g>
        );
      })}
    </svg>
  );
}

// ─── Agent Card ───────────────────────────────────────────────────────────────

function AgentCard({ agent }: { agent: Agent }) {
  const isOrchestrator = agent.access_level === "sector_orchestrator";
  return (
    <div
      className={`rounded-xl border bg-card p-4 flex flex-col gap-3 transition-colors hover:border-primary/50 ${
        isOrchestrator ? "border-primary/40 shadow-sm shadow-primary/10" : "border-border"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <AgentRoleIcon role={agent.role} name={agent.name} />
          <div>
            <p className="text-sm font-semibold leading-tight">{agent.name}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{agent.role}</p>
          </div>
        </div>
        <StatusDot status={agent.work_status as AgentStatus} />
      </div>

      <div className="flex flex-wrap gap-1.5 mt-auto">
        <span className="rounded-full border border-border bg-secondary/50 px-2 py-0.5 text-[10px] text-muted-foreground font-mono">
          {agent.access_level === "sector_orchestrator" ? "orquestrador" : agent.access_level}
        </span>
        <span className="rounded-full border border-border bg-secondary/50 px-2 py-0.5 text-[10px] text-muted-foreground">
          {AUTONOMY_LABELS[agent.autonomy_level] ?? `nível ${agent.autonomy_level}`}
        </span>
      </div>

      {agent.work_status === "working" && agent.current_task && (
        <p className="text-[11px] text-green-400/80 truncate">↳ {agent.current_task}</p>
      )}
    </div>
  );
}

// ─── Guardian Risk Panel ──────────────────────────────────────────────────────

function GuardianPanel() {
  const limits = [
    { label: "Máx. operações/dia", value: "5" },
    { label: "Perda máx. diária", value: "R$ 150" },
    { label: "Meta de parada", value: "R$ 300" },
    { label: "Máx. perdas consecutivas", value: "2" },
    { label: "Pausa entre operações", value: "≥ 10 min" },
    { label: "Horário permitido", value: "10h15 – 16h30" },
    { label: "Tamanho fixo", value: "1 contrato" },
  ];
  return (
    <div className="rounded-xl border border-orange-500/20 bg-orange-500/5 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Shield className="size-4 text-orange-400" />
        <p className="font-semibold text-sm">Guardião de Risco — limites ativos</p>
        <Badge variant="outline" className="ml-auto text-[10px] border-orange-500/30 text-orange-400">
          veto absoluto
        </Badge>
      </div>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {limits.map(({ label, value }) => (
          <div key={label} className="flex items-center justify-between gap-2 rounded-md bg-background/40 px-3 py-1.5 text-xs">
            <span className="text-muted-foreground">{label}</span>
            <span className="font-mono font-medium text-orange-300">{value}</span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">
        Nenhum agente pode alterar estes limites durante o pregão. Alterações só valem fora do horário e registradas com data.
      </p>
    </div>
  );
}

// ─── Trading Cycle Steps ──────────────────────────────────────────────────────

function CycleBar({ phase }: { phase: CyclePhase }) {
  const steps: { id: CyclePhase; label: string; time: string }[] = [
    { id: "pre", label: "Pré-abertura", time: "07h00–09h50" },
    { id: "trading", label: "Pregão", time: "09h50–17h30" },
    { id: "post", label: "Pós-pregão", time: "17h30–17h50" },
  ];
  const activeIdx = steps.findIndex((s) => s.id === phase);

  return (
    <div className="flex items-center gap-0">
      {steps.map((step, i) => {
        const done = activeIdx > i;
        const active = activeIdx === i;
        return (
          <div key={step.id} className="flex items-center flex-1">
            <div
              className={`flex-1 rounded-l-full rounded-r-full h-7 flex items-center justify-center px-3 text-[11px] font-medium border transition-colors ${
                active
                  ? "bg-primary/20 border-primary text-primary"
                  : done
                  ? "bg-success/10 border-success/30 text-success/70"
                  : "bg-secondary/30 border-border text-muted-foreground"
              }`}
            >
              <span className="hidden sm:inline">{step.label} · </span>
              {step.time}
            </div>
            {i < steps.length - 1 && (
              <div className={`h-px w-2 ${done || active ? "bg-primary/40" : "bg-border"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export function SectorDetailPage({
  sector,
  onBack,
}: {
  sector: Sector;
  onBack: () => void;
}) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<CyclePhase>(getTradingPhase);

  const isMercado = isMercadoSector(sector.name);

  useEffect(() => {
    listAgents(sector.id)
      .then(setAgents)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [sector.id]);

  // Atualiza ciclo a cada minuto
  useEffect(() => {
    const tid = setInterval(() => setPhase(getTradingPhase()), 60_000);
    return () => clearInterval(tid);
  }, []);

  const orchestrator = agents.find((a) => a.access_level === "sector_orchestrator");
  const ops = agents.filter((a) => a.access_level === "operational");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack} className="shrink-0">
          <ArrowLeft className="size-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {isMercado && <BarChart2 className="size-5 text-primary shrink-0" />}
            <h2 className="font-semibold text-lg truncate">{sector.name}</h2>
            {isMercado && (
              <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${PHASE_COLORS[phase]}`}>
                <Clock className="size-3 inline mr-1" />
                {PHASE_LABELS[phase]}
              </span>
            )}
          </div>
          {sector.description && (
            <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">{sector.description}</p>
          )}
        </div>
      </div>

      {/* Ciclo de pregão (só Inteligência de Mercado) */}
      {isMercado && phase !== "closed" && <CycleBar phase={phase} />}
      {isMercado && phase === "closed" && (
        <div className="rounded-xl border border-zinc-500/20 bg-zinc-500/5 px-4 py-3 flex items-center gap-3">
          <AlertTriangle className="size-4 text-zinc-400" />
          <p className="text-sm text-zinc-400">Mercado fechado — próximo ciclo começa às 07h00 BRT</p>
        </div>
      )}

      {/* KPIs */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <p className="text-xs text-muted-foreground">Agentes</p>
          <p className="text-2xl font-bold mt-1">{loading ? "—" : agents.length}</p>
        </div>
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <p className="text-xs text-muted-foreground">Trabalhando agora</p>
          <p className="text-2xl font-bold mt-1 text-green-400">
            {loading ? "—" : agents.filter((a) => a.work_status === "working").length}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <p className="text-xs text-muted-foreground">Base de conhecimento</p>
          <p className="text-sm font-medium mt-1 truncate">
            {sector.knowledge_source_name ?? <span className="text-muted-foreground">—</span>}
          </p>
        </div>
      </div>

      {/* Chart + Risk side-by-side on md+ */}
      {isMercado && (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-2 mb-3">
              <BarChart2 className="size-4 text-primary" />
              <p className="font-semibold text-sm">Candles do dia (simulação)</p>
              <span className="ml-auto text-[10px] text-muted-foreground font-mono">WIN/WDO · BTC</span>
            </div>
            <CandleChart />
            <div className="flex items-center gap-4 mt-2 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1"><span className="size-2 rounded-sm bg-green-500 inline-block" /> Alta</span>
              <span className="flex items-center gap-1"><span className="size-2 rounded-sm bg-red-500 inline-block" /> Baixa</span>
              <span className="flex items-center gap-1.5"><span className="inline-block w-4 h-px bg-blue-400 border-dashed border-t" style={{borderStyle:"dashed"}} /> VWAP</span>
            </div>
          </div>
          <GuardianPanel />
        </div>
      )}

      {/* Orquestrador destacado */}
      {orchestrator && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Orquestrador</p>
          <AgentCard agent={orchestrator} />
        </div>
      )}

      {/* Operacionais */}
      {!loading && ops.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Agentes operacionais ({ops.length})
          </p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {ops.map((agent) => (
              <AgentCard key={agent.id} agent={agent} />
            ))}
          </div>
        </div>
      )}

      {loading && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-24 rounded-xl border border-border bg-card animate-pulse" />
          ))}
        </div>
      )}
    </div>
  );
}

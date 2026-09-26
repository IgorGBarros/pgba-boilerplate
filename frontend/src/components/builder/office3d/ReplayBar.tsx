// office3d/ReplayBar.tsx — controle do replay do dia (linha do tempo).
//
// A planta mostra o estado calculado por replay.ts no instante escolhido;
// o ao vivo (WebSocket/polling) continua chegando por baixo e volta a
// aparecer ao sair do replay.
import { useMemo } from "react";
import { Loader2, Pause, Play, Radio, RotateCw } from "lucide-react";
import type { Timeline, TimelineEvent } from "@/lib/api";
import { REPLAY_SPEEDS, describeEvent } from "./replay";

const KIND_COLOR: Record<TimelineEvent["kind"], string> = {
  interaction: "#10b981",
  task_status: "#0ea5e9",
  task_finished: "#0ea5e9",
  message_created: "#f59e0b",
  message_answered: "#16a34a",
  message_rejected: "#ef4444",
  approval_created: "#f97316",
  approval_decided: "#78716c",
};

const hhmm = (ms: number) => new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

export function ReplayBar({
  timeline,
  loading,
  error,
  t,
  onSeek,
  playing,
  onTogglePlay,
  speed,
  onSpeed,
  recent,
  agentName,
  onReload,
  onExit,
}: {
  timeline: Timeline | null;
  loading: boolean;
  error: string | null;
  t: number;
  onSeek: (t: number) => void;
  playing: boolean;
  onTogglePlay: () => void;
  speed: number;
  onSpeed: (s: number) => void;
  recent: TimelineEvent[];
  agentName: (id: number) => string;
  onReload: () => void;
  onExit: () => void;
}) {
  const start = timeline ? new Date(timeline.since).getTime() : 0;
  const end = timeline ? new Date(timeline.until).getTime() : 1;
  const span = Math.max(end - start, 1);

  // Marcas na trilha: no máximo 1 por pixel-ish (agrupa por 1/400 da janela)
  const ticks = useMemo(() => {
    if (!timeline) return [];
    const seen = new Set<string>();
    const out: Array<{ left: number; color: string }> = [];
    for (const e of timeline.events) {
      const left = ((new Date(e.at).getTime() - start) / span) * 100;
      const key = `${Math.round(left * 4)}:${e.kind}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ left, color: KIND_COLOR[e.kind] });
    }
    return out;
  }, [timeline, start, span]);

  return (
    <div className="pointer-events-auto absolute inset-x-3 bottom-3 z-30 mx-auto max-w-3xl rounded-2xl border border-sky-200 bg-white/95 px-3 py-2 shadow-xl backdrop-blur">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-sky-800">
          Replay {timeline ? hhmm(t) : ""}
        </span>
        <button
          type="button"
          onClick={onTogglePlay}
          disabled={!timeline || loading}
          title={playing ? "Pausar" : "Reproduzir"}
          className="flex size-7 items-center justify-center rounded-full bg-stone-900 text-white hover:bg-stone-700 disabled:opacity-40"
        >
          {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
        </button>
        <div className="flex rounded-full border border-stone-200 p-0.5">
          {REPLAY_SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onSpeed(s)}
              title={`1 segundo = ${s >= 60 ? `${s / 60} min` : `${s}s`} do dia`}
              className={`rounded-full px-2 text-[10px] font-medium ${speed === s ? "bg-stone-900 text-white" : "text-stone-500 hover:text-stone-900"}`}
            >
              ×{s}
            </button>
          ))}
        </div>
        <span className="ml-auto text-[10px] text-stone-400">
          {timeline ? `${timeline.events.length} eventos · ${hhmm(start)}–${hhmm(end)}` : ""}
          {timeline?.truncated && " (cortado)"}
        </span>
        <button type="button" onClick={onReload} title="Recarregar até agora" className="rounded-full p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-800">
          <RotateCw className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={onExit}
          className="flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-100"
        >
          <Radio className="size-3" /> Ao vivo
        </button>
      </div>

      {loading ? (
        <p className="flex items-center gap-1.5 py-2 text-[11px] text-stone-500"><Loader2 className="size-3 animate-spin" /> Carregando o dia…</p>
      ) : error ? (
        <p className="mt-1.5 rounded bg-red-50 px-2 py-1 text-[11px] text-red-700">{error}</p>
      ) : timeline && (
        <>
          <div className="relative mt-2 h-5">
            <div className="absolute inset-x-0 top-2 h-1 rounded-full bg-stone-100" />
            {ticks.map((k, i) => (
              <span key={i} className="absolute top-1 h-3 w-px" style={{ left: `${k.left}%`, background: k.color }} />
            ))}
            <input
              type="range"
              min={start}
              max={end}
              step={1000}
              value={Math.min(Math.max(t, start), end)}
              onChange={(e) => onSeek(Number(e.target.value))}
              aria-label="Instante do replay"
              className="absolute inset-0 w-full cursor-pointer opacity-0"
            />
            <span
              className="pointer-events-none absolute top-0 h-5 w-0.5 rounded bg-sky-600"
              style={{ left: `${((Math.min(Math.max(t, start), end) - start) / span) * 100}%` }}
            />
          </div>
          <ul className="mt-1 max-h-20 space-y-0.5 overflow-y-auto text-[10px] text-stone-600">
            {timeline.events.length === 0 && <li className="text-stone-400">Nada registrado neste período.</li>}
            {recent.map((e, i) => (
              <li key={`${e.kind}-${e.at}-${i}`} className="flex gap-1.5 truncate">
                <span className="font-mono text-stone-400">{hhmm(new Date(e.at).getTime())}</span>
                <span className="size-1.5 shrink-0 translate-y-1 rounded-full" style={{ background: KIND_COLOR[e.kind] }} />
                <span className="truncate">{describeEvent(e, agentName)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

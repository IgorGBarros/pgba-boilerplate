// office3d/SectorCard.tsx — cartão flutuante de KPI por setor.
//
// Tamanho fixo em pixel (Html sem distanceFactor): continua legível em
// qualquer zoom da câmera isométrica. Todo número vem de dado real —
// agentes do setor (work_status) e Tasks (agency.Task.status); nenhum KPI
// "de enfeite" inventado pra preencher o cartão.
import { Html } from "@react-three/drei";

export interface SectorStats {
  agents: number;
  working: number;
  paused: number;
  doing: number;
  next: number;
  done: number;
}

export function SectorCard({
  position,
  name,
  color,
  stats,
  brain,
  onClick,
}: {
  position: [number, number, number];
  name: string;
  color: string;
  stats: SectorStats;
  /** Nome do knowledge_source (cérebro secundário) ou null. */
  brain: string | null | undefined;
  onClick?: () => void;
}) {
  const hot = stats.working > 0;
  return (
    <Html position={position} center zIndexRange={[10, 7]} style={{ userSelect: "none" }}>
      <button
        type="button"
        onClick={onClick}
        title={brain ? `Cérebro do setor: ${brain}` : "Setor sem knowledge_source — RAG escopado devolve vazio"}
        className="w-[150px] rounded-xl border bg-white/95 px-2.5 py-2 text-left shadow-[0_6px_20px_-8px_rgba(30,30,50,0.35)] backdrop-blur transition-transform hover:-translate-y-0.5"
        style={{
          borderColor: hot ? color : "#e7e5e4",
          boxShadow: hot ? `0 0 0 3px ${color}22, 0 8px 24px -10px ${color}88` : undefined,
        }}
      >
        <div className="flex items-center gap-1.5">
          <span className={`h-2 w-2 shrink-0 rounded-full ${hot ? "animate-pulse" : ""}`} style={{ background: color }} />
          <span className="truncate text-[9.5px] font-semibold uppercase tracking-[0.14em] text-stone-700">{name}</span>
        </div>
        <div className="mt-0.5 flex items-baseline gap-1.5">
          <span className="font-serif text-[22px] leading-none text-stone-900">{stats.agents}</span>
          <span className="text-[8.5px] font-medium uppercase tracking-[0.16em] text-stone-500">
            {stats.agents === 1 ? "agente" : "agentes"}
          </span>
          {hot && (
            <span className="ml-auto rounded-full bg-emerald-50 px-1.5 text-[8.5px] font-semibold text-emerald-700">
              {stats.working} ativo{stats.working > 1 ? "s" : ""}
            </span>
          )}
          {!hot && stats.paused > 0 && (
            <span className="ml-auto rounded-full bg-amber-50 px-1.5 text-[8.5px] font-semibold text-amber-700">
              {stats.paused} pausado{stats.paused > 1 ? "s" : ""}
            </span>
          )}
        </div>
        <div className={`mt-1 truncate text-[8.5px] ${brain ? "text-emerald-700" : "text-stone-400"}`}>
          ◈ {brain ?? "sem cérebro configurado"}
        </div>
        <div className="mt-1 flex justify-between border-t border-stone-200 pt-1 text-[8.5px] uppercase tracking-wider text-stone-500">
          <span>Fazendo <b className="font-mono text-[10px] text-stone-900">{stats.doing}</b></span>
          <span>Próx <b className="font-mono text-[10px] text-stone-900">{stats.next}</b></span>
          <span>Feito <b className="font-mono text-[10px] text-stone-900">{stats.done}</b></span>
        </div>
      </button>
    </Html>
  );
}

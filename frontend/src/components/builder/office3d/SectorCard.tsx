// office3d/SectorCard.tsx — etiqueta de KPI por setor (detalhe no hover).
//
// Tamanho fixo em pixel (Html sem distanceFactor): continua legível em
// qualquer zoom da câmera isométrica — por isso precisa ser pequena. Todo número vem de dado real —
// agentes do setor (work_status) e Tasks (agency.Task.status); nenhum KPI
// "de enfeite" inventado pra preencher o cartão.
import { useState } from "react";
import { Html } from "@react-three/drei";
import { PROVIDER_LABEL, formatUsd, providerName } from "./providers";

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
  aiProvider,
  aiModel,
  aiProblem,
  budget,
  onClick,
}: {
  position: [number, number, number];
  name: string;
  color: string;
  stats: SectorStats;
  /** Nome do knowledge_source (cérebro secundário) ou null. */
  brain: string | null | undefined;
  /** Provedor fixo do setor ("" = provedor ativo do tenant). */
  aiProvider?: string;
  aiModel?: string;
  /** IA do setor sem credencial/modelo (ai-status) — as chamadas falham. */
  aiProblem?: { provider: string; detail: string } | null;
  /** Gasto do mês vs orçamento (metrics/sectors); null = sem dado. */
  budget?: { monthCost: number; budget: number; percent: number | null; status: string } | null;
  onClick?: () => void;
}) {
  // Etiqueta de UMA linha por padrão: com muitos setores, o cartão completo
  // (versão anterior, ~150×110px fixos) cobria o escritório inteiro. O
  // detalhe (cérebro + tasks) só aparece ao passar o mouse.
  const [open, setOpen] = useState(false);
  const hot = stats.working > 0;
  // Alerta visível sem hover só quando há o que fazer (≥ 80% do orçamento).
  const budgetAlert = !!budget && (budget.status === "warn" || budget.status === "over");
  return (
    <Html position={position} center zIndexRange={[10, 7]} style={{ userSelect: "none" }}>
      <div
        className="relative"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        <button
          type="button"
          onClick={onClick}
          className="flex max-w-[150px] items-center gap-1 whitespace-nowrap rounded-full border bg-white/90 px-1.5 py-[1px] text-[9px] font-semibold uppercase leading-4 tracking-wider text-stone-700 shadow-sm"
          style={{ borderColor: hot ? color : "rgba(214,211,209,0.9)" }}
        >
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${hot ? "animate-pulse" : ""}`} style={{ background: color }} />
          <span className="truncate">{name}</span>
          <span className="font-mono font-normal text-stone-500">{stats.agents}</span>
          {hot && <span className="font-mono text-emerald-600">●{stats.working}</span>}
          {!hot && stats.paused > 0 && <span className="font-mono text-amber-600">Ⅱ{stats.paused}</span>}
          {aiProblem && <span className="font-mono text-red-600" title="IA do setor sem credencial">⚠</span>}
          {budgetAlert && (
            <span className={`font-mono ${budget?.status === "over" ? "text-red-600" : "text-amber-600"}`} title="Gasto do mês ÷ orçamento">
              ${budget?.percent?.toFixed(0)}%
            </span>
          )}
        </button>
        {open && (
          <div className="absolute bottom-full left-1/2 z-10 mb-1 w-[170px] -translate-x-1/2 rounded-lg border border-stone-200 bg-white px-2.5 py-2 text-left text-[10px] text-stone-600 shadow-lg">
            <div className="flex justify-between">
              <span>Agentes</span>
              <b className="font-mono text-stone-900">{stats.agents}</b>
            </div>
            <div className="flex justify-between">
              <span>Trabalhando agora</span>
              <b className="font-mono text-stone-900">{stats.working}</b>
            </div>
            {stats.paused > 0 && (
              <div className="flex justify-between">
                <span>Pausados</span>
                <b className="font-mono text-amber-600">{stats.paused}</b>
              </div>
            )}
            <div className={`mt-1 truncate ${brain ? "text-emerald-700" : "text-stone-400"}`}>
              ◈ {brain ?? "sem cérebro configurado"}
            </div>
            <div className="truncate text-stone-500" title="Modelo de IA usado pelos agentes deste setor">
              ✦ IA: {aiProvider
                ? <b className="font-medium text-stone-800">{PROVIDER_LABEL[aiProvider] ?? aiProvider}{aiModel ? ` · ${aiModel}` : ""} <span className="font-normal text-stone-400">(fixo)</span></b>
                : <span>padrão do tenant</span>}
            </div>
            {aiProblem && (
              <div className="mt-0.5 rounded bg-red-50 px-1 py-0.5 text-[9px] leading-tight text-red-700" title={aiProblem.detail}>
                ⚠ {providerName(aiProblem.provider)} sem credencial — as chamadas deste setor falham
              </div>
            )}
            {budget && (
              <div className="flex justify-between" title="Gasto estimado do mês corrente">
                <span>Custo do mês</span>
                <b className={`font-mono ${budgetAlert ? (budget.status === "over" ? "text-red-600" : "text-amber-600") : "text-stone-900"}`}>
                  {formatUsd(budget.monthCost)}{budget.percent !== null ? ` · ${budget.percent.toFixed(0)}%` : ""}
                </b>
              </div>
            )}
            <div className="mt-1 flex justify-between border-t border-stone-100 pt-1 text-[9px] uppercase tracking-wider text-stone-500">
              <span>Fazendo <b className="font-mono text-stone-900">{stats.doing}</b></span>
              <span>Próx <b className="font-mono text-stone-900">{stats.next}</b></span>
              <span>Feito <b className="font-mono text-stone-900">{stats.done}</b></span>
            </div>
          </div>
        )}
      </div>
    </Html>
  );
}

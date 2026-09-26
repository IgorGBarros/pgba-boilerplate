// office3d/ProviderCosts.tsx — custo do mês separado por provedor de IA.
//
// Agora que cada setor pode usar uma IA diferente (Desenvolvimento → Claude,
// demais → Groq), o custo só faz sentido separado por provedor. Os valores
// vêm de AgentInteraction.provider (agency.services.record_interaction) —
// interações antigas, de antes desse registro, aparecem como "sem registro".
import type { ProviderCost } from "@/lib/api";
import { PROVIDER_COLOR, formatUsd, providerName } from "./providers";

export function ProviderCosts({ rows, compact = false }: { rows: ProviderCost[]; compact?: boolean }) {
  const total = rows.reduce((s, r) => s + r.cost_usd, 0);
  if (rows.length === 0) {
    return <p className="text-[11px] text-stone-400">Nenhuma chamada de IA este mês.</p>;
  }
  return (
    <div>
      <div className="flex h-2 overflow-hidden rounded-full bg-stone-100">
        {rows.map((r) => (
          <span
            key={r.provider || "none"}
            title={`${providerName(r.provider)}: ${formatUsd(r.cost_usd)}`}
            style={{
              width: `${total > 0 ? (r.cost_usd / total) * 100 : 100 / rows.length}%`,
              background: PROVIDER_COLOR[r.provider] ?? "#a8a29e",
            }}
          />
        ))}
      </div>
      <div className={`mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 ${compact ? "text-[10px]" : "text-[11px]"} text-stone-600`}>
        {rows.map((r) => (
          <span key={r.provider || "none"} className="flex items-center gap-1">
            <span className="size-2 rounded-full" style={{ background: PROVIDER_COLOR[r.provider] ?? "#a8a29e" }} />
            {providerName(r.provider)}
            <b className="font-mono font-medium text-stone-900">{formatUsd(r.cost_usd)}</b>
            {!compact && <span className="text-stone-400">· {r.calls} chamada{r.calls === 1 ? "" : "s"}</span>}
          </span>
        ))}
      </div>
    </div>
  );
}

import { useState, useEffect, useCallback } from "react";
import { BarChart3, Zap, DollarSign, MessageSquare, RefreshCw, TrendingUp } from "lucide-react";
import { getCRMTokenUsage, TokenUsageSummary } from "@/lib/api";

const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  landing_page: "Landing Page",
  meta_ads: "Meta Ads",
  manual: "Manual",
};

const CHANNEL_COLORS: Record<string, string> = {
  whatsapp: "bg-emerald-500",
  telegram: "bg-blue-500",
  landing_page: "bg-violet-500",
  meta_ads: "bg-blue-600",
  manual: "bg-muted-foreground",
};

function fmtTokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function fmtUSD(v: number) {
  if (v === 0) return "US$ 0,00";
  if (v < 0.01) return `US$ ${v.toFixed(4)}`;
  return `US$ ${v.toFixed(2)}`;
}

export function CRMTokenUsage() {
  const [data, setData] = useState<TokenUsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const res = await getCRMTokenUsage(days);
      setData(res);
    } catch {
      // silently fail — endpoint pode não existir ainda
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [days]);

  useEffect(() => { void load(); }, [load]);

  const maxTokens = data
    ? Math.max(...(data.by_channel.map(c => c.total_tokens)), 1)
    : 1;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <RefreshCw className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-16 text-sm text-muted-foreground">
        Não foi possível carregar os dados de consumo.
      </div>
    );
  }

  const { totals, by_channel, top_leads } = data;
  const hasData = totals.total_tokens > 0;

  return (
    <div className="space-y-6 py-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="size-4 text-indigo-500" />
          <h3 className="text-sm font-semibold text-foreground">Consumo de IA — CRM</h3>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={days}
            onChange={e => setDays(Number(e.target.value))}
            className="text-xs border border-border rounded-md px-2 py-1 bg-background text-foreground"
          >
            <option value={7}>7 dias</option>
            <option value={30}>30 dias</option>
            <option value={90}>90 dias</option>
          </select>
          <button
            onClick={() => void load(true)}
            className="p-1.5 rounded-md hover:bg-muted transition-colors"
            title="Atualizar"
          >
            <RefreshCw className={`size-3.5 text-muted-foreground ${refreshing ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {!hasData ? (
        <div className="flex flex-col items-center justify-center py-14 gap-3 text-center">
          <Zap className="size-10 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">
            Nenhuma interação de IA registrada nos últimos {days} dias.
          </p>
          <p className="text-xs text-muted-foreground/60">
            Os tokens são registrados automaticamente após a primeira conversa via WhatsApp ou Telegram.
          </p>
        </div>
      ) : (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[
              {
                icon: <Zap className="size-4 text-amber-500" />,
                label: "Total de tokens",
                value: fmtTokens(totals.total_tokens),
                sub: `${fmtTokens(totals.tokens_in)} entrada · ${fmtTokens(totals.tokens_out)} saída`,
                bg: "bg-amber-500/8",
              },
              {
                icon: <DollarSign className="size-4 text-emerald-500" />,
                label: "Custo estimado",
                value: fmtUSD(totals.cost_estimated_usd),
                sub: `Últimos ${days} dias`,
                bg: "bg-emerald-500/8",
              },
              {
                icon: <MessageSquare className="size-4 text-indigo-500" />,
                label: "Mensagens de IA",
                value: String(totals.ai_messages),
                sub: `${totals.leads_with_ai} leads atendidos`,
                bg: "bg-indigo-500/8",
              },
            ].map(card => (
              <div key={card.label} className={`rounded-xl p-4 ${card.bg} border border-border/50`}>
                <div className="flex items-center gap-2 mb-2">{card.icon}<span className="text-xs text-muted-foreground">{card.label}</span></div>
                <p className="text-lg font-bold text-foreground tabular-nums">{card.value}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{card.sub}</p>
              </div>
            ))}
          </div>

          {/* Por canal */}
          {by_channel.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Por canal</h4>
              <div className="space-y-3">
                {by_channel.map(ch => {
                  const pct = Math.round((ch.total_tokens / maxTokens) * 100);
                  const label = CHANNEL_LABELS[ch.channel] ?? ch.channel;
                  const color = CHANNEL_COLORS[ch.channel] ?? "bg-muted-foreground";
                  return (
                    <div key={ch.channel} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span className={`size-2 rounded-full ${color} shrink-0`} />
                          <span className="font-medium text-foreground">{label}</span>
                          <span className="text-muted-foreground">{ch.leads} lead{ch.leads !== 1 ? "s" : ""} · {ch.messages} msg</span>
                        </div>
                        <div className="flex items-center gap-3 tabular-nums">
                          <span className="text-muted-foreground">{fmtTokens(ch.total_tokens)} tokens</span>
                          <span className="font-semibold text-foreground">{fmtUSD(ch.cost_usd)}</span>
                        </div>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Top leads */}
          {top_leads.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp className="size-3.5 text-muted-foreground" />
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Top leads por consumo</h4>
              </div>
              <div className="rounded-xl border border-border overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/40">
                      <th className="text-left px-3 py-2 text-muted-foreground font-medium">Lead</th>
                      <th className="text-right px-3 py-2 text-muted-foreground font-medium">Canal</th>
                      <th className="text-right px-3 py-2 text-muted-foreground font-medium">Tokens</th>
                      <th className="text-right px-3 py-2 text-muted-foreground font-medium">Custo</th>
                      <th className="text-right px-3 py-2 text-muted-foreground font-medium">Msgs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {top_leads.map((lead, i) => (
                      <tr key={lead.lead__id} className={`border-b border-border/50 last:border-0 ${i % 2 === 0 ? "" : "bg-muted/20"}`}>
                        <td className="px-3 py-2">
                          <span className="font-medium text-foreground">{lead.lead__nome}</span>
                          {lead.lead__empresa && <span className="text-muted-foreground"> · {lead.lead__empresa}</span>}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${CHANNEL_COLORS[lead.lead__origem] ?? "bg-muted-foreground"} text-foreground`}>
                            {CHANNEL_LABELS[lead.lead__origem] ?? lead.lead__origem}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmtTokens(lead.tokens)}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold text-foreground">{fmtUSD(lead.cost_usd)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{lead.messages}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

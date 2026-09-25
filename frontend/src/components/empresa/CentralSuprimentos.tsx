import { useState, useEffect, useCallback } from "react";
import {
  AlertTriangle, Truck, Clock, CheckCircle2, Package,
  RefreshCw, AlertCircle, ShoppingCart, TrendingUp,
} from "lucide-react";
import { getCentralSuprimentos, type CentralSuprimentosData, type PedidoCompra } from "@/lib/api";

function fmtBRL(v: number | string | null | undefined) {
  if (v == null) return "—";
  return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtDate(s: string | null | undefined) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

function PedidoRow({ pedido, variant }: { pedido: PedidoCompra; variant: "critico" | "pendente" | "transito" }) {
  const colors = {
    critico: "border-red-400/40 bg-red-500/5",
    pendente: "border-border bg-card",
    transito: "border-amber-400/30 bg-amber-500/5",
  };

  return (
    <div className={`rounded-lg border px-3 py-2.5 ${colors[variant]}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground truncate">
            {pedido.fornecedor_nome ?? `Pedido #${pedido.id}`}
          </p>
          {pedido.deal_titulo && (
            <p className="text-[11px] text-muted-foreground truncate">{pedido.deal_titulo}</p>
          )}
        </div>
        <div className="shrink-0 text-right">
          {pedido.valor_total && (
            <p className="text-sm font-semibold text-foreground tabular-nums">{fmtBRL(pedido.valor_total)}</p>
          )}
          {pedido.previsao_entrega && (
            <p className={`text-[11px] tabular-nums ${variant === "critico" ? "text-red-500 font-medium" : "text-muted-foreground"}`}>
              {variant === "critico" ? "⚠ " : ""}Prev. {fmtDate(pedido.previsao_entrega)}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export function CentralSuprimentos() {
  const [data, setData] = useState<CentralSuprimentosData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await getCentralSuprimentos());
    } catch {
      setError("Erro ao carregar central de suprimentos.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground">
        <RefreshCw className="size-4 animate-spin" />
        <span className="text-sm">Carregando central…</span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-center py-16 gap-2 text-destructive">
        <AlertCircle className="size-4" />
        <span className="text-sm">{error ?? "Erro desconhecido."}</span>
        <button onClick={() => void load()} className="ml-2 text-xs underline text-muted-foreground">Tentar novamente</button>
      </div>
    );
  }

  const kpis = [
    {
      label: "Críticos / Atrasados",
      value: data.criticos.length,
      color: data.criticos.length > 0 ? "text-red-600 dark:text-red-400" : "text-foreground",
      bg: data.criticos.length > 0 ? "bg-red-500/10" : "bg-muted/30",
      icon: <AlertTriangle className="size-4" />,
    },
    {
      label: "Em Trânsito",
      value: data.em_transito.length,
      color: "text-amber-700 dark:text-amber-400",
      bg: "bg-amber-500/10",
      icon: <Truck className="size-4" />,
    },
    {
      label: "Aguard. Atenção",
      value: data.pendentes_atencao.length,
      color: "text-blue-600 dark:text-blue-400",
      bg: "bg-blue-500/10",
      icon: <Clock className="size-4" />,
    },
    {
      label: "Entregues este mês",
      value: data.entregues_mes,
      color: "text-emerald-600 dark:text-emerald-400",
      bg: "bg-emerald-500/10",
      icon: <CheckCircle2 className="size-4" />,
    },
  ];

  return (
    <div className="p-4 space-y-5">
      {/* Alerta crítico */}
      {data.criticos.length > 0 && (
        <div className="flex items-start gap-2.5 p-3 rounded-xl bg-red-500/10 border border-red-400/30">
          <AlertTriangle className="size-4 text-red-500 shrink-0 mt-0.5" />
          <p className="text-sm text-red-600 dark:text-red-400 font-medium">
            {data.criticos.length === 1
              ? "1 pedido ultrapassou a data de entrega. Produção em risco."
              : `${data.criticos.length} pedidos ultrapassaram a data de entrega. Produção em risco.`}
          </p>
        </div>
      )}

      {/* KPI tiles */}
      <div className="grid grid-cols-2 gap-2">
        {kpis.map(k => (
          <div key={k.label} className={`rounded-xl p-3 ${k.bg} flex items-center gap-3`}>
            <span className={k.color}>{k.icon}</span>
            <div>
              <p className={`text-2xl font-bold tabular-nums leading-none ${k.color}`}>{k.value}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5 uppercase tracking-wide">{k.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Valor em andamento */}
      {Number(data.valor_em_andamento) > 0 && (
        <div className="flex items-center justify-between rounded-xl bg-muted/30 px-4 py-3">
          <div className="flex items-center gap-2 text-muted-foreground">
            <TrendingUp className="size-4" />
            <span className="text-xs uppercase tracking-wide font-medium">Valor em andamento</span>
          </div>
          <span className="text-base font-bold text-foreground tabular-nums">
            {fmtBRL(data.valor_em_andamento)}
          </span>
        </div>
      )}

      {/* Pedidos críticos */}
      {data.criticos.length > 0 && (
        <section>
          <p className="text-xs font-semibold text-red-600 dark:text-red-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
            <AlertTriangle className="size-3.5" /> Pedidos Críticos
          </p>
          <div className="space-y-2">
            {data.criticos.map(p => <PedidoRow key={p.id} pedido={p} variant="critico" />)}
          </div>
        </section>
      )}

      {/* Em trânsito */}
      {data.em_transito.length > 0 && (
        <section>
          <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
            <Truck className="size-3.5" /> Em Trânsito
          </p>
          <div className="space-y-2">
            {data.em_transito.map(p => <PedidoRow key={p.id} pedido={p} variant="transito" />)}
          </div>
        </section>
      )}

      {/* Aguardando atenção */}
      {data.pendentes_atencao.length > 0 && (
        <section>
          <p className="text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
            <Clock className="size-3.5" /> Aguardando Atenção
          </p>
          <div className="space-y-2">
            {data.pendentes_atencao.map(p => <PedidoRow key={p.id} pedido={p} variant="pendente" />)}
          </div>
        </section>
      )}

      {/* Orçamentos aguardando resposta */}
      {data.orcamentos_aguardando_resposta.length > 0 && (
        <section>
          <p className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
            <Package className="size-3.5" /> Orçamentos Enviados (aguardando resposta)
          </p>
          <div className="space-y-2">
            {data.orcamentos_aguardando_resposta.map(o => (
              <div key={o.id} className="rounded-lg border border-border bg-card px-3 py-2.5 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{o.fornecedor_nome}</p>
                  {o.observacoes && <p className="text-[11px] text-muted-foreground truncate">{o.observacoes}</p>}
                </div>
                <span className="text-[11px] text-blue-600 dark:text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-full shrink-0">Enviado</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {data.criticos.length === 0 && data.em_transito.length === 0 && data.pendentes_atencao.length === 0 && (
        <div className="flex flex-col items-center justify-center py-10 gap-3 text-center">
          <div className="grid size-12 place-items-center rounded-full bg-emerald-500/10">
            <CheckCircle2 className="size-6 text-emerald-500" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">Tudo em dia</p>
            <p className="text-xs text-muted-foreground mt-1">Nenhum pedido crítico ou pendente no momento.</p>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between pt-1">
        <p className="text-[11px] text-muted-foreground flex items-center gap-1">
          <ShoppingCart className="size-3" /> Central de Suprimentos
        </p>
        <button onClick={() => void load()} className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors">
          <RefreshCw className="size-3" /> Atualizar
        </button>
      </div>
    </div>
  );
}

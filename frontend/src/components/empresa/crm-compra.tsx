import { useState, useEffect, useCallback } from "react";
import {
  ShoppingCart, Package, Truck, CheckCircle2, XCircle,
  Clock, ChevronDown, ChevronRight, Loader2, AlertCircle,
  AlertTriangle, ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { listPedidosCompra, avancarStatusPedido, type PedidoCompra } from "@/lib/api";

const STATUS_CONFIG: Record<PedidoCompra["status"], { label: string; color: string; icon: React.ReactNode }> = {
  criado:       { label: "Criado",       color: "bg-slate-500/10 text-slate-600 dark:text-slate-400",     icon: <ShoppingCart className="size-3.5" /> },
  enviado:      { label: "Enviado",      color: "bg-blue-500/10 text-blue-600 dark:text-blue-400",        icon: <Package className="size-3.5" /> },
  confirmado:   { label: "Confirmado",   color: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",  icon: <CheckCircle2 className="size-3.5" /> },
  em_transito:  { label: "Em Trânsito",  color: "bg-amber-500/10 text-amber-700 dark:text-amber-400",    icon: <Truck className="size-3.5" /> },
  entregue:     { label: "Entregue",     color: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", icon: <CheckCircle2 className="size-3.5" /> },
  cancelado:    { label: "Cancelado",    color: "bg-red-500/10 text-red-600 dark:text-red-400",           icon: <XCircle className="size-3.5" /> },
};

const PROXIMO_LABEL: Record<string, string> = {
  enviado: "Marcar Enviado",
  confirmado: "Marcar Confirmado",
  em_transito: "Em Trânsito",
  entregue: "Marcar Entregue",
};

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtCurrency(v: string | number) {
  return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function PedidoCard({ pedido, onUpdate }: { pedido: PedidoCompra; onUpdate: (p: PedidoCompra) => void }) {
  const [open, setOpen] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const cfg = STATUS_CONFIG[pedido.status];

  async function handleAvancar(e: React.MouseEvent) {
    e.stopPropagation();
    setAdvancing(true);
    try {
      const updated = await avancarStatusPedido(pedido.id);
      onUpdate(updated);
    } catch {
      // silent — user sees no change
    } finally {
      setAdvancing(false);
    }
  }

  return (
    <div className={`border rounded-lg overflow-hidden ${pedido.em_atraso ? "border-red-400/60" : "border-border"}`}>
      <button
        className="w-full flex items-center gap-3 px-4 py-3 bg-muted/20 hover:bg-muted/40 transition-colors text-left"
        onClick={() => setOpen(v => !v)}
      >
        <span className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium shrink-0 ${cfg.color}`}>
          {cfg.icon}
          {cfg.label}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground truncate">
            {pedido.fornecedor_nome ?? `Pedido #${pedido.id}`}
          </p>
          {pedido.deal_titulo && (
            <p className="text-[11px] text-muted-foreground truncate">{pedido.deal_titulo}</p>
          )}
        </div>
        {pedido.em_atraso && (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/10 text-red-600 dark:text-red-400 text-[11px] font-medium shrink-0">
            <AlertTriangle className="size-3" />
            Atrasado
          </span>
        )}
        {pedido.valor_total && (
          <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 shrink-0 tabular-nums">
            {fmtCurrency(pedido.valor_total)}
          </span>
        )}
        {open ? <ChevronDown className="size-4 text-muted-foreground shrink-0" /> : <ChevronRight className="size-4 text-muted-foreground shrink-0" />}
      </button>

      {open && (
        <div className="px-4 py-3 border-t border-border space-y-3">
          {/* Atraso alert */}
          {pedido.em_atraso && (
            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-red-500/10 border border-red-400/30">
              <AlertTriangle className="size-4 text-red-500 shrink-0 mt-0.5" />
              <p className="text-xs text-red-600 dark:text-red-400">
                Este pedido ultrapassou a data prevista de entrega e pode comprometer a produção.
              </p>
            </div>
          )}

          {/* Items */}
          {pedido.itens && pedido.itens.length > 0 && (
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium mb-2">Itens</p>
              <div className="space-y-1">
                {pedido.itens.map((item, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span className="text-foreground/80">
                      {item.nome} <span className="text-muted-foreground">×{item.quantidade} {item.unidade}</span>
                    </span>
                    {item.preco_unitario && (
                      <span className="text-foreground font-medium tabular-nums">
                        {fmtCurrency(item.subtotal ?? Number(item.preco_unitario) * item.quantidade)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Timeline */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            {pedido.previsao_entrega && (
              <div className={`flex items-center gap-1.5 ${pedido.em_atraso ? "text-red-500" : "text-muted-foreground"}`}>
                <Clock className="size-3.5 shrink-0" />
                <span>Previsão: {fmtDate(pedido.previsao_entrega)}</span>
              </div>
            )}
            {pedido.confirmado_em && (
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <CheckCircle2 className="size-3.5 shrink-0" />
                <span>Confirmado: {fmtDate(pedido.confirmado_em)}</span>
              </div>
            )}
            {pedido.em_transito_em && (
              <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                <Truck className="size-3.5 shrink-0" />
                <span>Trânsito: {fmtDate(pedido.em_transito_em)}</span>
              </div>
            )}
            {pedido.entregue_em && (
              <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="size-3.5 shrink-0" />
                <span>Entregue: {fmtDate(pedido.entregue_em)}</span>
              </div>
            )}
          </div>

          {pedido.observacoes && (
            <p className="text-xs text-muted-foreground italic">{pedido.observacoes}</p>
          )}

          {/* Advance status button */}
          {pedido.proximo_status && pedido.status !== "cancelado" && (
            <Button
              size="sm"
              variant="outline"
              className="w-full gap-2"
              onClick={handleAvancar}
              disabled={advancing}
            >
              {advancing ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowRight className="size-3.5" />}
              {PROXIMO_LABEL[pedido.proximo_status] ?? `Avançar para ${pedido.proximo_status}`}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export function CRMCompra({ projectId, projectTitulo }: { projectId: number; projectTitulo?: string }) {
  const [pedidos, setPedidos] = useState<PedidoCompra[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listPedidosCompra({ project: projectId });
      setPedidos(data);
    } catch {
      setError("Erro ao carregar pedidos de compra.");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  function handleUpdate(updated: PedidoCompra) {
    setPedidos(prev => prev.map(p => p.id === updated.id ? updated : p));
  }

  const resumo = {
    total: pedidos.length,
    entregues: pedidos.filter(p => p.status === "entregue").length,
    emTransito: pedidos.filter(p => p.status === "em_transito").length,
    pendentes: pedidos.filter(p => ["criado", "enviado", "confirmado"].includes(p.status)).length,
    emAtraso: pedidos.filter(p => p.em_atraso).length,
    valorTotal: pedidos.reduce((acc, p) => acc + (p.valor_total ? Number(p.valor_total) : 0), 0),
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
        <Loader2 className="size-4 animate-spin" />
        <span className="text-sm">Carregando pedidos…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-12 text-destructive gap-2">
        <AlertCircle className="size-4" />
        <span className="text-sm">{error}</span>
        <Button size="sm" variant="outline" onClick={() => void load()}>Tentar novamente</Button>
      </div>
    );
  }

  if (pedidos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
        <div className="grid size-12 place-items-center rounded-full bg-muted/50">
          <ShoppingCart className="size-5 text-muted-foreground" />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">Nenhum pedido de compra</p>
          <p className="text-xs text-muted-foreground mt-1">
            Pedidos são gerados ao aprovar orçamentos na etapa Pré-Compra do Deal.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {/* Alerta de atrasos */}
      {resumo.emAtraso > 0 && (
        <div className="flex items-center gap-2.5 p-3 rounded-lg bg-red-500/10 border border-red-400/30">
          <AlertTriangle className="size-4 text-red-500 shrink-0" />
          <p className="text-sm text-red-600 dark:text-red-400 font-medium">
            {resumo.emAtraso === 1
              ? "1 pedido está em atraso e pode comprometer a produção."
              : `${resumo.emAtraso} pedidos estão em atraso e podem comprometer a produção.`}
          </p>
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-2 gap-2">
        <div className="p-3 rounded-lg bg-muted/30 text-center">
          <p className="text-xl font-bold text-foreground tabular-nums">{resumo.total}</p>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">Total</p>
        </div>
        <div className="p-3 rounded-lg bg-emerald-500/10 text-center">
          <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">{resumo.entregues}</p>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">Entregues</p>
        </div>
        <div className="p-3 rounded-lg bg-amber-500/10 text-center">
          <p className="text-xl font-bold text-amber-700 dark:text-amber-400 tabular-nums">{resumo.emTransito}</p>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">Em trânsito</p>
        </div>
        <div className="p-3 rounded-lg bg-blue-500/10 text-center">
          <p className="text-xl font-bold text-blue-600 dark:text-blue-400 tabular-nums">{resumo.pendentes}</p>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">Pendentes</p>
        </div>
      </div>

      {resumo.valorTotal > 0 && (
        <div className="p-3 rounded-lg bg-muted/30 flex items-center justify-between">
          <span className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Valor total em andamento</span>
          <span className="text-sm font-semibold text-foreground tabular-nums">
            {resumo.valorTotal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
          </span>
        </div>
      )}

      {/* Pedidos list — atrasados primeiro */}
      <div className="space-y-2">
        {[...pedidos]
          .sort((a, b) => (b.em_atraso ? 1 : 0) - (a.em_atraso ? 1 : 0))
          .map(p => <PedidoCard key={p.id} pedido={p} onUpdate={handleUpdate} />)
        }
      </div>

      {projectTitulo && (
        <p className="text-[11px] text-muted-foreground text-center">Projeto: {projectTitulo}</p>
      )}
    </div>
  );
}

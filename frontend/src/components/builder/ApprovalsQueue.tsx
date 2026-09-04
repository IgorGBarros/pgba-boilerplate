// frontend/src/components/builder/ApprovalsQueue.tsx
import { useEffect, useState } from "react";
import { ShieldAlert, Check, X, Clock } from "lucide-react";
import { listPendingApprovals, decidePendingApproval, type PendingApproval, ApiError } from "@/lib/api";
import { useRealtime } from "@/lib/useRealtime";

const RISK_COLOR: Record<string, string> = {
  low: "text-slate-400 bg-slate-500/10",
  medium: "text-yellow-400 bg-yellow-500/10",
  high: "text-orange-400 bg-orange-500/10",
  critical: "text-red-400 bg-red-500/10",
};

/**
 * Visualiza a fila do Policy Engine (agency.PendingApproval) — ações que
 * um agente tentou executar sozinho, mas o autonomy_level dele não
 * cobria o risco daquela ação (ver agency/policy.py). Aprovar aqui
 * EXECUTA a ação de verdade agora (agency.services.decide_pending_approval),
 * nunca antes — não é um botão decorativo.
 */
export default function ApprovalsQueue() {
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [decidingId, setDecidingId] = useState<number | null>(null);
  const { connected, lastPendingApprovalEvent } = useRealtime();

  async function refresh() {
    try {
      const data = await listPendingApprovals("pending");
      setApprovals(data);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao carregar aprovações.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // Rede de segurança bem espaçada — o normal agora é o WebSocket
    // atualizar isso na hora (ver efeito abaixo); esse poll só cobre uma
    // reconexão perdida ou o carregamento inicial antes do socket abrir.
    const interval = setInterval(refresh, 30000);
    return () => clearInterval(interval);
  }, []);

  // Chega em tempo real assim que uma ação é bloqueada pela política, ou
  // assim que alguém decide — nunca mais espera o próximo poll de 30s.
  useEffect(() => {
    if (!lastPendingApprovalEvent) return;
    setApprovals((prev) => {
      if (lastPendingApprovalEvent.status !== "pending") {
        return prev.filter((a) => a.id !== lastPendingApprovalEvent.id);
      }
      const exists = prev.some((a) => a.id === lastPendingApprovalEvent.id);
      if (exists) return prev.map((a) => (a.id === lastPendingApprovalEvent.id ? lastPendingApprovalEvent : a));
      return [lastPendingApprovalEvent, ...prev];
    });
  }, [lastPendingApprovalEvent]);

  async function handleDecide(id: number, approved: boolean) {
    setDecidingId(id);
    try {
      await decidePendingApproval(id, approved);
      setApprovals((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao decidir.");
    } finally {
      setDecidingId(null);
    }
  }

  if (loading) {
    return (
      <div className="space-y-2 p-6">
        {[0, 1].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-card border border-white/10 bg-surface-raised" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4 overflow-y-auto p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-slate-400" />
          <h2 className="text-sm font-semibold text-slate-200">Aprovações pendentes</h2>
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-slate-400">{approvals.length}</span>
        </div>
        <span className={`flex items-center gap-1 text-[10px] ${connected ? "text-green-400" : "text-slate-500"}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-green-400" : "bg-slate-600"}`} />
          {connected ? "tempo real" : "reconectando..."}
        </span>
      </div>

      {error && <p className="rounded-card border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</p>}

      {approvals.length === 0 && !error && (
        <p className="rounded-card border border-dashed border-white/10 py-8 text-center text-sm text-slate-500">
          Nenhuma ação aguardando aprovação — todos os agentes estão dentro do que a própria autonomia deles permite.
        </p>
      )}

      {approvals.map((approval) => (
        <div key={approval.id} className="rounded-card border border-white/10 bg-surface-raised p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-slate-100">{approval.agent_name}</span>
                <span className="text-xs text-slate-500">quer executar</span>
                <code className="rounded bg-black/30 px-1.5 py-0.5 text-xs text-brand-500">{approval.function_name}</code>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase ${RISK_COLOR[approval.risk] ?? RISK_COLOR.critical}`}>
                  {approval.risk}
                </span>
              </div>
              <p className="mt-1.5 text-xs text-slate-400">{approval.reason}</p>
              {Object.keys(approval.params).length > 0 && (
                <pre className="mt-2 overflow-x-auto rounded bg-black/30 p-2 text-[11px] text-slate-400">
                  {JSON.stringify(approval.params, null, 2)}
                </pre>
              )}
              <p className="mt-1.5 flex items-center gap-1 text-[10px] text-slate-500">
                <Clock className="h-3 w-3" />
                {new Date(approval.created_at).toLocaleString("pt-BR")}
              </p>
            </div>

            <div className="flex shrink-0 gap-1.5">
              <button
                onClick={() => handleDecide(approval.id, true)}
                disabled={decidingId === approval.id}
                className="flex items-center gap-1 rounded-lg bg-green-500/15 px-2.5 py-1.5 text-xs font-medium text-green-400 transition hover:bg-green-500/25 disabled:opacity-40"
              >
                <Check className="h-3.5 w-3.5" />
                Aprovar
              </button>
              <button
                onClick={() => handleDecide(approval.id, false)}
                disabled={decidingId === approval.id}
                className="flex items-center gap-1 rounded-lg bg-red-500/15 px-2.5 py-1.5 text-xs font-medium text-red-400 transition hover:bg-red-500/25 disabled:opacity-40"
              >
                <X className="h-3.5 w-3.5" />
                Rejeitar
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

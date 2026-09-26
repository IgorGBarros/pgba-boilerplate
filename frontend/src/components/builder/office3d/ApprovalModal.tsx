// office3d/ApprovalModal.tsx — decidir PendingApprovals pela planta.
//
// Quando a política de autonomia bloqueia uma função (agency.policy), ela
// NÃO executa: vira uma PendingApproval. Aprovar aqui chama o mesmo
// endpoint do painel de aprovações (`pending-approvals/{id}/decide/`), que
// só então executa a função de verdade via orchestration.registry.execute.
// Rejeitar só registra a decisão. Nada é executado pelo navegador.
import { useState } from "react";
import { Check, Loader2, ShieldAlert, X } from "lucide-react";
import { ApiError, decidePendingApproval, type PendingApproval } from "@/lib/api";

const RISK_STYLE: Record<string, string> = {
  low: "bg-stone-100 text-stone-600",
  medium: "bg-amber-50 text-amber-700",
  high: "bg-orange-100 text-orange-700",
  critical: "bg-red-100 text-red-700",
};
const RISK_LABEL: Record<string, string> = { low: "baixo", medium: "médio", high: "alto", critical: "crítico" };

export function ApprovalModal({
  approvals,
  title,
  onClose,
  onDecided,
}: {
  /** Aprovações a mostrar (já filtradas: de um agente ou de todos). */
  approvals: PendingApproval[];
  title: string;
  onClose: () => void;
  onDecided: (updated: PendingApproval) => void;
}) {
  const [busyId, setBusyId] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [done, setDone] = useState<PendingApproval[]>([]);

  const decide = async (p: PendingApproval, approved: boolean) => {
    setBusyId(p.id);
    setErrors((e) => ({ ...e, [p.id]: "" }));
    try {
      const updated = await decidePendingApproval(p.id, approved);
      setDone((d) => [...d, updated]);
      onDecided(updated);
    } catch (e) {
      setErrors((err) => ({ ...err, [p.id]: e instanceof ApiError ? e.message : "Falha ao registrar a decisão." }));
    } finally {
      setBusyId(null);
    }
  };

  const list = [...approvals, ...done.filter((d) => !approvals.some((a) => a.id === d.id))];

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-stone-900/25 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85%] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-stone-200 bg-[#faf8f4] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 border-b border-stone-200 px-4 py-3">
          <span className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-orange-100 text-orange-700">
            <ShieldAlert className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-800">Aprovação humana</p>
            <p className="text-xs text-stone-500">{title}</p>
          </div>
          <button onClick={onClose} className="rounded-full p-1 text-stone-400 hover:bg-stone-200 hover:text-stone-800"><X className="size-4" /></button>
        </div>

        <div className="flex-1 space-y-2.5 overflow-y-auto px-4 py-3 text-xs text-stone-600">
          <p className="text-[11px] text-stone-500">
            A política de autonomia bloqueou estas ações: nada foi executado ainda. Aprovar executa a função agora;
            rejeitar só registra a decisão.
          </p>
          {list.length === 0 && <p className="py-6 text-center text-stone-400">Nenhuma aprovação pendente.</p>}
          {list.map((p) => {
            const decided = p.status !== "pending";
            return (
              <div key={p.id} className="rounded-xl border border-stone-200 bg-white px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <code className="truncate font-mono text-[12px] text-stone-900">{p.function_name}</code>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${RISK_STYLE[p.risk] ?? RISK_STYLE.critical}`}>
                    risco {RISK_LABEL[p.risk] ?? p.risk}
                  </span>
                  <span className="ml-auto shrink-0 text-[10px] text-stone-400">{p.agent_name}</span>
                </div>
                <p className="mt-1 text-[12px] text-stone-700">{p.reason}</p>
                {Object.keys(p.params ?? {}).length > 0 && (
                  <pre className="mt-1.5 max-h-24 overflow-auto rounded-lg bg-stone-50 px-2 py-1 font-mono text-[10px] text-stone-600">
                    {JSON.stringify(p.params, null, 2)}
                  </pre>
                )}
                {errors[p.id] && <p className="mt-1.5 rounded bg-red-50 px-2 py-1 text-red-700">{errors[p.id]}</p>}
                <div className="mt-2 flex items-center justify-end gap-2">
                  {decided ? (
                    <span className={`text-[11px] font-semibold ${p.status === "approved" ? "text-emerald-700" : "text-stone-500"}`}>
                      {p.status === "approved" ? "✓ Aprovada e executada" : "✕ Rejeitada"}
                    </span>
                  ) : (
                    <>
                      <button
                        onClick={() => decide(p, false)}
                        disabled={busyId !== null}
                        className="rounded-full border border-stone-200 px-3 py-1 text-[11px] text-stone-700 hover:bg-stone-100 disabled:opacity-40"
                      >
                        Rejeitar
                      </button>
                      <button
                        onClick={() => decide(p, true)}
                        disabled={busyId !== null}
                        className="flex items-center gap-1 rounded-full bg-stone-900 px-3 py-1 text-[11px] font-semibold text-white hover:bg-stone-700 disabled:opacity-40"
                      >
                        {busyId === p.id ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
                        Aprovar e executar
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

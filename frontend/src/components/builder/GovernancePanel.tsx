// frontend/src/components/builder/GovernancePanel.tsx
import { ShieldAlert } from "lucide-react";
import ApprovalsQueue from "@/components/builder/ApprovalsQueue";
import PolicyRulesPanel from "@/components/builder/PolicyRulesPanel";

/**
 * "Aprovações e Políticas" numa aba só — cada peça (`ApprovalsQueue`,
 * `PolicyRulesPanel`) continua exatamente como já foi testada, esta
 * é só a composição visual das duas juntas, sem tocar no que já
 * funciona dentro delas. Fila de aprovação primeiro (o que precisa de
 * decisão AGORA), regras configuráveis depois (o que decide o que cai
 * ou não nessa fila no futuro).
 */
export default function GovernancePanel() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="border-b border-white/10 px-4 pt-4 sm:px-6">
        <div className="flex items-center gap-2 pb-3">
          <ShieldAlert className="h-4 w-4 text-slate-400" />
          <h1 className="text-sm font-semibold text-slate-200">Aprovações e Políticas</h1>
        </div>
      </div>
      <ApprovalsQueue />
      <div className="my-2 border-t border-white/10" />
      <PolicyRulesPanel />
    </div>
  );
}

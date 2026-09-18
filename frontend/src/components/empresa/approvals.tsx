import { CheckCircle2, Clock, ShieldAlert, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/empresa/shared";

interface Approval {
  id: string;
  agent: string;
  sector: string;
  action: string;
  risk: "low" | "medium" | "high" | "critical";
  created: string;
  status: "pending" | "approved" | "rejected";
}

const approvals: Approval[] = [
  {
    id: "PA-001",
    agent: "Agente SDR",
    sector: "Comercial",
    action: "enviar_proposta_comercial",
    risk: "high",
    created: "há 5 min",
    status: "pending",
  },
  {
    id: "PA-002",
    agent: "Agente Conciliação",
    sector: "Controladoria",
    action: "gerar_relatorio_financeiro",
    risk: "medium",
    created: "há 23 min",
    status: "approved",
  },
  {
    id: "PA-003",
    agent: "AI Backend",
    sector: "Desenvolvimento",
    action: "criar_branch_producao",
    risk: "critical",
    created: "há 1 h",
    status: "rejected",
  },
];

const riskVariant: Record<Approval["risk"], "destructive" | "default" | "secondary" | "outline"> = {
  critical: "destructive",
  high: "destructive",
  medium: "default",
  low: "secondary",
};

const statusIcon = {
  pending: Clock,
  approved: CheckCircle2,
  rejected: XCircle,
};

const statusColor: Record<Approval["status"], string> = {
  pending: "text-warning",
  approved: "text-success",
  rejected: "text-destructive",
};

export function Approvals() {
  return (
    <div className="space-y-6">
      <SectionHeader
        title="Aprovações e políticas"
        description="Ações bloqueadas pelo policy engine aguardando decisão humana."
      />

      <div className="panel divide-y divide-border">
        {approvals.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <ShieldAlert className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Nenhuma aprovação pendente.</p>
          </div>
        ) : (
          approvals.map((item) => {
            const StatusIcon = statusIcon[item.status];
            return (
              <div key={item.id} className="flex items-start gap-4 p-4">
                <StatusIcon className={`mt-0.5 size-5 shrink-0 ${statusColor[item.status]}`} />

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">{item.id}</span>
                    <Badge variant={riskVariant[item.risk]} className="text-[11px]">
                      {item.risk}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{item.created}</span>
                  </div>
                  <p className="mt-1 font-mono text-sm font-medium">{item.action}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.agent} · {item.sector}
                  </p>
                </div>

                {item.status === "pending" && (
                  <div className="flex shrink-0 gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => toast.error(`${item.id} rejeitada (protótipo)`)}
                    >
                      Rejeitar
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => toast.success(`${item.id} aprovada (protótipo)`)}
                    >
                      Aprovar
                    </Button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

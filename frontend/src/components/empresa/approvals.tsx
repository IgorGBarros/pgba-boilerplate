import { useEffect, useState } from "react";
import { CheckCircle2, Clock, ShieldAlert, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/empresa/shared";
import {
  listPendingApprovals,
  decidePendingApproval,
  type PendingApproval,
} from "@/lib/api";

const riskVariant: Record<string, "destructive" | "default" | "secondary"> = {
  critical: "destructive",
  high: "destructive",
  medium: "default",
  low: "secondary",
};

function statusIcon(status: PendingApproval["status"]) {
  if (status === "approved") return CheckCircle2;
  if (status === "rejected") return XCircle;
  return Clock;
}

function statusColor(status: PendingApproval["status"]): string {
  if (status === "approved") return "text-success";
  if (status === "rejected") return "text-destructive";
  return "text-warning";
}

function formatDate(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `há ${m} min`;
  const h = Math.floor(diff / 3600000);
  if (h < 24) return `há ${h} h`;
  return `há ${Math.floor(diff / 86400000)} d`;
}

export function Approvals() {
  const [items, setItems] = useState<PendingApproval[]>([]);
  const [loading, setLoading] = useState(true);
  const [deciding, setDeciding] = useState<Record<number, boolean>>({});

  const load = () => {
    listPendingApprovals()
      .then(setItems)
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const decide = async (id: number, approved: boolean) => {
    setDeciding((prev) => ({ ...prev, [id]: true }));
    try {
      const updated = await decidePendingApproval(id, approved);
      setItems((prev) => prev.map((i) => (i.id === id ? updated : i)));
      toast.success(approved ? "Aprovação confirmada" : "Aprovação rejeitada");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erro ao decidir");
    } finally {
      setDeciding((prev) => ({ ...prev, [id]: false }));
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Aprovações e políticas"
        description="Ações bloqueadas pelo policy engine aguardando decisão humana."
      />

      {loading ? (
        <div className="panel h-48 animate-pulse bg-elevated" />
      ) : (
        <div className="panel divide-y divide-border">
          {items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <ShieldAlert className="size-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Nenhuma aprovação pendente.</p>
            </div>
          ) : (
            items.map((item) => {
              const Icon = statusIcon(item.status);
              return (
                <div key={item.id} className="flex items-start gap-4 p-4">
                  <Icon className={`mt-0.5 size-5 shrink-0 ${statusColor(item.status)}`} />

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">PA-{item.id}</span>
                      <Badge
                        variant={riskVariant[item.risk] ?? "secondary"}
                        className="text-[11px]"
                      >
                        {item.risk}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {formatDate(item.created_at)}
                      </span>
                    </div>
                    <p className="mt-1 font-mono text-sm font-medium">{item.function_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.agent_name}
                      {item.reason && ` · ${item.reason}`}
                    </p>
                  </div>

                  {item.status === "pending" && (
                    <div className="flex shrink-0 gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={deciding[item.id]}
                        onClick={() => decide(item.id, false)}
                      >
                        Rejeitar
                      </Button>
                      <Button
                        size="sm"
                        disabled={deciding[item.id]}
                        onClick={() => decide(item.id, true)}
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
      )}
    </div>
  );
}

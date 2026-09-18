import { useEffect, useState } from "react";
import { ScrollText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SectionHeader } from "@/components/empresa/shared";
import { listQueryLogs, type QueryLog } from "@/lib/api";

const statusVariant: Record<QueryLog["status"], "default" | "secondary" | "destructive"> = {
  ok: "secondary",
  function_error: "destructive",
  llm_error: "destructive",
  rejected: "default",
};

function formatTs(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatDate(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `há ${m} min`;
  const h = Math.floor(diff / 3600000);
  if (h < 24) return `há ${h} h`;
  return new Date(iso).toLocaleDateString("pt-BR");
}

export function Logs() {
  const [logs, setLogs] = useState<QueryLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listQueryLogs()
      .then(setLogs)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Logs de auditoria"
        description="Registro de todas as interações dos agentes com o orquestrador — auditável e rastreável."
      />

      {loading ? (
        <div className="panel h-48 animate-pulse bg-elevated" />
      ) : (
        <div className="panel">
          {logs.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <ScrollText className="size-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Nenhum log registrado.</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {logs.map((entry) => (
                <div key={entry.id} className="flex items-start gap-3 px-4 py-3">
                  <span className="mt-0.5 w-16 shrink-0 font-mono text-xs text-muted-foreground">
                    {formatTs(entry.created_at)}
                  </span>
                  <Badge
                    variant={statusVariant[entry.status]}
                    className="mt-0.5 shrink-0 text-[11px]"
                  >
                    {entry.status}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">{entry.question}</p>
                    <p className="text-xs text-muted-foreground">
                      {entry.model_used}
                      {entry.function_called && (
                        <span className="font-mono"> · {entry.function_called}()</span>
                      )}
                      <span className="ml-2">{formatDate(entry.created_at)}</span>
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

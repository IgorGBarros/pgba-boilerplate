import { useEffect, useState, useCallback } from "react";
import { ScrollText, ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/empresa/shared";
import { listQueryLogs, type QueryLog } from "@/lib/api";

const statusVariant: Record<QueryLog["status"], "default" | "secondary" | "destructive"> = {
  ok: "secondary",
  function_error: "destructive",
  llm_error: "destructive",
  rejected: "default",
};

const ALL_STATUSES = ["ok", "function_error", "llm_error", "rejected"] as const;
const PAGE_SIZE = 20;

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
  const [loadingMore, setLoadingMore] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const fetchLogs = useCallback(async (p: number, status: string, replace: boolean) => {
    if (replace) setLoading(true); else setLoadingMore(true);
    try {
      const { results, count } = await listQueryLogs({ status: status || undefined, page: p, pageSize: PAGE_SIZE });
      setLogs((prev) => replace ? results : [...prev, ...results]);
      setTotal(count);
    } catch (e) {
      console.error(e);
    } finally {
      if (replace) setLoading(false); else setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    setPage(1);
    fetchLogs(1, statusFilter, true);
  }, [statusFilter, fetchLogs]);

  function loadMore() {
    const next = page + 1;
    setPage(next);
    fetchLogs(next, statusFilter, false);
  }

  const hasMore = logs.length < total;

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Logs de auditoria"
        description="Registro de todas as interações dos agentes com o orquestrador — auditável e rastreável."
      />

      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Filtrar por status:</span>
        <div className="flex gap-1">
          <button
            onClick={() => setStatusFilter("")}
            className={`rounded px-2 py-0.5 text-xs ${statusFilter === "" ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:bg-elevated"}`}
          >
            Todos
          </button>
          {ALL_STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`rounded px-2 py-0.5 text-xs ${statusFilter === s ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:bg-elevated"}`}
            >
              {s}
            </button>
          ))}
        </div>
        {total > 0 && <span className="ml-auto text-xs text-muted-foreground">{total} total</span>}
      </div>

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
            <>
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
              {hasMore && (
                <div className="flex justify-center border-t border-border p-3">
                  <Button variant="ghost" size="sm" onClick={loadMore} disabled={loadingMore}>
                    <ChevronDown className="mr-1 size-4" />
                    {loadingMore ? "Carregando…" : "Carregar mais"}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

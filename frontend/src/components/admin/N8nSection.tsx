// frontend/src/components/admin/N8nSection.tsx
//
// Automações do n8n: conexão (URL + API key) e painel — workflows, gatilho,
// ligado/desligado, execuções recentes com sucesso/erro. Ligar/desligar é
// ação de pessoa; os agentes só LEEM (função n8n_automacoes_resumo).
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, ExternalLink, Hand, Loader2, RefreshCw, Search, Webhook, Workflow, Zap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getN8nOverview,
  listN8nExecutions,
  setN8nWorkflowActive,
  type N8nExecution,
  type N8nOverview,
  type N8nWorkflow,
  type ServiceCredentialInfo,
} from "@/lib/api";
import { Badge, Card, CredentialCard, Kpi, SectionHeader, fmtDate, type Tone } from "@/components/admin/shared";

const TRIGGER: Record<N8nWorkflow["trigger"], { label: string; icon: React.ElementType }> = {
  webhook: { label: "webhook", icon: Webhook },
  agendado: { label: "agendado", icon: CalendarClock },
  manual: { label: "manual", icon: Hand },
  evento: { label: "evento", icon: Zap },
  outro: { label: "outro", icon: Workflow },
};

const EXEC_TONE: Record<string, Tone> = { success: "ok", error: "error", running: "info", waiting: "warn", canceled: "muted" };
const EXEC_LABEL: Record<string, string> = { success: "sucesso", error: "erro", running: "rodando", waiting: "aguardando", canceled: "cancelada" };

function Toggle({ checked, disabled, onChange, label }: { checked: boolean; disabled?: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition ${checked ? "bg-success" : "bg-muted-foreground/30"} disabled:opacity-50`}>
      <span className={`absolute top-0.5 size-4 rounded-full bg-white shadow transition ${checked ? "left-[18px]" : "left-0.5"}`} />
    </button>
  );
}

function RecentBar({ w }: { w: N8nWorkflow }) {
  const total = w.recent.success + w.recent.error + w.recent.other;
  if (!total) return <span className="text-[11px] text-muted-foreground">sem execuções recentes</span>;
  return (
    <span className="flex items-center gap-2">
      <span className="flex h-1.5 w-24 overflow-hidden rounded-full bg-secondary">
        <span className="bg-success" style={{ width: `${(w.recent.success / total) * 100}%` }} />
        <span className="bg-destructive" style={{ width: `${(w.recent.error / total) * 100}%` }} />
      </span>
      <span className="text-[11px] tabular-nums text-muted-foreground">{w.recent.success}✓ {w.recent.error ? `${w.recent.error}✕` : ""}</span>
    </span>
  );
}

function Executions({ workflowId }: { workflowId: string }) {
  const [rows, setRows] = useState<N8nExecution[] | null>(null);
  useEffect(() => { listN8nExecutions(workflowId).then(setRows).catch(() => setRows([])); }, [workflowId]);
  if (!rows) return <p className="py-2 text-xs text-muted-foreground">Carregando execuções…</p>;
  if (!rows.length) return <p className="py-2 text-xs text-muted-foreground">Nenhuma execução registrada.</p>;
  return (
    <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
      {rows.slice(0, 10).map((e) => (
        <li key={e.id} className="flex items-center gap-3 px-3 py-1.5 text-xs">
          <Badge tone={EXEC_TONE[e.status] ?? "muted"}>{EXEC_LABEL[e.status] ?? e.status}</Badge>
          <span className="tabular-nums text-muted-foreground">#{e.id}</span>
          <span className="text-muted-foreground">{e.mode}</span>
          <span className="ml-auto tabular-nums text-muted-foreground">{fmtDate(e.started_at)}</span>
        </li>
      ))}
    </ul>
  );
}

export function N8nSection({ credential, onCredentialsChanged }: { credential: ServiceCredentialInfo | undefined; onCredentialsChanged: () => void }) {
  const [data, setData] = useState<N8nOverview | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<"all" | "active" | "error">("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const base = (credential?.account_ref ?? "").replace(/\/+$/, "").replace(/\/api\/v1$/, "");

  const load = useCallback(async () => {
    if (!credential?.configured) return;
    setLoading(true);
    setError("");
    try {
      setData(await getN8nOverview());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível ler o n8n.");
    } finally {
      setLoading(false);
    }
  }, [credential?.configured]);
  useEffect(() => { void load(); }, [load]);

  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data?.workflows ?? [])
      .filter((w) => !w.archived)
      .filter((w) => (filter === "active" ? w.active : filter === "error" ? w.recent.error > 0 : true))
      .filter((w) => !term || w.name.toLowerCase().includes(term) || w.tags.some((t) => t.toLowerCase().includes(term)))
      .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
  }, [data, filter, q]);

  const toggle = async (w: N8nWorkflow, active: boolean) => {
    setToggling(w.id);
    try {
      await setN8nWorkflowActive(w.id, active);
      toast.success(`${w.name}: ${active ? "ligado" : "desligado"}.`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível alterar.");
    } finally {
      setToggling(null);
    }
  };

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Automações (n8n)"
        description="Veja o que roda no n8n, o que falhou e ligue/desligue fluxos. Os agentes conseguem consultar este resumo (só leitura)."
        actions={credential?.configured && (
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} /> Atualizar
          </Button>
        )}
      />
      <CredentialCard
        provider="n8n"
        current={credential}
        title="Conexão com o n8n"
        accountLabel="URL da instância"
        accountPlaceholder="https://n8n.suaempresa.com"
        accountHelp="Endereço onde o n8n roda (na VPS ou n8n Cloud)."
        tokenLabel="API key"
        tokenPlaceholder="n8n_api_..."
        tokenHelp="n8n → Settings → n8n API → Create API key."
        onChanged={() => { onCredentialsChanged(); void load(); }}
      />
      {error && <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      {credential?.configured && !data && !error && (
        <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Lendo workflows…</p>
      )}
      {data && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Kpi label="Workflows" value={data.totals.workflows} />
            <Kpi label="Ativos" value={data.totals.active} tone="ok" />
            <Kpi label="Sucesso (recente)" value={data.totals.success_recent} />
            <Kpi label="Erros (recente)" value={data.totals.errors_recent} tone={data.totals.errors_recent ? "error" : undefined} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {([["all", "Todos"], ["active", "Ativos"], ["error", "Com erro"]] as const).map(([id, label]) => (
              <button key={id} type="button" onClick={() => setFilter(id)}
                className={`rounded-full px-3 py-1 text-sm transition ${filter === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground"}`}>
                {label}
              </button>
            ))}
            <div className="relative ml-auto w-full sm:w-64">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar workflow ou tag…" className="pl-8" />
            </div>
          </div>
          <div className="space-y-2">
            {list.map((w) => {
              const T = TRIGGER[w.trigger];
              return (
                <Card key={w.id} className="p-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <Toggle checked={w.active} disabled={toggling === w.id} onChange={(v) => void toggle(w, v)} label={`Ligar ${w.name}`} />
                    <button type="button" onClick={() => setOpen(open === w.id ? null : w.id)} className="min-w-0 flex-1 text-left">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium">{w.name}</span>
                        <Badge><T.icon className="size-3" /> {T.label}</Badge>
                        {w.tags.map((t) => <Badge key={t} tone="info">{t}</Badge>)}
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                        <span>{w.nodes} nó(s){w.node_types.length ? ` · ${w.node_types.slice(0, 5).join(", ")}` : ""}</span>
                        <RecentBar w={w} />
                        {w.recent.last && <span>última: {fmtDate(w.recent.last.started_at)} ({EXEC_LABEL[w.recent.last.status] ?? w.recent.last.status})</span>}
                      </span>
                    </button>
                    {base && (
                      <a href={`${base}/workflow/${encodeURIComponent(w.id)}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                        Abrir no n8n <ExternalLink className="size-3" />
                      </a>
                    )}
                  </div>
                  {open === w.id && <Executions workflowId={w.id} />}
                </Card>
              );
            })}
            {!list.length && <p className="py-6 text-center text-sm text-muted-foreground">Nenhum workflow neste filtro.</p>}
          </div>
        </>
      )}
      {!credential?.configured && (
        <Card className="text-sm text-muted-foreground">
          Sem n8n ainda? Ele pode rodar na sua VPS (Oracle grátis ou Hostinger) — cadastre o servidor em <strong className="text-foreground">Servidores</strong> e,
          com o n8n no ar, volte aqui com a URL e a API key.
        </Card>
      )}
    </div>
  );
}

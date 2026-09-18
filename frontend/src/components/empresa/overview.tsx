import { useEffect, useState } from "react";
import {
  Activity,
  Brain,
  Building2,
  Code2,
  MessageSquare,
  PauseCircle,
  Receipt,
  ShoppingCart,
  Users,
  Wallet,
  Wrench,
  Database,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Metric, StatusDot } from "@/components/empresa/shared";
import {
  listSectors,
  listAgents,
  getAgentMetricsOverview,
  type Sector,
  type Agent,
  type AgentMetricsOverview,
} from "@/lib/api";

type SectorIconKey = "commercial" | "purchasing" | "finance" | "dev" | "ops";

const sectorIcons: Record<SectorIconKey, React.ElementType> = {
  commercial: Users,
  purchasing: ShoppingCart,
  finance: Receipt,
  dev: Code2,
  ops: Wrench,
};

function inferIcon(name: string): SectorIconKey {
  const n = name.toLowerCase();
  if (n.includes("comercial") || n.includes("vend")) return "commercial";
  if (n.includes("compra") || n.includes("purch")) return "purchasing";
  if (n.includes("financ") || n.includes("contabil") || n.includes("control")) return "finance";
  if (n.includes("desen") || n.includes("dev") || n.includes("tech")) return "dev";
  return "ops";
}

function formatCost(usd: number): string {
  if (usd === 0) return "R$ 0,00";
  return `US$ ${usd.toFixed(2)}`;
}

export function Overview({ onNewTask }: { onNewTask: (sector?: string) => void }) {
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [metrics, setMetrics] = useState<AgentMetricsOverview | null>(null);
  const [openSectorId, setOpenSectorId] = useState<number | null>(null);
  const [openAgentId, setOpenAgentId] = useState<number | null>(null);
  const [openCompany, setOpenCompany] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([listSectors(), listAgents(), getAgentMetricsOverview()])
      .then(([s, a, m]) => {
        setSectors(s);
        setAgents(a);
        setMetrics(m);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const agentsBySector = agents.reduce<Record<number, Agent[]>>((acc, a) => {
    if (a.sector != null) {
      acc[a.sector] = [...(acc[a.sector] ?? []), a];
    }
    return acc;
  }, {});

  const orchestrators = agents.filter(
    (a) => a.access_level === "ceo" || a.access_level === "general_orchestrator",
  );
  const primaryOrchestrator = orchestrators[0] ?? null;

  const openSector = sectors.find((s) => s.id === openSectorId) ?? null;
  const openAgent = agents.find((a) => a.id === openAgentId) ?? null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end gap-2 text-xs text-success">
        <span className="size-2 rounded-full bg-success animate-pulse" />
        Tempo real conectado
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="panel h-24 animate-pulse bg-elevated" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Metric
            label="Agentes"
            value={String(metrics?.total_agents ?? agents.length)}
            icon={<Users className="size-4" />}
          />
          <Metric
            label="Trabalhando agora"
            value={String(metrics?.working_now ?? agents.filter((a) => a.work_status === "working").length)}
            icon={<Activity className="size-4" />}
            tone="success"
          />
          <Metric
            label="Pausados"
            value={String(metrics?.paused ?? agents.filter((a) => a.work_status === "paused").length)}
            icon={<PauseCircle className="size-4" />}
            tone="warning"
          />
          <Metric
            label="Custo total"
            value={formatCost(metrics?.total_cost_usd ?? 0)}
            icon={<Wallet className="size-4" />}
          />
        </div>
      )}

      <div className="flex flex-col items-center">
        <button
          type="button"
          onClick={() => setOpenCompany(true)}
          className="panel w-full max-w-xl p-5 text-left transition-colors hover:border-primary"
        >
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-lg bg-secondary text-muted-foreground">
              <Building2 className="size-5" />
            </span>
            <div>
              <p className="font-semibold">Empresa</p>
              <p className="text-sm text-muted-foreground">Visão estratégica</p>
            </div>
          </div>
        </button>

        {primaryOrchestrator && (
          <>
            <div className="h-6 w-px bg-border" />
            <button
              type="button"
              onClick={() => setOpenAgentId(primaryOrchestrator.id)}
              className="panel glow-ring w-full max-w-xl p-5 text-left"
            >
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-lg gradient-primary text-primary-foreground">
                  <Brain className="size-5" />
                </span>
                <div>
                  <p className="font-semibold">{primaryOrchestrator.name}</p>
                  <p className="text-sm text-muted-foreground">{primaryOrchestrator.role}</p>
                </div>
              </div>
            </button>
            <div className="h-6 w-px bg-border" />
          </>
        )}
      </div>

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="panel h-48 animate-pulse bg-elevated" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {sectors.map((sector) => {
            const Icon = sectorIcons[inferIcon(sector.name)];
            const sectorAgents = agentsBySector[sector.id] ?? [];
            const hasRag = sector.knowledge_source !== null;

            return (
              <div key={sector.id} className="panel flex flex-col">
                <button
                  type="button"
                  onClick={() => setOpenSectorId(sector.id)}
                  className="flex items-center justify-between gap-2 border-b border-border p-4 text-left transition-colors hover:bg-accent"
                >
                  <div className="flex items-center gap-2 font-semibold">
                    <Icon className="size-4 text-primary" />
                    {sector.name}
                  </div>
                  <Badge variant={hasRag ? "default" : "secondary"} className="gap-1 text-[11px]">
                    <Database className="size-3" />
                    {hasRag ? sector.knowledge_source_name ?? "RAG ativo" : "sem RAG"}
                  </Badge>
                </button>

                <div className="flex-1 space-y-2 p-4">
                  {sectorAgents.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      Nenhum agente ainda.
                    </p>
                  ) : (
                    sectorAgents.map((agent) => (
                      <button
                        key={agent.id}
                        type="button"
                        onClick={() => setOpenAgentId(agent.id)}
                        className="flex w-full items-center justify-between gap-2 rounded-md border border-border bg-elevated px-3 py-2 text-left transition-colors hover:border-primary"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <StatusDot status={agent.work_status} />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{agent.name}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {agent.role}
                            </p>
                          </div>
                        </div>
                        <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
                      </button>
                    ))
                  )}
                </div>

                <div className="border-t border-border p-3">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="w-full"
                    onClick={() => onNewTask(sector.name)}
                  >
                    Criar tarefa para {sector.name}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Sector dialog */}
      <Dialog open={!!openSector} onOpenChange={(v) => !v && setOpenSectorId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{openSector?.name}</DialogTitle>
            <DialogDescription>{openSector?.description}</DialogDescription>
          </DialogHeader>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Agentes</dt>
              <dd>{openSector?.agents_count ?? 0}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Base de conhecimento</dt>
              <dd>{openSector?.knowledge_source_name ?? "—"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Orçamento mensal</dt>
              <dd>{openSector ? `US$ ${openSector.monthly_budget_usd}` : "—"}</dd>
            </div>
          </dl>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenSectorId(null)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Agent dialog */}
      <Dialog open={!!openAgent} onOpenChange={(v) => !v && setOpenAgentId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{openAgent?.name}</DialogTitle>
            <DialogDescription>{openAgent?.role}</DialogDescription>
          </DialogHeader>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Setor</dt>
              <dd>{openAgent?.sector_name ?? "—"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Nível de acesso</dt>
              <dd className="font-mono text-xs">{openAgent?.access_level}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Autonomia</dt>
              <dd>{openAgent?.autonomy_level}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Status</dt>
              <dd className="flex items-center gap-1.5">
                <StatusDot status={openAgent?.work_status ?? "idle"} />
                {openAgent?.work_status}
              </dd>
            </div>
            {openAgent?.current_task && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Tarefa atual</dt>
                <dd className="max-w-[200px] truncate text-xs">{openAgent.current_task}</dd>
              </div>
            )}
          </dl>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenAgentId(null)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Company dialog */}
      <Dialog open={openCompany} onOpenChange={setOpenCompany}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Empresa</DialogTitle>
            <DialogDescription>
              Visão estratégica do motor principal e de todos os projetos derivados.
            </DialogDescription>
          </DialogHeader>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Setores</dt>
              <dd>{sectors.length}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Agentes</dt>
              <dd>{agents.length}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Motor principal</dt>
              <dd className="font-mono text-xs">pgba-core</dd>
            </div>
          </dl>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenCompany(false)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

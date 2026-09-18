import { useEffect, useRef, useState } from "react";
import {
  Activity,
  Brain,
  Building2,
  Code2,
  Database,
  FileText,
  MessageSquare,
  PauseCircle,
  Plus,
  Receipt,
  Save,
  ShoppingCart,
  Users,
  Wallet,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Metric, StatusDot } from "@/components/empresa/shared";
import { aiModels } from "@/lib/pgba-data";
import {
  listSectors,
  listAgents,
  getAgentMetricsOverview,
  getSectorMetrics,
  listDocuments,
  uploadDocumentFile,
  updateAgent,
  type Sector,
  type Agent,
  type AgentMetricsOverview,
  type SectorMetric,
  type KnowledgeDocument,
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
  if (usd === 0) return "US$ 0,00";
  return `US$ ${usd.toFixed(4)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

// ─── Sector Knowledge Dialog ─────────────────────────────────────────────────

function SectorKnowledgeDialog({
  sector,
  open,
  onClose,
}: {
  sector: Sector | null;
  open: boolean;
  onClose: () => void;
}) {
  const [docs, setDocs] = useState<KnowledgeDocument[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || !sector?.knowledge_source) {
      setDocs([]);
      return;
    }
    listDocuments(sector.knowledge_source).then(setDocs).catch(console.error);
  }, [open, sector?.knowledge_source]);

  const handleUpload = async (files: FileList | null) => {
    if (!files || !sector?.knowledge_source) return;
    setUploading(true);
    let ok = 0;
    for (const file of Array.from(files)) {
      try {
        await uploadDocumentFile(sector.knowledge_source, file);
        ok++;
      } catch (e: unknown) {
        toast.error(`Erro ao enviar ${file.name}: ${e instanceof Error ? e.message : "falha"}`);
      }
    }
    if (ok > 0) {
      toast.success(`${ok} arquivo(s) enviado(s)`);
      listDocuments(sector!.knowledge_source!).then(setDocs).catch(console.error);
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{sector?.name}</DialogTitle>
          <DialogDescription>{sector?.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">{sector?.agents_count ?? 0} agentes</Badge>
            <Badge variant={sector?.knowledge_source ? "default" : "secondary"}>
              {sector?.knowledge_source ? `RAG · ${sector.knowledge_source_name}` : "sem RAG"}
            </Badge>
            {sector?.monthly_budget_usd && parseFloat(sector.monthly_budget_usd) > 0 && (
              <Badge variant="secondary">
                US$ {parseFloat(sector.monthly_budget_usd).toFixed(2)}/mês
              </Badge>
            )}
          </div>

          <div>
            <p className="mb-2 text-sm font-medium">Documentos de conhecimento</p>
            <div className="max-h-64 space-y-1.5 overflow-y-auto rounded-md border border-border p-2">
              {!sector?.knowledge_source ? (
                <p className="p-4 text-center text-sm text-muted-foreground">
                  Configure uma base de conhecimento para este setor para indexar documentos.
                </p>
              ) : docs.length === 0 ? (
                <p className="p-4 text-center text-sm text-muted-foreground">
                  Nenhum documento ainda — envie um arquivo abaixo.
                </p>
              ) : (
                docs.map((doc) => (
                  <div
                    key={doc.id}
                    className="flex items-center gap-3 rounded-md bg-elevated px-3 py-2"
                  >
                    <FileText className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{doc.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {doc.metadata?.uploaded_filename ?? doc.source_name}
                      </p>
                    </div>
                    <Badge
                      variant={
                        doc.status === "indexed"
                          ? "default"
                          : doc.status === "error"
                          ? "destructive"
                          : "secondary"
                      }
                      className="shrink-0 text-[11px]"
                    >
                      {doc.status}
                    </Badge>
                  </div>
                ))
              )}
            </div>
          </div>

          {sector?.knowledge_source && (
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-border bg-elevated px-4 py-4 text-sm text-muted-foreground transition-colors hover:border-primary">
              <Plus className="size-4" />
              {uploading ? "Enviando..." : "Anexar documento ao setor"}
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                multiple
                accept=".pdf,.md,.txt,.docx,.png,.jpg,.jpeg,.xlsx,.csv"
                disabled={uploading}
                onChange={(e) => handleUpload(e.target.files)}
              />
            </label>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Agent Edit Dialog ────────────────────────────────────────────────────────

function AgentEditDialog({
  agent,
  open,
  onClose,
  onUpdated,
}: {
  agent: Agent | null;
  open: boolean;
  onClose: () => void;
  onUpdated: (updated: Agent) => void;
}) {
  const [role, setRole] = useState("");
  const [model, setModel] = useState(aiModels[0]!);
  const [skillsMd, setSkillsMd] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (agent) {
      setRole(agent.role);
      setModel(aiModels[0]!);
      setSkillsMd("");
    }
  }, [agent]);

  const handleSave = async () => {
    if (!agent) return;
    setSaving(true);
    try {
      const updated = await updateAgent(agent.id, { role, skillsMd });
      toast.success("Agente atualizado");
      onUpdated(updated);
      onClose();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar agente");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{agent?.name}</DialogTitle>
          <DialogDescription>
            Ajuste o papel, o modelo de IA e as instruções do skills.md deste agente.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ag-role">Papel</Label>
              <Input
                id="ag-role"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="ex: Gerente Comercial"
              />
            </div>
            <div className="space-y-2">
              <Label>Modelo de IA</Label>
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {aiModels.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ag-skills">skills.md</Label>
            <Textarea
              id="ag-skills"
              value={skillsMd}
              onChange={(e) => setSkillsMd(e.target.value)}
              className="min-h-64 font-mono text-xs"
              placeholder={`# ${agent?.name ?? "Agente"}\n\n## Responsabilidades\n- ...\n\n## Regras\n- ...`}
            />
          </div>

          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span className="rounded bg-elevated px-2 py-0.5 font-mono">
              {agent?.access_level}
            </span>
            <span className="rounded bg-elevated px-2 py-0.5">
              autonomia {agent?.autonomy_level}
            </span>
            <span className="rounded bg-elevated px-2 py-0.5">
              {agent?.sector_name ?? "sem setor"}
            </span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            <Save className="size-4" />
            {saving ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function Overview({ onNewTask }: { onNewTask: (sector?: string) => void }) {
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [metrics, setMetrics] = useState<AgentMetricsOverview | null>(null);
  const [sectorMetrics, setSectorMetrics] = useState<SectorMetric[]>([]);
  const [openSector, setOpenSector] = useState<Sector | null>(null);
  const [sectorKnowledgeOpen, setSectorKnowledgeOpen] = useState(false);
  const [openAgent, setOpenAgent] = useState<Agent | null>(null);
  const [agentEditOpen, setAgentEditOpen] = useState(false);
  const [openCompany, setOpenCompany] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      listSectors(),
      listAgents(),
      getAgentMetricsOverview(),
      getSectorMetrics().catch(() => [] as SectorMetric[]),
    ])
      .then(([s, a, m, sm]) => {
        setSectors(s);
        setAgents(a);
        setMetrics(m);
        setSectorMetrics(sm);
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

  const handleAgentUpdated = (updated: Agent) => {
    setAgents((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end gap-2 text-xs text-success">
        <span className="size-2 rounded-full bg-success animate-pulse" />
        Tempo real conectado
      </div>

      {/* KPI tiles */}
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

      {/* Hierarquia: empresa → orquestrador → setores */}
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
              onClick={() => { setOpenAgent(primaryOrchestrator); setAgentEditOpen(true); }}
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

      {/* Setores */}
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
                <div className="flex items-center justify-between gap-2 border-b border-border p-4">
                  <div className="flex items-center gap-2 font-semibold">
                    <Icon className="size-4 text-primary" />
                    {sector.name}
                  </div>
                  {/* RAG badge — clicável para abrir modal de docs */}
                  <button
                    type="button"
                    onClick={() => { setOpenSector(sector); setSectorKnowledgeOpen(true); }}
                    title="Ver / adicionar documentos de conhecimento"
                  >
                    <Badge
                      variant={hasRag ? "default" : "secondary"}
                      className="cursor-pointer gap-1 text-[11px] hover:opacity-80"
                    >
                      <Database className="size-3" />
                      {hasRag ? sector.knowledge_source_name ?? "RAG ativo" : "sem RAG"}
                    </Badge>
                  </button>
                </div>

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
                        onClick={() => { setOpenAgent(agent); setAgentEditOpen(true); }}
                        className="flex w-full items-center justify-between gap-2 rounded-md border border-border bg-elevated px-3 py-2 text-left transition-colors hover:border-primary"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <StatusDot status={agent.work_status as import("@/lib/pgba-data").AgentStatus} />
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

      {/* Métricas de tokens por setor */}
      {sectorMetrics.length > 0 && (
        <div className="panel">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <Wallet className="size-4 text-primary" />
            <p className="font-semibold">Tokens e custo por setor</p>
          </div>
          <div className="divide-y divide-border">
            {sectorMetrics.map((m) => (
              <div key={m.sector_id} className="flex items-center gap-4 px-4 py-3 text-sm">
                <p className="min-w-0 flex-1 font-medium">{m.sector_name}</p>
                <div className="flex shrink-0 items-center gap-4 text-right text-xs text-muted-foreground">
                  <span className="hidden sm:block">
                    <span className="font-mono">{formatTokens(m.tokens)}</span> tokens
                  </span>
                  <span className="w-20 font-mono text-right">{formatCost(m.cost_usd)}</span>
                  {m.usage_percent !== null && (
                    <div className="hidden w-24 items-center gap-1.5 sm:flex">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-border">
                        <div
                          className={`h-full rounded-full ${
                            m.status === "over"
                              ? "bg-destructive"
                              : m.status === "warn"
                              ? "bg-warning"
                              : "bg-success"
                          }`}
                          style={{ width: `${Math.min(m.usage_percent, 100)}%` }}
                        />
                      </div>
                      <span className="w-8 text-right">{m.usage_percent.toFixed(0)}%</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sector knowledge dialog */}
      <SectorKnowledgeDialog
        sector={openSector}
        open={sectorKnowledgeOpen}
        onClose={() => setSectorKnowledgeOpen(false)}
      />

      {/* Agent edit dialog */}
      <AgentEditDialog
        agent={openAgent}
        open={agentEditOpen}
        onClose={() => setAgentEditOpen(false)}
        onUpdated={handleAgentUpdated}
      />

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
              <dt className="text-muted-foreground">Custo total</dt>
              <dd>{formatCost(metrics?.total_cost_usd ?? 0)}</dd>
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

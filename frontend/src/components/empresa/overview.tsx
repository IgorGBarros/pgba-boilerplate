import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  Activity,
  Brain,
  Building2,
  ChevronRight,
  Code2,
  Cuboid,
  Database,
  FileText,
  FolderTree,
  Handshake,
  Landmark,
  Layers,
  MessageSquare,
  PauseCircle,
  Pencil,
  Plus,
  Receipt,
  Save,
  Settings,
  ShoppingCart,
  ShieldCheck,
  Trash2,
  TrendingUp,
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
import {
  ImportProjectDialog,
  NewProjectDialog,
} from "@/components/empresa/dialogs";
import { SectorDetailPage } from "@/components/empresa/mercado";
import { Projects } from "@/components/empresa/projects";
import { CRMView } from "@/components/empresa/crm";
import { ERPView } from "@/components/empresa/erp";
import { ControladoriaView } from "@/components/empresa/controladoria";
import { DataLakeView } from "@/components/empresa/datalake";
import SettingsModal from "@/components/builder/SettingsModal";
import { DEFAULT_SETTINGS, type AppSettings } from "@/types/settings";
import { aiModels } from "@/lib/pgba-data";
import {
  createAgent,
  createSector,
  deleteAgent,
  deleteSector,
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
  type AgentAccessLevel,
} from "@/lib/api";

const CompanyOffice3D = lazy(() => import("@/components/builder/CompanyOffice3D"));

type SectorIconKey = "commercial" | "purchasing" | "finance" | "dev" | "ops" | "mercado";

const sectorIcons: Record<SectorIconKey, React.ElementType> = {
  commercial: Users,
  purchasing: ShoppingCart,
  finance: Receipt,
  dev: Code2,
  ops: Wrench,
  mercado: TrendingUp,
};

function inferIcon(name: string): SectorIconKey {
  const n = name.toLowerCase();
  if (n.includes("mercado") || n.includes("trading") || n.includes("bolsa")) return "mercado";
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

// ─── New Sector Dialog ────────────────────────────────────────────────────────

function NewSectorDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (sector: Sector) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [budget, setBudget] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const sector = await createSector({
        name: name.trim(),
        description: description.trim(),
        monthlyBudgetUsd: budget ? parseFloat(budget) : 0,
      });
      toast.success(`Setor "${sector.name}" criado`);
      onCreated(sector);
      setName("");
      setDescription("");
      setBudget("");
      onClose();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erro ao criar setor");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo setor</DialogTitle>
          <DialogDescription>Adicione um novo setor à estrutura da empresa.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ns-name">Nome *</Label>
            <Input
              id="ns-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ex: Jurídico, Marketing, Suporte"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ns-desc">Descrição</Label>
            <Textarea
              id="ns-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Responsabilidades do setor..."
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ns-budget">Orçamento mensal (US$)</Label>
            <Input
              id="ns-budget"
              type="number"
              min="0"
              step="0.01"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              placeholder="0.00"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? "Criando..." : "Criar setor"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── New Agent Dialog ─────────────────────────────────────────────────────────

function NewAgentDialog({
  sector,
  open,
  onClose,
  onCreated,
}: {
  sector: Sector | null;
  open: boolean;
  onClose: () => void;
  onCreated: (agent: Agent) => void;
}) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [accessLevel, setAccessLevel] = useState<AgentAccessLevel>("operational");
  const [model, setModel] = useState(aiModels[0]!);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim() || !role.trim()) return;
    setSaving(true);
    try {
      const agent = await createAgent({
        name: name.trim(),
        role: role.trim(),
        access_level: accessLevel,
        sector: sector?.id ?? null,
        model,
      });
      toast.success(`Agente "${agent.name}" criado`);
      onCreated(agent);
      setName("");
      setRole("");
      setAccessLevel("operational");
      onClose();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erro ao criar agente");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo agente{sector ? ` — ${sector.name}` : ""}</DialogTitle>
          <DialogDescription>Crie um novo agente para este setor.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="na-name">Nome *</Label>
              <Input
                id="na-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="ex: AI Vendas, Agente Fiscal"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="na-role">Papel *</Label>
              <Input
                id="na-role"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="ex: Analista Comercial"
              />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Nível de acesso</Label>
              <Select value={accessLevel} onValueChange={(v) => setAccessLevel(v as AgentAccessLevel)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="operational">Operacional</SelectItem>
                  <SelectItem value="sector_orchestrator">Orquestrador de Setor</SelectItem>
                  <SelectItem value="general_orchestrator">Orquestrador Geral</SelectItem>
                  <SelectItem value="ceo">CEO</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Modelo de IA</Label>
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {aiModels.map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving || !name.trim() || !role.trim()}>
            {saving ? "Criando..." : "Criar agente"}
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

// ─── Delete Agent Confirm Dialog ──────────────────────────────────────────────

function DeleteAgentDialog({
  agent,
  open,
  onClose,
  onDeleted,
}: {
  agent: Agent | null;
  open: boolean;
  onClose: () => void;
  onDeleted: (id: number) => void;
}) {
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!agent) return;
    setDeleting(true);
    try {
      await deleteAgent(agent.id);
      toast.success(`Agente "${agent.name}" removido`);
      onDeleted(agent.id);
      onClose();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erro ao remover agente");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Excluir agente</DialogTitle>
          <DialogDescription>
            Tem certeza que deseja excluir <strong>{agent?.name}</strong>? Esta ação não pode ser desfeita.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
            {deleting ? "Excluindo..." : "Excluir"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Delete Sector Confirm Dialog ─────────────────────────────────────────────

function DeleteSectorDialog({
  sector,
  open,
  onClose,
  onDeleted,
}: {
  sector: Sector | null;
  open: boolean;
  onClose: () => void;
  onDeleted: (id: number) => void;
}) {
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!sector) return;
    setDeleting(true);
    try {
      await deleteSector(sector.id);
      toast.success(`Setor "${sector.name}" removido`);
      onDeleted(sector.id);
      onClose();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erro ao remover setor");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Excluir setor</DialogTitle>
          <DialogDescription>
            Tem certeza que deseja excluir <strong>{sector?.name}</strong> e todos os seus agentes? Esta ação não pode ser desfeita.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
            {deleting ? "Excluindo..." : "Excluir setor"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Sub-tab button ───────────────────────────────────────────────────────────

function SubTabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-secondary hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

// ─── Visão Geral content ──────────────────────────────────────────────────────

type ModuleKey = "crm" | "erp" | "controladoria" | "datalake";

const MODULE_CARDS: { key: ModuleKey; label: string; desc: string; icon: React.ElementType; color: string; bg: string; border: string }[] = [
  { key: "crm", label: "CRM & Comercial", desc: "Pipeline, leads e atividades", icon: Handshake, color: "text-indigo-400", bg: "bg-indigo-500/10 hover:bg-indigo-500/20", border: "border-indigo-500/20 hover:border-indigo-400/40" },
  { key: "erp", label: "ERP", desc: "Compras, estoque, financeiro, RH", icon: Layers, color: "text-emerald-400", bg: "bg-emerald-500/10 hover:bg-emerald-500/20", border: "border-emerald-500/20 hover:border-emerald-400/40" },
  { key: "controladoria", label: "Controladoria", desc: "Budget, desvios e auditoria", icon: ShieldCheck, color: "text-amber-400", bg: "bg-amber-500/10 hover:bg-amber-500/20", border: "border-amber-500/20 hover:border-amber-400/40" },
  { key: "datalake", label: "Data Lake", desc: "Catálogo, Obsidian, Databricks", icon: Landmark, color: "text-violet-400", bg: "bg-violet-500/10 hover:bg-violet-500/20", border: "border-violet-500/20 hover:border-violet-400/40" },
];

function VisaoGeral({ onNewTask, onSectorClick, onModuleClick }: { onNewTask: (sector?: string) => void; onSectorClick: (sector: Sector) => void; onModuleClick: (m: ModuleKey) => void }) {
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

  // CRUD dialogs
  const [newSectorOpen, setNewSectorOpen] = useState(false);
  const [newAgentSector, setNewAgentSector] = useState<Sector | null>(null);
  const [newAgentOpen, setNewAgentOpen] = useState(false);
  const [deleteAgentTarget, setDeleteAgentTarget] = useState<Agent | null>(null);
  const [deleteAgentOpen, setDeleteAgentOpen] = useState(false);
  const [deleteSectorTarget, setDeleteSectorTarget] = useState<Sector | null>(null);
  const [deleteSectorOpen, setDeleteSectorOpen] = useState(false);

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

  const handleAgentDeleted = (id: number) => {
    setAgents((prev) => prev.filter((a) => a.id !== id));
  };

  const handleSectorDeleted = (id: number) => {
    setSectors((prev) => prev.filter((s) => s.id !== id));
    setAgents((prev) => prev.filter((a) => a.sector !== id));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-success">
          <span className="size-2 rounded-full bg-success animate-pulse" />
          Tempo real conectado
        </div>
        <Button size="sm" onClick={() => setNewSectorOpen(true)}>
          <Plus className="size-4" />
          Novo setor
        </Button>
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
      <div className="flex flex-col items-center mx-auto w-full">
        <button
          type="button"
          onClick={() => setOpenCompany(true)}
          className="panel w-full max-w-2xl p-5 text-left transition-colors hover:border-primary"
        >
          <div className="flex items-center gap-4">
            <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-secondary text-muted-foreground">
              <Building2 className="size-6" />
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
              className="panel glow-ring w-full max-w-2xl p-5 text-left"
            >
              <div className="flex items-center gap-4">
                <span className="grid size-12 shrink-0 place-items-center rounded-xl gradient-primary text-primary-foreground">
                  <Brain className="size-6" />
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
        <div className="mx-auto grid w-full max-w-5xl gap-4 md:grid-cols-2 xl:grid-cols-3">
          {sectors.map((sector) => {
            const Icon = sectorIcons[inferIcon(sector.name)];
            const sectorAgents = agentsBySector[sector.id] ?? [];
            const hasRag = sector.knowledge_source !== null;

            return (
              <div key={sector.id} className="panel flex h-72 flex-col">
                {/* Header */}
                <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border p-4">
                  <button
                    type="button"
                    onClick={() => onSectorClick(sector)}
                    className="flex items-center gap-2 font-semibold hover:text-primary transition-colors"
                  >
                    <Icon className="size-5 text-primary" />
                    {sector.name}
                  </button>
                  <div className="flex items-center gap-1.5">
                    {/* RAG badge + add-agent button */}
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
                    <button
                      type="button"
                      onClick={() => { setNewAgentSector(sector); setNewAgentOpen(true); }}
                      className="rounded p-0.5 text-muted-foreground hover:text-primary transition-colors"
                      title="Adicionar agente"
                    >
                      <Plus className="size-4" />
                    </button>
                    {/* Delete sector */}
                    <button
                      type="button"
                      onClick={() => { setDeleteSectorTarget(sector); setDeleteSectorOpen(true); }}
                      className="rounded p-0.5 text-muted-foreground hover:text-destructive transition-colors"
                      title="Excluir setor"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </div>

                {/* Agent list — scrollable */}
                <div className="flex-1 overflow-y-auto space-y-2 p-4">
                  {sectorAgents.length === 0 ? (
                    <p className="py-4 text-center text-sm text-muted-foreground">
                      Nenhum agente ainda.
                    </p>
                  ) : (
                    sectorAgents.map((agent) => (
                      <div
                        key={agent.id}
                        className="flex w-full items-center justify-between gap-2 rounded-md border border-border bg-elevated px-3 py-2 transition-colors hover:border-primary"
                      >
                        <button
                          type="button"
                          onClick={() => { setOpenAgent(agent); setAgentEditOpen(true); }}
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        >
                          <StatusDot status={agent.work_status as import("@/lib/pgba-data").AgentStatus} />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{agent.name}</p>
                            <p className="truncate text-xs text-muted-foreground">{agent.role}</p>
                          </div>
                        </button>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => { setOpenAgent(agent); setAgentEditOpen(true); }}
                            className="rounded p-1 text-muted-foreground hover:text-foreground transition-colors"
                            title="Editar agente"
                          >
                            <Pencil className="size-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => { setDeleteAgentTarget(agent); setDeleteAgentOpen(true); }}
                            className="rounded p-1 text-muted-foreground hover:text-destructive transition-colors"
                            title="Excluir agente"
                          >
                            <Trash2 className="size-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onNewTask(sector.name)}
                            className="rounded p-1 text-muted-foreground hover:text-primary transition-colors"
                            title="Criar tarefa para este agente"
                          >
                            <MessageSquare className="size-4" />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
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

      {/* Módulos de negócio */}
      <div>
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Módulos</p>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {MODULE_CARDS.map(({ key, label, desc, icon: Icon, color, bg, border }) => (
            <button
              key={key}
              type="button"
              onClick={() => onModuleClick(key)}
              className={`panel flex items-center gap-3 p-4 text-left transition-colors ${bg} ${border}`}
            >
              <span className={`grid size-9 shrink-0 place-items-center rounded-lg ${bg} ${color}`}>
                <Icon className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="font-medium text-sm leading-tight">{label}</p>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">{desc}</p>
              </div>
              <ChevronRight className="ml-auto size-4 shrink-0 text-muted-foreground" />
            </button>
          ))}
        </div>
      </div>

      {/* Dialogs */}
      <SectorKnowledgeDialog
        sector={openSector}
        open={sectorKnowledgeOpen}
        onClose={() => setSectorKnowledgeOpen(false)}
      />
      <AgentEditDialog
        agent={openAgent}
        open={agentEditOpen}
        onClose={() => setAgentEditOpen(false)}
        onUpdated={handleAgentUpdated}
      />
      <NewSectorDialog
        open={newSectorOpen}
        onClose={() => setNewSectorOpen(false)}
        onCreated={(s) => setSectors((prev) => [...prev, s])}
      />
      <NewAgentDialog
        sector={newAgentSector}
        open={newAgentOpen}
        onClose={() => setNewAgentOpen(false)}
        onCreated={(a) => setAgents((prev) => [...prev, a])}
      />
      <DeleteAgentDialog
        agent={deleteAgentTarget}
        open={deleteAgentOpen}
        onClose={() => setDeleteAgentOpen(false)}
        onDeleted={handleAgentDeleted}
      />
      <DeleteSectorDialog
        sector={deleteSectorTarget}
        open={deleteSectorOpen}
        onClose={() => setDeleteSectorOpen(false)}
        onDeleted={handleSectorDeleted}
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

// ─── Main: EmpresaView (exported as Overview for backwards compat) ────────────

export function Overview({ onNewTask, onOpenGerar }: { onNewTask: (sector?: string) => void; onOpenGerar?: (projectId?: number) => void }) {
  const [subTab, setSubTab] = useState<"overview" | "projects" | "office">("overview");
  const [newProject, setNewProject] = useState(false);
  const [importProject, setImportProject] = useState(false);
  const [selectedSector, setSelectedSector] = useState<Sector | null>(null);
  const [selectedModule, setSelectedModule] = useState<ModuleKey | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);

  return (
    <div className={subTab === "office" ? "-mx-4 md:-mx-6 -mt-4 md:-mt-6 flex flex-col" : ""}>
      {/* Sub-tab nav — oculta no detalhe de setor ou módulo */}
      {!selectedSector && !selectedModule && (
        <div className={`flex items-center gap-1 border-b border-border overflow-x-auto ${subTab === "office" ? "px-4 py-2 bg-background" : "pb-4 mb-2"}`}>
          <SubTabBtn active={subTab === "overview"} onClick={() => setSubTab("overview")}>
            <Building2 className="size-4" />
            Visão Geral
          </SubTabBtn>
          <SubTabBtn active={subTab === "projects"} onClick={() => setSubTab("projects")}>
            <FolderTree className="size-4" />
            Projetos
          </SubTabBtn>
          <SubTabBtn active={subTab === "office"} onClick={() => setSubTab("office")}>
            <Cuboid className="size-4" />
            Escritório 3D
          </SubTabBtn>
          <div className="ml-auto shrink-0">
            <button
              onClick={() => setSettingsOpen(true)}
              title="Configurações"
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
            >
              <Settings className="size-4" />
            </button>
          </div>
        </div>
      )}

      {/* Detalhe de setor */}
      {selectedSector && (
        <SectorDetailPage sector={selectedSector} onBack={() => setSelectedSector(null)} />
      )}

      {/* Módulos de negócio — página completa */}
      {!selectedSector && selectedModule === "crm" && (
        <CRMView onBack={() => setSelectedModule(null)} />
      )}
      {!selectedSector && selectedModule === "erp" && (
        <ERPView onBack={() => setSelectedModule(null)} />
      )}
      {!selectedSector && selectedModule === "controladoria" && (
        <ControladoriaView onBack={() => setSelectedModule(null)} />
      )}
      {!selectedSector && selectedModule === "datalake" && (
        <DataLakeView onBack={() => setSelectedModule(null)} />
      )}

      {!selectedSector && !selectedModule && subTab === "overview" && (
        <VisaoGeral onNewTask={onNewTask} onSectorClick={setSelectedSector} onModuleClick={setSelectedModule} />
      )}

      {subTab === "projects" && (
        <div className="space-y-4">
          <div className="rounded-md border border-border bg-secondary/30 px-4 py-3 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Desenvolvimento</span> é o setor responsável por trabalhar nos projetos novos e existentes da plataforma.
          </div>
          <Projects
            onNewProject={() => setNewProject(true)}
            onImportProject={() => setImportProject(true)}
            onNewTask={onNewTask}
            onOpenGerar={onOpenGerar}
          />
        </div>
      )}

      {subTab === "office" && (
        <div style={{ height: "calc(100vh - 152px)" }}>
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center">
                <p className="text-sm text-muted-foreground">Carregando escritório 3D...</p>
              </div>
            }
          >
            <CompanyOffice3D />
          </Suspense>
        </div>
      )}

      <NewProjectDialog open={newProject} onOpenChange={setNewProject} />
      <ImportProjectDialog open={importProject} onOpenChange={setImportProject} />

      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onUpdate={(partial) => setSettings((prev) => ({ ...prev, ...partial }))}
        onReset={() => setSettings(DEFAULT_SETTINGS)}
      />
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import {
  Activity,
  Brain,
  Building2,
  ChevronRight,
  Code2,
  Crown,
  Database,
  FileText,
  Handshake,
  Landmark,
  Layers,
  MessageCircle,
  MessageSquare,
  PauseCircle,
  Pencil,
  Plus,
  Receipt,
  RefreshCw,
  Save,
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
import { Metric } from "@/components/empresa/shared";
import { SectorDetailPage } from "@/components/empresa/mercado";
import { CRMKanban } from "@/components/empresa/crm-kanban";
import { ERPView } from "@/components/empresa/erp";
import { ControladoriaView } from "@/components/empresa/controladoria";
import { DataLakeView } from "@/components/empresa/datalake";
import { JuridicoView } from "@/components/empresa/juridico";
import { DesenvolvimentoView } from "@/components/empresa/desenvolvimento";
import { HelpdeskView } from "@/components/empresa/helpdesk";
import { PROVIDER_LABEL, formatUsd } from "@/components/builder/office3d/providers";
import { useRealtime } from "@/lib/useRealtime";
import { aiModels } from "@/lib/pgba-data";
import {
  askAsAgent,
  createAgent,
  createKnowledgeSource,
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
  updateSector,
  type AgentAskResult,
  type Sector,
  type Agent,
  type AgentMetricsOverview,
  type SectorMetric,
  type KnowledgeDocument,
  type AgentAccessLevel,
  ApiError,
  sectorSourceIds,
} from "@/lib/api";

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

const formatCost = formatUsd;

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
  onUpdated,
}: {
  sector: Sector | null;
  open: boolean;
  onClose: () => void;
  onUpdated?: (updated: Sector) => void;
}) {
  const [docs, setDocs] = useState<KnowledgeDocument[]>([]);
  const [uploading, setUploading] = useState(false);
  const [creatingKb, setCreatingKb] = useState(false);
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

  const handleCreateKb = async () => {
    if (!sector) return;
    setCreatingKb(true);
    try {
      const ks = await createKnowledgeSource({ name: `Base de ${sector.name}`, source_type: "manual" });
      const updated = await updateSector(sector.id, { knowledge_source: ks.id });
      toast.success(`Base de conhecimento criada e vinculada ao setor ${sector.name}`);
      onUpdated?.(updated);
      listDocuments(ks.id).then(setDocs).catch(console.error);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erro ao criar base de conhecimento");
    } finally {
      setCreatingKb(false);
    }
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
            {(sector?.extra_knowledge_source_names ?? []).map((n) => (
              <Badge key={n} variant="secondary" title="Fonte adicional (Data Lake → Conectores → Quem acessa)">+ {n}</Badge>
            ))}
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
                <div className="flex flex-col items-center gap-3 p-4 text-center">
                  <p className="text-sm text-muted-foreground">
                    Este setor ainda não tem base de conhecimento (RAG).
                  </p>
                  <Button size="sm" onClick={handleCreateKb} disabled={creatingKb}>
                    <Plus className="mr-1.5 size-3.5" />
                    {creatingKb ? "Criando..." : "Criar base de conhecimento"}
                  </Button>
                </div>
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
      setModel(agent.default_model || aiModels[0]!);
      setSkillsMd(agent.instructions ?? "");
    }
  }, [agent]);

  const handleSave = async () => {
    if (!agent) return;
    setSaving(true);
    try {
      const updated = await updateAgent(agent.id, { role, skillsMd, defaultModel: model });
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

// ─── Visão Geral content ──────────────────────────────────────────────────────

type ModuleKey = "crm" | "erp" | "controladoria" | "datalake" | "juridico" | "desenvolvimento" | "helpdesk";
type ModuleState = { key: ModuleKey; erpTab?: string };

// Map a sector name to its business module (returns null for sectors that use SectorDetailPage)
function getSectorModule(name: string): ModuleState | null {
  const n = name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (n.includes("comercial") || n.includes("vendas") || n.includes("crm")) return { key: "crm" };
  if (n.includes("compras") || n.includes("procurement") || n.includes("suprimentos")) return { key: "erp", erpTab: "compras" };
  if (n.includes("financeiro") || n.includes("financ")) return { key: "erp", erpTab: "financeiro" };
  if (n.includes("contabilidade")) return { key: "erp", erpTab: "contabilidade" };
  if (n.includes("fiscal") || n.includes("tributar")) return { key: "erp", erpTab: "fiscal" };
  if (n.includes("rh") || n.includes("recursos humanos") || n.includes("people") || n.includes("pessoal")) return { key: "erp", erpTab: "rh" };
  if (n.includes("estoque") || n.includes("operac") || n.includes("logistic")) return { key: "erp", erpTab: "estoque" };
  if (n.includes("controladoria") || n.includes("auditoria") || n.includes("compliance")) return { key: "controladoria" };
  if (n.includes("juridico") || n.includes("legal") || n.includes("juridica")) return { key: "juridico" };
  if (n.includes("desenvolvimento") || n.includes("engenharia") || n.includes("software")) return { key: "desenvolvimento" };
  if (n.includes("ti") || n.includes("tecnologia") || n.includes("helpdesk") || n.includes("suporte")) return { key: "helpdesk" };
  if (n.includes("dados") || n.includes("data")) return { key: "datalake" };
  return null;
}

const MODULE_LABELS: Record<ModuleKey, string> = {
  crm: "CRM",
  erp: "ERP",
  controladoria: "Controladoria",
  datalake: "Data Lake",
  juridico: "Jurídico",
  desenvolvimento: "Dev",
  helpdesk: "Helpdesk",
};

// Mesma família de cores das salas do Escritório 3D (cor fixa por índice, nunca aleatória)
const SECTOR_ACCENTS = ["#10b981", "#6366f1", "#f59e0b", "#ec4899", "#0ea5e9", "#8b5cf6", "#ef4444", "#14b8a6"];

function initials(name: string): string {
  const parts = name.replace(/[^\p{L}\p{N} ]/gu, " ").trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

function AgentAvatar({ agent, size = "md" }: { agent: Agent; size?: "md" | "lg" }) {
  const color = SECTOR_ACCENTS[agent.id % SECTOR_ACCENTS.length];
  const dim = size === "lg" ? "size-10 text-sm" : "size-8 text-[11px]";
  const status = agent.work_status;
  return (
    <span className="relative inline-flex shrink-0">
      <span
        className={`${dim} inline-flex items-center justify-center rounded-full font-semibold`}
        style={{ backgroundColor: `${color}24`, color }}
      >
        {initials(agent.name)}
      </span>
      <span
        title={status === "working" ? "Trabalhando" : status === "paused" ? "Pausado" : "Ocioso"}
        className={`absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-surface ${
          status === "working" ? "animate-pulse bg-success" : status === "paused" ? "bg-warning" : "bg-muted-foreground/50"
        }`}
      />
    </span>
  );
}

function Chip({
  children,
  tone = "muted",
  title,
  onClick,
}: {
  children: React.ReactNode;
  tone?: "muted" | "ok";
  title?: string;
  onClick?: () => void;
}) {
  const cls = `inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
    tone === "ok"
      ? "border-success/30 bg-success/10 text-success"
      : "border-border bg-secondary text-muted-foreground"
  }`;
  return onClick ? (
    <button type="button" title={title} onClick={onClick} className={`${cls} transition-colors hover:border-ring`}>
      {children}
    </button>
  ) : (
    <span title={title} className={cls}>
      {children}
    </span>
  );
}

function IconBtn({
  title,
  onClick,
  danger,
  children,
}: {
  title: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary ${
        danger ? "hover:text-destructive" : "hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

const MODULE_CARDS: { state: ModuleState; label: string; desc: string; icon: React.ElementType; color: string; bg: string; border: string }[] = [
  { state: { key: "crm" }, label: "CRM & Comercial", desc: "Pipeline, leads e atividades", icon: Handshake, color: "text-indigo-600 dark:text-indigo-400", bg: "bg-indigo-500/10 hover:bg-indigo-500/20", border: "border-indigo-500/20 hover:border-indigo-400/40" },
  { state: { key: "erp" }, label: "ERP", desc: "Contratos, parceiros, estoque, financeiro e fiscal", icon: Layers, color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-500/10 hover:bg-emerald-500/20", border: "border-emerald-500/20 hover:border-emerald-400/40" },
  { state: { key: "controladoria" }, label: "Controladoria", desc: "Budget, desvios e auditoria", icon: ShieldCheck, color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-500/10 hover:bg-amber-500/20", border: "border-amber-500/20 hover:border-amber-400/40" },
  { state: { key: "datalake" }, label: "Data Lake", desc: "Catálogo, Obsidian, Databricks", icon: Landmark, color: "text-violet-600 dark:text-violet-400", bg: "bg-violet-500/10 hover:bg-violet-500/20", border: "border-violet-500/20 hover:border-violet-400/40" },
  { state: { key: "juridico" }, label: "Jurídico", desc: "Processos, contratos e prazos", icon: FileText, color: "text-muted-foreground", bg: "bg-secondary hover:bg-secondary", border: "border-border hover:border-border" },
  { state: { key: "desenvolvimento" }, label: "Desenvolvimento", desc: "Sprint, PRs e CI/CD", icon: Code2, color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-500/10 hover:bg-blue-500/20", border: "border-blue-500/20 hover:border-blue-400/40" },
  { state: { key: "helpdesk" }, label: "TI · Helpdesk", desc: "Chamados, SLA e inventário", icon: Brain, color: "text-teal-600 dark:text-teal-400", bg: "bg-teal-500/10 hover:bg-teal-500/20", border: "border-teal-500/20 hover:border-teal-400/40" },
];

// ─── Ask Agent Dialog ─────────────────────────────────────────────────────────

function AskAgentDialog({ agent, open, onClose }: { agent: Agent | null; open: boolean; onClose: () => void }) {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AgentAskResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleOpenChange(v: boolean) {
    if (!v) { onClose(); setQuestion(""); setResult(null); setError(null); }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!agent || !question.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await askAsAgent(agent.id, question.trim());
      setResult(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao perguntar ao agente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageCircle className="size-4 text-primary" />
            {agent?.name}
          </DialogTitle>
          <DialogDescription>{agent?.role}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3">
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            rows={3}
            required
            autoFocus
            placeholder="O que você quer perguntar a este agente?"
            className="w-full resize-none rounded-md border border-border bg-elevated px-3 py-2 text-sm focus:border-primary focus:outline-none"
          />
          <Button type="submit" disabled={loading || !question.trim()} className="w-full gap-2">
            {loading ? <RefreshCw className="size-4 animate-spin" /> : <MessageCircle className="size-4" />}
            {loading ? "Perguntando..." : "Perguntar"}
          </Button>
        </form>

        {error && <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}

        {result?.status === "pending_approval" && (
          <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
            Esta ação aguarda aprovação humana — veja a aba "Aprovações". {result.answer}
          </div>
        )}

        {result?.status === "ok" && (
          <div className="rounded-md border border-border bg-elevated px-3 py-3 text-sm space-y-2">
            <p className="leading-relaxed">{result.answer}</p>
            {result.function_called && (
              <p className="text-[10px] text-muted-foreground">função: {result.function_called}</p>
            )}
            {result.sources && result.sources.length > 0 && (
              <div className="flex flex-wrap gap-1.5 border-t border-border pt-2">
                {result.sources.map((src, i) => (
                  <span key={i} className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground" title={src.source}>
                    <span className="opacity-60">▸</span>
                    {src.document.length > 35 ? src.document.slice(0, 35) + "…" : src.document}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {result && ["function_error", "llm_error", "rejected"].includes(result.status) && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{result.answer}</div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Visão Geral ──────────────────────────────────────────────────────────────

function VisaoGeral({ onNewTask, onSectorClick, onModuleClick }: { onNewTask: (sector?: string) => void; onSectorClick: (sector: Sector) => void; onModuleClick: (m: ModuleState) => void }) {
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [metrics, setMetrics] = useState<AgentMetricsOverview | null>(null);
  const [sectorMetrics, setSectorMetrics] = useState<SectorMetric[]>([]);
  const [openSector, setOpenSector] = useState<Sector | null>(null);
  const [sectorKnowledgeOpen, setSectorKnowledgeOpen] = useState(false);
  const [openAgent, setOpenAgent] = useState<Agent | null>(null);
  const [agentEditOpen, setAgentEditOpen] = useState(false);
  const [askAgentTarget, setAskAgentTarget] = useState<Agent | null>(null);
  const [askAgentOpen, setAskAgentOpen] = useState(false);
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

  const { connected } = useRealtime();
  const leaders = [...orchestrators].sort(
    (a, b) => Number(b.access_level === "ceo") - Number(a.access_level === "ceo"),
  );
  const metricBySector = new Map(sectorMetrics.map((m) => [m.sector_id, m]));
  const workingNow = agents.filter((a) => a.work_status === "working").length;
  const pausedNow = agents.filter((a) => a.work_status === "paused").length;
  const monthCost = sectorMetrics.reduce((sum, m) => sum + (m.month_cost_usd ?? 0), 0);

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold tracking-tight">Organograma</h2>
          <p className="mt-0.5 flex items-center gap-2 text-sm text-muted-foreground">
            <span
              className={`size-2 rounded-full ${connected ? "animate-pulse bg-success" : "bg-warning"}`}
              title={connected ? "Tempo real conectado (WebSocket)" : "Reconectando — atualiza ao recarregar"}
            />
            {sectors.length} setores · {agents.length} agentes · {connected ? "ao vivo" : "reconectando…"}
          </p>
        </div>
        <Button size="sm" onClick={() => setNewSectorOpen(true)} className="rounded-full">
          <Plus className="size-4" />
          Novo setor
        </Button>
      </div>

      {/* KPIs */}
      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[...Array(4)].map((_, i) => <div key={i} className="panel h-[88px] animate-pulse" />)}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Agentes" value={String(metrics?.total_agents ?? agents.length)} icon={<Users className="size-4" />} />
          <Metric label="Trabalhando agora" value={String(workingNow)} icon={<Activity className="size-4" />} tone={workingNow ? "success" : "default"} />
          <Metric label="Pausados" value={String(pausedNow)} icon={<PauseCircle className="size-4" />} tone={pausedNow ? "warning" : "default"} />
          <Metric
            label="Custo do mês"
            value={formatCost(monthCost)}
            hint={`total ${formatCost(metrics?.total_cost_usd ?? 0)}`}
            icon={<Wallet className="size-4" />}
          />
        </div>
      )}

      {/* Árvore: Empresa → Liderança → Setores */}
      <section className="rounded-2xl border border-border bg-surface/60 p-4 sm:p-6">
        <div className="flex flex-col items-center">
          <button
            type="button"
            onClick={() => setOpenCompany(true)}
            className="group flex items-center gap-3 rounded-full border border-border bg-elevated py-2 pl-2 pr-5 shadow-sm transition hover:border-foreground/30"
          >
            <span className="grid size-9 place-items-center rounded-full bg-primary text-primary-foreground">
              <Building2 className="size-4" />
            </span>
            <span className="text-left">
              <span className="block text-sm font-semibold leading-tight">Empresa</span>
              <span className="block text-[11px] text-muted-foreground">Visão estratégica · cérebro principal</span>
            </span>
          </button>

          {leaders.length > 0 && (
            <>
              <div className="h-6 w-px bg-border" />
              <div className="flex flex-wrap justify-center gap-3">
                {leaders.map((leader) => (
                  <button
                    key={leader.id}
                    type="button"
                    onClick={() => { setOpenAgent(leader); setAgentEditOpen(true); }}
                    className="flex min-w-[220px] items-center gap-3 rounded-xl border border-border bg-elevated px-3 py-2.5 text-left shadow-sm transition hover:border-foreground/30"
                  >
                    <AgentAvatar agent={leader} size="lg" />
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 text-sm font-semibold">
                        <Crown className="size-3.5 text-amber-500" />
                        <span className="truncate">{leader.name}</span>
                      </span>
                      <span className="block text-[11px] text-muted-foreground">
                        {leader.access_level === "ceo" ? "CEO" : "Orquestrador-Geral"} · media qualquer setor
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}

          <div className="h-6 w-px bg-border" />
          <span className="rounded-full border border-border bg-background px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {sectors.length} {sectors.length === 1 ? "setor" : "setores"}
          </span>
          <div className="h-4 w-px bg-border" />
        </div>

        {loading ? (
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(290px,1fr))]">
            {[...Array(3)].map((_, i) => <div key={i} className="panel h-64 animate-pulse" />)}
          </div>
        ) : sectors.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Nenhum setor ainda — crie o primeiro.</p>
        ) : (
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(290px,1fr))]">
            {sectors.map((sector, index) => {
              const Icon = sectorIcons[inferIcon(sector.name)];
              const accent = SECTOR_ACCENTS[index % SECTOR_ACCENTS.length]!;
              const sectorAgents = [...(agentsBySector[sector.id] ?? [])].sort(
                (a, b) => Number(b.access_level === "sector_orchestrator") - Number(a.access_level === "sector_orchestrator"),
              );
              const hasRag = sectorSourceIds(sector).length > 0;
              const extras = sector.extra_knowledge_source_names ?? [];
              const sectorModule = getSectorModule(sector.name);
              const m = metricBySector.get(sector.id);
              const working = sectorAgents.filter((a) => a.work_status === "working").length;

              return (
                <article
                  key={sector.id}
                  className="group/sector relative flex flex-col overflow-hidden rounded-xl border border-border bg-elevated shadow-sm transition hover:shadow-md"
                >
                  <span className="absolute inset-x-0 top-0 h-1" style={{ background: accent }} />

                  {/* Cabeçalho do setor */}
                  <header className="flex items-center gap-3 px-4 pb-3 pt-4">
                    <span
                      className="grid size-9 shrink-0 place-items-center rounded-lg"
                      style={{ background: `${accent}1f`, color: accent }}
                    >
                      <Icon className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() => (sectorModule ? onModuleClick(sectorModule) : onSectorClick(sector))}
                        className="flex max-w-full items-center gap-1 text-left font-semibold transition-colors hover:text-foreground/70"
                        title={sectorModule ? "Abrir o módulo do setor" : "Abrir o setor"}
                      >
                        <span className="truncate">{sector.name}</span>
                        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                      </button>
                    </div>
                    <div className="flex shrink-0 gap-0.5 opacity-60 transition group-hover/sector:opacity-100 focus-within:opacity-100">
                      <IconBtn title="Adicionar agente" onClick={() => { setNewAgentSector(sector); setNewAgentOpen(true); }}>
                        <Plus className="size-4" />
                      </IconBtn>
                      <IconBtn title="Excluir setor" danger onClick={() => { setDeleteSectorTarget(sector); setDeleteSectorOpen(true); }}>
                        <Trash2 className="size-4" />
                      </IconBtn>
                    </div>
                  </header>
                  <div className="-mt-1 flex flex-wrap gap-1 px-4 pb-3">
                    {sectorModule && (
                      <Chip>{sectorModule.erpTab ? `ERP · ${sectorModule.erpTab}` : MODULE_LABELS[sectorModule.key]}</Chip>
                    )}
                    <Chip title="IA usada pelos agentes do setor">
                      ✦ {sector.default_provider ? PROVIDER_LABEL[sector.default_provider] ?? sector.default_provider : "IA padrão"}
                    </Chip>
                    <button
                      type="button"
                      onClick={() => { setOpenSector(sector); setSectorKnowledgeOpen(true); }}
                      title="Cérebro do setor — ver / adicionar documentos"
                    >
                      <Chip tone={hasRag ? "ok" : "muted"}>
                        <Database className="size-3" />
                        {hasRag
                          ? `${sector.knowledge_source_name ?? extras[0] ?? "cérebro"}${
                              extras.length > (sector.knowledge_source_name ? 0 : 1)
                                ? ` +${extras.length - (sector.knowledge_source_name ? 0 : 1)}`
                                : ""
                            }`
                          : "sem cérebro"}
                      </Chip>
                    </button>
                  </div>

                  {/* Equipe */}
                  <ul className="max-h-60 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
                    {sectorAgents.length === 0 && (
                      <li className="px-2 py-6 text-center text-xs text-muted-foreground">Nenhum agente ainda.</li>
                    )}
                    {sectorAgents.map((agent) => (
                      <li key={agent.id} className="group/agent flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition hover:bg-secondary/70">
                        <button
                          type="button"
                          onClick={() => { setOpenAgent(agent); setAgentEditOpen(true); }}
                          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                        >
                          <AgentAvatar agent={agent} />
                          <span className="min-w-0">
                            <span className="flex items-center gap-1 text-[13px] font-medium">
                              {agent.access_level === "sector_orchestrator" && <Crown className="size-3 shrink-0 text-amber-500" />}
                              <span className="truncate">{agent.name}</span>
                            </span>
                            <span className="block truncate text-[11px] text-muted-foreground">
                              {agent.work_status === "working" && agent.current_task
                                ? <span className="text-success">{agent.current_task}</span>
                                : agent.role}
                            </span>
                          </span>
                        </button>
                        <span className="flex shrink-0 gap-0.5 opacity-0 transition group-hover/agent:opacity-100 focus-within:opacity-100">
                          <IconBtn title="Perguntar a este agente" onClick={() => { setAskAgentTarget(agent); setAskAgentOpen(true); }}>
                            <MessageCircle className="size-3.5" />
                          </IconBtn>
                          <IconBtn title="Criar tarefa para este setor" onClick={() => onNewTask(sector.name)}>
                            <MessageSquare className="size-3.5" />
                          </IconBtn>
                          <IconBtn title="Editar agente" onClick={() => { setOpenAgent(agent); setAgentEditOpen(true); }}>
                            <Pencil className="size-3.5" />
                          </IconBtn>
                          <IconBtn title="Excluir agente" danger onClick={() => { setDeleteAgentTarget(agent); setDeleteAgentOpen(true); }}>
                            <Trash2 className="size-3.5" />
                          </IconBtn>
                        </span>
                      </li>
                    ))}
                  </ul>

                  {/* Rodapé: atividade + custo do mês */}
                  <footer className="border-t border-border px-4 py-2.5">
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>
                        {sectorAgents.length} {sectorAgents.length === 1 ? "agente" : "agentes"}
                        {working > 0 && <span className="text-success"> · {working} trabalhando</span>}
                      </span>
                      {m && (
                        <span className="tabular-nums text-foreground" title={`${formatTokens(m.tokens)} tokens desde o início`}>
                          {formatCost(m.month_cost_usd ?? 0)}
                          {m.budget_usd > 0 && <span className="text-muted-foreground"> / {formatCost(m.budget_usd)}</span>}
                        </span>
                      )}
                    </div>
                    {m && m.usage_percent !== null && (
                      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-secondary" title={`${m.usage_percent.toFixed(0)}% do orçamento do mês`}>
                        <div
                          className={`h-full rounded-full ${m.status === "over" ? "bg-destructive" : m.status === "warn" ? "bg-warning" : "bg-success"}`}
                          style={{ width: `${Math.min(m.usage_percent, 100)}%` }}
                        />
                      </div>
                    )}
                  </footer>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Módulos de negócio */}
      <section>
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Módulos</p>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {MODULE_CARDS.map(({ state, label, desc, icon: Icon, color }) => (
            <button
              key={state.key}
              type="button"
              onClick={() => onModuleClick(state)}
              className="group flex items-center gap-3 rounded-xl border border-border bg-elevated p-3.5 text-left shadow-sm transition hover:border-foreground/25"
            >
              <span className={`grid size-9 shrink-0 place-items-center rounded-lg bg-secondary ${color}`}>
                <Icon className="size-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium leading-tight">{label}</span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">{desc}</span>
              </span>
              <ChevronRight className="ml-auto size-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5" />
            </button>
          ))}
        </div>
      </section>

      {/* Dialogs */}
      <SectorKnowledgeDialog
        sector={openSector}
        open={sectorKnowledgeOpen}
        onClose={() => setSectorKnowledgeOpen(false)}
        onUpdated={(updated) => setSectors((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))}
      />
      <AgentEditDialog
        agent={openAgent}
        open={agentEditOpen}
        onClose={() => setAgentEditOpen(false)}
        onUpdated={handleAgentUpdated}
      />
      <AskAgentDialog
        agent={askAgentTarget}
        open={askAgentOpen}
        onClose={() => setAskAgentOpen(false)}
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

// ─── Main: Organograma + páginas de módulo ──────────────────────────────────
// Projetos e Escritório 3D saíram daqui: são áreas do header (App.tsx).

export function Overview({ onNewTask }: { onNewTask: (sector?: string) => void }) {
  const [selectedSector, setSelectedSector] = useState<Sector | null>(null);
  const [selectedModule, setSelectedModule] = useState<ModuleState | null>(null);

  return (
    <div>
      {/* Detalhe de setor */}
      {selectedSector && (
        <SectorDetailPage sector={selectedSector} onBack={() => setSelectedSector(null)} />
      )}

      {/* Módulos de negócio — página completa */}
      {!selectedSector && selectedModule?.key === "crm" && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSelectedModule(null)} className="gap-1">
              <ChevronRight className="size-4 rotate-180" />
              Voltar
            </Button>
            <span className="text-lg font-semibold">CRM &amp; Comercial</span>
          </div>
          <CRMKanban />
        </div>
      )}
      {!selectedSector && selectedModule?.key === "erp" && (
        <ERPView onBack={() => setSelectedModule(null)} defaultTab={selectedModule.erpTab} />
      )}
      {!selectedSector && selectedModule?.key === "controladoria" && (
        <ControladoriaView onBack={() => setSelectedModule(null)} />
      )}
      {!selectedSector && selectedModule?.key === "datalake" && (
        <DataLakeView onBack={() => setSelectedModule(null)} />
      )}
      {!selectedSector && selectedModule?.key === "juridico" && (
        <JuridicoView onBack={() => setSelectedModule(null)} />
      )}
      {!selectedSector && selectedModule?.key === "desenvolvimento" && (
        <DesenvolvimentoView onBack={() => setSelectedModule(null)} />
      )}
      {!selectedSector && selectedModule?.key === "helpdesk" && (
        <HelpdeskView onBack={() => setSelectedModule(null)} />
      )}

      {!selectedSector && !selectedModule && (
        <VisaoGeral onNewTask={onNewTask} onSectorClick={setSelectedSector} onModuleClick={setSelectedModule} />
      )}
    </div>
  );
}

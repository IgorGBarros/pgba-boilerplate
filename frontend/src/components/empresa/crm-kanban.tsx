import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  Plus, X, Send, User,
  Mail, Phone, DollarSign, Briefcase, MessageSquare,
  CheckCircle2, XCircle, Settings, Pencil, Trash2, Bot,
  ArrowRight, Loader2, Radio, MessageCircle, Calendar, Package2,
  ChevronRight, GripVertical, Palette, MapPin, Download, RefreshCw,
  BookOpen, RefreshCcw, FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  CRMPipeline, CRMStage, CRMLead, CRMDeal, CRMProject,
  LeadMessage, MainStage, LeadOutcome, DealOutcome, ProjectOutcome,
  CustomFieldValue, CustomFieldDefinition,
  listCRMPipelines, seedDefaultPipeline,
  createGoogleMapsJob, getScrapingJob, importScrapingJobToCRM, retryScrapingJob, ScrapingJob as ScrapingJobType,
  listLeads, createLead, updateLead, deleteLead, moveLead,
  setLeadOutcome, convertLeadToDeal,
  listDeals, createDeal, updateDeal, deleteDeal, moveDeal,
  setDealOutcome, convertDealToProject,
  listProjects, createProject, updateProject, deleteProject, moveProject,
  setProjectOutcome,
  getLeadMessages, qualifyLead,
  createStage, updateStage, deleteStage,
  listCustomFieldDefs, createCustomFieldDef, deleteCustomFieldDef, bulkUpsertCustomFieldValues,
  getLeadObsidianNote, LeadObsidianNote,
} from "@/lib/api";
import { CRMChannels } from "@/components/empresa/crm-channels";
import { toast } from "sonner";

// ─── Helpers ──────────────────────────────────────────────────────────────────

// key + label only — color comes from palette state
const TAB_META: { key: MainStage; label: string }[] = [
  { key: "lead",    label: "Leads"    },
  { key: "deal",    label: "Deals"    },
  { key: "project", label: "Projetos" },
];

const COLOR_MAP: Record<string, string> = {
  blue: "#3b82f6", indigo: "#6366f1", violet: "#8b5cf6",
  pink: "#ec4899",  rose: "#f43f5e",  red: "#ef4444",
  orange: "#f97316", amber: "#f59e0b", yellow: "#eab308",
  green: "#22c55e", emerald: "#10b981", teal: "#14b8a6", cyan: "#06b6d4", sky: "#0ea5e9",
};

// Tailwind classes for each named color — theme-aware (darker in light, lighter in dark)
const COLOR_CLASSES: Record<string, { text: string; bg: string; border: string }> = {
  blue:    { text: "text-blue-600 dark:text-blue-400",    bg: "bg-blue-500/15",    border: "border-blue-500/40"    },
  indigo:  { text: "text-indigo-600 dark:text-indigo-400",  bg: "bg-indigo-500/15",  border: "border-indigo-500/40"  },
  violet:  { text: "text-violet-600 dark:text-violet-400",  bg: "bg-violet-500/15",  border: "border-violet-500/40"  },
  pink:    { text: "text-pink-600 dark:text-pink-400",    bg: "bg-pink-500/15",    border: "border-pink-500/40"    },
  rose:    { text: "text-rose-600 dark:text-rose-400",    bg: "bg-rose-500/15",    border: "border-rose-500/40"    },
  red:     { text: "text-red-600 dark:text-red-400",      bg: "bg-red-500/15",     border: "border-red-500/40"     },
  orange:  { text: "text-orange-600 dark:text-orange-400",  bg: "bg-orange-500/15",  border: "border-orange-500/40"  },
  amber:   { text: "text-amber-700 dark:text-amber-400",   bg: "bg-amber-500/15",   border: "border-amber-500/40"   },
  yellow:  { text: "text-yellow-700 dark:text-yellow-400",  bg: "bg-yellow-500/15",  border: "border-yellow-500/40"  },
  green:   { text: "text-green-600 dark:text-green-400",   bg: "bg-green-500/15",   border: "border-green-500/40"   },
  emerald: { text: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-500/15", border: "border-emerald-500/40" },
  teal:    { text: "text-teal-600 dark:text-teal-400",    bg: "bg-teal-500/15",    border: "border-teal-500/40"    },
  cyan:    { text: "text-cyan-600 dark:text-cyan-400",    bg: "bg-cyan-500/15",    border: "border-cyan-500/40"    },
  sky:     { text: "text-sky-600 dark:text-sky-400",      bg: "bg-sky-500/15",     border: "border-sky-500/40"     },
};

const PALETTE_SWATCHES = [
  "blue", "indigo", "violet", "pink", "rose", "red",
  "orange", "amber", "yellow", "green", "emerald", "teal", "cyan", "sky",
] as const;

type KanbanPalette = { lead: string; deal: string; project: string };

const DEFAULT_PALETTE: KanbanPalette = { lead: "indigo", deal: "amber", project: "emerald" };

function loadPalette(): KanbanPalette {
  try { const s = localStorage.getItem("crm_palette"); return s ? JSON.parse(s) : DEFAULT_PALETTE; }
  catch { return DEFAULT_PALETTE; }
}

// ─── Palette Popover ──────────────────────────────────────────────────────────

function PalettePopover({ palette, onChange, onClose }: {
  palette: KanbanPalette;
  onChange: (next: KanbanPalette) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const sections: { key: keyof KanbanPalette; label: string }[] = [
    { key: "lead", label: "Leads" },
    { key: "deal", label: "Deals" },
    { key: "project", label: "Projetos" },
  ];

  return (
    <div ref={ref} className="absolute right-0 top-full mt-1.5 z-50 bg-card border border-border rounded-xl shadow-2xl p-4 w-64">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-foreground">Paleta de Cores</span>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="size-3.5" /></button>
      </div>
      <div className="space-y-3">
        {sections.map(s => (
          <div key={s.key}>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1.5">{s.label}</p>
            <div className="flex flex-wrap gap-1.5">
              {PALETTE_SWATCHES.map(sw => (
                <button
                  key={sw}
                  title={sw}
                  onClick={() => onChange({ ...palette, [s.key]: sw })}
                  className={`size-5 rounded-full transition-transform hover:scale-110 ring-offset-card ${palette[s.key] === sw ? "ring-2 ring-offset-1 ring-foreground/50 scale-110" : ""}`}
                  style={{ backgroundColor: COLOR_MAP[sw] }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      <button
        onClick={() => onChange(DEFAULT_PALETTE)}
        className="mt-3 w-full text-[10px] text-muted-foreground hover:text-foreground text-center transition-colors"
      >
        Restaurar padrão
      </button>
    </div>
  );
}

function colorDot(color: string) {
  return <span className="inline-block size-2 rounded-full shrink-0" style={{ backgroundColor: COLOR_MAP[color] ?? "#94a3b8" }} />;
}

function fmtCurrency(v: string | null | undefined, moeda = "BRL") {
  if (!v) return null;
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: moeda, minimumFractionDigits: 0 }).format(Number(v));
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function fmtDateFull(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "Hoje";
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Ontem";
  return d.toLocaleDateString("pt-BR");
}

function initials(name: string) {
  return name.split(" ").slice(0, 2).map(w => w[0]).join("").toUpperCase();
}

// ─── Custom Fields Manager ────────────────────────────────────────────────────

function CustomFieldsManager({
  entityType, entityId, values, onUpdated,
}: {
  entityType: MainStage;
  entityId: number;
  values: CustomFieldValue[];
  onUpdated: (values: CustomFieldValue[]) => void;
}) {
  const [defs, setDefs] = useState<CustomFieldDefinition[]>([]);
  const [localValues, setLocalValues] = useState<Record<number, string>>({});
  const [newFieldName, setNewFieldName] = useState("");
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingDefs, setLoadingDefs] = useState(true);

  useEffect(() => {
    setLocalValues(Object.fromEntries(values.map(v => [v.field_def, String(v.value ?? "")])));
  }, [values]);

  useEffect(() => {
    setLoadingDefs(true);
    listCustomFieldDefs(entityType)
      .then(setDefs)
      .catch(() => toast.error("Erro ao carregar campos."))
      .finally(() => setLoadingDefs(false));
  }, [entityType]);

  const handleAddDef = async () => {
    if (!newFieldName.trim()) return;
    setAdding(true);
    try {
      const key = newFieldName.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
      const def = await createCustomFieldDef({
        entity_type: entityType,
        name: newFieldName.trim(),
        key,
        field_type: "text",
        options: [],
        required: false,
        position: defs.length,
        is_active: true,
      });
      setDefs(prev => [...prev, def]);
      setNewFieldName("");
      toast.success("Campo criado.");
    } catch { toast.error("Erro ao criar campo."); }
    finally { setAdding(false); }
  };

  const handleDeleteDef = async (defId: number) => {
    try {
      await deleteCustomFieldDef(defId);
      setDefs(prev => prev.filter(d => d.id !== defId));
      setLocalValues(prev => { const n = { ...prev }; delete n[defId]; return n; });
      toast.success("Campo removido.");
    } catch { toast.error("Erro ao remover campo."); }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const entries = defs
        .filter(d => (localValues[d.id] ?? "") !== "")
        .map(d => ({ field_def: d.id, entity_type: entityType, entity_id: entityId, value: localValues[d.id] }));
      const updated = await bulkUpsertCustomFieldValues(entries);
      onUpdated(updated);
      toast.success("Valores salvos.");
    } catch { toast.error("Erro ao salvar campos."); }
    finally { setSaving(false); }
  };

  return (
    <div className="p-5 space-y-4">
      {loadingDefs ? (
        <div className="space-y-2">
          {[0, 1].map(i => <div key={i} className="h-12 animate-pulse rounded-lg bg-muted/40" />)}
        </div>
      ) : defs.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">Nenhum campo personalizado. Crie o primeiro abaixo.</p>
      ) : (
        <div className="space-y-3">
          {defs.map(def => (
            <div key={def.id} className="flex items-end gap-2 group">
              <div className="flex-1">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium mb-0.5">{def.name}</p>
                <Input
                  value={localValues[def.id] ?? ""}
                  onChange={e => setLocalValues(prev => ({ ...prev, [def.id]: e.target.value }))}
                  placeholder="Valor..."
                  className="h-8 text-sm"
                />
              </div>
              <button
                onClick={() => void handleDeleteDef(def.id)}
                className="shrink-0 mb-0.5 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400 transition-all"
                title="Remover campo"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2 border-t border-border pt-3">
        <Input
          value={newFieldName}
          onChange={e => setNewFieldName(e.target.value)}
          placeholder="Nome do novo campo..."
          className="h-8 text-sm flex-1"
          onKeyDown={e => { if (e.key === "Enter") void handleAddDef(); }}
        />
        <Button size="sm" variant="outline" onClick={() => void handleAddDef()} disabled={adding || !newFieldName.trim()} className="h-8 gap-1.5">
          {adding ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
          Criar
        </Button>
      </div>

      {defs.length > 0 && (
        <Button size="sm" onClick={() => void handleSave()} disabled={saving} className="w-full gap-1.5">
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
          Salvar valores
        </Button>
      )}
    </div>
  );
}

// ─── Lead Card ────────────────────────────────────────────────────────────────

function LeadCard({
  lead, accentColor = "indigo", onDragStart, onClick,
}: {
  lead: CRMLead;
  accentColor?: string;
  onDragStart: (e: React.DragEvent) => void;
  onClick: () => void;
}) {
  const cc = COLOR_CLASSES[accentColor] ?? COLOR_CLASSES.indigo!;
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      className="group bg-card border border-border rounded-lg p-3 cursor-grab active:cursor-grabbing hover:border-border/60 hover:shadow-sm transition-all select-none"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`shrink-0 grid size-7 place-items-center rounded-full text-[11px] font-semibold ${cc.bg} ${cc.text}`}>
            {initials(lead.nome)}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground truncate leading-tight">{lead.nome}</p>
            {lead.empresa && <p className="text-[11px] text-muted-foreground truncate">{lead.empresa}</p>}
          </div>
        </div>
        {lead.stage_is_won && <CheckCircle2 className="size-3.5 text-emerald-400 shrink-0 mt-0.5" />}
        {lead.stage_is_lost && <XCircle className="size-3.5 text-red-400 shrink-0 mt-0.5" />}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        {lead.valor_estimado
          ? <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">{fmtCurrency(lead.valor_estimado)}</span>
          : <span />}
        <div className="flex items-center gap-2 text-muted-foreground">
          {lead.messages_count > 0 && (
            <span className="flex items-center gap-0.5 text-[10px]">
              <MessageSquare className="size-3" />{lead.messages_count}
            </span>
          )}
          {lead.deals_count > 0 && (
            <span className="flex items-center gap-0.5 text-[10px] text-amber-700 dark:text-amber-400">
              <ChevronRight className="size-3" />{lead.deals_count} deal{lead.deals_count > 1 ? "s" : ""}
            </span>
          )}
          {lead.outcome && (
            <Badge className="text-[9px] h-4 px-1.5" variant="outline">
              {lead.outcome === "convertido" ? "Convertido" : lead.outcome === "perdido" ? "Perdido" : "Cancelado"}
            </Badge>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Deal Card ────────────────────────────────────────────────────────────────

function DealCard({
  deal, onDragStart, onClick,
}: {
  deal: CRMDeal;
  onDragStart: (e: React.DragEvent) => void;
  onClick: () => void;
}) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      className="group bg-card border border-border rounded-lg p-3 cursor-grab active:cursor-grabbing hover:border-border/60 hover:shadow-sm transition-all select-none"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground truncate leading-tight">{deal.titulo}</p>
          {deal.empresa && <p className="text-[11px] text-muted-foreground truncate">{deal.empresa}</p>}
        </div>
        {deal.stage_is_won && <CheckCircle2 className="size-3.5 text-emerald-400 shrink-0 mt-0.5" />}
        {deal.stage_is_lost && <XCircle className="size-3.5 text-red-400 shrink-0 mt-0.5" />}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        {deal.valor
          ? <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">{fmtCurrency(deal.valor, deal.moeda)}</span>
          : <span />}
        <div className="flex items-center gap-2 text-muted-foreground">
          {deal.data_fechamento_previsto && (
            <span className="flex items-center gap-0.5 text-[10px]">
              <Calendar className="size-3" />{fmtDate(deal.data_fechamento_previsto)}
            </span>
          )}
          {deal.projects_count > 0 && (
            <span className="flex items-center gap-0.5 text-[10px] text-emerald-600 dark:text-emerald-400">
              <Package2 className="size-3" />{deal.projects_count}
            </span>
          )}
          {deal.outcome && (
            <Badge className="text-[9px] h-4 px-1.5" variant="outline">
              {deal.outcome === "ganho" ? "Ganho" : deal.outcome === "contrato_assinado" ? "Contrato" : deal.outcome === "perdido" ? "Perdido" : "Cancelado"}
            </Badge>
          )}
        </div>
      </div>
      {deal.lead_nome && (
        <p className="mt-1.5 text-[10px] text-muted-foreground/60 truncate">
          Lead: {deal.lead_nome}
        </p>
      )}
    </div>
  );
}

// ─── Project Card ─────────────────────────────────────────────────────────────

function ProjectCard({
  project, onDragStart, onClick,
}: {
  project: CRMProject;
  onDragStart: (e: React.DragEvent) => void;
  onClick: () => void;
}) {
  const overdue = project.data_fim_previsto && !project.data_fim_realizado && new Date(project.data_fim_previsto) < new Date();
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      className="group bg-card border border-border rounded-lg p-3 cursor-grab active:cursor-grabbing hover:border-border/60 hover:shadow-sm transition-all select-none"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground truncate leading-tight">{project.titulo}</p>
          {project.empresa && <p className="text-[11px] text-muted-foreground truncate">{project.empresa}</p>}
        </div>
        {project.stage_is_won && <CheckCircle2 className="size-3.5 text-emerald-400 shrink-0 mt-0.5" />}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-muted-foreground">
          {project.data_fim_previsto && (
            <span className={`flex items-center gap-0.5 text-[10px] ${overdue ? "text-red-600 dark:text-red-400" : ""}`}>
              <Calendar className="size-3" />{fmtDate(project.data_fim_previsto)}
            </span>
          )}
        </div>
        {project.outcome && (
          <Badge className="text-[9px] h-4 px-1.5" variant="outline">
            {project.outcome === "concluido" ? "Concluído" : project.outcome === "pausado" ? "Pausado" : "Cancelado"}
          </Badge>
        )}
      </div>
      {project.deal_titulo && (
        <p className="mt-1.5 text-[10px] text-muted-foreground/60 truncate">
          Deal: {project.deal_titulo}
        </p>
      )}
    </div>
  );
}

// ─── Generic Kanban Column ────────────────────────────────────────────────────

function KanbanColumn({
  stage, count, totalValue, children, onDrop, onDragOver, onAdd,
}: {
  stage: CRMStage;
  count: number;
  totalValue?: number;
  children: React.ReactNode;
  onDrop: (e: React.DragEvent, stageId: number) => void;
  onDragOver: (e: React.DragEvent) => void;
  onAdd: (stage: CRMStage) => void;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      className={`flex flex-col min-w-[220px] max-w-[260px] rounded-xl border transition-colors ${over ? "border-primary/40 bg-primary/5" : "border-border bg-muted/20"}`}
      onDragOver={(e) => { onDragOver(e); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { setOver(false); onDrop(e, stage.id); }}
    >
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
        <div className="flex items-center gap-2 min-w-0">
          {colorDot(stage.color)}
          <span className="text-xs font-semibold text-foreground truncate">{stage.name}</span>
          <span className="text-[10px] text-muted-foreground shrink-0">({count})</span>
        </div>
        <button
          onClick={() => onAdd(stage)}
          className="grid size-5 place-items-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
        >
          <Plus className="size-3" />
        </button>
      </div>
      {totalValue != null && totalValue > 0 && (
        <div className="px-3 py-1 border-b border-border/50">
          <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">{fmtCurrency(String(totalValue))}</span>
        </div>
      )}
      <div className="flex-1 p-2 space-y-2 overflow-y-auto min-h-[120px]">
        {children}
        {count === 0 && (
          <div className="text-center py-4 text-[11px] text-muted-foreground/50 border border-dashed border-border/40 rounded-lg">
            Arraste um card aqui
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Lead Form Dialog ─────────────────────────────────────────────────────────

const ORIGEM_OPTIONS = [
  { value: "outro", label: "Outro" },
  { value: "site", label: "Site" },
  { value: "indicacao", label: "Indicação" },
  { value: "social", label: "Redes sociais" },
  { value: "evento", label: "Evento" },
  { value: "cold_outreach", label: "Cold outreach" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "telegram", label: "Telegram" },
  { value: "landing_page", label: "Landing Page" },
  { value: "meta_ads", label: "Meta Ads" },
];

function LeadFormDialog({
  initial, defaultStage, pipelineId, onClose, onSaved,
}: {
  initial?: CRMLead;
  defaultStage?: CRMStage;
  pipelineId?: number;
  onClose: () => void;
  onSaved: (lead: CRMLead) => void;
}) {
  const contextLabel = defaultStage?.main_stage === "deal"
    ? "Deal"
    : defaultStage?.main_stage === "project"
    ? "Project"
    : initial?.stage_main === "deal"
    ? "Deal"
    : initial?.stage_main === "project"
    ? "Project"
    : "Lead";

  const [form, setForm] = useState({
    nome: initial?.nome ?? "",
    empresa: initial?.empresa ?? "",
    email: initial?.email ?? "",
    telefone: initial?.telefone ?? "",
    cargo: initial?.cargo ?? "",
    valor_estimado: initial?.valor_estimado ?? "",
    responsavel: initial?.responsavel ?? "",
    origem: initial?.origem ?? "outro",
    observacoes: initial?.observacoes ?? "",
  });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.nome.trim()) { toast.error("Nome é obrigatório."); return; }
    setSaving(true);
    try {
      const payload = {
        ...form,
        valor_estimado: form.valor_estimado || null,
        stage: defaultStage?.id ?? initial?.stage ?? null,
        pipeline: pipelineId ?? initial?.pipeline ?? null,
      };
      const saved = initial ? await updateLead(initial.id, payload) : await createLead(payload);
      onSaved(saved);
      toast.success(`${contextLabel} "${saved.nome}" ${initial ? "atualizado" : "criado"}.`);
      onClose();
    } catch {
      toast.error(`Erro ao salvar ${contextLabel.toLowerCase()}.`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-card border border-border rounded-xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="font-semibold text-foreground">{initial ? `Editar ${contextLabel}` : `Novo ${contextLabel}`}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="size-4" /></button>
        </div>
        <div className="px-5 py-4 space-y-3 max-h-[70vh] overflow-y-auto">
          {([
            { key: "nome", label: "Nome *", placeholder: "João Silva" },
            { key: "empresa", label: "Empresa", placeholder: "Acme Ltda" },
            { key: "email", label: "E-mail", placeholder: "joao@acme.com" },
            { key: "telefone", label: "Telefone", placeholder: "(11) 99999-9999" },
            { key: "cargo", label: "Cargo", placeholder: "Diretor Comercial" },
            { key: "valor_estimado", label: "Valor estimado (R$)", placeholder: "50000" },
            { key: "responsavel", label: "Responsável", placeholder: "Maria (SDR)" },
          ] as const).map(f => (
            <div key={f.key} className="space-y-1">
              <label className="text-xs text-muted-foreground uppercase tracking-wide font-medium">{f.label}</label>
              <Input value={(form as Record<string, string>)[f.key]} onChange={e => set(f.key, e.target.value)} placeholder={f.placeholder} className="bg-background" />
            </div>
          ))}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Origem</label>
            <select value={form.origem} onChange={e => set("origem", e.target.value)} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring">
              {ORIGEM_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Observações</label>
            <textarea value={form.observacoes} onChange={e => set("observacoes", e.target.value)} rows={3} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring" />
          </div>
          {initial && (
            <div className="border-t border-border pt-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Campos extra</p>
              <CustomFieldsManager
                entityType="lead"
                entityId={initial.id}
                values={initial.custom_fields}
                onUpdated={() => {}}
              />
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancelar</Button>
          <Button size="sm" onClick={handleSave} disabled={saving} className="gap-2">
            {saving && <Loader2 className="size-3.5 animate-spin" />}
            {initial ? "Salvar" : `Criar ${contextLabel.toLowerCase()}`}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Deal Form Dialog ─────────────────────────────────────────────────────────

function DealFormDialog({
  initial, defaultStage, pipelineId, onClose, onSaved,
}: {
  initial?: CRMDeal;
  defaultStage?: CRMStage;
  pipelineId?: number;
  onClose: () => void;
  onSaved: (deal: CRMDeal) => void;
}) {
  const [form, setForm] = useState({
    titulo: initial?.titulo ?? "",
    empresa: initial?.empresa ?? "",
    responsavel: initial?.responsavel ?? "",
    valor: initial?.valor ?? "",
    moeda: initial?.moeda ?? "BRL",
    data_fechamento_previsto: initial?.data_fechamento_previsto ?? "",
    observacoes: initial?.observacoes ?? "",
  });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.titulo.trim()) { toast.error("Título é obrigatório."); return; }
    setSaving(true);
    try {
      const payload = {
        ...form,
        valor: form.valor || null,
        data_fechamento_previsto: form.data_fechamento_previsto || null,
        stage: defaultStage?.id ?? initial?.stage ?? null,
        pipeline: pipelineId ?? initial?.pipeline ?? null,
      };
      const saved = initial ? await updateDeal(initial.id, payload) : await createDeal(payload);
      onSaved(saved);
      toast.success(`Deal "${saved.titulo}" ${initial ? "atualizado" : "criado"}.`);
      onClose();
    } catch {
      toast.error("Erro ao salvar deal.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-card border border-border rounded-xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="font-semibold text-foreground">{initial ? "Editar Deal" : "Novo Deal"}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="size-4" /></button>
        </div>
        <div className="px-5 py-4 space-y-3 max-h-[70vh] overflow-y-auto">
          {([
            { key: "titulo", label: "Título *", placeholder: "Projeto Website" },
            { key: "empresa", label: "Empresa", placeholder: "Acme Ltda" },
            { key: "responsavel", label: "Responsável", placeholder: "Maria (AE)" },
            { key: "valor", label: "Valor (R$)", placeholder: "150000" },
          ] as const).map(f => (
            <div key={f.key} className="space-y-1">
              <label className="text-xs text-muted-foreground uppercase tracking-wide font-medium">{f.label}</label>
              <Input value={(form as Record<string, string>)[f.key]} onChange={e => set(f.key, e.target.value)} placeholder={f.placeholder} className="bg-background" />
            </div>
          ))}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Previsão de fechamento</label>
            <Input type="date" value={form.data_fechamento_previsto} onChange={e => set("data_fechamento_previsto", e.target.value)} className="bg-background" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Observações</label>
            <textarea value={form.observacoes} onChange={e => set("observacoes", e.target.value)} rows={3} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring" />
          </div>
          {initial && (
            <div className="border-t border-border pt-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Campos extra</p>
              <CustomFieldsManager
                entityType="deal"
                entityId={initial.id}
                values={initial.custom_fields}
                onUpdated={() => {}}
              />
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancelar</Button>
          <Button size="sm" onClick={handleSave} disabled={saving} className="gap-2">
            {saving && <Loader2 className="size-3.5 animate-spin" />}
            {initial ? "Salvar" : "Criar deal"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Project Form Dialog ──────────────────────────────────────────────────────

function ProjectFormDialog({
  initial, defaultStage, pipelineId, onClose, onSaved,
}: {
  initial?: CRMProject;
  defaultStage?: CRMStage;
  pipelineId?: number;
  onClose: () => void;
  onSaved: (project: CRMProject) => void;
}) {
  const [form, setForm] = useState({
    titulo: initial?.titulo ?? "",
    empresa: initial?.empresa ?? "",
    responsavel: initial?.responsavel ?? "",
    data_inicio: initial?.data_inicio ?? "",
    data_fim_previsto: initial?.data_fim_previsto ?? "",
    observacoes: initial?.observacoes ?? "",
  });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.titulo.trim()) { toast.error("Título é obrigatório."); return; }
    setSaving(true);
    try {
      const payload = {
        ...form,
        data_inicio: form.data_inicio || null,
        data_fim_previsto: form.data_fim_previsto || null,
        stage: defaultStage?.id ?? initial?.stage ?? null,
        pipeline: pipelineId ?? initial?.pipeline ?? null,
      };
      const saved = initial ? await updateProject(initial.id, payload) : await createProject(payload);
      onSaved(saved);
      toast.success(`Projeto "${saved.titulo}" ${initial ? "atualizado" : "criado"}.`);
      onClose();
    } catch {
      toast.error("Erro ao salvar projeto.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-card border border-border rounded-xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="font-semibold text-foreground">{initial ? "Editar Projeto" : "Novo Projeto"}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="size-4" /></button>
        </div>
        <div className="px-5 py-4 space-y-3 max-h-[70vh] overflow-y-auto">
          {([
            { key: "titulo", label: "Título *", placeholder: "Projeto Website" },
            { key: "empresa", label: "Empresa", placeholder: "Acme Ltda" },
            { key: "responsavel", label: "Responsável", placeholder: "Carlos (PM)" },
          ] as const).map(f => (
            <div key={f.key} className="space-y-1">
              <label className="text-xs text-muted-foreground uppercase tracking-wide font-medium">{f.label}</label>
              <Input value={(form as Record<string, string>)[f.key]} onChange={e => set(f.key, e.target.value)} placeholder={f.placeholder} className="bg-background" />
            </div>
          ))}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Início</label>
              <Input type="date" value={form.data_inicio} onChange={e => set("data_inicio", e.target.value)} className="bg-background" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Previsão de entrega</label>
              <Input type="date" value={form.data_fim_previsto} onChange={e => set("data_fim_previsto", e.target.value)} className="bg-background" />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Observações</label>
            <textarea value={form.observacoes} onChange={e => set("observacoes", e.target.value)} rows={3} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring" />
          </div>
          {initial && (
            <div className="border-t border-border pt-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Campos extra</p>
              <CustomFieldsManager
                entityType="project"
                entityId={initial.id}
                values={initial.custom_fields}
                onUpdated={() => {}}
              />
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancelar</Button>
          <Button size="sm" onClick={handleSave} disabled={saving} className="gap-2">
            {saving && <Loader2 className="size-3.5 animate-spin" />}
            {initial ? "Salvar" : "Criar projeto"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Conversation Tab (Lead only) ─────────────────────────────────────────────

function ConversationTab({ lead }: { lead: CRMLead }) {
  const [messages, setMessages] = useState<LeadMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [closingSuggested, setClosingSuggested] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    void getLeadMessages(lead.id).then(setMessages).catch(() => {}).finally(() => setLoading(false));
  }, [lead.id]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || sending) return;
    const msg = input.trim();
    setInput("");
    setSending(true);
    try {
      const result = await qualifyLead(lead.id, msg);
      setMessages(prev => [
        ...prev,
        { id: Date.now(), role: "user", content: msg, created_at: new Date().toISOString() },
        { id: Date.now() + 1, role: "agent", content: result.response, created_at: new Date().toISOString() },
      ]);
      if (result.closing_suggested) setClosingSuggested(true);
    } catch {
      toast.error("Erro ao enviar mensagem.");
    } finally {
      setSending(false);
    }
  };

  const visible = messages.filter(m => m.role !== "system");
  const grouped: { date: string; msgs: LeadMessage[] }[] = [];
  for (const m of visible) {
    const d = fmtDateFull(m.created_at);
    const last = grouped[grouped.length - 1];
    if (last?.date === d) last.msgs.push(m);
    else grouped.push({ date: d, msgs: [m] });
  }

  if (loading) return <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">Carregando...</div>;

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {closingSuggested && (
        <div className="mx-4 mt-3 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center gap-2 shrink-0">
          <CheckCircle2 className="size-4 text-emerald-400 shrink-0" />
          <p className="text-xs text-emerald-400 flex-1">Agente detectou interesse! Considere converter em Deal.</p>
          <button onClick={() => setClosingSuggested(false)} className="text-emerald-400/60 hover:text-emerald-400"><X className="size-3.5" /></button>
        </div>
      )}
      <div className="flex-1 overflow-y-auto p-4 space-y-1">
        {visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 py-12">
            <MessageCircle className="size-10 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground text-center">Nenhuma mensagem ainda.</p>
            <p className="text-xs text-muted-foreground/60 text-center">Mensagens de canais conectados aparecem aqui.</p>
          </div>
        ) : (
          grouped.map(group => (
            <div key={group.date}>
              <div className="flex justify-center my-3">
                <span className="text-[10px] bg-muted/60 text-muted-foreground px-2 py-0.5 rounded-full">{group.date}</span>
              </div>
              <div className="space-y-1.5">
                {group.msgs.map(m => (
                  <div key={m.id} className={`flex ${m.role === "user" ? "justify-start" : "justify-end"}`}>
                    <div className={`max-w-[75%] rounded-2xl px-3 py-2 ${m.role === "user" ? "bg-muted text-foreground rounded-tl-sm" : "bg-primary text-primary-foreground rounded-tr-sm"}`}>
                      {m.role === "agent" && (
                        <div className="flex items-center gap-1 mb-1">
                          <Bot className="size-3 opacity-70" />
                          <span className="text-[9px] opacity-70 font-medium">Agente</span>
                        </div>
                      )}
                      <p className="text-sm leading-relaxed whitespace-pre-wrap">{m.content}</p>
                      <p className={`text-[10px] mt-1 text-right ${m.role === "user" ? "text-muted-foreground" : "text-primary-foreground/70"}`}>
                        {fmtTime(m.created_at)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>
      <div className="p-3 border-t border-border bg-card/50 shrink-0">
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && !e.shiftKey && void handleSend()}
            placeholder="Simular mensagem do lead..."
            className="bg-background text-sm"
            disabled={sending}
          />
          <Button size="sm" onClick={handleSend} disabled={sending || !input.trim()} className="shrink-0">
            {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1.5">Simule uma mensagem do lead para o agente qualificar e responder.</p>
      </div>
    </div>
  );
}

// ─── Modal shell helpers ───────────────────────────────────────────────────────

function ModalShell({
  title, subtitle, badge, icon, extra, onEdit, onDelete, onClose, children, footer,
}: {
  title: string;
  subtitle?: string;
  badge?: string;
  icon?: React.ReactNode;
  extra?: React.ReactNode;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-card border border-border rounded-xl w-full max-w-2xl shadow-2xl flex flex-col" style={{ maxHeight: "90vh" }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            {icon}
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-base font-semibold text-foreground truncate">{title}</p>
                {badge && <Badge variant="outline" className="text-[10px] h-5 shrink-0">{badge}</Badge>}
              </div>
              {subtitle && <p className="text-sm text-muted-foreground truncate">{subtitle}</p>}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0 ml-2">
            {extra}
            {!confirmDelete ? (
              <>
                <button onClick={onEdit} className="grid size-7 place-items-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors" title="Editar">
                  <Pencil className="size-3.5" />
                </button>
                <button onClick={() => setConfirmDelete(true)} className="grid size-7 place-items-center rounded text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors" title="Excluir">
                  <Trash2 className="size-3.5" />
                </button>
              </>
            ) : (
              <div className="flex items-center gap-1.5 mr-1">
                <span className="text-xs text-muted-foreground">Excluir?</span>
                <Button
                  size="sm" variant="destructive" className="h-6 px-2 text-xs gap-1"
                  onClick={async () => {
                    setDeleting(true);
                    try { await onDelete(); }
                    finally { setDeleting(false); setConfirmDelete(false); }
                  }}
                  disabled={deleting}
                >
                  {deleting ? <Loader2 className="size-3 animate-spin" /> : null} Sim
                </Button>
                <button onClick={() => setConfirmDelete(false)} className="grid size-6 place-items-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors text-xs">Não</button>
              </div>
            )}
            <button onClick={onClose} className="grid size-7 place-items-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors" title="Fechar">
              <X className="size-4" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-hidden flex flex-col">
          {children}
        </div>
        {footer}
      </div>
    </div>
  );
}

// ─── Obsidian Note Tab ───────────────────────────────────────────────────────

function ObsidianNoteTab({ leadId }: { leadId: number }) {
  const [note, setNote] = useState<LeadObsidianNote | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const data = await getLeadObsidianNote(leadId);
      setNote(data);
    } catch {
      setNote({ content: null, exists: false, detail: "Erro ao carregar nota." });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [leadId]);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const parseMarkdown = (md: string) => {
    // frontmatter → ocultar bloco ---...---
    const withoutFrontmatter = md.replace(/^---[\s\S]*?---\n*/m, "");
    // Títulos → negrito visual
    const lines = withoutFrontmatter.split("\n");
    return lines.map((line, i) => {
      if (line.startsWith("## ")) return <h3 key={i} className="text-sm font-semibold text-foreground mt-4 mb-1">{line.slice(3)}</h3>;
      if (line.startsWith("# ")) return <h2 key={i} className="text-base font-bold text-foreground mt-2 mb-2">{line.slice(2)}</h2>;
      if (line.startsWith("**Lead**") || line.startsWith("**Agente**")) {
        const isLead = line.startsWith("**Lead**");
        return (
          <div key={i} className={`flex gap-2 py-1 ${isLead ? "" : "justify-end"}`}>
            <span className={`text-xs px-2.5 py-1 rounded-xl max-w-[85%] break-words leading-relaxed ${
              isLead
                ? "bg-muted text-foreground"
                : "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300"
            }`}>
              {line.replace(/^\*\*(Lead|Agente)\*\*( _[^_]+_)?:? ?/, "")}
            </span>
          </div>
        );
      }
      if (line.startsWith("- ") || line.startsWith("• ")) {
        return <li key={i} className="text-xs text-muted-foreground ml-3 list-disc">{line.slice(2)}</li>;
      }
      if (line.startsWith("**") && line.includes(":**")) {
        const [label, ...rest] = line.replace(/\*\*/g, "").split(":");
        return (
          <div key={i} className="flex gap-1.5 text-xs">
            <span className="text-muted-foreground shrink-0">{label}:</span>
            <span className="text-foreground">{rest.join(":").replace(/  $/, "").trim()}</span>
          </div>
        );
      }
      if (!line.trim()) return <div key={i} className="h-1" />;
      return <p key={i} className="text-xs text-muted-foreground leading-relaxed">{line}</p>;
    });
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center justify-between px-5 py-2.5 border-b border-border shrink-0">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <BookOpen className="size-3.5" />
          <span>Nota no Vault Obsidian</span>
          {note?.path && (
            <span className="font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded truncate max-w-[200px]" title={note.path}>
              {note.path.split("/").slice(-2).join("/")}
            </span>
          )}
        </div>
        <button
          onClick={() => void load(true)}
          className="p-1 rounded hover:bg-muted transition-colors"
          title="Atualizar nota"
        >
          <RefreshCcw className={`size-3.5 text-muted-foreground ${refreshing ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {!note?.exists ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center py-12">
            <FileText className="size-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              {note?.detail === "OBSIDIAN_VAULT_PATH não configurado."
                ? "Vault Obsidian não configurado no servidor."
                : "Nota ainda não gerada. Ela será criada automaticamente após a próxima mensagem no canal."}
            </p>
            {note?.detail === "OBSIDIAN_VAULT_PATH não configurado." && (
              <p className="text-xs text-muted-foreground/60">Configure OBSIDIAN_VAULT_PATH no servidor.</p>
            )}
          </div>
        ) : (
          <div className="space-y-0.5">
            {parseMarkdown(note.content ?? "")}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Lead Detail Modal ────────────────────────────────────────────────────────

function LeadDetailModal({
  lead, onClose, onUpdated, onDeleted, onConverted,
}: {
  lead: CRMLead;
  onClose: () => void;
  onUpdated: (lead: CRMLead) => void;
  onDeleted: (id: number) => void;
  onConverted: (deal: CRMDeal) => void;
}) {
  const [tab, setTab] = useState<"conversa" | "info" | "obsidian">("conversa");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [local, setLocal] = useState(lead);
  useEffect(() => { setLocal(lead); }, [lead]);

  const handleConvert = async () => {
    setBusy(true);
    try {
      const deal = await convertLeadToDeal(local.id);
      const updatedLead = { ...local, outcome: "convertido" as LeadOutcome };
      setLocal(updatedLead);
      onUpdated(updatedLead);
      onConverted(deal);
      toast.success(`Deal "${deal.titulo}" criado!`);
    } catch {
      toast.error("Erro ao converter lead.");
    } finally {
      setBusy(false);
    }
  };

  const handleOutcome = async (outcome: LeadOutcome) => {
    setBusy(true);
    try {
      const updated = await setLeadOutcome(local.id, outcome);
      setLocal(updated);
      onUpdated(updated);
      toast.success("Desfecho registrado.");
    } catch {
      toast.error("Erro ao definir desfecho.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell
      title={local.nome}
      subtitle={local.empresa}
      badge={local.stage_name ?? undefined}
      icon={
        <span className="grid size-10 place-items-center rounded-full bg-indigo-500/15 text-sm font-bold text-indigo-600 dark:text-indigo-400 shrink-0">
          {initials(local.nome)}
        </span>
      }
      extra={
        local.valor_estimado ? (
          <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 mr-1">{fmtCurrency(local.valor_estimado)}</span>
        ) : null
      }
      onEdit={() => setEditing(true)}
      onDelete={async () => {
        await deleteLead(local.id);
        toast.success(`Lead "${local.nome}" excluído.`);
        onDeleted(local.id);
        onClose();
      }}
      onClose={onClose}
      footer={
        <div className="px-5 py-3 border-t border-border shrink-0">
          <div className="flex flex-wrap gap-2">
            {local.outcome !== "convertido" && (
              <Button
                size="sm" variant="outline"
                className="gap-1.5 h-8 text-xs border-amber-500/40 text-amber-700 dark:text-amber-400 hover:bg-amber-500/10"
                onClick={handleConvert} disabled={busy}
              >
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowRight className="size-3.5" />}
                Converter em Deal
              </Button>
            )}
            {local.outcome !== "perdido" && (
              <Button
                size="sm" variant="outline"
                className="gap-1.5 h-8 text-xs border-red-500/40 text-red-600 dark:text-red-400 hover:bg-red-500/10"
                onClick={() => void handleOutcome("perdido")} disabled={busy}
              >
                <XCircle className="size-3.5" /> Perdido
              </Button>
            )}
            {local.outcome !== "cancelado" && (
              <Button
                size="sm" variant="outline"
                className="gap-1.5 h-8 text-xs border-muted-foreground/30 text-muted-foreground hover:bg-muted/40"
                onClick={() => void handleOutcome("cancelado")} disabled={busy}
              >
                Cancelado
              </Button>
            )}
            {local.outcome && (
              <span className="text-xs text-muted-foreground self-center ml-1">
                Atual: <span className="font-medium text-foreground capitalize">{local.outcome.replace("_", " ")}</span>
              </span>
            )}
          </div>
        </div>
      }
    >
      <div className="flex border-b border-border shrink-0">
        {([
          { key: "conversa" as const, label: "Conversa", icon: <MessageCircle className="size-3.5" /> },
          { key: "info" as const, label: "Informações", icon: <User className="size-3.5" /> },
          { key: "obsidian" as const, label: "Obsidian", icon: <BookOpen className="size-3.5" /> },
        ]).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors ${tab === t.key ? "text-foreground border-b-2 border-primary" : "text-muted-foreground hover:text-foreground"}`}
          >
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {tab === "conversa" && <ConversationTab lead={local} />}

      {tab === "info" && (
        <div className="flex-1 overflow-y-auto">
          <div className="p-5 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              {[
                { icon: <Mail className="size-4" />, label: "E-mail", value: local.email },
                { icon: <Phone className="size-4" />, label: "Telefone", value: local.telefone },
                { icon: <Briefcase className="size-4" />, label: "Cargo", value: local.cargo },
                { icon: <User className="size-4" />, label: "Responsável", value: local.responsavel },
                { icon: <DollarSign className="size-4" />, label: "Valor estimado", value: local.valor_estimado ? fmtCurrency(local.valor_estimado) : null },
                { icon: <MessageSquare className="size-4" />, label: "Origem", value: local.origem },
              ].filter(r => r.value).map(r => (
                <div key={r.label} className="flex items-start gap-2 p-3 rounded-lg bg-muted/30">
                  <span className="text-muted-foreground mt-0.5 shrink-0">{r.icon}</span>
                  <div className="min-w-0">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">{r.label}</p>
                    <p className="text-sm text-foreground mt-0.5 truncate">{r.value}</p>
                  </div>
                </div>
              ))}
            </div>
            {local.observacoes && (
              <div className="p-3 rounded-lg bg-muted/30">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium mb-1">Observações</p>
                <p className="text-sm text-foreground/80 leading-relaxed">{local.observacoes}</p>
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">Criado em {new Date(local.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })}</p>
          </div>
        </div>
      )}

      {tab === "obsidian" && <ObsidianNoteTab leadId={local.id} />}

      {editing && (
        <LeadFormDialog
          initial={local}
          onClose={() => setEditing(false)}
          onSaved={updated => { setLocal(updated); onUpdated(updated); setEditing(false); }}
        />
      )}
    </ModalShell>
  );
}

// ─── Deal Detail Modal ────────────────────────────────────────────────────────

function DealDetailModal({
  deal, onClose, onUpdated, onDeleted, onConverted,
}: {
  deal: CRMDeal;
  onClose: () => void;
  onUpdated: (deal: CRMDeal) => void;
  onDeleted: (id: number) => void;
  onConverted: (project: CRMProject) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [local, setLocal] = useState(deal);
  useEffect(() => { setLocal(deal); }, [deal]);

  const handleConvert = async () => {
    setBusy(true);
    try {
      const project = await convertDealToProject(local.id);
      onConverted(project);
      toast.success(`Projeto "${project.titulo}" criado!`);
    } catch {
      toast.error("Erro ao converter deal em projeto.");
    } finally {
      setBusy(false);
    }
  };

  const handleOutcome = async (outcome: DealOutcome) => {
    setBusy(true);
    try {
      const updated = await setDealOutcome(local.id, outcome);
      setLocal(updated);
      onUpdated(updated);
      if (outcome === "ganho" || outcome === "contrato_assinado") {
        toast.success("Deal ganho! Projeto criado automaticamente se não existia.");
      } else {
        toast.success("Desfecho registrado.");
      }
    } catch {
      toast.error("Erro ao definir desfecho.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell
      title={local.titulo}
      subtitle={local.empresa}
      badge={local.stage_name ?? undefined}
      icon={
        <span className="grid size-10 place-items-center rounded-full bg-amber-500/15 text-sm font-bold text-amber-700 dark:text-amber-400 shrink-0">
          <DollarSign className="size-5" />
        </span>
      }
      extra={
        local.valor ? (
          <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 mr-1">{fmtCurrency(local.valor, local.moeda)}</span>
        ) : null
      }
      onEdit={() => setEditing(true)}
      onDelete={async () => {
        await deleteDeal(local.id);
        toast.success(`Deal "${local.titulo}" excluído.`);
        onDeleted(local.id);
        onClose();
      }}
      onClose={onClose}
      footer={
        <div className="px-5 py-3 border-t border-border shrink-0">
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm" variant="outline"
              className="gap-1.5 h-8 text-xs border-emerald-500/40 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10"
              onClick={() => void handleOutcome("ganho")} disabled={busy || local.outcome === "ganho"}
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
              Ganho
            </Button>
            <Button
              size="sm" variant="outline"
              className="gap-1.5 h-8 text-xs border-blue-500/40 text-blue-600 dark:text-blue-400 hover:bg-blue-500/10"
              onClick={() => void handleOutcome("contrato_assinado")} disabled={busy || local.outcome === "contrato_assinado"}
            >
              Contrato Assinado → Projeto
            </Button>
            <Button
              size="sm" variant="outline"
              className="gap-1.5 h-8 text-xs border-emerald-500/40 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10"
              onClick={handleConvert} disabled={busy}
            >
              <ArrowRight className="size-3.5" /> Converter em Projeto
            </Button>
            <Button
              size="sm" variant="outline"
              className="gap-1.5 h-8 text-xs border-red-500/40 text-red-600 dark:text-red-400 hover:bg-red-500/10"
              onClick={() => void handleOutcome("perdido")} disabled={busy || local.outcome === "perdido"}
            >
              <XCircle className="size-3.5" /> Perdido
            </Button>
            {local.outcome && (
              <span className="text-xs text-muted-foreground self-center ml-1">
                Atual: <span className="font-medium text-foreground capitalize">{local.outcome.replace("_", " ")}</span>
              </span>
            )}
          </div>
        </div>
      }
    >
      <div className="flex-1 overflow-y-auto">
        <div className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            {[
              { icon: <User className="size-4" />, label: "Responsável", value: local.responsavel },
              { icon: <DollarSign className="size-4" />, label: "Valor", value: local.valor ? fmtCurrency(local.valor, local.moeda) : null },
              { icon: <Calendar className="size-4" />, label: "Previsão de fechamento", value: local.data_fechamento_previsto ? fmtDate(local.data_fechamento_previsto) : null },
              { icon: <MessageSquare className="size-4" />, label: "Lead de origem", value: local.lead_nome },
            ].filter(r => r.value).map(r => (
              <div key={r.label} className="flex items-start gap-2 p-3 rounded-lg bg-muted/30">
                <span className="text-muted-foreground mt-0.5 shrink-0">{r.icon}</span>
                <div className="min-w-0">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">{r.label}</p>
                  <p className="text-sm text-foreground mt-0.5 truncate">{r.value}</p>
                </div>
              </div>
            ))}
          </div>
          {local.observacoes && (
            <div className="p-3 rounded-lg bg-muted/30">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium mb-1">Observações</p>
              <p className="text-sm text-foreground/80 leading-relaxed">{local.observacoes}</p>
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">Criado em {new Date(local.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })}</p>
        </div>
      </div>

      {editing && (
        <DealFormDialog
          initial={local}
          onClose={() => setEditing(false)}
          onSaved={updated => { setLocal(updated); onUpdated(updated); setEditing(false); }}
        />
      )}
    </ModalShell>
  );
}

// ─── Project Detail Modal ─────────────────────────────────────────────────────

function ProjectDetailModal({
  project, onClose, onUpdated, onDeleted,
}: {
  project: CRMProject;
  onClose: () => void;
  onUpdated: (project: CRMProject) => void;
  onDeleted: (id: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [local, setLocal] = useState(project);
  useEffect(() => { setLocal(project); }, [project]);

  const handleOutcome = async (outcome: ProjectOutcome) => {
    setBusy(true);
    try {
      const updated = await setProjectOutcome(local.id, outcome);
      setLocal(updated);
      onUpdated(updated);
      toast.success("Desfecho registrado.");
    } catch {
      toast.error("Erro ao definir desfecho.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell
      title={local.titulo}
      subtitle={local.empresa}
      badge={local.stage_name ?? undefined}
      icon={
        <span className="grid size-10 place-items-center rounded-full bg-emerald-500/15 text-sm font-bold text-emerald-600 dark:text-emerald-400 shrink-0">
          <Package2 className="size-5" />
        </span>
      }
      onEdit={() => setEditing(true)}
      onDelete={async () => {
        await deleteProject(local.id);
        toast.success(`Projeto "${local.titulo}" excluído.`);
        onDeleted(local.id);
        onClose();
      }}
      onClose={onClose}
      footer={
        <div className="px-5 py-3 border-t border-border shrink-0">
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm" variant="outline"
              className="gap-1.5 h-8 text-xs border-emerald-500/40 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10"
              onClick={() => void handleOutcome("concluido")} disabled={busy || local.outcome === "concluido"}
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
              Concluído
            </Button>
            <Button
              size="sm" variant="outline"
              className="gap-1.5 h-8 text-xs border-yellow-500/40 text-yellow-700 dark:text-yellow-400 hover:bg-yellow-500/10"
              onClick={() => void handleOutcome("pausado")} disabled={busy || local.outcome === "pausado"}
            >
              Pausado
            </Button>
            <Button
              size="sm" variant="outline"
              className="gap-1.5 h-8 text-xs border-red-500/40 text-red-600 dark:text-red-400 hover:bg-red-500/10"
              onClick={() => void handleOutcome("cancelado")} disabled={busy || local.outcome === "cancelado"}
            >
              <XCircle className="size-3.5" /> Cancelado
            </Button>
            {local.outcome && (
              <span className="text-xs text-muted-foreground self-center ml-1">
                Atual: <span className="font-medium text-foreground capitalize">{local.outcome}</span>
              </span>
            )}
          </div>
        </div>
      }
    >
      <div className="flex-1 overflow-y-auto">
        <div className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            {[
              { icon: <User className="size-4" />, label: "Responsável", value: local.responsavel },
              { icon: <Calendar className="size-4" />, label: "Início", value: local.data_inicio ? fmtDate(local.data_inicio) : null },
              { icon: <Calendar className="size-4" />, label: "Previsão de entrega", value: local.data_fim_previsto ? fmtDate(local.data_fim_previsto) : null },
              { icon: <CheckCircle2 className="size-4" />, label: "Entregue em", value: local.data_fim_realizado ? fmtDate(local.data_fim_realizado) : null },
              { icon: <DollarSign className="size-4" />, label: "Deal de origem", value: local.deal_titulo },
              { icon: <MessageSquare className="size-4" />, label: "Lead de origem", value: local.lead_nome },
            ].filter(r => r.value).map(r => (
              <div key={r.label} className="flex items-start gap-2 p-3 rounded-lg bg-muted/30">
                <span className="text-muted-foreground mt-0.5 shrink-0">{r.icon}</span>
                <div className="min-w-0">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">{r.label}</p>
                  <p className="text-sm text-foreground mt-0.5 truncate">{r.value}</p>
                </div>
              </div>
            ))}
          </div>
          {local.observacoes && (
            <div className="p-3 rounded-lg bg-muted/30">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium mb-1">Observações</p>
              <p className="text-sm text-foreground/80 leading-relaxed">{local.observacoes}</p>
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">Criado em {new Date(local.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })}</p>
        </div>
      </div>

      {editing && (
        <ProjectFormDialog
          initial={local}
          onClose={() => setEditing(false)}
          onSaved={updated => { setLocal(updated); onUpdated(updated); setEditing(false); }}
        />
      )}
    </ModalShell>
  );
}

// ─── Stage Config Dialog ──────────────────────────────────────────────────────

function StageConfigDialog({
  pipeline, onClose, onSaved,
}: {
  pipeline: CRMPipeline;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [stages, setStages] = useState<CRMStage[]>(pipeline.stages);
  const [newName, setNewName] = useState("");
  const [newMain, setNewMain] = useState<MainStage>("lead");
  const [saving, setSaving] = useState(false);
  const dragItem = useRef<{ id: number; mainStage: MainStage } | null>(null);
  const [dragOverId, setDragOverId] = useState<number | null>(null);

  const handleAdd = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      const maxPos = Math.max(0, ...stages.filter(s => s.main_stage === newMain).map(s => s.position)) + 1;
      const s = await createStage({ pipeline: pipeline.id, main_stage: newMain, name: newName, position: maxPos, color: "blue", is_won: false, is_lost: false });
      setStages(prev => [...prev, s]);
      setNewName("");
      toast.success("Etapa criada.");
    } catch { toast.error("Erro ao criar etapa."); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteStage(id);
      setStages(prev => prev.filter(s => s.id !== id));
      toast.success("Etapa removida.");
    } catch { toast.error("Erro ao remover etapa."); }
  };

  const handleDrop = async (targetId: number, mainStage: MainStage) => {
    if (!dragItem.current || dragItem.current.id === targetId) return;
    const group = [...stages.filter(s => s.main_stage === mainStage)].sort((a, b) => a.position - b.position);
    const fromIdx = group.findIndex(s => s.id === dragItem.current!.id);
    const toIdx = group.findIndex(s => s.id === targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    const reordered = [...group];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    const updated = reordered.map((s, i) => ({ ...s, position: i }));
    setStages(prev => [...prev.filter(s => s.main_stage !== mainStage), ...updated]);
    setDragOverId(null);
    dragItem.current = null;
    await Promise.all(updated.map(s => updateStage(s.id, { position: s.position }).catch(() => {})));
    onSaved();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-card border border-border rounded-xl w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="font-semibold text-foreground">Configurar Etapas — {pipeline.name}</h3>
          <button onClick={() => { onSaved(); onClose(); }} className="text-muted-foreground hover:text-foreground"><X className="size-4" /></button>
        </div>
        <div className="px-5 py-4 space-y-4 max-h-[65vh] overflow-y-auto">
          {TAB_META.map(ms => (
            <div key={ms.key}>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{ms.label}</p>
              <div className="space-y-1">
                {stages.filter(s => s.main_stage === ms.key).sort((a, b) => a.position - b.position).map(s => (
                  <div
                    key={s.id}
                    draggable
                    onDragStart={() => { dragItem.current = { id: s.id, mainStage: ms.key }; }}
                    onDragOver={e => { e.preventDefault(); setDragOverId(s.id); }}
                    onDragLeave={() => setDragOverId(null)}
                    onDrop={() => void handleDrop(s.id, ms.key)}
                    className={`flex items-center gap-2 group rounded px-1 py-0.5 cursor-grab active:cursor-grabbing transition-colors ${dragOverId === s.id ? "bg-muted/60 border border-dashed border-border" : "hover:bg-muted/30"}`}
                  >
                    <GripVertical className="size-3.5 text-muted-foreground/40 shrink-0" />
                    {colorDot(s.color)}
                    <span className="flex-1 text-sm text-foreground">{s.name}</span>
                    {s.is_won && <Badge className="text-[10px] h-4 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30">Ganho</Badge>}
                    {s.is_lost && <Badge className="text-[10px] h-4 bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30">Perdido</Badge>}
                    {!s.is_won && !s.is_lost && (
                      <button onClick={() => void handleDelete(s.id)} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400 transition-all">
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div className="border-t border-border pt-4 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Nova etapa</p>
            <div className="flex gap-2">
              <select value={newMain} onChange={e => setNewMain(e.target.value as MainStage)} className="rounded-md border border-input bg-background px-2 py-1.5 text-sm">
                {TAB_META.map(ms => <option key={ms.key} value={ms.key}>{ms.label}</option>)}
              </select>
              <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Nome da etapa" className="flex-1 bg-background" onKeyDown={e => e.key === "Enter" && void handleAdd()} />
              <Button size="sm" onClick={handleAdd} disabled={saving || !newName.trim()} className="gap-1.5 shrink-0">
                {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                Adicionar
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Google Maps Scraper Modal ────────────────────────────────────────────────

function ScraperModal({
  pipelineId, onClose, onImported,
}: {
  pipelineId?: number;
  onClose: () => void;
  onImported: () => void;
}) {
  const [query, setQuery] = useState("");
  const [depth, setDepth] = useState(5);
  const [job, setJob] = useState<ScrapingJobType | null>(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [paused, setPaused] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const jobIdRef = useRef<number | null>(null);

  const stopPoll = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };

  const startPoll = (id: number) => {
    stopPoll();
    pollRef.current = setInterval(async () => {
      try {
        const updated = await getScrapingJob(id);
        setJob(updated);
        if (updated.status === "done" || updated.status === "failed") { stopPoll(); setPaused(false); }
      } catch {}
    }, 4000);
  };

  useEffect(() => () => stopPoll(), []);

  const handlePauseResume = () => {
    if (!jobIdRef.current) return;
    if (paused) {
      startPoll(jobIdRef.current);
      setPaused(false);
    } else {
      stopPoll();
      setPaused(true);
    }
  };

  const handleStart = async () => {
    if (!query.trim()) { toast.error("Digite uma busca."); return; }
    setLoading(true);
    setJob(null);
    setPaused(false);
    try {
      const created = await createGoogleMapsJob(query.trim(), depth);
      setJob(created);
      jobIdRef.current = created.id;
      startPoll(created.id);
    } catch {
      toast.error("Erro ao iniciar scrape. Verifique se o container gmaps-scraper está ativo.");
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async () => {
    if (!job) return;
    setImporting(true);
    try {
      const { imported } = await importScrapingJobToCRM(job.id, pipelineId);
      toast.success(`${imported} lead(s) importado(s) para o CRM.`);
      onImported();
      onClose();
    } catch {
      toast.error("Erro ao importar leads.");
    } finally {
      setImporting(false);
    }
  };

  const handleRetry = async () => {
    if (!job) return;
    setLoading(true);
    try {
      stopPoll();
      setPaused(false);
      const updated = await retryScrapingJob(job.id);
      setJob(updated);
      jobIdRef.current = updated.id;
      startPoll(updated.id);
    } catch {
      toast.error("Erro ao reiniciar o job.");
    } finally {
      setLoading(false);
    }
  };

  const isRunning = job?.status === "pending" || job?.status === "running";
  const isDone = job?.status === "done";
  const isFailed = job?.status === "failed";

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-card border border-border rounded-xl w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <MapPin className="size-4 text-primary" />
            <h3 className="font-semibold text-foreground">Google Maps Scraper</h3>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="size-4" /></button>
        </div>

        <div className="px-5 py-4 space-y-4 flex-1 overflow-y-auto">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Busca *</label>
            <Input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="academias em Salvador BA"
              className="bg-background"
              onKeyDown={e => e.key === "Enter" && !loading && void handleStart()}
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Profundidade</label>
              <span className="text-xs font-semibold text-foreground tabular-nums">{depth}</span>
            </div>
            <input
              type="range" min={1} max={20} value={depth}
              onChange={e => setDepth(Number(e.target.value))}
              className="w-full accent-primary"
            />
            <p className="text-[10px] text-muted-foreground">Valores maiores retornam mais resultados mas levam mais tempo.</p>
          </div>

          {job && (
            <div className={`rounded-lg border p-3 space-y-2 ${isDone ? "border-emerald-500/30 bg-emerald-500/5" : isFailed ? "border-red-500/30 bg-red-500/5" : "border-primary/20 bg-primary/5"}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {(isRunning && !paused) && <Loader2 className="size-3.5 animate-spin text-primary shrink-0" />}
                  {paused && <span className="size-3.5 rounded-full bg-amber-400 shrink-0 inline-block" />}
                  {isDone && <CheckCircle2 className="size-3.5 text-emerald-400 shrink-0" />}
                  {isFailed && <XCircle className="size-3.5 text-red-400 shrink-0" />}
                  <span className="text-xs font-medium text-foreground truncate">
                    {isFailed
                      ? `Falhou: ${job.error_message || "erro desconhecido"}`
                      : isDone
                      ? `${job.result_count} resultado(s) encontrado(s)`
                      : (job.results?.length ?? 0) > 0
                      ? `${job.results.length} encontrado(s) até agora...`
                      : paused ? "Pausado" : "Buscando..."}
                  </span>
                </div>
                {(isRunning || paused) && (
                  <button
                    onClick={handlePauseResume}
                    className="text-[10px] font-semibold shrink-0 px-2 py-0.5 rounded border border-border hover:bg-muted transition-colors"
                  >
                    {paused ? "Retomar" : "Pausar"}
                  </button>
                )}
              </div>

              {(job.results?.length ?? 0) > 0 && (
                <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                  {job.results.slice(0, 10).map((r, i) => (
                    <div key={i} className="text-xs text-foreground/80 flex items-start gap-1.5 py-0.5 border-b border-border/30 last:border-0">
                      <span className="text-muted-foreground shrink-0 tabular-nums w-4">{i + 1}.</span>
                      <div className="min-w-0">
                        <p className="font-medium truncate">{r.title}</p>
                        <p className="text-muted-foreground truncate text-[10px]">{[r.phone, r.address].filter(Boolean).join(" · ")}</p>
                      </div>
                    </div>
                  ))}
                  {(job.results?.length ?? 0) > 10 && (
                    <p className="text-[10px] text-muted-foreground text-center pt-1">... e mais {job.results.length - 10} resultado(s)</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-border shrink-0">
          <Button variant="ghost" size="sm" onClick={onClose}>Fechar</Button>
          {isFailed && (
            <Button size="sm" variant="outline" onClick={() => void handleRetry()} disabled={loading} className="gap-1.5">
              {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              Tentar novamente
            </Button>
          )}
          {!isDone && !paused && !isFailed && (
            <Button size="sm" onClick={() => void handleStart()} disabled={loading || isRunning || !query.trim()} className="gap-1.5">
              {loading || isRunning ? <Loader2 className="size-3.5 animate-spin" /> : <MapPin className="size-3.5" />}
              {isRunning ? "Buscando..." : "Iniciar busca"}
            </Button>
          )}
          {(isDone || paused) && job && (job.results?.length ?? 0) > 0 && (
            <Button size="sm" onClick={() => void handleImport()} disabled={importing} className="gap-1.5">
              {importing ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
              Importar {job.results.length} lead(s)
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export function CRMKanban() {
  const [view, setView] = useState<"kanban" | "channels">("kanban");
  const [pipeline, setPipeline] = useState<CRMPipeline | null>(null);
  const [leads, setLeads] = useState<CRMLead[]>([]);
  const [deals, setDeals] = useState<CRMDeal[]>([]);
  const [projects, setProjects] = useState<CRMProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<MainStage>("lead");
  const [selectedLead, setSelectedLead] = useState<CRMLead | null>(null);
  const [selectedDeal, setSelectedDeal] = useState<CRMDeal | null>(null);
  const [selectedProject, setSelectedProject] = useState<CRMProject | null>(null);
  const [addingToStage, setAddingToStage] = useState<CRMStage | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [showScraper, setShowScraper] = useState(false);
  const [search, setSearch] = useState("");
  const [palette, setPalette] = useState<KanbanPalette>(loadPalette);

  const savePalette = (next: KanbanPalette) => {
    setPalette(next);
    try { localStorage.setItem("crm_palette", JSON.stringify(next)); } catch {}
  };

  const tabMeta = useMemo(() => TAB_META.map(ms => ({
    ...ms,
    color: palette[ms.key as keyof KanbanPalette],
    ...(COLOR_CLASSES[palette[ms.key as keyof KanbanPalette]] ?? COLOR_CLASSES.indigo!),
  })), [palette]);

  const load = useCallback(async () => {
    try {
      let pipelines = await listCRMPipelines();
      if (pipelines.length === 0) {
        const seeded = await seedDefaultPipeline();
        pipelines = [seeded];
      }
      const p = pipelines.find(pp => pp.is_default) ?? pipelines[0]!;
      setPipeline(p);
      const [l, d, pr] = await Promise.all([
        listLeads({ pipeline: p.id }),
        listDeals({ pipeline: p.id }),
        listProjects({ pipeline: p.id }),
      ]);
      setLeads(l);
      setDeals(d);
      setProjects(pr);
    } catch {
      toast.error("Erro ao carregar CRM.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleDropLead = async (e: React.DragEvent, stageId: number) => {
    e.preventDefault();
    const id = Number(e.dataTransfer.getData("leadId"));
    if (!id) return;
    try {
      const updated = await moveLead(id, stageId);
      setLeads(prev => prev.map(l => l.id === id ? updated : l));
      if (selectedLead?.id === id) setSelectedLead(updated);
    } catch { toast.error("Erro ao mover lead."); }
  };

  const handleDropDeal = async (e: React.DragEvent, stageId: number) => {
    e.preventDefault();
    const id = Number(e.dataTransfer.getData("dealId"));
    if (!id) return;
    try {
      const updated = await moveDeal(id, stageId);
      setDeals(prev => prev.map(d => d.id === id ? updated : d));
      if (selectedDeal?.id === id) setSelectedDeal(updated);
    } catch { toast.error("Erro ao mover deal."); }
  };

  const handleDropProject = async (e: React.DragEvent, stageId: number) => {
    e.preventDefault();
    const id = Number(e.dataTransfer.getData("projectId"));
    if (!id) return;
    try {
      const updated = await moveProject(id, stageId);
      setProjects(prev => prev.map(p => p.id === id ? updated : p));
      if (selectedProject?.id === id) setSelectedProject(updated);
    } catch { toast.error("Erro ao mover projeto."); }
  };

  const activeStages = (pipeline?.stages ?? [])
    .filter(s => s.main_stage === activeTab)
    .sort((a, b) => a.position - b.position);

  const q = search.toLowerCase();
  const filteredLeads = q ? leads.filter(l => l.nome.toLowerCase().includes(q) || l.empresa?.toLowerCase().includes(q)) : leads;
  const filteredDeals = q ? deals.filter(d => d.titulo.toLowerCase().includes(q) || d.empresa?.toLowerCase().includes(q)) : deals;
  const filteredProjects = q ? projects.filter(p => p.titulo.toLowerCase().includes(q) || p.empresa?.toLowerCase().includes(q)) : projects;

  const wonValue = deals.filter(d => d.stage_is_won).reduce((s, d) => s + (d.valor ? Number(d.valor) : 0), 0);

  const addLabel = activeTab === "lead" ? "Lead" : activeTab === "deal" ? "Deal" : "Projeto";

  if (loading) return <div className="text-center py-16 text-sm text-muted-foreground">Carregando CRM...</div>;

  return (
    <div className="flex flex-col h-full gap-0 overflow-hidden">
      {/* View switcher */}
      <div className="flex items-center gap-1 pb-3 shrink-0 border-b border-border mb-3">
        <button
          onClick={() => setView("kanban")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${view === "kanban" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
        >
          Pipeline
        </button>
        <button
          onClick={() => setView("channels")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${view === "channels" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
        >
          <Radio className="size-3.5" />
          Canais
        </button>
      </div>

      {view === "channels" && (
        <div className="flex-1 overflow-y-auto">
          <CRMChannels />
        </div>
      )}

      {view === "kanban" && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Top bar */}
          <div className="flex items-center justify-between px-1 pb-4 gap-3 shrink-0 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              {tabMeta.map(ms => {
                const count = ms.key === "lead" ? leads.length : ms.key === "deal" ? deals.length : projects.length;
                return (
                  <button
                    key={ms.key}
                    onClick={() => setActiveTab(ms.key)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all border ${activeTab === ms.key ? `${ms.bg} ${ms.text} ${ms.border}` : "text-muted-foreground border-transparent hover:bg-muted/40"}`}
                  >
                    {ms.label}
                    <span className="text-xs opacity-70">({count})</span>
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-2">
              {wonValue > 0 && (
                <span className="text-xs text-muted-foreground hidden sm:block">
                  Ganho: <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{fmtCurrency(String(wonValue))}</span>
                </span>
              )}
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={`Buscar ${activeTab === "lead" ? "lead" : activeTab === "deal" ? "deal" : "projeto"}...`}
                className="bg-background w-40 h-8 text-sm"
              />
              <div className="relative">
                <Button
                  variant="outline" size="sm"
                  onClick={() => setShowPalette(v => !v)}
                  className={`gap-1.5 h-8 ${showPalette ? "bg-muted" : ""}`}
                  title="Paleta de cores"
                >
                  <Palette className="size-3.5" />
                  <span className="hidden sm:inline">Cores</span>
                </Button>
                {showPalette && (
                  <PalettePopover
                    palette={palette}
                    onChange={savePalette}
                    onClose={() => setShowPalette(false)}
                  />
                )}
              </div>
              <Button variant="outline" size="sm" onClick={() => setShowScraper(true)} className="gap-1.5 h-8" title="Google Maps Scraper">
                <MapPin className="size-3.5" />
                <span className="hidden sm:inline">Scraper</span>
              </Button>
              <Button variant="outline" size="sm" onClick={() => pipeline && setShowConfig(true)} className="gap-1.5 h-8">
                <Settings className="size-3.5" />
                <span className="hidden sm:inline">Etapas</span>
              </Button>
              <Button size="sm" onClick={() => setAddingToStage(activeStages[0] ?? null)} className="gap-1.5 h-8">
                <Plus className="size-3.5" />
                {addLabel}
              </Button>
            </div>
          </div>

          {/* Board */}
          <div className="flex-1 overflow-x-auto pb-4">
            <div className="flex gap-3 h-full min-h-0" style={{ minWidth: `${activeStages.length * 250}px` }}>

              {activeTab === "lead" && activeStages.map((stage, idx) => {
                const stageLeads = filteredLeads.filter(l => l.stage === stage.id || (!l.stage && idx === 0));
                const totalValue = stageLeads.reduce((s, l) => s + (l.valor_estimado ? Number(l.valor_estimado) : 0), 0);
                return (
                  <KanbanColumn
                    key={stage.id}
                    stage={stage}
                    count={stageLeads.length}
                    totalValue={totalValue}
                    onDrop={handleDropLead}
                    onDragOver={e => e.preventDefault()}
                    onAdd={setAddingToStage}
                  >
                    {stageLeads.map(lead => (
                      <LeadCard
                        key={lead.id}
                        lead={lead}
                        accentColor={palette.lead}
                        onDragStart={e => e.dataTransfer.setData("leadId", String(lead.id))}
                        onClick={() => setSelectedLead(lead)}
                      />
                    ))}
                  </KanbanColumn>
                );
              })}

              {activeTab === "deal" && activeStages.map((stage, idx) => {
                const stageDeals = filteredDeals.filter(d => d.stage === stage.id || (!d.stage && idx === 0));
                const totalValue = stageDeals.reduce((s, d) => s + (d.valor ? Number(d.valor) : 0), 0);
                return (
                  <KanbanColumn
                    key={stage.id}
                    stage={stage}
                    count={stageDeals.length}
                    totalValue={totalValue}
                    onDrop={handleDropDeal}
                    onDragOver={e => e.preventDefault()}
                    onAdd={setAddingToStage}
                  >
                    {stageDeals.map(deal => (
                      <DealCard
                        key={deal.id}
                        deal={deal}
                        onDragStart={e => e.dataTransfer.setData("dealId", String(deal.id))}
                        onClick={() => setSelectedDeal(deal)}
                      />
                    ))}
                  </KanbanColumn>
                );
              })}

              {activeTab === "project" && activeStages.map((stage, idx) => {
                const stageProjects = filteredProjects.filter(p => p.stage === stage.id || (!p.stage && idx === 0));
                return (
                  <KanbanColumn
                    key={stage.id}
                    stage={stage}
                    count={stageProjects.length}
                    onDrop={handleDropProject}
                    onDragOver={e => e.preventDefault()}
                    onAdd={setAddingToStage}
                  >
                    {stageProjects.map(project => (
                      <ProjectCard
                        key={project.id}
                        project={project}
                        onDragStart={e => e.dataTransfer.setData("projectId", String(project.id))}
                        onClick={() => setSelectedProject(project)}
                      />
                    ))}
                  </KanbanColumn>
                );
              })}

              {activeStages.length === 0 && (
                <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
                  Nenhuma etapa configurada para {TAB_META.find(m => m.key === activeTab)?.label}.
                  <button onClick={() => pipeline && setShowConfig(true)} className="ml-2 text-primary hover:underline">Configurar</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Detail Modals */}
      {selectedLead && (
        <LeadDetailModal
          lead={selectedLead}
          onClose={() => setSelectedLead(null)}
          onUpdated={updated => setLeads(prev => prev.map(l => l.id === updated.id ? updated : l))}
          onDeleted={id => { setLeads(prev => prev.filter(l => l.id !== id)); setSelectedLead(null); }}
          onConverted={deal => { setDeals(prev => [deal, ...prev]); setActiveTab("deal"); }}
        />
      )}

      {selectedDeal && (
        <DealDetailModal
          deal={selectedDeal}
          onClose={() => setSelectedDeal(null)}
          onUpdated={updated => setDeals(prev => prev.map(d => d.id === updated.id ? updated : d))}
          onDeleted={id => { setDeals(prev => prev.filter(d => d.id !== id)); setSelectedDeal(null); }}
          onConverted={project => { setProjects(prev => [project, ...prev]); setActiveTab("project"); }}
        />
      )}

      {selectedProject && (
        <ProjectDetailModal
          project={selectedProject}
          onClose={() => setSelectedProject(null)}
          onUpdated={updated => setProjects(prev => prev.map(p => p.id === updated.id ? updated : p))}
          onDeleted={id => { setProjects(prev => prev.filter(p => p.id !== id)); setSelectedProject(null); }}
        />
      )}

      {/* Add Dialogs */}
      {addingToStage && pipeline && activeTab === "lead" && (
        <LeadFormDialog
          defaultStage={addingToStage}
          pipelineId={pipeline.id}
          onClose={() => setAddingToStage(null)}
          onSaved={lead => { setLeads(prev => [lead, ...prev]); setAddingToStage(null); }}
        />
      )}

      {addingToStage && pipeline && activeTab === "deal" && (
        <DealFormDialog
          defaultStage={addingToStage}
          pipelineId={pipeline.id}
          onClose={() => setAddingToStage(null)}
          onSaved={deal => { setDeals(prev => [deal, ...prev]); setAddingToStage(null); }}
        />
      )}

      {addingToStage && pipeline && activeTab === "project" && (
        <ProjectFormDialog
          defaultStage={addingToStage}
          pipelineId={pipeline.id}
          onClose={() => setAddingToStage(null)}
          onSaved={project => { setProjects(prev => [project, ...prev]); setAddingToStage(null); }}
        />
      )}

      {showConfig && pipeline && (
        <StageConfigDialog
          pipeline={pipeline}
          onClose={() => setShowConfig(false)}
          onSaved={() => void load()}
        />
      )}

      {showScraper && (
        <ScraperModal
          pipelineId={pipeline?.id}
          onClose={() => setShowScraper(false)}
          onImported={() => void load()}
        />
      )}
    </div>
  );
}

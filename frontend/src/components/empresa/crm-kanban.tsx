import { useState, useEffect, useCallback, useRef } from "react";
import {
  Plus, X, Send, User,
  Mail, Phone, DollarSign, Briefcase, MessageSquare,
  CheckCircle2, XCircle, Settings, Pencil, Trash2, Bot,
  ArrowRight, Loader2, Radio, MessageCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  CRMPipeline, CRMStage, CRMLead, LeadMessage, MainStage, LeadOutcome,
  listCRMPipelines, seedDefaultPipeline, listLeads, createLead,
  updateLead, deleteLead, moveLead, getLeadMessages, qualifyLead,
  createStage, deleteStage, setLeadOutcome,
} from "@/lib/api";
import { CRMChannels } from "@/components/empresa/crm-channels";
import { toast } from "sonner";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MAIN_STAGES: { key: MainStage; label: string; color: string; bgClass: string }[] = [
  { key: "lead",    label: "Lead",    color: "#6366f1", bgClass: "bg-indigo-500/15 text-indigo-400 border-indigo-500/30" },
  { key: "deal",    label: "Deals",   color: "#f59e0b", bgClass: "bg-amber-500/15  text-amber-400  border-amber-500/30"  },
  { key: "project", label: "Project", color: "#10b981", bgClass: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
];

const COLOR_MAP: Record<string, string> = {
  blue: "#6366f1", indigo: "#818cf8", violet: "#a78bfa",
  amber: "#f59e0b", orange: "#f97316", yellow: "#eab308", red: "#ef4444",
  green: "#10b981", emerald: "#34d399", cyan: "#06b6d4", teal: "#14b8a6", sky: "#0ea5e9",
};

function colorDot(color: string) {
  return <span className="inline-block size-2 rounded-full" style={{ backgroundColor: COLOR_MAP[color] ?? "#94a3b8" }} />;
}

function fmtValue(v: string | null) {
  if (!v) return null;
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0 }).format(Number(v));
}

function initials(name: string) {
  return name.split(" ").slice(0, 2).map(w => w[0]).join("").toUpperCase();
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "Hoje";
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Ontem";
  return d.toLocaleDateString("pt-BR");
}

// ─── Lead Card ────────────────────────────────────────────────────────────────

function LeadCard({
  lead, onDragStart, onClick,
}: {
  lead: CRMLead;
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
        <div className="flex items-center gap-2 min-w-0">
          <span className="shrink-0 grid size-7 place-items-center rounded-full bg-muted text-[11px] font-semibold text-foreground/70">
            {initials(lead.nome)}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground truncate leading-tight">{lead.nome}</p>
            {lead.empresa && <p className="text-[11px] text-muted-foreground truncate">{lead.empresa}</p>}
          </div>
        </div>
        {lead.stage_is_won && <CheckCircle2 className="size-3.5 text-emerald-400 shrink-0" />}
        {lead.stage_is_lost && <XCircle className="size-3.5 text-red-400 shrink-0" />}
      </div>

      <div className="mt-2 flex items-center justify-between">
        {lead.valor_estimado ? (
          <span className="text-xs font-semibold text-emerald-400">{fmtValue(lead.valor_estimado)}</span>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2 text-muted-foreground">
          {lead.messages_count > 0 && (
            <span className="flex items-center gap-0.5 text-[10px]">
              <MessageSquare className="size-3" />{lead.messages_count}
            </span>
          )}
          {lead.outcome && (
            <Badge className="text-[9px] h-4 px-1.5" variant="outline">
              {lead.outcome === "vendido" ? "Vendido" :
               lead.outcome === "concluido" ? "Concluído" :
               lead.outcome === "perdido" ? "Perdido" :
               lead.outcome === "contrato_assinado" ? "Contrato" : "Cancelado"}
            </Badge>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Kanban Column ────────────────────────────────────────────────────────────

function KanbanColumn({
  stage, leads, onDrop, onDragOver, onLeadClick, onAddLead,
}: {
  stage: CRMStage;
  leads: CRMLead[];
  onDrop: (e: React.DragEvent, stageId: number) => void;
  onDragOver: (e: React.DragEvent) => void;
  onLeadClick: (lead: CRMLead) => void;
  onAddLead: (stage: CRMStage) => void;
}) {
  const [over, setOver] = useState(false);
  const totalValue = leads.reduce((s, l) => s + (l.valor_estimado ? Number(l.valor_estimado) : 0), 0);

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
          <span className="text-[10px] text-muted-foreground shrink-0">({leads.length})</span>
        </div>
        <button
          onClick={() => onAddLead(stage)}
          className="grid size-5 place-items-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
        >
          <Plus className="size-3" />
        </button>
      </div>

      {totalValue > 0 && (
        <div className="px-3 py-1 border-b border-border/50">
          <span className="text-[10px] font-semibold text-emerald-400">{fmtValue(String(totalValue))}</span>
        </div>
      )}

      <div className="flex-1 p-2 space-y-2 overflow-y-auto min-h-[120px]">
        {leads.map(lead => (
          <LeadCard
            key={lead.id}
            lead={lead}
            onDragStart={(e) => e.dataTransfer.setData("leadId", String(lead.id))}
            onClick={() => onLeadClick(lead)}
          />
        ))}
        {leads.length === 0 && (
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
      const saved = initial
        ? await updateLead(initial.id, payload)
        : await createLead(payload);
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
          {[
            { key: "nome", label: "Nome *", placeholder: "João Silva" },
            { key: "empresa", label: "Empresa", placeholder: "Acme Ltda" },
            { key: "email", label: "E-mail", placeholder: "joao@acme.com" },
            { key: "telefone", label: "Telefone", placeholder: "(11) 99999-9999" },
            { key: "cargo", label: "Cargo", placeholder: "Diretor Comercial" },
            { key: "valor_estimado", label: "Valor estimado (R$)", placeholder: "50000" },
            { key: "responsavel", label: "Responsável", placeholder: "Maria (SDR)" },
          ].map(f => (
            <div key={f.key} className="space-y-1">
              <label className="text-xs text-muted-foreground uppercase tracking-wide font-medium">{f.label}</label>
              <Input value={(form as Record<string, string>)[f.key]} onChange={e => set(f.key, e.target.value)} placeholder={f.placeholder} className="bg-background" />
            </div>
          ))}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Origem</label>
            <select
              value={form.origem}
              onChange={e => set("origem", e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {ORIGEM_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Observações</label>
            <textarea
              value={form.observacoes}
              onChange={e => set("observacoes", e.target.value)}
              rows={3}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
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

// ─── WhatsApp Conversation Tab ────────────────────────────────────────────────

function ConversationTab({ lead }: { lead: CRMLead }) {
  const [messages, setMessages] = useState<LeadMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setMessages(await getLeadMessages(lead.id)); }
    catch { /* ignore */ }
    finally { setLoading(false); }
  }, [lead.id]);

  useEffect(() => { void load(); }, [load]);
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
    } catch {
      toast.error("Erro ao enviar mensagem.");
    } finally {
      setSending(false);
    }
  };

  const visibleMessages = messages.filter(m => m.role !== "system");

  // Group messages by date
  const grouped: { date: string; msgs: LeadMessage[] }[] = [];
  for (const m of visibleMessages) {
    const d = fmtDate(m.created_at);
    const last = grouped[grouped.length - 1];
    if (last?.date === d) last.msgs.push(m);
    else grouped.push({ date: d, msgs: [m] });
  }

  if (loading) return <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">Carregando...</div>;

  return (
    <div className="flex flex-col flex-1 overflow-hidden" style={{ background: "hsl(var(--background))" }}>
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-1">
        {visibleMessages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 py-12">
            <MessageCircle className="size-10 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground text-center">Nenhuma mensagem ainda.</p>
            <p className="text-xs text-muted-foreground/60 text-center">
              Mensagens do WhatsApp/Telegram aparecem aqui automaticamente.
            </p>
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
                    <div className={`max-w-[75%] rounded-2xl px-3 py-2 ${
                      m.role === "user"
                        ? "bg-muted text-foreground rounded-tl-sm"
                        : "bg-primary text-primary-foreground rounded-tr-sm"
                    }`}>
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

      {/* Input */}
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
        <p className="text-[10px] text-muted-foreground mt-1.5">
          Simule uma mensagem do lead para o agente qualificar e responder.
        </p>
      </div>
    </div>
  );
}

// ─── Outcome Buttons ──────────────────────────────────────────────────────────

function OutcomeSection({
  lead, onUpdated,
}: {
  lead: CRMLead;
  onUpdated: (lead: CRMLead) => void;
}) {
  const [busy, setBusy] = useState(false);
  const main = lead.stage_main;

  const apply = async (outcome: LeadOutcome) => {
    setBusy(true);
    try {
      const updated = await setLeadOutcome(lead.id, outcome);
      onUpdated(updated);
      const moved = updated.stage_main !== main;
      if (moved) {
        toast.success(`Lead avançado para ${updated.stage_main === "deal" ? "Deals" : "Project"}!`);
      } else if (outcome === "perdido" || outcome === "cancelado") {
        toast.success("Desfecho registrado.");
      } else {
        toast.success("Desfecho salvo.");
      }
    } catch {
      toast.error("Erro ao definir desfecho.");
    } finally {
      setBusy(false);
    }
  };

  if (main === "lead") {
    return (
      <div className="px-5 py-4 border-t border-border">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Desfecho</p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm" variant="outline"
            className="gap-1.5 h-8 text-xs border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
            onClick={() => void apply("vendido")} disabled={busy || lead.outcome === "vendido"}
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
            Vendido → Deals
          </Button>
          <Button
            size="sm" variant="outline"
            className="gap-1.5 h-8 text-xs border-blue-500/40 text-blue-400 hover:bg-blue-500/10"
            onClick={() => void apply("concluido")} disabled={busy || lead.outcome === "concluido"}
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowRight className="size-3.5" />}
            Concluído → Deals
          </Button>
          <Button
            size="sm" variant="outline"
            className="gap-1.5 h-8 text-xs border-red-500/40 text-red-400 hover:bg-red-500/10"
            onClick={() => void apply("perdido")} disabled={busy || lead.outcome === "perdido"}
          >
            <XCircle className="size-3.5" /> Perdido
          </Button>
        </div>
        {lead.outcome && (
          <p className="text-[11px] text-muted-foreground mt-2">
            Desfecho atual: <span className="font-medium text-foreground capitalize">{lead.outcome.replace("_", " ")}</span>
          </p>
        )}
      </div>
    );
  }

  if (main === "deal") {
    return (
      <div className="px-5 py-4 border-t border-border">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Desfecho</p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm" variant="outline"
            className="gap-1.5 h-8 text-xs border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
            onClick={() => void apply("contrato_assinado")} disabled={busy || lead.outcome === "contrato_assinado"}
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
            Contrato Assinado → Project
          </Button>
          <Button
            size="sm" variant="outline"
            className="gap-1.5 h-8 text-xs border-blue-500/40 text-blue-400 hover:bg-blue-500/10"
            onClick={() => void apply("concluido")} disabled={busy || lead.outcome === "concluido"}
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowRight className="size-3.5" />}
            Concluído → Project
          </Button>
          <Button
            size="sm" variant="outline"
            className="gap-1.5 h-8 text-xs border-red-500/40 text-red-400 hover:bg-red-500/10"
            onClick={() => void apply("cancelado")} disabled={busy || lead.outcome === "cancelado"}
          >
            <XCircle className="size-3.5" /> Cancelado
          </Button>
        </div>
        {lead.outcome && (
          <p className="text-[11px] text-muted-foreground mt-2">
            Desfecho atual: <span className="font-medium text-foreground capitalize">{lead.outcome.replace("_", " ")}</span>
          </p>
        )}
      </div>
    );
  }

  return null;
}

// ─── Lead Detail Modal ────────────────────────────────────────────────────────

function LeadDetailModal({
  lead, stages, onClose, onUpdated, onDeleted,
}: {
  lead: CRMLead;
  stages: CRMStage[];
  onClose: () => void;
  onUpdated: (lead: CRMLead) => void;
  onDeleted: (id: number) => void;
}) {
  const [tab, setTab] = useState<"info" | "conversa" | "agente">("conversa");
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [localLead, setLocalLead] = useState(lead);

  useEffect(() => { setLocalLead(lead); setConfirmDelete(false); }, [lead]);

  const handleDeleteClick = () => setConfirmDelete(true);

  const handleDeleteConfirm = async () => {
    setDeleting(true);
    try {
      await deleteLead(localLead.id);
      toast.success(`${localLead.stage_main === "deal" ? "Deal" : localLead.stage_main === "project" ? "Project" : "Lead"} "${localLead.nome}" excluído.`);
      onDeleted(localLead.id);
      onClose();
    } catch {
      toast.error("Erro ao excluir.");
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const handleUpdated = (updated: CRMLead) => {
    setLocalLead(updated);
    onUpdated(updated);
  };

  const mainLabel = localLead.stage_main === "deal" ? "Deal" : localLead.stage_main === "project" ? "Project" : "Lead";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-card border border-border rounded-xl w-full max-w-2xl shadow-2xl flex flex-col" style={{ maxHeight: "90vh" }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <span className="grid size-10 place-items-center rounded-full bg-muted text-sm font-bold text-foreground/70 shrink-0">
              {initials(localLead.nome)}
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-base font-semibold text-foreground truncate">{localLead.nome}</p>
                <Badge variant="outline" className="text-[10px] h-5 shrink-0">{mainLabel}</Badge>
                {localLead.stage_name && (
                  <Badge variant="outline" className="text-[10px] h-5 gap-1 shrink-0">
                    {colorDot(localLead.stage_color ?? "blue")}
                    {localLead.stage_name}
                  </Badge>
                )}
              </div>
              {localLead.empresa && <p className="text-sm text-muted-foreground truncate">{localLead.empresa}</p>}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0 ml-2">
            {localLead.valor_estimado && (
              <span className="text-sm font-semibold text-emerald-400 mr-2">{fmtValue(localLead.valor_estimado)}</span>
            )}
            {!confirmDelete ? (
              <>
                <button onClick={() => setEditing(true)} className="grid size-7 place-items-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors" title="Editar">
                  <Pencil className="size-3.5" />
                </button>
                <button onClick={handleDeleteClick} className="grid size-7 place-items-center rounded text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors" title="Excluir">
                  <Trash2 className="size-3.5" />
                </button>
              </>
            ) : (
              <div className="flex items-center gap-1.5 mr-1">
                <span className="text-xs text-muted-foreground">Excluir?</span>
                <Button
                  size="sm" variant="destructive"
                  className="h-6 px-2 text-xs gap-1"
                  onClick={handleDeleteConfirm}
                  disabled={deleting}
                >
                  {deleting ? <Loader2 className="size-3 animate-spin" /> : null}
                  Sim
                </Button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="grid size-6 place-items-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors text-xs"
                >
                  Não
                </button>
              </div>
            )}
            <button onClick={onClose} className="grid size-7 place-items-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors" title="Fechar">
              <X className="size-4" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border shrink-0">
          {([
            { key: "conversa", label: "Conversa", icon: <MessageCircle className="size-3.5" /> },
            { key: "info",     label: "Informações", icon: <User className="size-3.5" /> },
            { key: "agente",   label: "Agente", icon: <Bot className="size-3.5" /> },
          ] as const).map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors ${
                tab === t.key
                  ? "text-foreground border-b-2 border-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.icon}{t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {tab === "conversa" && <ConversationTab lead={localLead} />}

          {tab === "info" && (
            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { icon: <Mail className="size-4" />, label: "E-mail", value: localLead.email },
                  { icon: <Phone className="size-4" />, label: "Telefone", value: localLead.telefone },
                  { icon: <Briefcase className="size-4" />, label: "Cargo", value: localLead.cargo },
                  { icon: <User className="size-4" />, label: "Responsável", value: localLead.responsavel },
                  { icon: <DollarSign className="size-4" />, label: "Valor estimado", value: localLead.valor_estimado ? fmtValue(localLead.valor_estimado) : null },
                  { icon: <MessageSquare className="size-4" />, label: "Origem", value: localLead.origem },
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

              {localLead.observacoes && (
                <div className="p-3 rounded-lg bg-muted/30">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium mb-1">Observações</p>
                  <p className="text-sm text-foreground/80 leading-relaxed">{localLead.observacoes}</p>
                </div>
              )}

              <p className="text-[11px] text-muted-foreground">
                Criado em {new Date(localLead.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })}
              </p>
            </div>
          )}

          {tab === "agente" && (
            <AgentTab lead={localLead} stages={stages} onUpdated={handleUpdated} />
          )}
        </div>

        {/* Outcome section — only for lead/deal stages */}
        {(localLead.stage_main === "lead" || localLead.stage_main === "deal") && (
          <OutcomeSection lead={localLead} onUpdated={handleUpdated} />
        )}
      </div>

      {editing && (
        <LeadFormDialog
          initial={localLead}
          onClose={() => setEditing(false)}
          onSaved={updated => { handleUpdated(updated); setEditing(false); }}
        />
      )}
    </div>
  );
}

// ─── Agent Tab (AI agent chat) ────────────────────────────────────────────────

function AgentTab({
  lead, stages, onUpdated,
}: {
  lead: CRMLead;
  stages: CRMStage[];
  onUpdated: (lead: CRMLead) => void;
}) {
  const [messages, setMessages] = useState<LeadMessage[]>([]);
  const [input, setInput] = useState("");
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [closingSuggested, setClosingSuggested] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoadingMessages(true);
    void getLeadMessages(lead.id)
      .then(setMessages)
      .catch(() => { /* ignore */ })
      .finally(() => setLoadingMessages(false));
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

  const handleMoveToDeals = async () => {
    const dealStage = stages.find(s => s.main_stage === "deal" && !s.is_lost);
    if (!dealStage) { toast.error("Nenhuma etapa de Deal configurada."); return; }
    try {
      const updated = await moveLead(lead.id, dealStage.id);
      onUpdated(updated);
      toast.success(`Lead movido para ${dealStage.name}.`);
      setClosingSuggested(false);
    } catch { toast.error("Erro ao mover lead."); }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {closingSuggested && (
        <div className="mx-4 mt-3 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-start gap-2 shrink-0">
          <CheckCircle2 className="size-4 text-emerald-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-emerald-400">Pronto para avançar!</p>
            <p className="text-[11px] text-emerald-400/80 mt-0.5">O agente detectou interesse. Mova para Deals?</p>
          </div>
          <Button size="sm" onClick={handleMoveToDeals} className="shrink-0 h-7 text-xs gap-1 bg-emerald-600 hover:bg-emerald-500">
            <ArrowRight className="size-3" /> Deals
          </Button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {loadingMessages ? (
          <div className="text-center py-6 text-xs text-muted-foreground">Carregando...</div>
        ) : messages.filter(m => m.role !== "system").length === 0 ? (
          <div className="text-center py-8 space-y-2">
            <Bot className="size-8 text-muted-foreground/40 mx-auto" />
            <p className="text-xs text-muted-foreground">Inicie a conversa com o agente comercial.</p>
            <p className="text-[11px] text-muted-foreground/60">Ele vai responder dúvidas do lead e qualificar o interesse.</p>
          </div>
        ) : (
          messages.filter(m => m.role !== "system").map(m => (
            <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              {m.role === "agent" && (
                <span className="grid size-6 place-items-center rounded-full bg-primary/20 text-primary shrink-0 mr-2 mt-0.5">
                  <Bot className="size-3.5" />
                </span>
              )}
              <div className={`max-w-[80%] rounded-xl px-3 py-2 text-xs leading-relaxed ${
                m.role === "user"
                  ? "bg-primary text-primary-foreground rounded-br-sm"
                  : "bg-muted text-foreground rounded-bl-sm"
              }`}>
                {m.content}
              </div>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>

      <div className="p-3 border-t border-border shrink-0">
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && !e.shiftKey && void handleSend()}
            placeholder="Mensagem do lead..."
            className="bg-background text-sm"
            disabled={sending}
          />
          <Button size="sm" onClick={handleSend} disabled={sending || !input.trim()} className="shrink-0">
            {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1">Simule a mensagem do lead para que o agente responda</p>
      </div>
    </div>
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-card border border-border rounded-xl w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="font-semibold text-foreground">Configurar Etapas — {pipeline.name}</h3>
          <button onClick={() => { onSaved(); onClose(); }} className="text-muted-foreground hover:text-foreground"><X className="size-4" /></button>
        </div>
        <div className="px-5 py-4 space-y-4 max-h-[65vh] overflow-y-auto">
          {MAIN_STAGES.map(ms => (
            <div key={ms.key}>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{ms.label}</p>
              <div className="space-y-1">
                {stages.filter(s => s.main_stage === ms.key).sort((a, b) => a.position - b.position).map(s => (
                  <div key={s.id} className="flex items-center gap-2 group">
                    {colorDot(s.color)}
                    <span className="flex-1 text-sm text-foreground">{s.name}</span>
                    {s.is_won && <Badge className="text-[10px] h-4 bg-emerald-500/15 text-emerald-400 border-emerald-500/30">Ganho</Badge>}
                    {s.is_lost && <Badge className="text-[10px] h-4 bg-red-500/15 text-red-400 border-red-500/30">Perdido</Badge>}
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
              <select
                value={newMain}
                onChange={e => setNewMain(e.target.value as MainStage)}
                className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              >
                {MAIN_STAGES.map(ms => <option key={ms.key} value={ms.key}>{ms.label}</option>)}
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

// ─── Main Export ──────────────────────────────────────────────────────────────

export function CRMKanban() {
  const [view, setView] = useState<"kanban" | "channels">("kanban");
  const [pipeline, setPipeline] = useState<CRMPipeline | null>(null);
  const [leads, setLeads] = useState<CRMLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeMain, setActiveMain] = useState<MainStage>("lead");
  const [selectedLead, setSelectedLead] = useState<CRMLead | null>(null);
  const [addingToStage, setAddingToStage] = useState<CRMStage | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    try {
      let pipelines = await listCRMPipelines();
      if (pipelines.length === 0) {
        const seeded = await seedDefaultPipeline();
        pipelines = [seeded];
      }
      const p = pipelines.find(p => p.is_default) ?? pipelines[0]!;
      setPipeline(p);
      setLeads(await listLeads({ pipeline: p.id }));
    } catch {
      toast.error("Erro ao carregar CRM.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleDrop = async (e: React.DragEvent, stageId: number) => {
    e.preventDefault();
    const leadId = Number(e.dataTransfer.getData("leadId"));
    if (!leadId) return;
    try {
      const updated = await moveLead(leadId, stageId);
      setLeads(prev => prev.map(l => l.id === leadId ? updated : l));
      if (selectedLead?.id === leadId) setSelectedLead(updated);
    } catch { toast.error("Erro ao mover lead."); }
  };

  const handleLeadUpdated = (updated: CRMLead) => {
    setLeads(prev => prev.map(l => l.id === updated.id ? updated : l));
    // If lead moved to another main stage (e.g. lead → deal), keep it visible
    if (selectedLead?.id === updated.id) setSelectedLead(updated);
  };

  const activeStages = (pipeline?.stages ?? [])
    .filter(s => s.main_stage === activeMain)
    .sort((a, b) => a.position - b.position);

  const filteredLeads = leads.filter(l =>
    !search || l.nome.toLowerCase().includes(search.toLowerCase()) || l.empresa?.toLowerCase().includes(search.toLowerCase())
  );

  const totalValue = leads
    .filter(l => l.stage_main === "deal" && l.stage_is_won)
    .reduce((s, l) => s + (l.valor_estimado ? Number(l.valor_estimado) : 0), 0);

  if (loading) return <div className="text-center py-16 text-sm text-muted-foreground">Carregando CRM...</div>;

  return (
    <div className="flex flex-col h-full gap-0 overflow-hidden">
      {/* View switcher */}
      <div className="flex items-center gap-1 pb-3 shrink-0 border-b border-border mb-3">
        <button
          onClick={() => setView("kanban")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
            view === "kanban" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
          }`}
        >
          Pipeline
        </button>
        <button
          onClick={() => setView("channels")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
            view === "channels" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
          }`}
        >
          <Radio className="size-3.5" />
          Canais
        </button>
      </div>

      {/* Canais view */}
      {view === "channels" && (
        <div className="flex-1 overflow-y-auto">
          <CRMChannels />
        </div>
      )}

      {/* Kanban view */}
      {view === "kanban" && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Top bar */}
          <div className="flex items-center justify-between px-1 pb-4 gap-3 shrink-0 flex-wrap">
            <div className="flex items-center gap-3 flex-wrap">
              {MAIN_STAGES.map(ms => {
                const count = leads.filter(l => l.stage_main === ms.key).length;
                return (
                  <button
                    key={ms.key}
                    onClick={() => setActiveMain(ms.key)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all border ${
                      activeMain === ms.key
                        ? `${ms.bgClass} border-current`
                        : "text-muted-foreground border-transparent hover:bg-muted/40"
                    }`}
                  >
                    {ms.label}
                    <span className="text-xs opacity-70">({count})</span>
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-2">
              {totalValue > 0 && (
                <span className="text-xs text-muted-foreground hidden sm:block">
                  Ganho: <span className="text-emerald-400 font-semibold">{fmtValue(String(totalValue))}</span>
                </span>
              )}
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar lead..."
                className="bg-background w-40 h-8 text-sm"
              />
              <Button variant="outline" size="sm" onClick={() => pipeline && setShowConfig(true)} className="gap-1.5 h-8">
                <Settings className="size-3.5" />
                <span className="hidden sm:inline">Etapas</span>
              </Button>
              <Button size="sm" onClick={() => setAddingToStage(activeStages[0] ?? null)} className="gap-1.5 h-8">
                <Plus className="size-3.5" />
                Lead
              </Button>
            </div>
          </div>

          {/* Board */}
          <div className="flex-1 overflow-x-auto pb-4">
            <div className="flex gap-3 h-full min-h-0" style={{ minWidth: `${activeStages.length * 250}px` }}>
              {activeStages.map(stage => (
                <KanbanColumn
                  key={stage.id}
                  stage={stage}
                  leads={filteredLeads.filter(l => l.stage === stage.id)}
                  onDrop={handleDrop}
                  onDragOver={e => e.preventDefault()}
                  onLeadClick={l => setSelectedLead(l)}
                  onAddLead={s => setAddingToStage(s)}
                />
              ))}
              {activeStages.length === 0 && (
                <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
                  Nenhuma etapa configurada para {MAIN_STAGES.find(m => m.key === activeMain)?.label}.
                  <button onClick={() => pipeline && setShowConfig(true)} className="ml-2 text-primary hover:underline">Configurar</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Lead Detail Modal */}
      {selectedLead && (
        <LeadDetailModal
          lead={selectedLead}
          stages={pipeline?.stages ?? []}
          onClose={() => setSelectedLead(null)}
          onUpdated={handleLeadUpdated}
          onDeleted={id => {
            setLeads(prev => prev.filter(l => l.id !== id));
            setSelectedLead(null);
          }}
        />
      )}

      {/* Dialogs */}
      {addingToStage && pipeline && (
        <LeadFormDialog
          defaultStage={addingToStage}
          pipelineId={pipeline.id}
          onClose={() => setAddingToStage(null)}
          onSaved={lead => setLeads(prev => [lead, ...prev])}
        />
      )}

      {showConfig && pipeline && (
        <StageConfigDialog
          pipeline={pipeline}
          onClose={() => setShowConfig(false)}
          onSaved={() => void load()}
        />
      )}
    </div>
  );
}

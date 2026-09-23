// frontend/src/components/empresa/crm.tsx
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  DollarSign,
  Handshake,
  Mail,
  Phone,
  TrendingUp,
  Users,
  Video,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Metric, SectionHeader } from "@/components/empresa/shared";
import {
  type Lead,
  type LeadStatus,
  type LeadOrigem,
  type Oportunidade,
  type AtividadeCRM,
  listLeads,
  listOportunidades,
  listAtividadesCRM,
} from "@/lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────

type PipelineStage =
  | "prospeccao"
  | "qualificacao"
  | "proposta"
  | "negociacao"
  | "ganho"
  | "perdido";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtBRL(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(value);
}

function fmtBRLCompact(value: number): string {
  if (value >= 1_000_000)
    return `R$ ${(value / 1_000_000).toFixed(1).replace(".", ",")}M`;
  if (value >= 1_000)
    return `R$ ${(value / 1_000).toFixed(0)}k`;
  return fmtBRL(value);
}

// ── Stage Config ──────────────────────────────────────────────────────────────

interface StageConfig {
  id: PipelineStage;
  label: string;
  color: string;
  headerColor: string;
}

const STAGES: StageConfig[] = [
  { id: "prospeccao",   label: "Prospecção",     color: "bg-blue-500/10 border-blue-500/30",     headerColor: "bg-blue-500/20 text-blue-400" },
  { id: "qualificacao", label: "Qualificação",   color: "bg-violet-500/10 border-violet-500/30", headerColor: "bg-violet-500/20 text-violet-400" },
  { id: "proposta",     label: "Proposta",       color: "bg-amber-500/10 border-amber-500/30",   headerColor: "bg-amber-500/20 text-amber-400" },
  { id: "negociacao",   label: "Negociação",     color: "bg-orange-500/10 border-orange-500/30", headerColor: "bg-orange-500/20 text-orange-400" },
  { id: "ganho",        label: "Fechado Ganho",  color: "bg-success/10 border-success/30",       headerColor: "bg-success/20 text-success" },
  { id: "perdido",      label: "Fechado Perdido",color: "bg-destructive/10 border-destructive/30",headerColor: "bg-destructive/20 text-destructive" },
];

function stageBadgeVariant(stage: PipelineStage) {
  const map: Record<PipelineStage, string> = {
    prospeccao:   "bg-blue-500/15 text-blue-400 border-blue-500/30",
    qualificacao: "bg-violet-500/15 text-violet-400 border-violet-500/30",
    proposta:     "bg-amber-500/15 text-amber-400 border-amber-500/30",
    negociacao:   "bg-orange-500/15 text-orange-400 border-orange-500/30",
    ganho:        "bg-success/15 text-success border-success/30",
    perdido:      "bg-destructive/15 text-destructive border-destructive/30",
  };
  return map[stage];
}

// ── Lead Status & Origin Badges ───────────────────────────────────────────────

function LeadStatusBadge({ status }: { status: LeadStatus }) {
  const label: Record<LeadStatus, string> = {
    novo:        "Novo",
    contato:     "Contatado",
    qualificado: "Qualificado",
    proposta:    "Proposta",
    negociacao:  "Negociação",
    ganho:       "Ganho",
    perdido:     "Perdido",
  };
  const styles: Record<LeadStatus, string> = {
    novo:        "bg-blue-500/15 text-blue-400 border-blue-500/30",
    contato:     "bg-amber-500/15 text-amber-400 border-amber-500/30",
    qualificado: "bg-success/15 text-success border-success/30",
    proposta:    "bg-violet-500/15 text-violet-400 border-violet-500/30",
    negociacao:  "bg-orange-500/15 text-orange-400 border-orange-500/30",
    ganho:       "bg-success/15 text-success border-success/30",
    perdido:     "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
  };
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium ${styles[status]}`}>
      {label[status]}
    </span>
  );
}

function OriginBadge({ origem }: { origem: LeadOrigem }) {
  const label: Record<LeadOrigem, string> = {
    site:          "Site",
    indicacao:     "Indicação",
    social:        "Social",
    evento:        "Evento",
    cold_outreach: "Cold Outreach",
    outro:         "Outro",
  };
  const styles: Record<LeadOrigem, string> = {
    site:          "bg-primary/10 text-primary border-primary/20",
    indicacao:     "bg-success/10 text-success border-success/20",
    social:        "bg-pink-500/10 text-pink-400 border-pink-500/20",
    evento:        "bg-amber-500/10 text-amber-400 border-amber-500/20",
    cold_outreach: "bg-violet-500/10 text-violet-400 border-violet-500/20",
    outro:         "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
  };
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium ${styles[origem]}`}>
      {label[origem]}
    </span>
  );
}

// ── Activity Icon ─────────────────────────────────────────────────────────────

function ActivityIcon({ tipo }: { tipo: AtividadeCRM["tipo"] }) {
  const base = "size-7 rounded-md flex items-center justify-center shrink-0";
  if (tipo === "ligacao")
    return <span className={`${base} bg-success/10 text-success`}><Phone className="size-3.5" /></span>;
  if (tipo === "email")
    return <span className={`${base} bg-primary/10 text-primary`}><Mail className="size-3.5" /></span>;
  return <span className={`${base} bg-violet-500/10 text-violet-400`}><Video className="size-3.5" /></span>;
}

// ── Deal Card ─────────────────────────────────────────────────────────────────

function DealCard({ deal }: { deal: Oportunidade }) {
  const value = parseFloat(deal.valor);
  return (
    <div className="panel rounded-md p-3 space-y-2 cursor-pointer hover:border-border/80 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold leading-tight line-clamp-1">{deal.lead_empresa}</p>
        <span className="text-xs font-mono font-bold tabular-nums text-foreground whitespace-nowrap">
          {fmtBRL(value)}
        </span>
      </div>
      <p className="text-[11px] text-muted-foreground leading-tight">{deal.lead_nome}</p>
      <div className="flex items-center justify-between gap-2">
        <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${stageBadgeVariant(deal.status)}`}>
          {STAGES.find((s) => s.id === deal.status)?.label}
        </span>
        {deal.data_fechamento_previsto && (
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <CalendarDays className="size-3" />
            {deal.data_fechamento_previsto}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Pipeline Column ───────────────────────────────────────────────────────────

function PipelineColumn({ stage, deals }: { stage: StageConfig; deals: Oportunidade[] }) {
  const total = deals.reduce((s, d) => s + parseFloat(d.valor), 0);
  return (
    <div className="flex flex-col gap-2 min-w-[200px] w-[200px] shrink-0">
      <div className={`rounded-md px-3 py-2 flex items-center justify-between gap-2 ${stage.headerColor}`}>
        <span className="text-[11px] font-semibold uppercase tracking-wide truncate">{stage.label}</span>
        <span className="text-[11px] font-mono font-bold tabular-nums shrink-0">
          {deals.length} · {fmtBRLCompact(total)}
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {deals.map((deal) => (
          <DealCard key={deal.id} deal={deal} />
        ))}
        {deals.length === 0 && (
          <div className="rounded-md border border-dashed border-border/50 p-3 text-center text-[11px] text-muted-foreground">
            Sem oportunidades
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Export ───────────────────────────────────────────────────────────────

export function CRMView({ onBack }: { onBack: () => void }) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [oportunidades, setOportunidades] = useState<Oportunidade[]>([]);
  const [atividades, setAtividades] = useState<AtividadeCRM[]>([]);
  const [leadFilter, setLeadFilter] = useState<string>("all");
  const [leadSearch, setLeadSearch] = useState("");

  useEffect(() => {
    listLeads().then(setLeads).catch(() => {});
    listOportunidades().then(setOportunidades).catch(() => {});
    listAtividadesCRM().then(setAtividades).catch(() => {});
  }, []);

  // ── KPI calculations ──────────────────────────────────────────────────────

  const totalLeads = leads.length;
  const openDeals = oportunidades.filter(
    (d) => d.status !== "ganho" && d.status !== "perdido"
  ).length;
  const wonDeals = oportunidades.filter((d) => d.status === "ganho").length;
  const closedDeals = oportunidades.filter(
    (d) => d.status === "ganho" || d.status === "perdido"
  ).length;
  const conversionRate =
    closedDeals > 0 ? Math.round((wonDeals / closedDeals) * 100) : 0;
  const pipeline = oportunidades
    .filter((d) => d.status !== "ganho" && d.status !== "perdido")
    .reduce((s, d) => s + parseFloat(d.valor), 0);

  // ── Filtered leads ────────────────────────────────────────────────────────

  const filteredLeads = leads.filter((l) => {
    const matchesStatus =
      leadFilter === "all" || l.status === leadFilter;
    const q = leadSearch.toLowerCase();
    const matchesSearch =
      !q ||
      l.nome.toLowerCase().includes(q) ||
      l.empresa.toLowerCase().includes(q);
    return matchesStatus && matchesSearch;
  });

  // ── Deals grouped by stage ────────────────────────────────────────────────

  const dealsByStage = (stage: PipelineStage) =>
    oportunidades.filter((d) => d.status === stage);

  return (
    <div className="flex flex-col gap-6">
      {/* ── Page Header ───────────────────────────────────────────────────── */}
      <div className="rounded-xl bg-gradient-to-r from-indigo-600/20 via-blue-600/10 to-transparent border border-indigo-500/20 px-5 py-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack} className="shrink-0 text-indigo-300 hover:text-indigo-100 hover:bg-indigo-500/20">
            <ArrowLeft className="size-4" />
          </Button>
          <div className="flex items-center gap-3 min-w-0">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-indigo-500/20 text-indigo-300">
              <Handshake className="size-5" />
            </span>
            <div>
              <h2 className="font-semibold text-lg font-display text-foreground">CRM & Comercial</h2>
              <p className="text-xs text-muted-foreground">Pipeline de vendas, leads e atividades do time comercial</p>
            </div>
          </div>
          <div className="ml-auto">
            <Button size="sm" className="gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white border-0">
              <ChevronRight className="size-3.5" />
              Nova oportunidade
            </Button>
          </div>
        </div>
      </div>

      {/* ── KPI Row ───────────────────────────────────────────────────────── */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Metric
          label="Total de Leads"
          value={String(totalLeads)}
          icon={<Users className="size-4" />}
        />
        <Metric
          label="Oportunidades Abertas"
          value={String(openDeals)}
          icon={<Building2 className="size-4" />}
        />
        <Metric
          label="Taxa de Conversão"
          value={`${conversionRate}%`}
          icon={<TrendingUp className="size-4" />}
          tone={conversionRate >= 40 ? "success" : conversionRate >= 20 ? "warning" : "default"}
        />
        <Metric
          label="Receita no Pipeline"
          value={fmtBRLCompact(pipeline)}
          icon={<DollarSign className="size-4" />}
          tone="success"
        />
      </div>

      {/* ── Pipeline Kanban ───────────────────────────────────────────────── */}
      <div>
        <SectionHeader title="Pipeline de Vendas" />
        <div
          className="mt-3 overflow-x-auto pb-3 -mx-1 px-1"
          style={{ scrollbarWidth: "thin" }}
        >
          <div className="flex gap-3 min-w-max">
            {STAGES.map((stage) => (
              <PipelineColumn
                key={stage.id}
                stage={stage}
                deals={dealsByStage(stage.id)}
              />
            ))}
          </div>
        </div>
      </div>

      {/* ── Leads + Atividades ────────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        {/* Leads recentes */}
        <div className="flex flex-col gap-3">
          <SectionHeader
            title="Leads Recentes"
            action={
              <div className="flex items-center gap-2">
                <Input
                  placeholder="Buscar lead…"
                  value={leadSearch}
                  onChange={(e) => setLeadSearch(e.target.value)}
                  className="h-8 w-36 text-xs"
                />
                <Select value={leadFilter} onValueChange={setLeadFilter}>
                  <SelectTrigger className="h-8 w-36 text-xs">
                    <SelectValue placeholder="Filtrar status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="novo">Novo</SelectItem>
                    <SelectItem value="contato">Contatado</SelectItem>
                    <SelectItem value="qualificado">Qualificado</SelectItem>
                    <SelectItem value="perdido">Descartado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            }
          />

          <div className="panel rounded-md overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-secondary/40">
                    <th className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-3 py-2.5 whitespace-nowrap">Nome</th>
                    <th className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-3 py-2.5 whitespace-nowrap">Empresa</th>
                    <th className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-3 py-2.5 whitespace-nowrap">Origem</th>
                    <th className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-3 py-2.5 whitespace-nowrap">Status</th>
                    <th className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-3 py-2.5 whitespace-nowrap">Responsável</th>
                    <th className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-3 py-2.5 whitespace-nowrap">Data</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredLeads.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-6 text-center text-sm text-muted-foreground">
                        Nenhum lead encontrado
                      </td>
                    </tr>
                  ) : (
                    filteredLeads.map((lead) => (
                      <tr key={lead.id} className="hover:bg-secondary/20 transition-colors">
                        <td className="px-3 py-2.5 text-xs font-medium whitespace-nowrap">{lead.nome}</td>
                        <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{lead.empresa}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <OriginBadge origem={lead.origem} />
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <LeadStatusBadge status={lead.status} />
                        </td>
                        <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{lead.responsavel}</td>
                        <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap tabular-nums">
                          {lead.created_at.slice(0, 10)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Atividades do dia */}
        <div className="flex flex-col gap-3">
          <SectionHeader title="Atividades Recentes" />
          <div className="panel rounded-md p-0 overflow-hidden divide-y divide-border">
            {atividades.slice(0, 6).map((act) => (
              <div
                key={act.id}
                className="flex items-start gap-3 px-3 py-3 hover:bg-secondary/20 transition-colors"
              >
                <ActivityIcon tipo={act.tipo} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium leading-snug line-clamp-2">{act.titulo}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{act.responsavel}</p>
                </div>
                <span className="text-[11px] font-mono text-muted-foreground shrink-0 tabular-nums mt-0.5">
                  {act.data_hora.slice(11, 16)}
                </span>
              </div>
            ))}
            {atividades.length === 0 && (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                Nenhuma atividade registrada
              </div>
            )}
            <div className="flex items-center gap-2 px-3 py-2.5 bg-secondary/30">
              <CheckCircle2 className="size-3.5 text-success" />
              <span className="text-[11px] text-muted-foreground">
                {atividades.length} atividade{atividades.length !== 1 ? "s" : ""} registrada{atividades.length !== 1 ? "s" : ""}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

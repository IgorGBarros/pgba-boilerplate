// frontend/src/components/empresa/crm.tsx
import { useState } from "react";
import {
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  DollarSign,
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

// ── Types ─────────────────────────────────────────────────────────────────────

type PipelineStage =
  | "prospeccao"
  | "qualificacao"
  | "proposta"
  | "negociacao"
  | "ganho"
  | "perdido";

type LeadOrigin = "Inbound" | "Outbound" | "Indicação" | "Social";
type LeadStatus = "Novo" | "Contatado" | "Qualificado" | "Descartado";
type ActivityType = "phone" | "email" | "meeting";

interface Deal {
  id: string;
  company: string;
  contact: string;
  value: number;
  stage: PipelineStage;
  dueDate: string;
}

interface Lead {
  id: string;
  name: string;
  company: string;
  origin: LeadOrigin;
  status: LeadStatus;
  responsible: string;
  date: string;
}

interface Activity {
  id: string;
  type: ActivityType;
  description: string;
  time: string;
  responsible: string;
}

// ── Mock Data ─────────────────────────────────────────────────────────────────

const DEALS: Deal[] = [
  // Prospecção
  { id: "d1",  company: "Construtora Horizonte",  contact: "Marcos Alves",    value: 18000,  stage: "prospeccao",  dueDate: "30/09" },
  { id: "d2",  company: "Logística Sul",          contact: "Ana Ferreira",    value: 9500,   stage: "prospeccao",  dueDate: "02/10" },
  { id: "d3",  company: "TechVerde Ltda",         contact: "Paulo Mendes",    value: 24000,  stage: "prospeccao",  dueDate: "05/10" },
  // Qualificação
  { id: "d4",  company: "Clínica Bem Estar",      contact: "Dr. Sofia Lima",  value: 31500,  stage: "qualificacao", dueDate: "28/09" },
  { id: "d5",  company: "Atacado Progresso",      contact: "José Nunes",      value: 47200,  stage: "qualificacao", dueDate: "01/10" },
  { id: "d6",  company: "Escola Saber",           contact: "Renata Costa",    value: 12800,  stage: "qualificacao", dueDate: "04/10" },
  // Proposta
  { id: "d7",  company: "Distribuidora Norte",    contact: "Felipe Souza",    value: 68000,  stage: "proposta",    dueDate: "27/09" },
  { id: "d8",  company: "Grupo Imobiliário RJ",   contact: "Carla Ribeiro",   value: 115000, stage: "proposta",    dueDate: "29/09" },
  { id: "d9",  company: "Farmácias União",        contact: "Hugo Bastos",     value: 52400,  stage: "proposta",    dueDate: "03/10" },
  // Negociação
  { id: "d10", company: "Indústria Metálica SP",  contact: "Vera Cardoso",    value: 189000, stage: "negociacao",  dueDate: "26/09" },
  { id: "d11", company: "Seguros Capital",        contact: "André Tavares",   value: 76000,  stage: "negociacao",  dueDate: "28/09" },
  { id: "d12", company: "Porto Seco Logística",   contact: "Bianca Melo",     value: 43500,  stage: "negociacao",  dueDate: "30/09" },
  // Fechado Ganho
  { id: "d13", company: "Varejo Express",         contact: "Cláudio Pinto",   value: 94000,  stage: "ganho",       dueDate: "20/09" },
  { id: "d14", company: "Recicla Tech",           contact: "Natália Jorge",   value: 37800,  stage: "ganho",       dueDate: "18/09" },
  { id: "d15", company: "Alimentos Bela Vista",   contact: "Rodrigo Farias",  value: 61200,  stage: "ganho",       dueDate: "15/09" },
  // Fechado Perdido
  { id: "d16", company: "Constru Rápida",         contact: "Leandro Reis",    value: 28000,  stage: "perdido",     dueDate: "10/09" },
  { id: "d17", company: "Mercado Popular",        contact: "Tânia Braga",     value: 19500,  stage: "perdido",     dueDate: "08/09" },
];

const LEADS: Lead[] = [
  { id: "l1", name: "Gustavo Henrique",   company: "AgroSmart",           origin: "Inbound",   status: "Novo",        responsible: "Marina S.",  date: "23/09" },
  { id: "l2", name: "Patricia Moura",     company: "Saúde+ Clínicas",     origin: "Indicação", status: "Contatado",   responsible: "Lucas P.",   date: "22/09" },
  { id: "l3", name: "Roberto Cunha",      company: "Transpac Logística",  origin: "Outbound",  status: "Qualificado", responsible: "Marina S.",  date: "21/09" },
  { id: "l4", name: "Fernanda Leal",      company: "E-Moda Brasil",       origin: "Social",    status: "Novo",        responsible: "Diego R.",   date: "21/09" },
  { id: "l5", name: "Carlos Eduardo",     company: "Construtora Delta",   origin: "Outbound",  status: "Contatado",   responsible: "Diego R.",   date: "20/09" },
  { id: "l6", name: "Simone Barbosa",     company: "FarmaVida",           origin: "Inbound",   status: "Qualificado", responsible: "Lucas P.",   date: "19/09" },
  { id: "l7", name: "Alexandre Torres",   company: "Educação Conectada",  origin: "Social",    status: "Descartado",  responsible: "Marina S.",  date: "18/09" },
  { id: "l8", name: "Mariana Duarte",     company: "TechEdge Sistemas",   origin: "Indicação", status: "Contatado",   responsible: "Diego R.",   date: "17/09" },
];

const ACTIVITIES: Activity[] = [
  { id: "a1", type: "phone",   description: "Follow-up — Indústria Metálica SP",    time: "09:00", responsible: "Vera C." },
  { id: "a2", type: "email",   description: "Enviar proposta revisada — Grupo RJ",  time: "10:30", responsible: "Marina S." },
  { id: "a3", type: "meeting", description: "Demo produto — Distribuidora Norte",   time: "14:00", responsible: "Lucas P." },
  { id: "a4", type: "phone",   description: "Negociação final — Seguros Capital",   time: "15:30", responsible: "André T." },
  { id: "a5", type: "email",   description: "Onboarding — Varejo Express",          time: "16:00", responsible: "Diego R." },
  { id: "a6", type: "meeting", description: "Kick-off — Recicla Tech",              time: "17:00", responsible: "Carla R." },
];

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
  { id: "prospeccao",  label: "Prospecção",    color: "bg-blue-500/10 border-blue-500/30",    headerColor: "bg-blue-500/20 text-blue-400" },
  { id: "qualificacao",label: "Qualificação",  color: "bg-violet-500/10 border-violet-500/30",headerColor: "bg-violet-500/20 text-violet-400" },
  { id: "proposta",    label: "Proposta",      color: "bg-amber-500/10 border-amber-500/30",  headerColor: "bg-amber-500/20 text-amber-400" },
  { id: "negociacao",  label: "Negociação",    color: "bg-orange-500/10 border-orange-500/30",headerColor: "bg-orange-500/20 text-orange-400" },
  { id: "ganho",       label: "Fechado Ganho", color: "bg-success/10 border-success/30",      headerColor: "bg-success/20 text-success" },
  { id: "perdido",     label: "Fechado Perdido",color: "bg-destructive/10 border-destructive/30", headerColor: "bg-destructive/20 text-destructive" },
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
  const styles: Record<LeadStatus, string> = {
    Novo:        "bg-blue-500/15 text-blue-400 border-blue-500/30",
    Contatado:   "bg-amber-500/15 text-amber-400 border-amber-500/30",
    Qualificado: "bg-success/15 text-success border-success/30",
    Descartado:  "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
  };
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium ${styles[status]}`}>
      {status}
    </span>
  );
}

function OriginBadge({ origin }: { origin: LeadOrigin }) {
  const styles: Record<LeadOrigin, string> = {
    Inbound:   "bg-primary/10 text-primary border-primary/20",
    Outbound:  "bg-violet-500/10 text-violet-400 border-violet-500/20",
    Indicação: "bg-success/10 text-success border-success/20",
    Social:    "bg-pink-500/10 text-pink-400 border-pink-500/20",
  };
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium ${styles[origin]}`}>
      {origin}
    </span>
  );
}

// ── Activity Icon ─────────────────────────────────────────────────────────────

function ActivityIcon({ type }: { type: ActivityType }) {
  const base = "size-7 rounded-md flex items-center justify-center shrink-0";
  if (type === "phone")
    return <span className={`${base} bg-success/10 text-success`}><Phone className="size-3.5" /></span>;
  if (type === "email")
    return <span className={`${base} bg-primary/10 text-primary`}><Mail className="size-3.5" /></span>;
  return <span className={`${base} bg-violet-500/10 text-violet-400`}><Video className="size-3.5" /></span>;
}

// ── Deal Card ─────────────────────────────────────────────────────────────────

function DealCard({ deal }: { deal: Deal }) {
  return (
    <div className="panel rounded-md p-3 space-y-2 cursor-pointer hover:border-border/80 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold leading-tight line-clamp-1">{deal.company}</p>
        <span className="text-xs font-mono font-bold tabular-nums text-foreground whitespace-nowrap">
          {fmtBRL(deal.value)}
        </span>
      </div>
      <p className="text-[11px] text-muted-foreground leading-tight">{deal.contact}</p>
      <div className="flex items-center justify-between gap-2">
        <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${stageBadgeVariant(deal.stage)}`}>
          {STAGES.find((s) => s.id === deal.stage)?.label}
        </span>
        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <CalendarDays className="size-3" />
          {deal.dueDate}
        </span>
      </div>
    </div>
  );
}

// ── Pipeline Column ───────────────────────────────────────────────────────────

function PipelineColumn({ stage, deals }: { stage: StageConfig; deals: Deal[] }) {
  const total = deals.reduce((s, d) => s + d.value, 0);
  return (
    <div className="flex flex-col gap-2 min-w-[200px] w-[200px] shrink-0">
      {/* Column header */}
      <div className={`rounded-md px-3 py-2 flex items-center justify-between gap-2 ${stage.headerColor}`}>
        <span className="text-[11px] font-semibold uppercase tracking-wide truncate">{stage.label}</span>
        <span className="text-[11px] font-mono font-bold tabular-nums shrink-0">
          {deals.length} · {fmtBRLCompact(total)}
        </span>
      </div>
      {/* Cards */}
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

export function CRMView() {
  const [leadFilter, setLeadFilter] = useState<string>("all");
  const [leadSearch, setLeadSearch] = useState("");

  // ── KPI calculations ──────────────────────────────────────────────────────

  const totalLeads = LEADS.length;
  const openDeals = DEALS.filter(
    (d) => d.stage !== "ganho" && d.stage !== "perdido"
  ).length;
  const wonDeals = DEALS.filter((d) => d.stage === "ganho").length;
  const closedDeals = DEALS.filter(
    (d) => d.stage === "ganho" || d.stage === "perdido"
  ).length;
  const conversionRate =
    closedDeals > 0 ? Math.round((wonDeals / closedDeals) * 100) : 0;
  const pipeline = DEALS.filter(
    (d) => d.stage !== "ganho" && d.stage !== "perdido"
  ).reduce((s, d) => s + d.value, 0);

  // ── Filtered leads ────────────────────────────────────────────────────────

  const filteredLeads = LEADS.filter((l) => {
    const matchesStatus =
      leadFilter === "all" || l.status.toLowerCase() === leadFilter;
    const q = leadSearch.toLowerCase();
    const matchesSearch =
      !q ||
      l.name.toLowerCase().includes(q) ||
      l.company.toLowerCase().includes(q);
    return matchesStatus && matchesSearch;
  });

  // ── Deals grouped by stage ────────────────────────────────────────────────

  const dealsByStage = (stage: PipelineStage) =>
    DEALS.filter((d) => d.stage === stage);

  return (
    <div className="flex flex-col gap-6">
      {/* ── KPI Row ───────────────────────────────────────────────────────── */}
      <div>
        <SectionHeader
          title="CRM & Comercial"
          description="Pipeline de vendas, leads e atividades do time comercial."
          action={
            <Button size="sm" className="gap-1.5">
              <ChevronRight className="size-3.5" />
              Nova oportunidade
            </Button>
          }
        />
        <div className="mt-4 grid gap-3 grid-cols-2 lg:grid-cols-4">
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
                    <SelectItem value="contatado">Contatado</SelectItem>
                    <SelectItem value="qualificado">Qualificado</SelectItem>
                    <SelectItem value="descartado">Descartado</SelectItem>
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
                    <th className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-3 py-2.5 whitespace-nowrap">
                      Nome
                    </th>
                    <th className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-3 py-2.5 whitespace-nowrap">
                      Empresa
                    </th>
                    <th className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-3 py-2.5 whitespace-nowrap">
                      Origem
                    </th>
                    <th className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-3 py-2.5 whitespace-nowrap">
                      Status
                    </th>
                    <th className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-3 py-2.5 whitespace-nowrap">
                      Responsável
                    </th>
                    <th className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-3 py-2.5 whitespace-nowrap">
                      Data
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredLeads.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-3 py-6 text-center text-sm text-muted-foreground"
                      >
                        Nenhum lead encontrado
                      </td>
                    </tr>
                  ) : (
                    filteredLeads.map((lead) => (
                      <tr
                        key={lead.id}
                        className="hover:bg-secondary/20 transition-colors"
                      >
                        <td className="px-3 py-2.5 text-xs font-medium whitespace-nowrap">
                          {lead.name}
                        </td>
                        <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                          {lead.company}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <OriginBadge origin={lead.origin} />
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <LeadStatusBadge status={lead.status} />
                        </td>
                        <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                          {lead.responsible}
                        </td>
                        <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap tabular-nums">
                          {lead.date}
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
          <SectionHeader title="Atividades do Dia" />
          <div className="panel rounded-md p-0 overflow-hidden divide-y divide-border">
            {ACTIVITIES.map((act) => (
              <div
                key={act.id}
                className="flex items-start gap-3 px-3 py-3 hover:bg-secondary/20 transition-colors"
              >
                <ActivityIcon type={act.type} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium leading-snug line-clamp-2">
                    {act.description}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {act.responsible}
                  </p>
                </div>
                <span className="text-[11px] font-mono text-muted-foreground shrink-0 tabular-nums mt-0.5">
                  {act.time}
                </span>
              </div>
            ))}

            {/* Summary footer */}
            <div className="flex items-center gap-2 px-3 py-2.5 bg-secondary/30">
              <CheckCircle2 className="size-3.5 text-success" />
              <span className="text-[11px] text-muted-foreground">
                {ACTIVITIES.length} atividades agendadas hoje
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

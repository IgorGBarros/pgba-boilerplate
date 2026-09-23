// frontend/src/components/empresa/juridico.tsx
import { useState } from "react";
import {
  ArrowLeft,
  Scale,
  FileSignature,
  Clock,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Calendar,
  User,
  Building2,
  Filter,
  Search,
  Download,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Metric } from "@/components/empresa/shared";

// ── Mock data ──────────────────────────────────────────────────────────────────

const PROCESSOS = [
  { id: "P-2024-001", titulo: "Ação Trabalhista — Ex-Funcionário A", tipo: "Trabalhista", status: "em_andamento", parte: "João Silva", advogado: "Dra. Ana Costa", foro: "TRT-SP", risco: "alto", valor: 48000, prazoProx: "2026-10-03" },
  { id: "P-2024-007", titulo: "Ação de Cobrança — Cliente B", tipo: "Cível", status: "em_andamento", parte: "Beta Corp S.A.", advogado: "Dr. Carlos Lima", foro: "TJSP", risco: "medio", valor: 120000, prazoProx: "2026-10-15" },
  { id: "P-2024-012", titulo: "Auto de Infração Fiscal ICMS", tipo: "Tributário", status: "em_andamento", parte: "Fazenda Estadual", advogado: "Dra. Fernanda Reis", foro: "TIT-SP", risco: "alto", valor: 87500, prazoProx: "2026-09-28" },
  { id: "P-2023-044", titulo: "Rescisão Contratual — Fornecedor", tipo: "Cível", status: "ganho", parte: "Gamma Suprimentos ME", advogado: "Dr. Carlos Lima", foro: "TJSP", risco: "baixo", valor: 22000, prazoProx: null },
  { id: "P-2023-031", titulo: "Violação de PI — Marca Registrada", tipo: "PI", status: "em_andamento", parte: "Delta Tech Ltda", advogado: "Dra. Ana Costa", foro: "TJSP", risco: "medio", valor: 65000, prazoProx: "2026-11-02" },
  { id: "P-2022-089", titulo: "Ação Consumerista", tipo: "Cível", status: "perdido", parte: "Consumidor Final", advogado: "Dr. Pedro Santos", foro: "JEC-SP", risco: "baixo", valor: 4500, prazoProx: null },
  { id: "P-2024-019", titulo: "Impugnação de Auto de Lavração", tipo: "Administrativo", status: "em_andamento", parte: "Prefeitura SP", advogado: "Dra. Fernanda Reis", foro: "CARF", risco: "medio", valor: 31000, prazoProx: "2026-10-22" },
  { id: "P-2023-067", titulo: "Recuperação de Créditos PIS/COFINS", tipo: "Tributário", status: "ganho", parte: "RFB", advogado: "Dra. Fernanda Reis", foro: "CARF", risco: "baixo", valor: 156000, prazoProx: null },
];

const CONTRATOS = [
  { id: "C-001", titulo: "Contrato de Prestação de Serviços TI", parte: "Cloudify Ltda", tipo: "Serviços", valor: 84000, vigencia: "2027-03-31", renovacao: "automática", status: "vigente" },
  { id: "C-002", titulo: "Acordo de Confidencialidade (NDA)", parte: "Investidores Série A", tipo: "NDA", valor: null, vigencia: "2028-01-01", renovacao: "manual", status: "vigente" },
  { id: "C-003", titulo: "Licença de Software ERP", parte: "SAP Brasil", tipo: "Licença", valor: 240000, vigencia: "2026-12-31", renovacao: "manual", status: "vigente" },
  { id: "C-004", titulo: "Contrato de Locação Comercial", parte: "Imóveis Prime Ltda", tipo: "Imóvel", valor: 90000, vigencia: "2026-10-31", renovacao: "negociação", status: "expirando" },
  { id: "C-005", titulo: "Parceria Comercial — Distribuidora", parte: "Alfa Distribuidora SA", tipo: "Parceria", valor: 360000, vigencia: "2027-06-30", renovacao: "automática", status: "vigente" },
  { id: "C-006", titulo: "Contrato de Seguro Empresarial", parte: "Porto Seguro SA", tipo: "Seguro", valor: 28800, vigencia: "2026-11-15", renovacao: "manual", status: "vigente" },
  { id: "C-007", titulo: "Acordo Trabalhista Coletivo (ACT)", parte: "Sindicato dos Trabalhadores", tipo: "Trabalhista", valor: null, vigencia: "2026-09-30", renovacao: "negociação", status: "expirando" },
];

const PRAZOS = [
  { id: 1, processo: "P-2024-012", titulo: "Contestação Auto de Infração", prazo: "2026-09-28", tipo: "Peça processual", urgencia: "critico", responsavel: "Dra. Fernanda Reis" },
  { id: 2, processo: "P-2024-001", titulo: "Audiência Conciliação TRT", prazo: "2026-10-03", tipo: "Audiência", urgencia: "alto", responsavel: "Dra. Ana Costa" },
  { id: 3, titulo: "Renovação Contrato de Locação", processo: "C-004", prazo: "2026-10-10", tipo: "Contrato", urgencia: "alto", responsavel: "Dr. Carlos Lima" },
  { id: 4, processo: "P-2024-007", titulo: "Réplica à Contestação", prazo: "2026-10-15", tipo: "Peça processual", urgencia: "medio", responsavel: "Dr. Carlos Lima" },
  { id: 5, titulo: "Renovação ACT 2026/27", processo: "C-007", prazo: "2026-09-30", tipo: "Contrato", urgencia: "critico", responsavel: "Dra. Ana Costa" },
  { id: 6, processo: "P-2024-019", titulo: "Sustentação Oral no CARF", prazo: "2026-10-22", tipo: "Audiência", urgencia: "medio", responsavel: "Dra. Fernanda Reis" },
  { id: 7, processo: "P-2023-031", titulo: "Laudo Pericial Entregue", prazo: "2026-11-02", tipo: "Diligência", urgencia: "baixo", responsavel: "Dr. Pedro Santos" },
];

// ── Helpers ────────────────────────────────────────────────────────────────────

const fmtBRL = (v: number | null) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const fmtDate = (d: string | null) => {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
};

const daysUntil = (d: string | null) => {
  if (!d) return null;
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
};

function StatusBadgeProcesso({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    em_andamento: { label: "Em andamento", cls: "border-blue-500/40 text-blue-400 bg-blue-500/10" },
    ganho:        { label: "Ganho",        cls: "border-emerald-500/40 text-emerald-400 bg-emerald-500/10" },
    perdido:      { label: "Perdido",      cls: "border-red-500/40 text-red-400 bg-red-500/10" },
    arquivado:    { label: "Arquivado",    cls: "border-slate-500/40 text-slate-400 bg-slate-500/10" },
  };
  const { label, cls } = map[status] ?? { label: status, cls: "" };
  return <span className={`rounded border px-2 py-0.5 text-[10px] font-medium ${cls}`}>{label}</span>;
}

function RiscoBadge({ risco }: { risco: string }) {
  const map: Record<string, string> = {
    alto:  "border-red-500/40 text-red-400 bg-red-500/10",
    medio: "border-amber-500/40 text-amber-400 bg-amber-500/10",
    baixo: "border-emerald-500/40 text-emerald-400 bg-emerald-500/10",
  };
  return <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium capitalize ${map[risco] ?? ""}`}>{risco}</span>;
}

function UrgenciaBadge({ urgencia }: { urgencia: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    critico: { label: "Crítico", cls: "border-red-500/40 text-red-400 bg-red-500/10" },
    alto:    { label: "Alto",    cls: "border-amber-500/40 text-amber-400 bg-amber-500/10" },
    medio:   { label: "Médio",   cls: "border-blue-500/40 text-blue-400 bg-blue-500/10" },
    baixo:   { label: "Baixo",   cls: "border-slate-500/40 text-slate-400 bg-slate-500/10" },
  };
  const { label, cls } = map[urgencia] ?? { label: urgencia, cls: "" };
  return <span className={`rounded border px-1.5 py.0.5 text-[10px] font-medium ${cls}`}>{label}</span>;
}

// ── Tabs ───────────────────────────────────────────────────────────────────────

function TabProcessos() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("todos");

  const filtered = PROCESSOS.filter((p) => {
    const matchStatus = filter === "todos" || p.status === filter;
    const q = search.toLowerCase();
    return matchStatus && (!q || p.titulo.toLowerCase().includes(q) || p.parte.toLowerCase().includes(q));
  });

  const totalRisco = PROCESSOS.filter((p) => p.status === "em_andamento").reduce((s, p) => s + p.valor, 0);
  const ganhos = PROCESSOS.filter((p) => p.status === "ganho").length;
  const perdidos = PROCESSOS.filter((p) => p.status === "perdido").length;
  const taxa = ganhos + perdidos > 0 ? Math.round((ganhos / (ganhos + perdidos)) * 100) : 0;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Metric label="Processos Ativos" value={String(PROCESSOS.filter((p) => p.status === "em_andamento").length)} icon={<Scale className="size-4" />} />
        <Metric label="Risco Financeiro" value={fmtBRL(totalRisco)} icon={<AlertTriangle className="size-4" />} tone="warning" />
        <Metric label="Taxa de Êxito" value={`${taxa}%`} icon={<CheckCircle2 className="size-4" />} tone={taxa >= 60 ? "success" : "warning"} />
        <Metric label="Advogados Ativos" value="4" icon={<User className="size-4" />} />
      </div>

      <div className="panel">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <Scale className="size-4 text-primary shrink-0" />
          <span className="font-semibold">Processos</span>
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <Input className="h-7 pl-7 text-xs w-52" placeholder="Buscar processo..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <select value={filter} onChange={(e) => setFilter(e.target.value)} className="h-7 rounded-md border border-border bg-secondary px-2 text-xs text-foreground">
              <option value="todos">Todos</option>
              <option value="em_andamento">Em andamento</option>
              <option value="ganho">Ganhos</option>
              <option value="perdido">Perdidos</option>
            </select>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-border bg-secondary/30">
              <tr>
                {["Nº", "Título", "Tipo", "Contraparte", "Advogado", "Risco", "Valor", "Próx. Prazo", "Status"].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((p) => {
                const days = daysUntil(p.prazoProx);
                return (
                  <tr key={p.id} className="hover:bg-secondary/40 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{p.id}</td>
                    <td className="px-4 py-3 text-xs font-medium max-w-[200px] truncate">{p.titulo}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{p.tipo}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{p.parte}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{p.advogado}</td>
                    <td className="px-4 py-3"><RiscoBadge risco={p.risco} /></td>
                    <td className="px-4 py-3 tabular-nums text-xs font-medium">{fmtBRL(p.valor)}</td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap">
                      {p.prazoProx ? (
                        <span className={days != null && days <= 7 ? "text-red-400 font-medium" : days != null && days <= 21 ? "text-amber-400" : "text-muted-foreground"}>
                          {fmtDate(p.prazoProx)}{days != null ? ` (${days}d)` : ""}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3"><StatusBadgeProcesso status={p.status} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function TabContratos() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Metric label="Contratos Vigentes" value={String(CONTRATOS.filter((c) => c.status === "vigente").length)} icon={<FileSignature className="size-4" />} tone="success" />
        <Metric label="Expirando em 60d" value={String(CONTRATOS.filter((c) => c.status === "expirando").length)} icon={<Clock className="size-4" />} tone="warning" />
        <Metric label="Valor Anual Total" value={fmtBRL(CONTRATOS.reduce((s, c) => s + (c.valor ?? 0), 0))} icon={<Building2 className="size-4" />} />
        <Metric label="Em Negociação" value={String(CONTRATOS.filter((c) => c.renovacao === "negociação").length)} icon={<RefreshCw className="size-4" />} tone="warning" />
      </div>

      <div className="panel">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <FileSignature className="size-4 text-primary" />
          <span className="font-semibold">Contratos Vigentes</span>
          <Button variant="outline" size="sm" className="ml-auto h-7 gap-1.5 text-xs">
            <Download size={12} /> Exportar
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-border bg-secondary/30">
              <tr>
                {["ID", "Título", "Parte", "Tipo", "Valor/Ano", "Vigência", "Renovação", "Status"].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {CONTRATOS.map((c) => {
                const expirando = c.status === "expirando";
                return (
                  <tr key={c.id} className="hover:bg-secondary/40 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{c.id}</td>
                    <td className="px-4 py-3 text-xs font-medium max-w-[200px] truncate">{c.titulo}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{c.parte}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{c.tipo}</td>
                    <td className="px-4 py-3 tabular-nums text-xs">{fmtBRL(c.valor)}</td>
                    <td className={`px-4 py-3 text-xs whitespace-nowrap ${expirando ? "text-amber-400 font-medium" : "text-muted-foreground"}`}>{fmtDate(c.vigencia)}</td>
                    <td className="px-4 py-3 text-xs capitalize text-muted-foreground">{c.renovacao}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded border px-2 py-0.5 text-[10px] font-medium ${expirando ? "border-amber-500/40 text-amber-400 bg-amber-500/10" : "border-emerald-500/40 text-emerald-400 bg-emerald-500/10"}`}>
                        {expirando ? "Expirando" : "Vigente"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function TabPrazos() {
  const sorted = [...PRAZOS].sort((a, b) => new Date(a.prazo).getTime() - new Date(b.prazo).getTime());

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Metric label="Prazos em 7 dias" value={String(PRAZOS.filter((p) => { const d = daysUntil(p.prazo); return d != null && d <= 7; }).length)} icon={<AlertTriangle className="size-4" />} tone="warning" />
        <Metric label="Audiências Próximas" value={String(PRAZOS.filter((p) => p.tipo === "Audiência").length)} icon={<Calendar className="size-4" />} />
        <Metric label="Peças Processuais" value={String(PRAZOS.filter((p) => p.tipo === "Peça processual").length)} icon={<Scale className="size-4" />} />
        <Metric label="Renovações Pendentes" value={String(PRAZOS.filter((p) => p.tipo === "Contrato").length)} icon={<FileSignature className="size-4" />} tone="warning" />
      </div>

      <div className="panel divide-y divide-border">
        <div className="flex items-center gap-2 px-4 py-3">
          <Clock className="size-4 text-primary" />
          <span className="font-semibold">Agenda de Prazos</span>
          <span className="ml-auto text-xs text-muted-foreground">Ordenado por urgência</span>
        </div>
        {sorted.map((p) => {
          const days = daysUntil(p.prazo);
          const isUrgent = p.urgencia === "critico" || p.urgencia === "alto";
          return (
            <div key={p.id} className={`flex items-center gap-4 px-4 py-4 ${isUrgent ? "bg-red-500/5" : ""}`}>
              <div className="flex flex-col items-center w-14 shrink-0">
                <span className={`text-lg font-bold tabular-nums leading-tight ${days != null && days <= 3 ? "text-red-400" : days != null && days <= 10 ? "text-amber-400" : "text-foreground"}`}>
                  {days != null ? days : "—"}
                </span>
                <span className="text-[10px] text-muted-foreground">dias</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{p.titulo}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {p.processo} · {p.tipo} · {fmtDate(p.prazo)}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="hidden sm:block text-xs text-muted-foreground">{p.responsavel}</span>
                <UrgenciaBadge urgencia={p.urgencia} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Export ─────────────────────────────────────────────────────────────────────

export function JuridicoView({ onBack }: { onBack: () => void }) {
  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="rounded-xl bg-gradient-to-r from-slate-600/20 via-purple-600/10 to-transparent border border-slate-500/20 px-5 py-4">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="shrink-0 grid size-8 place-items-center rounded-md text-slate-300 hover:text-slate-100 hover:bg-slate-500/20 transition-colors">
            <ArrowLeft className="size-4" />
          </button>
          <div className="flex items-center gap-3 min-w-0">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-slate-500/20 text-slate-300">
              <Scale className="size-5" />
            </span>
            <div>
              <h2 className="font-semibold text-lg font-display text-foreground">Jurídico</h2>
              <p className="text-xs text-muted-foreground">Processos, contratos e gestão de prazos</p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs border-slate-500/30 text-slate-300 hover:bg-slate-500/10">
              <Filter size={12} /> Filtros
            </Button>
            <Button size="sm" className="h-8 gap-1.5 text-xs bg-slate-600 hover:bg-slate-700 text-white border-0">
              <ChevronRight size={12} /> Novo Processo
            </Button>
          </div>
        </div>
      </div>

      <Tabs defaultValue="processos">
        <TabsList className="h-9 gap-1 bg-secondary p-1 rounded-md">
          <TabsTrigger value="processos" className="h-7 gap-1.5 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm">
            <Scale className="size-3.5" /> Processos
          </TabsTrigger>
          <TabsTrigger value="contratos" className="h-7 gap-1.5 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm">
            <FileSignature className="size-3.5" /> Contratos
          </TabsTrigger>
          <TabsTrigger value="prazos" className="h-7 gap-1.5 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm">
            <Clock className="size-3.5" /> Prazos
          </TabsTrigger>
        </TabsList>
        <TabsContent value="processos" className="mt-4"><TabProcessos /></TabsContent>
        <TabsContent value="contratos" className="mt-4"><TabContratos /></TabsContent>
        <TabsContent value="prazos" className="mt-4"><TabPrazos /></TabsContent>
      </Tabs>
    </div>
  );
}

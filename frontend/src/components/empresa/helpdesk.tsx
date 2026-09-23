import { ArrowLeft, Headphones, AlertCircle, Clock, CheckCircle2, XCircle, Monitor, Server, Wifi, Smartphone, HardDrive, TrendingUp, Users, BarChart3, Search } from "lucide-react";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { type Ticket, type EquipamentoTI, listTickets, listEquipamentosTI } from "@/lib/api";

interface HelpdeskViewProps {
  onBack: () => void;
}

type TicketStatus = Ticket["status"];
type Prioridade = Ticket["prioridade"];
type EquipmentStatus = EquipamentoTI["status"];

function computeSlaRemaining(createdAt: string, slaHoras: number): number {
  const elapsed = (Date.now() - new Date(createdAt).getTime()) / 3600000;
  return Math.round(slaHoras - elapsed);
}

function PrioridadeBadge({ p }: { p: Prioridade }) {
  const map: Record<Prioridade, string> = {
    critica: "bg-red-500/20 text-red-400 border-red-500/30",
    alta: "bg-orange-500/20 text-orange-400 border-orange-500/30",
    media: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    baixa: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
  };
  const labels: Record<Prioridade, string> = { critica: "Crítica", alta: "Alta", media: "Média", baixa: "Baixa" };
  return <Badge className={`${map[p]} text-[11px]`}>{labels[p]}</Badge>;
}

function StatusBadge({ s }: { s: TicketStatus }) {
  const map: Record<TicketStatus, string> = {
    aberto: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    em_atendimento: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    aguardando: "bg-purple-500/20 text-purple-400 border-purple-500/30",
    resolvido: "bg-green-500/20 text-green-400 border-green-500/30",
    fechado: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
  };
  const labels: Record<TicketStatus, string> = {
    aberto: "Aberto", em_atendimento: "Em atendimento", aguardando: "Aguardando", resolvido: "Resolvido", fechado: "Fechado",
  };
  return <Badge className={`${map[s]} text-[11px]`}>{labels[s]}</Badge>;
}

function SLABadge({ hours }: { hours: number }) {
  if (hours < 0) return (
    <span className="flex items-center gap-1 text-red-400 text-xs font-medium">
      <XCircle className="w-3.5 h-3.5" /> SLA violado ({Math.abs(hours)}h)
    </span>
  );
  if (hours <= 4) return (
    <span className="flex items-center gap-1 text-orange-400 text-xs">
      <AlertCircle className="w-3.5 h-3.5" /> {hours}h restantes
    </span>
  );
  return (
    <span className="flex items-center gap-1 text-zinc-400 text-xs">
      <Clock className="w-3.5 h-3.5" /> {hours}h restantes
    </span>
  );
}

function EquipStatusBadge({ s }: { s: EquipmentStatus }) {
  const map: Record<EquipmentStatus, string> = {
    ativo: "bg-green-500/20 text-green-400 border-green-500/30",
    manutencao: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    disponivel: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    descarte: "bg-red-500/20 text-red-400 border-red-500/30",
  };
  const labels: Record<EquipmentStatus, string> = { ativo: "Ativo", manutencao: "Manutenção", disponivel: "Disponível", descarte: "Descarte" };
  return <Badge className={`${map[s]} text-[11px]`}>{labels[s]}</Badge>;
}

function CategoryIcon({ cat }: { cat: string }) {
  const c = cat.toLowerCase();
  if (c === "rede" || c === "infraestrutura") return <Wifi className="w-4 h-4 text-cyan-400" />;
  if (c === "hardware") return <Monitor className="w-4 h-4 text-blue-400" />;
  if (c === "mobile") return <Smartphone className="w-4 h-4 text-purple-400" />;
  if (c === "servidor") return <Server className="w-4 h-4 text-orange-400" />;
  return <HardDrive className="w-4 h-4 text-zinc-400" />;
}

function TabTickets({ tickets }: { tickets: Ticket[] }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<TicketStatus | "todos">("todos");

  const filtered = tickets.filter(t => {
    const matchSearch = t.titulo.toLowerCase().includes(search.toLowerCase()) || t.solicitante.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "todos" || t.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const slaViolados = tickets.filter(t => {
    const remaining = computeSlaRemaining(t.created_at, t.sla_horas);
    return remaining < 0 && t.status !== "resolvido" && t.status !== "fechado";
  }).length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Abertos", value: tickets.filter(t => t.status === "aberto").length, icon: <AlertCircle className="w-4 h-4 text-blue-400" /> },
          { label: "Em atendimento", value: tickets.filter(t => t.status === "em_atendimento").length, icon: <Clock className="w-4 h-4 text-yellow-400" /> },
          { label: "SLA violados", value: slaViolados, icon: <XCircle className="w-4 h-4 text-red-400" /> },
          { label: "Resolvidos", value: tickets.filter(t => t.status === "resolvido").length, icon: <CheckCircle2 className="w-4 h-4 text-green-400" /> },
        ].map(m => (
          <div key={m.label} className="p-4 rounded-lg bg-white/5 border border-white/10 flex items-center gap-3">
            {m.icon}
            <div>
              <p className="text-xl font-bold text-white">{m.value}</p>
              <p className="text-xs text-zinc-400">{m.label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
          <Input placeholder="Buscar ticket, solicitante..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 bg-white/5 border-white/10 text-zinc-200 placeholder:text-zinc-500" />
        </div>
        <div className="flex gap-2">
          {(["todos", "aberto", "em_atendimento", "aguardando", "resolvido"] as const).map(s => (
            <button key={s} onClick={() => setStatusFilter(s)} className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${statusFilter === s ? "bg-teal-500/20 text-teal-400 border border-teal-500/30" : "bg-white/5 text-zinc-400 border border-white/10 hover:border-white/20"}`}>
              {s === "todos" ? "Todos" : s === "em_atendimento" ? "Em atend." : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        {filtered.map(t => {
          const slaHours = computeSlaRemaining(t.created_at, t.sla_horas);
          const slaViolated = slaHours < 0 && t.status !== "resolvido" && t.status !== "fechado";
          return (
            <div key={t.id} className={`p-4 rounded-lg bg-white/5 border transition-colors hover:border-white/20 ${slaViolated ? "border-red-500/30" : "border-white/10"}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <CategoryIcon cat={t.categoria} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-zinc-200 truncate">{t.titulo}</p>
                    </div>
                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                      <span className="text-xs text-zinc-500">{t.solicitante}</span>
                      <span className="text-xs text-zinc-500">· {t.categoria}</span>
                      {t.atendente && <span className="text-xs text-zinc-500">· {t.atendente}</span>}
                      <span className="text-xs text-zinc-500">· {t.created_at.slice(0, 16).replace("T", " ")}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <SLABadge hours={slaHours} />
                  <PrioridadeBadge p={t.prioridade} />
                  <StatusBadge s={t.status} />
                </div>
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="text-center py-12 text-zinc-500">Nenhum ticket encontrado</div>
        )}
      </div>
    </div>
  );
}

function TabInventario({ equipamentos }: { equipamentos: EquipamentoTI[] }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-4 mb-2">
        {[
          { label: "Ativos", value: equipamentos.filter(i => i.status === "ativo").length },
          { label: "Disponíveis", value: equipamentos.filter(i => i.status === "disponivel").length },
          { label: "Em manutenção", value: equipamentos.filter(i => i.status === "manutencao").length },
          { label: "Total", value: equipamentos.length },
        ].map(m => (
          <div key={m.label} className="p-4 rounded-lg bg-white/5 border border-white/10">
            <p className="text-2xl font-bold text-white">{m.value}</p>
            <p className="text-xs text-zinc-400 mt-0.5">{m.label}</p>
          </div>
        ))}
      </div>

      <div className="rounded-lg bg-white/5 border border-white/10 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10">
              {["ID", "Equipamento", "Tipo", "Usuário", "Setor", "Status", "Última revisão"].map(h => (
                <th key={h} className="text-left text-xs text-zinc-500 font-medium px-4 py-3">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {equipamentos.map(item => (
              <tr key={item.id} className="hover:bg-white/5 transition-colors">
                <td className="px-4 py-3 text-xs font-mono text-zinc-400">{item.codigo}</td>
                <td className="px-4 py-3 text-zinc-200">{item.nome}</td>
                <td className="px-4 py-3 text-zinc-400 text-xs">{item.tipo}</td>
                <td className="px-4 py-3 text-zinc-400 text-xs">{item.usuario || <span className="text-zinc-600">—</span>}</td>
                <td className="px-4 py-3 text-zinc-400 text-xs">{item.setor}</td>
                <td className="px-4 py-3"><EquipStatusBadge s={item.status} /></td>
                <td className="px-4 py-3 text-zinc-500 text-xs">{item.ultima_revisao ?? "—"}</td>
              </tr>
            ))}
            {equipamentos.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-zinc-500 text-sm">Nenhum equipamento cadastrado</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function HelpdeskView({ onBack }: HelpdeskViewProps) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [equipamentos, setEquipamentos] = useState<EquipamentoTI[]>([]);

  useEffect(() => {
    listTickets().then(setTickets).catch(() => {});
    listEquipamentosTI().then(setEquipamentos).catch(() => {});
  }, []);

  const abertos = tickets.filter(t => t.status === "aberto" || t.status === "em_atendimento").length;
  const slaViolados = tickets.filter(t => {
    const rem = computeSlaRemaining(t.created_at, t.sla_horas);
    return rem < 0 && t.status !== "resolvido" && t.status !== "fechado";
  }).length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="relative overflow-hidden rounded-xl p-6 mb-6 bg-gradient-to-r from-teal-600/20 via-cyan-600/10 to-transparent border border-white/10">
        <div className="absolute inset-0 bg-gradient-to-br from-teal-500/5 to-cyan-500/5" />
        <div className="relative flex items-start justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={onBack} className="text-zinc-400 hover:text-white p-1 h-auto">
              <ArrowLeft className="w-4 h-4 mr-1" /> Voltar
            </Button>
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-teal-500/20 border border-teal-500/30">
                <Headphones className="w-5 h-5 text-teal-400" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-white">TI · Helpdesk</h1>
                <p className="text-sm text-zinc-400">Chamados · SLA · Inventário</p>
              </div>
            </div>
          </div>
          <div className="flex gap-4 text-center">
            {[
              { label: "Chamados ativos", value: abertos, icon: <AlertCircle className="w-4 h-4 text-teal-400 mx-auto mb-1" /> },
              { label: "SLA violados", value: slaViolados, icon: <XCircle className="w-4 h-4 text-red-400 mx-auto mb-1" /> },
              { label: "Satisfação", value: "—", icon: <TrendingUp className="w-4 h-4 text-green-400 mx-auto mb-1" /> },
              { label: "Equipamentos", value: equipamentos.length, icon: <BarChart3 className="w-4 h-4 text-cyan-400 mx-auto mb-1" /> },
            ].map(m => (
              <div key={m.label} className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 min-w-[90px]">
                {m.icon}
                <p className="text-xl font-bold text-white">{m.value}</p>
                <p className="text-xs text-zinc-400">{m.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="tickets" className="flex-1">
        <TabsList className="bg-white/5 border border-white/10 mb-6">
          <TabsTrigger value="tickets" className="data-[state=active]:bg-white/10">
            <Headphones className="w-4 h-4 mr-1.5" /> Chamados
          </TabsTrigger>
          <TabsTrigger value="inventario" className="data-[state=active]:bg-white/10">
            <Monitor className="w-4 h-4 mr-1.5" /> Inventário
          </TabsTrigger>
        </TabsList>

        <TabsContent value="tickets"><TabTickets tickets={tickets} /></TabsContent>
        <TabsContent value="inventario"><TabInventario equipamentos={equipamentos} /></TabsContent>
      </Tabs>

      {/* Footer */}
      <div className="mt-6 pt-4 border-t border-white/10 flex items-center justify-between text-xs text-zinc-500">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> Equipe TI</span>
          <span className="flex items-center gap-1.5"><Server className="w-3.5 h-3.5" /> Infraestrutura PGBA</span>
        </div>
        <span>Setor TI</span>
      </div>
    </div>
  );
}

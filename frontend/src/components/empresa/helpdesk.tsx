import { ArrowLeft, Headphones, AlertCircle, Clock, CheckCircle2, XCircle, Monitor, Server, Wifi, Smartphone, HardDrive, TrendingUp, Users, BarChart3, Search } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";

interface HelpdeskViewProps {
  onBack: () => void;
}

type TicketStatus = "aberto" | "em_atendimento" | "aguardando" | "resolvido" | "fechado";
type Prioridade = "critica" | "alta" | "media" | "baixa";

interface Ticket {
  id: string;
  titulo: string;
  solicitante: string;
  categoria: string;
  prioridade: Prioridade;
  status: TicketStatus;
  sla: number; // horas restantes (negativo = violado)
  criado: string;
  atendente?: string;
}

const tickets: Ticket[] = [
  { id: "TI-0891", titulo: "VPN não conecta após atualização do Windows", solicitante: "Maria Silva", categoria: "Rede", prioridade: "critica", status: "em_atendimento", sla: -2, criado: "2026-09-23 08:14", atendente: "Carlos TI" },
  { id: "TI-0890", titulo: "Impressora do financeiro não responde", solicitante: "João Costa", categoria: "Hardware", prioridade: "alta", status: "aberto", sla: 3, criado: "2026-09-23 09:02" },
  { id: "TI-0889", titulo: "Acesso ao sistema ERP negado após troca de senha", solicitante: "Ana Rodrigues", categoria: "Acesso", prioridade: "alta", status: "em_atendimento", sla: 5, criado: "2026-09-23 07:55", atendente: "Carlos TI" },
  { id: "TI-0888", titulo: "Computador lento — memória insuficiente", solicitante: "Pedro Lima", categoria: "Hardware", prioridade: "media", status: "aguardando", sla: 18, criado: "2026-09-22 16:30", atendente: "Fernanda TI" },
  { id: "TI-0887", titulo: "Email corporativo não sincroniza no celular", solicitante: "Lucia Santos", categoria: "Mobile", prioridade: "media", status: "aguardando", sla: 12, criado: "2026-09-22 14:00" },
  { id: "TI-0886", titulo: "Solicitar novo notebook para colaborador onboarding", solicitante: "RH - Onboarding", categoria: "Equipamento", prioridade: "media", status: "aberto", sla: 48, criado: "2026-09-22 11:00" },
  { id: "TI-0885", titulo: "Software de design precisa de licença atualizada", solicitante: "Bruno Alves", categoria: "Software", prioridade: "baixa", status: "resolvido", sla: 72, criado: "2026-09-21 10:20", atendente: "Fernanda TI" },
  { id: "TI-0884", titulo: "Backup do servidor falhou na última execução", solicitante: "Sistema", categoria: "Infraestrutura", prioridade: "alta", status: "resolvido", sla: 8, criado: "2026-09-21 03:00", atendente: "Carlos TI" },
  { id: "TI-0883", titulo: "Monitor com linhas na tela", solicitante: "Carla Mendes", categoria: "Hardware", prioridade: "baixa", status: "fechado", sla: 72, criado: "2026-09-20 09:45", atendente: "Fernanda TI" },
];

type EquipmentStatus = "ativo" | "manutencao" | "disponivel" | "descarte";

interface InventoryItem {
  id: string;
  nome: string;
  tipo: string;
  usuario?: string;
  setor: string;
  status: EquipmentStatus;
  ultimaRevisao: string;
}

const inventario: InventoryItem[] = [
  { id: "NB-042", nome: "Dell Latitude 5430", tipo: "Notebook", usuario: "Maria Silva", setor: "Comercial", status: "ativo", ultimaRevisao: "2026-07-15" },
  { id: "NB-043", nome: "Lenovo ThinkPad X1", tipo: "Notebook", usuario: "João Costa", setor: "Financeiro", status: "ativo", ultimaRevisao: "2026-08-01" },
  { id: "DK-011", nome: "HP ProDesk 400", tipo: "Desktop", usuario: "Pedro Lima", setor: "RH", status: "manutencao", ultimaRevisao: "2026-09-10" },
  { id: "NB-044", nome: "Dell Latitude 5430", tipo: "Notebook", usuario: undefined, setor: "Estoque", status: "disponivel", ultimaRevisao: "2026-09-01" },
  { id: "SV-003", nome: "Dell PowerEdge R640", tipo: "Servidor", usuario: undefined, setor: "TI", status: "ativo", ultimaRevisao: "2026-06-30" },
  { id: "SW-007", nome: "Cisco SG350-28", tipo: "Switch", usuario: undefined, setor: "TI", status: "ativo", ultimaRevisao: "2026-05-20" },
  { id: "NB-039", nome: "HP EliteBook 840", tipo: "Notebook", usuario: undefined, setor: "—", status: "descarte", ultimaRevisao: "2025-12-10" },
];

function PrioridadeBadge({ p }: { p: Prioridade }) {
  const map = {
    critica: "bg-red-500/20 text-red-400 border-red-500/30",
    alta: "bg-orange-500/20 text-orange-400 border-orange-500/30",
    media: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    baixa: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
  };
  const labels = { critica: "Crítica", alta: "Alta", media: "Média", baixa: "Baixa" };
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

function TabTickets() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<TicketStatus | "todos">("todos");

  const filtered = tickets.filter(t => {
    const matchSearch = t.titulo.toLowerCase().includes(search.toLowerCase()) || t.id.toLowerCase().includes(search.toLowerCase()) || t.solicitante.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "todos" || t.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const slaViolados = tickets.filter(t => t.sla < 0 && t.status !== "resolvido" && t.status !== "fechado").length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Abertos", value: tickets.filter(t => t.status === "aberto").length, icon: <AlertCircle className="w-4 h-4 text-blue-400" /> },
          { label: "Em atendimento", value: tickets.filter(t => t.status === "em_atendimento").length, icon: <Clock className="w-4 h-4 text-yellow-400" /> },
          { label: "SLA violados", value: slaViolados, icon: <XCircle className="w-4 h-4 text-red-400" /> },
          { label: "Resolvidos hoje", value: tickets.filter(t => t.status === "resolvido").length, icon: <CheckCircle2 className="w-4 h-4 text-green-400" /> },
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
        {filtered.map(t => (
          <div key={t.id} className={`p-4 rounded-lg bg-white/5 border transition-colors hover:border-white/20 ${t.sla < 0 && t.status !== "resolvido" && t.status !== "fechado" ? "border-red-500/30" : "border-white/10"}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 min-w-0">
                <CategoryIcon cat={t.categoria} />
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-mono text-zinc-500">{t.id}</span>
                    <p className="text-sm font-medium text-zinc-200 truncate">{t.titulo}</p>
                  </div>
                  <div className="flex items-center gap-3 mt-1 flex-wrap">
                    <span className="text-xs text-zinc-500">{t.solicitante}</span>
                    <span className="text-xs text-zinc-500">· {t.categoria}</span>
                    {t.atendente && <span className="text-xs text-zinc-500">· {t.atendente}</span>}
                    <span className="text-xs text-zinc-500">· {t.criado}</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <SLABadge hours={t.sla} />
                <PrioridadeBadge p={t.prioridade} />
                <StatusBadge s={t.status} />
              </div>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="text-center py-12 text-zinc-500">Nenhum ticket encontrado</div>
        )}
      </div>
    </div>
  );
}

function TabInventario() {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-4 mb-2">
        {[
          { label: "Ativos", value: inventario.filter(i => i.status === "ativo").length },
          { label: "Disponíveis", value: inventario.filter(i => i.status === "disponivel").length },
          { label: "Em manutenção", value: inventario.filter(i => i.status === "manutencao").length },
          { label: "Total", value: inventario.length },
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
            {inventario.map(item => (
              <tr key={item.id} className="hover:bg-white/5 transition-colors">
                <td className="px-4 py-3 text-xs font-mono text-zinc-400">{item.id}</td>
                <td className="px-4 py-3 text-zinc-200">{item.nome}</td>
                <td className="px-4 py-3 text-zinc-400 text-xs">{item.tipo}</td>
                <td className="px-4 py-3 text-zinc-400 text-xs">{item.usuario ?? <span className="text-zinc-600">—</span>}</td>
                <td className="px-4 py-3 text-zinc-400 text-xs">{item.setor}</td>
                <td className="px-4 py-3"><EquipStatusBadge s={item.status} /></td>
                <td className="px-4 py-3 text-zinc-500 text-xs">{item.ultimaRevisao}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function HelpdeskView({ onBack }: HelpdeskViewProps) {
  const abertos = tickets.filter(t => t.status === "aberto" || t.status === "em_atendimento").length;
  const slaViolados = tickets.filter(t => t.sla < 0 && t.status !== "resolvido" && t.status !== "fechado").length;
  const satisfacao = 94;

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
              { label: "Satisfação", value: `${satisfacao}%`, icon: <TrendingUp className="w-4 h-4 text-green-400 mx-auto mb-1" /> },
              { label: "Equipamentos", value: inventario.length, icon: <BarChart3 className="w-4 h-4 text-cyan-400 mx-auto mb-1" /> },
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

        <TabsContent value="tickets"><TabTickets /></TabsContent>
        <TabsContent value="inventario"><TabInventario /></TabsContent>
      </Tabs>

      {/* Footer */}
      <div className="mt-6 pt-4 border-t border-white/10 flex items-center justify-between text-xs text-zinc-500">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> Carlos TI · Fernanda TI</span>
          <span className="flex items-center gap-1.5"><Server className="w-3.5 h-3.5" /> Infraestrutura PGBA</span>
        </div>
        <span>Setor TI</span>
      </div>
    </div>
  );
}

// frontend/src/components/empresa/helpdesk.tsx
//
// Setor TI — observabilidade de tudo (plataforma, IA de cada setor, agentes,
// APIs, conectores, MCP, e-mail, redes) e helpdesk: chamados atendidos pelo time
// de TI através de Tasks, com a IA diagnosticando incidentes e sugerindo respostas.
// Cada aba vive em components/empresa/ti/.
import { useCallback, useEffect, useState } from "react";
import { Activity, ArrowLeft, Bot, Bug, Gauge, HardDrive, Headphones, Plug, Siren, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ti, type EquipamentoTI, type EquipeTI, type PainelObs, type PainelTI } from "@/lib/api";
import { ErpCrud, type ColumnDef, type FieldDef } from "@/components/empresa/erp-crud";
import { VisaoTab } from "@/components/empresa/ti/visao";
import { ChamadosTab, NovoChamado } from "@/components/empresa/ti/chamados";
import { IncidenteDetalhe, IncidentesTab } from "@/components/empresa/ti/incidentes";
import { AgentesTab } from "@/components/empresa/ti/agentes";
import { IntegracoesTab } from "@/components/empresa/ti/integracoes";
import { ErrosTab } from "@/components/empresa/ti/erros";
import { TimeTab } from "@/components/empresa/ti/time";
import { Dot, Tag } from "@/components/empresa/ti/shared";

const TAB_KEY = "pgba_ti_tab";
const TABS = [
  { id: "visao", label: "Visão geral", icon: Gauge },
  { id: "chamados", label: "Chamados", icon: Headphones },
  { id: "incidentes", label: "Incidentes", icon: Siren },
  { id: "agentes", label: "Agentes", icon: Bot },
  { id: "integracoes", label: "APIs e integrações", icon: Plug },
  { id: "erros", label: "Erros", icon: Bug, staff: true },
  { id: "inventario", label: "Inventário", icon: HardDrive },
  { id: "time", label: "Time", icon: Users },
] as const;
type Tab = (typeof TABS)[number]["id"];

const EQUIP_FIELDS: FieldDef[] = [
  { name: "codigo", label: "Código / patrimônio", required: true },
  { name: "nome", label: "Nome", required: true },
  { name: "tipo", label: "Tipo", type: "select", options: ["notebook", "desktop", "servidor", "switch", "roteador", "impressora", "monitor", "outro"].map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) })) },
  { name: "status", label: "Status", type: "select", options: [
    { value: "ativo", label: "Ativo" }, { value: "manutencao", label: "Em manutenção" }, { value: "disponivel", label: "Disponível" }, { value: "descarte", label: "Descarte" },
  ] },
  { name: "usuario", label: "Com quem está" },
  { name: "setor", label: "Setor" },
  { name: "ultima_revisao", label: "Última revisão", type: "date" },
  { name: "observacoes", label: "Observações", type: "textarea", wide: true },
];
const EQUIP_TONE: Record<EquipamentoTI["status"], "ok" | "warn" | "info" | "muted"> = { ativo: "ok", manutencao: "warn", disponivel: "info", descarte: "muted" };
const EQUIP_COLS: ColumnDef<EquipamentoTI>[] = [
  { key: "codigo", label: "Código", render: (e) => <span className="font-mono text-xs">{e.codigo}</span> },
  { key: "nome", label: "Equipamento" },
  { key: "tipo", label: "Tipo" },
  { key: "usuario", label: "Com quem", render: (e) => e.usuario || "—" },
  { key: "setor", label: "Setor", render: (e) => e.setor || "—" },
  { key: "status", label: "Status", render: (e) => <Tag tone={EQUIP_TONE[e.status]}>{e.status}</Tag> },
  { key: "ultima_revisao", label: "Revisão", render: (e) => (e.ultima_revisao ? new Date(`${e.ultima_revisao}T12:00`).toLocaleDateString("pt-BR") : "—") },
];

export function HelpdeskView({ onBack }: { onBack: () => void }) {
  const [tab, setTabState] = useState<Tab>(() => {
    try { return (sessionStorage.getItem(TAB_KEY) as Tab) || "visao"; } catch { return "visao"; }
  });
  const [reload, setReload] = useState(0);
  const [obs, setObs] = useState<PainelObs | null>(null);
  const [painel, setPainel] = useState<PainelTI | null>(null);
  const [equipe, setEquipe] = useState<EquipeTI | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [chamadoAberto, setChamadoAberto] = useState<number | null>(null);
  const [incidenteAberto, setIncidenteAberto] = useState<number | null>(null);
  const [novo, setNovo] = useState(false);

  const setTab = (t: string) => {
    try { sessionStorage.setItem(TAB_KEY, t); } catch { /* aba privada */ }
    setTabState(t as Tab);
  };
  const changed = useCallback(() => setReload((r) => r + 1), []);
  const limparChamado = useCallback(() => setChamadoAberto(null), []);

  useEffect(() => {
    let vivo = true;
    const buscar = () => Promise.allSettled([ti.obs(), ti.painel(), ti.equipe()]).then(([o, p, e]) => {
      if (!vivo) return;
      if (o.status === "fulfilled") setObs(o.value);
      if (p.status === "fulfilled") setPainel(p.value);
      if (e.status === "fulfilled") setEquipe(e.value);
      setCarregando(false);
    });
    buscar();
    const t = setInterval(buscar, 30_000); // o monitoramento roda a cada minuto
    return () => { vivo = false; clearInterval(t); };
  }, [reload]);

  const abrirChamado = (id: number) => { setTab("chamados"); setChamadoAberto(id); };
  const fora = obs?.contagem.falha ?? 0;
  const trabalhando = equipe?.agentes.filter((a) => a.work_status === "working") ?? [];
  const tabs = TABS.filter((t) => !("staff" in t) || obs?.staff);

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-border bg-gradient-to-r from-secondary via-teal-500/10 to-transparent px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={onBack} className="grid size-8 shrink-0 place-items-center rounded-md transition-colors hover:bg-secondary" title="Voltar">
            <ArrowLeft className="size-4" />
          </button>
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-teal-500/15 text-teal-700 dark:text-teal-300"><Activity className="size-5" /></span>
          <div className="min-w-0">
            <h2 className="font-display text-lg font-semibold">TI · Observabilidade e Helpdesk</h2>
            <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              {obs && <><Dot status={fora ? "falha" : (obs.contagem.alerta ? "alerta" : obs.componentes.length ? "ok" : "desconhecido")} pulse />
                {fora ? `${fora} fora do ar` : obs.contagem.alerta ? `${obs.contagem.alerta} com atenção` : obs.componentes.length ? "tudo no ar" : "sem verificação ainda"} ·</>}
              {painel && <span>{painel.abertos} chamado(s) em aberto</span>}
              {trabalhando.length > 0 && <span className="text-success">· {trabalhando.map((a) => a.nome).join(", ")} trabalhando</span>}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <a href="/status" target="_blank" rel="noreferrer" className="text-xs text-muted-foreground underline-offset-2 hover:underline">Página de status pública</a>
            <Button size="sm" onClick={() => setNovo(true)}><Headphones className="size-3.5" /> Abrir chamado</Button>
          </div>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto rounded-xl bg-secondary p-1">
        {tabs.map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)}
            className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition ${tab === t.id ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
            <t.icon className="size-4" /> {t.label}
            {t.id === "incidentes" && !!obs?.incidentes_abertos.length && <span className="rounded-full bg-destructive px-1.5 text-[10px] text-destructive-foreground">{obs.incidentes_abertos.length}</span>}
            {t.id === "chamados" && !!painel?.sla_estourado && <span className="rounded-full bg-warning px-1.5 text-[10px] text-warning-foreground">{painel.sla_estourado}</span>}
            {t.id === "erros" && !!obs?.erros_abertos && <span className="rounded-full bg-secondary-foreground/15 px-1.5 text-[10px]">{obs.erros_abertos}</span>}
          </button>
        ))}
      </div>

      {tab === "visao" && <VisaoTab obs={obs} painel={painel} carregando={carregando} recarregar={changed} onGo={setTab} abrirIncidente={setIncidenteAberto} />}
      {tab === "chamados" && <ChamadosTab reloadKey={reload} abrirId={chamadoAberto} onAberto={limparChamado} onChanged={changed} />}
      {tab === "incidentes" && <IncidentesTab reloadKey={reload} abrirChamado={abrirChamado} />}
      {tab === "agentes" && <AgentesTab reloadKey={reload} />}
      {tab === "integracoes" && <IntegracoesTab reloadKey={reload} staff={!!obs?.staff} componentes={obs?.componentes ?? []} />}
      {tab === "erros" && obs?.staff && <ErrosTab reloadKey={reload} onChanged={changed} />}
      {tab === "inventario" && (
        <ErpCrud<EquipamentoTI>
          resource="helpdesk/equipamentos"
          title="Inventário de TI"
          description="Notebooks, servidores, rede e periféricos — com quem está, setor e última revisão."
          singular="equipamento"
          fields={EQUIP_FIELDS}
          columns={EQUIP_COLS}
          defaults={{ tipo: "notebook", status: "ativo" }}
          filters={[
            { label: "Todos", params: {} },
            { label: "Ativos", params: { status: "ativo" } },
            { label: "Em manutenção", params: { status: "manutencao" } },
            { label: "Disponíveis", params: { status: "disponivel" } },
          ]}
          emptyText="Nenhum equipamento cadastrado."
        />
      )}
      {tab === "time" && <TimeTab equipe={equipe} onChanged={changed} />}

      {incidenteAberto && tab !== "incidentes" && (
        <IncidenteDetalhe id={incidenteAberto} onClose={() => setIncidenteAberto(null)} onChanged={changed} abrirChamado={abrirChamado} />
      )}
      {novo && <NovoChamado onClose={() => setNovo(false)} onCriado={(t) => { setNovo(false); changed(); abrirChamado(t.id); }} />}
    </div>
  );
}

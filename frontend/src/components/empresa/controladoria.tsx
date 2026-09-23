import { useState } from "react"
import {
  TrendingUp,
  TrendingDown,
  ChevronDown,
  ChevronRight,
  Lock,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { SectionHeader, Metric } from "@/components/empresa/shared"

// ── Mock data ─────────────────────────────────────────────────────────────────

const KPI_CONTROLADORIA = [
  { label: "Receita Realizada", value: "R$ 4,82M", sub: "YTD" },
  { label: "Budget Receita", value: "R$ 5,10M", sub: "Anual pro-rated" },
  { label: "% Atingimento", value: "94,5%", sub: "-5,5 p.p. vs meta" },
  { label: "Desvio OPEX", value: "+R$ 187K", sub: "acima do budget" },
  { label: "Margem EBITDA", value: "21,3%", sub: "meta: 24,0%" },
  { label: "Forecast Fechamento", value: "R$ 5,91M", sub: "revisado" },
]

const CENTROS_CUSTO = [
  { cc: "TI & Infraestrutura", budget: 480000, realizado: 413200, tendencia: "up" },
  { cc: "Comercial", budget: 320000, realizado: 298700, tendencia: "down" },
  { cc: "Operações", budget: 750000, realizado: 781400, tendencia: "up" },
  { cc: "RH & Pessoas", budget: 210000, realizado: 195600, tendencia: "down" },
  { cc: "Marketing", budget: 140000, realizado: 162300, tendencia: "up" },
  { cc: "Financeiro", budget: 95000, realizado: 88100, tendencia: "down" },
  { cc: "Jurídico", budget: 60000, realizado: 57400, tendencia: "down" },
]

const MONTHLY_DATA = [
  { mes: "Jan", receita: 82, despesa: 68 },
  { mes: "Fev", receita: 75, despesa: 71 },
  { mes: "Mar", receita: 91, despesa: 74 },
  { mes: "Abr", receita: 88, despesa: 76 },
  { mes: "Mai", receita: 94, despesa: 79 },
  { mes: "Jun", receita: 100, despesa: 83 },
  { mes: "Jul", receita: 87, despesa: 85 },
  { mes: "Ago", receita: 96, despesa: 81 },
  { mes: "Set", receita: 78, despesa: 77 },
  { mes: "Out", receita: 103, despesa: 88 },
  { mes: "Nov", receita: 98, despesa: 84 },
  { mes: "Dez", receita: 110, despesa: 91 },
]

const TOP_DESVIOS = [
  { area: "Operações", desvio: +31400, pct: "+4,2%", motivo: "Aumento de custos logísticos Q3" },
  { area: "Marketing", desvio: +22300, pct: "+15,9%", motivo: "Campanha extra aprovada fora do budget" },
  { area: "TI & Infraestrutura", desvio: -66800, pct: "-13,9%", motivo: "Migração cloud adiada para Q1 próximo" },
  { area: "Comercial", desvio: -21300, pct: "-6,7%", motivo: "Redução em viagens e eventos presenciais" },
  { area: "RH & Pessoas", desvio: -14400, pct: "-6,9%", motivo: "Vagas abertas sem preenchimento no semestre" },
]

const KPI_AUDITORIA = [
  { label: "Eventos Hoje", value: "234", sub: "última atualização: agora" },
  { label: "Eventos 30 dias", value: "6.847", sub: "+12% vs mês anterior" },
  { label: "Usuários Ativos", value: "41", sub: "sessões abertas" },
  { label: "Alertas Pendentes", value: "7", sub: "3 críticos" },
]

type AuditEvent = {
  id: number
  ts: string
  usuario: string
  modulo: string
  acao: string
  recurso: string
  ip: string
  detalhes: string
}

const AUDIT_EVENTS: AuditEvent[] = [
  { id: 1, ts: "2026-09-23 14:52:03", usuario: "ana.lima", modulo: "Admin", acao: "DELETE", recurso: "User #4821", ip: "192.168.x.x", detalhes: "Exclusão de conta inativa há 180 dias" },
  { id: 2, ts: "2026-09-23 14:48:17", usuario: "carlos.melo", modulo: "Financeiro", acao: "EXPORT", recurso: "RelatorioMensal_Set2026.xlsx", ip: "10.0.x.x", detalhes: "Exportação aprovada pelo gerente financeiro" },
  { id: 3, ts: "2026-09-23 14:31:44", usuario: "joao.ferreira", modulo: "CRM", acao: "UPDATE", recurso: "Lead #9023", ip: "172.16.x.x", detalhes: "Atualização de status: qualificado → proposta" },
  { id: 4, ts: "2026-09-23 14:20:05", usuario: "mariana.costa", modulo: "IAR", acao: "CREATE", recurso: "QueryLog #112899", ip: "10.0.x.x", detalhes: "Consulta ao módulo de orquestração — tokens: 1.240" },
  { id: 5, ts: "2026-09-23 13:58:29", usuario: "tech.admin", modulo: "Admin", acao: "LOGIN", recurso: "Painel Administrativo", ip: "203.0.x.x", detalhes: "Login bem-sucedido via SSO" },
  { id: 6, ts: "2026-09-23 13:45:11", usuario: "beatriz.santos", modulo: "ERP", acao: "UPDATE", recurso: "Contrato #5502", ip: "192.168.x.x", detalhes: "Renovação automática aprovada — prazo: 12 meses" },
  { id: 7, ts: "2026-09-23 13:30:00", usuario: "ana.lima", modulo: "Financeiro", acao: "CREATE", recurso: "LançamentoManual #884", ip: "192.168.x.x", detalhes: "Lançamento de ajuste contábil — aprovação pendente" },
  { id: 8, ts: "2026-09-23 12:59:48", usuario: "paulo.rocha", modulo: "CRM", acao: "DELETE", recurso: "Oportunidade #3319", ip: "172.16.x.x", detalhes: "Oportunidade encerrada — perda para concorrente" },
  { id: 9, ts: "2026-09-23 12:41:22", usuario: "mariana.costa", modulo: "Admin", acao: "UPDATE", recurso: "PolicyRule #17", ip: "10.0.x.x", detalhes: "Autonomia de agente alterada: OBSERVER → RECOMMENDER" },
  { id: 10, ts: "2026-09-23 12:15:03", usuario: "carlos.melo", modulo: "IAR", acao: "EXPORT", recurso: "KnowledgeSource #7 chunks", ip: "10.0.x.x", detalhes: "Export de embeddings para auditoria externa" },
  { id: 11, ts: "2026-09-23 11:50:34", usuario: "joao.ferreira", modulo: "ERP", acao: "CREATE", recurso: "OrdemCompra #6670", ip: "172.16.x.x", detalhes: "OC emitida — valor: R$ 18.400" },
  { id: 12, ts: "2026-09-23 11:22:09", usuario: "tech.admin", modulo: "Admin", acao: "UPDATE", recurso: "Tenant config", ip: "203.0.x.x", detalhes: "ENCRYPTION_KEY rotacionada via Django admin" },
  { id: 13, ts: "2026-09-23 10:47:55", usuario: "beatriz.santos", modulo: "Financeiro", acao: "LOGIN", recurso: "Módulo Financeiro", ip: "192.168.x.x", detalhes: "Acesso ao módulo financeiro — sessão nº 8821" },
  { id: 14, ts: "2026-09-23 10:30:18", usuario: "paulo.rocha", modulo: "CRM", acao: "UPDATE", recurso: "Conta #1102", ip: "172.16.x.x", detalhes: "Score de risco atualizado de Médio para Alto" },
  { id: 15, ts: "2026-09-23 09:58:41", usuario: "ana.lima", modulo: "IAR", acao: "CREATE", recurso: "KnowledgeSource #12", ip: "192.168.x.x", detalhes: "Nova fonte de conhecimento indexada — 348 documentos" },
]

type AlertaConformidade = {
  id: number
  titulo: string
  severidade: "Crítico" | "Alto" | "Médio" | "Baixo"
  tags: string[]
  descricao: string
  prazo: string
}

const ALERTAS: AlertaConformidade[] = [
  { id: 1, titulo: "Retenção de dados PII além do prazo", severidade: "Crítico", tags: ["LGPD", "ISO27001"], descricao: "27 registros com dados pessoais retidos além de 5 anos sem consentimento renovado.", prazo: "Vence em 2 dias" },
  { id: 2, titulo: "Exportação de dados sem aprovação dupla", severidade: "Crítico", tags: ["SOX"], descricao: "3 exportações financeiras realizadas sem segunda aprovação exigida pelo controle SOX.", prazo: "Imediato" },
  { id: 3, titulo: "Acesso privilegiado sem revisão trimestral", severidade: "Alto", tags: ["ISO27001"], descricao: "14 contas com perfil admin não passaram pela revisão trimestral de acessos.", prazo: "Vence em 7 dias" },
  { id: 4, titulo: "Logs de auditoria com gap de 4h", severidade: "Alto", tags: ["LGPD", "SOX"], descricao: "Intervalo sem registro de eventos detectado em 2026-09-21 entre 02h e 06h UTC.", prazo: "Vence em 5 dias" },
  { id: 5, titulo: "Política de senha desatualizada", severidade: "Médio", tags: ["ISO27001"], descricao: "Política de rotação de senhas configurada para 180 dias; recomendação é 90 dias.", prazo: "Vence em 30 dias" },
  { id: 6, titulo: "Relatório ROPA desatualizado", severidade: "Médio", tags: ["LGPD"], descricao: "Registro de Atividades de Processamento não atualizado após adição do módulo CRM.", prazo: "Vence em 14 dias" },
  { id: 7, titulo: "Backup de chave de criptografia sem verificação", severidade: "Baixo", tags: ["ISO27001"], descricao: "Último teste de restauração do backup da ENCRYPTION_KEY há 47 dias (limite: 60 dias).", prazo: "Vence em 13 dias" },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmtBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v)

const acaoBadgeClass: Record<string, string> = {
  CREATE: "bg-success text-success-foreground",
  UPDATE: "bg-primary text-primary-foreground",
  DELETE: "bg-destructive text-destructive-foreground",
  LOGIN: "bg-secondary text-foreground",
  EXPORT: "bg-warning text-warning-foreground",
}

const severidadeClass: Record<string, string> = {
  Crítico: "bg-destructive text-destructive-foreground",
  Alto: "bg-warning text-warning-foreground",
  Médio: "bg-secondary text-foreground border border-border",
  Baixo: "bg-elevated text-muted-foreground border border-border",
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function ProgressBar({ pct }: { pct: number }) {
  const over = pct > 100
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${over ? "bg-warning" : "bg-primary"}`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      <span className={`text-xs tabular-nums w-12 text-right ${over ? "text-warning" : "text-muted-foreground"}`}>
        {pct.toFixed(1)}%
      </span>
    </div>
  )
}

function BarChart() {
  const max = Math.max(...MONTHLY_DATA.map((d) => Math.max(d.receita, d.despesa)))
  return (
    <div className="space-y-2">
      <div className="flex gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-primary" /> Receita</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-warning opacity-80" /> Despesas</span>
      </div>
      <div className="flex items-end gap-1.5 h-40">
        {MONTHLY_DATA.map((d) => (
          <div key={d.mes} className="flex-1 flex flex-col items-center gap-0.5">
            <div className="w-full flex items-end gap-0.5 h-32">
              <div
                className="flex-1 bg-primary rounded-t-sm opacity-90"
                style={{ height: `${(d.receita / max) * 100}%` }}
                title={`Receita ${d.mes}: ${d.receita}K`}
              />
              <div
                className="flex-1 bg-warning rounded-t-sm opacity-70"
                style={{ height: `${(d.despesa / max) * 100}%` }}
                title={`Despesas ${d.mes}: ${d.despesa}K`}
              />
            </div>
            <span className="text-[10px] text-muted-foreground">{d.mes}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function AuditRow({ event }: { event: AuditEvent }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <tr className="border-b border-border hover:bg-elevated transition-colors">
        <td className="py-2 px-3 text-xs text-muted-foreground tabular-nums whitespace-nowrap">{event.ts}</td>
        <td className="py-2 px-3 text-xs text-foreground font-medium">{event.usuario}</td>
        <td className="py-2 px-3 text-xs text-muted-foreground">{event.modulo}</td>
        <td className="py-2 px-3">
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${acaoBadgeClass[event.acao] ?? "bg-secondary text-foreground"}`}>
            {event.acao}
          </span>
        </td>
        <td className="py-2 px-3 text-xs text-foreground max-w-[160px] truncate">{event.recurso}</td>
        <td className="py-2 px-3 text-xs text-muted-foreground font-mono">{event.ip}</td>
        <td className="py-2 px-3">
          <button
            onClick={() => setOpen((v) => !v)}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Expandir detalhes"
          >
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        </td>
      </tr>
      {open && (
        <tr className="bg-elevated border-b border-border">
          <td colSpan={7} className="px-3 py-2 text-xs text-muted-foreground italic">{event.detalhes}</td>
        </tr>
      )}
    </>
  )
}

// ── Tabs ───────────────────────────────────────────────────────────────────────

function TabControladoria() {
  return (
    <div className="space-y-6">
      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {KPI_CONTROLADORIA.map((k) => (
          <Metric key={k.label} label={k.label} value={k.value} />
        ))}
      </div>

      {/* Budget vs Realizado */}
      <div className="panel-elevated rounded-md p-4 space-y-3">
        <SectionHeader title="Budget vs Realizado" />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                {["Centro de Custo", "Budget Anual", "Realizado YTD", "Saldo", "% Consumido", "Tendência"].map((h) => (
                  <th key={h} className="pb-2 px-2 text-xs font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CENTROS_CUSTO.map((row) => {
                const saldo = row.budget - row.realizado
                const pct = (row.realizado / row.budget) * 100
                return (
                  <tr key={row.cc} className="border-b border-border hover:bg-elevated transition-colors">
                    <td className="py-2.5 px-2 text-xs text-foreground font-medium">{row.cc}</td>
                    <td className="py-2.5 px-2 text-xs text-muted-foreground tabular-nums">{fmtBRL(row.budget)}</td>
                    <td className="py-2.5 px-2 text-xs text-foreground tabular-nums">{fmtBRL(row.realizado)}</td>
                    <td className={`py-2.5 px-2 text-xs tabular-nums font-medium ${saldo >= 0 ? "text-success" : "text-warning"}`}>
                      {saldo >= 0 ? "+" : ""}{fmtBRL(saldo)}
                    </td>
                    <td className="py-2.5 px-2 w-40">
                      <ProgressBar pct={pct} />
                    </td>
                    <td className="py-2.5 px-2">
                      {row.tendencia === "up" ? (
                        <TrendingUp size={14} className="text-warning" />
                      ) : (
                        <TrendingDown size={14} className="text-success" />
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Evolução Mensal */}
      <div className="panel-elevated rounded-md p-4 space-y-3">
        <SectionHeader title="Evolução Mensal — Receita vs Despesas" />
        <BarChart />
      </div>

      {/* Top Desvios */}
      <div className="panel-elevated rounded-md p-4 space-y-3">
        <SectionHeader title="Top Desvios Orçamentários" />
        <ul className="space-y-2">
          {TOP_DESVIOS.map((d) => (
            <li key={d.area} className="flex items-start gap-3 p-2.5 bg-secondary rounded-md border border-border">
              <span className={`mt-0.5 text-xs font-semibold tabular-nums px-2 py-0.5 rounded-md ${d.desvio > 0 ? "bg-warning text-warning-foreground" : "bg-success text-success-foreground"}`}>
                {d.desvio > 0 ? "+" : ""}{fmtBRL(d.desvio)}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground">{d.area} <span className="text-muted-foreground font-normal">({d.pct})</span></p>
                <p className="text-xs text-muted-foreground mt-0.5">{d.motivo}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function TabAuditoria() {
  const [modulo, setModulo] = useState("all")
  const [acao, setAcao] = useState("all")
  const [usuario, setUsuario] = useState("")
  const [expandedAlerta, setExpandedAlerta] = useState<number | null>(null)

  const filtered = AUDIT_EVENTS.filter((e) => {
    if (modulo !== "all" && e.modulo !== modulo) return false
    if (acao !== "all" && e.acao !== acao) return false
    if (usuario && !e.usuario.toLowerCase().includes(usuario.toLowerCase())) return false
    return true
  })

  return (
    <div className="space-y-6">
      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {KPI_AUDITORIA.map((k) => (
          <Metric key={k.label} label={k.label} value={k.value} />
        ))}
      </div>

      {/* Trilha de Auditoria */}
      <div className="panel-elevated rounded-md p-4 space-y-3">
        <SectionHeader title="Trilha de Auditoria" />

        {/* Filters */}
        <div className="flex flex-wrap gap-2">
          <Select value={modulo} onValueChange={setModulo}>
            <SelectTrigger className="w-36 h-8 text-xs">
              <SelectValue placeholder="Módulo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos módulos</SelectItem>
              {["CRM", "ERP", "IAR", "Admin", "Financeiro"].map((m) => (
                <SelectItem key={m} value={m}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={acao} onValueChange={setAcao}>
            <SelectTrigger className="w-36 h-8 text-xs">
              <SelectValue placeholder="Ação" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas ações</SelectItem>
              {["CREATE", "UPDATE", "DELETE", "LOGIN", "EXPORT"].map((a) => (
                <SelectItem key={a} value={a}>{a}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <input
            type="text"
            placeholder="Filtrar por usuário..."
            value={usuario}
            onChange={(e) => setUsuario(e.target.value)}
            className="h-8 px-3 text-xs rounded-md border border-border bg-secondary text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />

          {(modulo !== "all" || acao !== "all" || usuario) && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs text-muted-foreground"
              onClick={() => { setModulo("all"); setAcao("all"); setUsuario("") }}
            >
              Limpar filtros
            </Button>
          )}

          <span className="ml-auto self-center text-xs text-muted-foreground">
            {filtered.length} evento{filtered.length !== 1 ? "s" : ""}
          </span>
        </div>

        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full">
            <thead className="bg-secondary">
              <tr>
                {["Timestamp", "Usuário", "Módulo", "Ação", "Recurso", "IP", ""].map((h) => (
                  <th key={h} className="py-2 px-3 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-xs text-muted-foreground">Nenhum evento encontrado com os filtros aplicados.</td>
                </tr>
              ) : (
                filtered.map((e) => <AuditRow key={e.id} event={e} />)
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Alertas de Conformidade */}
      <div className="panel-elevated rounded-md p-4 space-y-3">
        <div className="flex items-center justify-between">
          <SectionHeader title="Alertas de Conformidade" />
          <Badge className="bg-destructive text-destructive-foreground text-xs">
            {ALERTAS.filter((a) => a.severidade === "Crítico").length} críticos
          </Badge>
        </div>
        <ul className="space-y-2">
          {ALERTAS.map((alerta) => (
            <li key={alerta.id} className="border border-border rounded-md overflow-hidden">
              <button
                className="w-full flex items-start gap-3 p-3 hover:bg-elevated transition-colors text-left"
                onClick={() => setExpandedAlerta(expandedAlerta === alerta.id ? null : alerta.id)}
              >
                <span className={`mt-0.5 shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${severidadeClass[alerta.severidade]}`}>
                  {alerta.severidade}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-medium text-foreground">{alerta.titulo}</span>
                    {alerta.tags.map((tag) => (
                      <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-elevated text-muted-foreground border border-border">
                        {tag}
                      </span>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{alerta.prazo}</p>
                </div>
                <Lock size={13} className="shrink-0 mt-0.5 text-muted-foreground" />
              </button>
              {expandedAlerta === alerta.id && (
                <div className="px-3 pb-3 bg-elevated border-t border-border">
                  <p className="text-xs text-muted-foreground pt-2">{alerta.descricao}</p>
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" variant="outline" className="h-7 text-xs">Atribuir</Button>
                    <Button size="sm" className="h-7 text-xs">Marcar como tratado</Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

export function ControladoriaView() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Controladoria &amp; Auditoria</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Controle orçamentário, desvios e trilha de auditoria centralizada
        </p>
      </div>

      <Tabs defaultValue="controladoria">
        <TabsList className="mb-4">
          <TabsTrigger value="controladoria">Controladoria</TabsTrigger>
          <TabsTrigger value="auditoria">Auditoria</TabsTrigger>
        </TabsList>

        <TabsContent value="controladoria">
          <TabControladoria />
        </TabsContent>

        <TabsContent value="auditoria">
          <TabAuditoria />
        </TabsContent>
      </Tabs>
    </div>
  )
}

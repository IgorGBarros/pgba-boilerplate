import { useState, useEffect } from "react"
import {
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  ChevronDown,
  ChevronRight,
  Lock,
  ShieldCheck,
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
import {
  CentroCusto,
  EntradaAuditoria,
  AlertaConformidade,
  listCentrosCusto,
  listEntradasAuditoria,
  listAlertasConformidade,
  updateAlertaConformidade,
} from "@/lib/api"

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmtBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v)

const acaoBadgeClass: Record<string, string> = {
  CREATE: "bg-success text-success-foreground",
  UPDATE: "bg-primary text-primary-foreground",
  DELETE: "bg-destructive text-destructive-foreground",
  LOGIN: "bg-secondary text-foreground",
  EXPORT: "bg-warning text-warning-foreground",
  VIEW: "bg-elevated text-muted-foreground border border-border",
}

const severidadeClass: Record<string, string> = {
  critico: "bg-destructive text-destructive-foreground",
  alto: "bg-warning text-warning-foreground",
  medio: "bg-secondary text-foreground border border-border",
  baixo: "bg-elevated text-muted-foreground border border-border",
}

const severidadeLabel: Record<string, string> = {
  critico: "Crítico",
  alto: "Alto",
  medio: "Médio",
  baixo: "Baixo",
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

function AuditRow({ event }: { event: EntradaAuditoria }) {
  const [open, setOpen] = useState(false)
  const ts = new Date(event.created_at).toLocaleString("pt-BR")
  return (
    <>
      <tr className="border-b border-border hover:bg-elevated transition-colors">
        <td className="py-2 px-3 text-xs text-muted-foreground tabular-nums whitespace-nowrap">{ts}</td>
        <td className="py-2 px-3 text-xs text-foreground font-medium">{event.usuario}</td>
        <td className="py-2 px-3 text-xs text-muted-foreground">{event.modulo}</td>
        <td className="py-2 px-3">
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${acaoBadgeClass[event.acao] ?? "bg-secondary text-foreground"}`}>
            {event.acao}
          </span>
        </td>
        <td className="py-2 px-3 text-xs text-foreground max-w-[160px] truncate">{event.recurso}</td>
        <td className="py-2 px-3 text-xs text-muted-foreground font-mono">{event.ip ?? "—"}</td>
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
          <td colSpan={7} className="px-3 py-2 text-xs text-muted-foreground italic">{event.detalhes || "—"}</td>
        </tr>
      )}
    </>
  )
}

// ── Tabs ───────────────────────────────────────────────────────────────────────

function TabControladoria() {
  const [centros, setCentros] = useState<CentroCusto[]>([])

  useEffect(() => {
    listCentrosCusto().then(setCentros).catch(() => {})
  }, [])

  const totalBudget = centros.reduce((s, c) => s + parseFloat(c.budget), 0)
  const totalRealizado = centros.reduce((s, c) => s + parseFloat(c.realizado), 0)
  const pctAtingimento = totalBudget > 0 ? (totalRealizado / totalBudget) * 100 : 0
  const desvioOpex = totalRealizado - totalBudget

  return (
    <div className="space-y-6">
      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        <Metric label="Budget Total" value={fmtBRL(totalBudget)} />
        <Metric label="Realizado YTD" value={fmtBRL(totalRealizado)} />
        <Metric label="% Atingimento" value={`${pctAtingimento.toFixed(1)}%`} />
        <Metric label="Desvio OPEX" value={(desvioOpex >= 0 ? "+" : "") + fmtBRL(desvioOpex)} />
      </div>

      {/* Budget vs Realizado */}
      <div className="panel-elevated rounded-md p-4 space-y-3">
        <SectionHeader title="Budget vs Realizado" />
        {centros.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">Nenhum centro de custo cadastrado.</p>
        ) : (
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
                {centros.map((row) => {
                  const budget = parseFloat(row.budget)
                  const realizado = parseFloat(row.realizado)
                  const saldo = budget - realizado
                  const pct = budget > 0 ? (realizado / budget) * 100 : 0
                  return (
                    <tr key={row.id} className="border-b border-border hover:bg-elevated transition-colors">
                      <td className="py-2.5 px-2 text-xs text-foreground font-medium">{row.nome}</td>
                      <td className="py-2.5 px-2 text-xs text-muted-foreground tabular-nums">{fmtBRL(budget)}</td>
                      <td className="py-2.5 px-2 text-xs text-foreground tabular-nums">{fmtBRL(realizado)}</td>
                      <td className={`py-2.5 px-2 text-xs tabular-nums font-medium ${saldo >= 0 ? "text-success" : "text-warning"}`}>
                        {saldo >= 0 ? "+" : ""}{fmtBRL(saldo)}
                      </td>
                      <td className="py-2.5 px-2 w-40">
                        <ProgressBar pct={pct} />
                      </td>
                      <td className="py-2.5 px-2">
                        {row.tendencia === "up" ? (
                          <TrendingUp size={14} className="text-warning" />
                        ) : row.tendencia === "down" ? (
                          <TrendingDown size={14} className="text-success" />
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function TabAuditoria() {
  const [auditorias, setAuditorias] = useState<EntradaAuditoria[]>([])
  const [alertas, setAlertas] = useState<AlertaConformidade[]>([])
  const [modulo, setModulo] = useState("all")
  const [acao, setAcao] = useState("all")
  const [usuario, setUsuario] = useState("")
  const [expandedAlerta, setExpandedAlerta] = useState<number | null>(null)

  useEffect(() => {
    listEntradasAuditoria().then(setAuditorias).catch(() => {})
    listAlertasConformidade().then(setAlertas).catch(() => {})
  }, [])

  const filtered = auditorias.filter((e) => {
    if (modulo !== "all" && e.modulo !== modulo) return false
    if (acao !== "all" && e.acao !== acao) return false
    if (usuario && !e.usuario.toLowerCase().includes(usuario.toLowerCase())) return false
    return true
  })

  const modulosUnicos = Array.from(new Set(auditorias.map((e) => e.modulo))).sort()
  const criticosCount = alertas.filter((a) => a.severidade === "critico").length

  async function handleTratarAlerta(id: number) {
    try {
      const updated = await updateAlertaConformidade(id, { status: "resolvido" })
      setAlertas((prev) => prev.map((a) => (a.id === id ? updated : a)))
    } catch {
      // silently ignore
    }
  }

  return (
    <div className="space-y-6">
      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Metric label="Eventos (total)" value={auditorias.length.toLocaleString("pt-BR")} />
        <Metric label="Alertas Abertos" value={alertas.filter((a) => a.status === "aberto").length.toString()} />
        <Metric label="Alertas Críticos" value={criticosCount.toString()} />
        <Metric label="Módulos Monitorados" value={modulosUnicos.length.toString()} />
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
              {modulosUnicos.map((m) => (
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
              {["CREATE", "UPDATE", "DELETE", "LOGIN", "EXPORT", "VIEW"].map((a) => (
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
                  <td colSpan={7} className="py-8 text-center text-xs text-muted-foreground">
                    {auditorias.length === 0
                      ? "Nenhum evento de auditoria registrado ainda."
                      : "Nenhum evento encontrado com os filtros aplicados."}
                  </td>
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
          {criticosCount > 0 && (
            <Badge className="bg-destructive text-destructive-foreground text-xs">
              {criticosCount} crítico{criticosCount !== 1 ? "s" : ""}
            </Badge>
          )}
        </div>
        {alertas.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">Nenhum alerta de conformidade registrado.</p>
        ) : (
          <ul className="space-y-2">
            {alertas.map((alerta) => (
              <li key={alerta.id} className="border border-border rounded-md overflow-hidden">
                <button
                  className="w-full flex items-start gap-3 p-3 hover:bg-elevated transition-colors text-left"
                  onClick={() => setExpandedAlerta(expandedAlerta === alerta.id ? null : alerta.id)}
                >
                  <span className={`mt-0.5 shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${severidadeClass[alerta.severidade]}`}>
                    {severidadeLabel[alerta.severidade] ?? alerta.severidade}
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
                    {alerta.prazo && (
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        Prazo: {new Date(alerta.prazo).toLocaleDateString("pt-BR")}
                      </p>
                    )}
                  </div>
                  <Lock size={13} className="shrink-0 mt-0.5 text-muted-foreground" />
                </button>
                {expandedAlerta === alerta.id && (
                  <div className="px-3 pb-3 bg-elevated border-t border-border">
                    <p className="text-xs text-muted-foreground pt-2">{alerta.descricao}</p>
                    <div className="mt-2 flex gap-2">
                      <Button size="sm" variant="outline" className="h-7 text-xs">Atribuir</Button>
                      <Button
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => handleTratarAlerta(alerta.id)}
                        disabled={alerta.status === "resolvido"}
                      >
                        {alerta.status === "resolvido" ? "Resolvido" : "Marcar como tratado"}
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

export function ControladoriaView({ onBack }: { onBack: () => void }) {
  return (
    <div className="space-y-4">
      {/* ── Page Header ─────────────────────────────────────────────────────── */}
      <div className="rounded-xl bg-gradient-to-r from-amber-600/20 via-orange-600/10 to-transparent border border-amber-500/20 px-5 py-4">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="shrink-0 grid size-8 place-items-center rounded-md text-amber-700 dark:text-amber-300 hover:text-amber-100 hover:bg-amber-500/20 transition-colors">
            <ArrowLeft className="size-4" />
          </button>
          <div className="flex items-center gap-3 min-w-0">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-amber-500/20 text-amber-700 dark:text-amber-300">
              <ShieldCheck className="size-5" />
            </span>
            <div>
              <h2 className="font-semibold text-lg font-display text-foreground">Controladoria &amp; Auditoria</h2>
              <p className="text-xs text-muted-foreground">Controle orçamentário, desvios e trilha de auditoria centralizada</p>
            </div>
          </div>
        </div>
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

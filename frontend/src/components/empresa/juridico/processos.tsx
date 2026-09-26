// frontend/src/components/empresa/juridico/processos.tsx — Painel e Contencioso
import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle, CalendarClock, CheckCircle2, FileSignature, Gavel, Landmark, Loader2, Plus, RefreshCw, Scale,
  ShieldAlert, TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ErpCrud, ErpFormDialog, type ColumnDef } from "@/components/empresa/erp-crud";
import { brl, dataBR } from "@/components/empresa/erp-utils";
import {
  createAndamento, erpUpdate, getPainelJuridico, listAndamentos, listDocumentosJuridicos, listPrazos, syncDataJud,
  type Andamento, type DocumentoJuridico, type PainelJuridico, type Prazo, type Processo,
} from "@/lib/api";
import {
  FASE, PROB_TONE, PROBABILIDADE, PROCESSO_FIELDS, STATUS_CONTRATO_TONE, STATUS_PROC_TONE, STATUS_PROCESSO,
  TIPO_PROCESSO, Tag, label, prazoTexto,
} from "@/components/empresa/juridico/shared";

// ─── Painel ──────────────────────────────────────────────────────────────────

function Kpi({ label: l, value, hint, icon, tone }: { label: string; value: React.ReactNode; hint?: string; icon: React.ReactNode; tone?: "error" | "warn" | "ok" }) {
  const cls = tone === "error" ? "text-destructive" : tone === "warn" ? "text-warning" : tone === "ok" ? "text-success" : "";
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{l}</p>
        <span className="grid size-7 place-items-center rounded-lg bg-secondary text-muted-foreground">{icon}</span>
      </div>
      <p className={`mt-2 font-display text-2xl font-semibold tabular-nums ${cls}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function PainelTab({ onGo }: { onGo: (tab: string) => void }) {
  const [p, setP] = useState<PainelJuridico | null>(null);
  useEffect(() => { getPainelJuridico().then(setP).catch(() => setP(null)); }, []);
  if (!p) return <p className="py-10 text-center text-sm text-muted-foreground">Carregando painel…</p>;
  const totalCont = Number(p.provisao) + Number(p.contingencia_possivel) + Number(p.contingencia_remota);
  const pct = (v: string) => (totalCont ? (Number(v) / totalCont) * 100 : 0);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Processos ativos" value={p.processos_ativos} hint={`${brl(p.valor_em_disputa)} em disputa`} icon={<Scale className="size-4" />} />
        <Kpi label="Provisão (provável)" value={brl(p.provisao)} tone={Number(p.provisao) ? "error" : undefined}
          hint={`+ ${brl(p.contingencia_possivel)} possível`} icon={<ShieldAlert className="size-4" />} />
        <Kpi label="Prazos" value={p.prazos_7_dias} tone={p.prazos_vencidos ? "error" : p.prazos_7_dias ? "warn" : undefined}
          hint={p.prazos_vencidos ? `${p.prazos_vencidos} vencido(s)!` : "nos próximos 7 dias"} icon={<CalendarClock className="size-4" />} />
        <Kpi label="Taxa de êxito" value={p.taxa_exito == null ? "—" : `${p.taxa_exito}%`} tone={p.taxa_exito != null && p.taxa_exito >= 50 ? "ok" : undefined}
          hint={p.encerrados ? `${p.encerrados} encerrado(s) — ganho ou acordo` : "sem processos encerrados"} icon={<TrendingUp className="size-4" />} />
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        <div className="rounded-2xl border border-border bg-surface p-4 lg:col-span-2">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold">Próximos prazos (15 dias)</p>
            <Button size="sm" variant="ghost" onClick={() => onGo("prazos")}>Agenda completa</Button>
          </div>
          {p.proximos_prazos.length ? (
            <ul className="divide-y divide-border">
              {p.proximos_prazos.map((z) => {
                const t = prazoTexto(z.dias_restantes);
                return (
                  <li key={z.id} className="flex items-center gap-3 py-2 text-sm">
                    <span className="w-20 shrink-0 tabular-nums text-muted-foreground">{dataBR(z.prazo)}</span>
                    <span className="min-w-0 flex-1 truncate">{z.titulo}{z.processo_numero && <span className="text-muted-foreground"> · {z.processo_numero}</span>}</span>
                    <Tag tone={t.tone}>{t.texto}</Tag>
                  </li>
                );
              })}
            </ul>
          ) : <p className="py-6 text-center text-sm text-muted-foreground">Nenhum prazo nos próximos 15 dias.</p>}
        </div>
        <div className="space-y-3">
          <div className="rounded-2xl border border-border bg-surface p-4">
            <p className="mb-2 text-sm font-semibold">Contingências (CPC 25)</p>
            <div className="flex h-2.5 overflow-hidden rounded-full bg-secondary">
              <span className="bg-destructive" style={{ width: `${pct(p.provisao)}%` }} />
              <span className="bg-warning" style={{ width: `${pct(p.contingencia_possivel)}%` }} />
              <span className="bg-muted-foreground/40" style={{ width: `${pct(p.contingencia_remota)}%` }} />
            </div>
            <dl className="mt-2 space-y-1 text-xs">
              <div className="flex justify-between"><dt className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-destructive" />Provável — provisiona</dt><dd className="tabular-nums">{brl(p.provisao)}</dd></div>
              <div className="flex justify-between"><dt className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-warning" />Possível — divulga em nota</dt><dd className="tabular-nums">{brl(p.contingencia_possivel)}</dd></div>
              <div className="flex justify-between"><dt className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-muted-foreground/40" />Remota</dt><dd className="tabular-nums">{brl(p.contingencia_remota)}</dd></div>
            </dl>
          </div>
          <button type="button" onClick={() => onGo("contratos")} className="w-full rounded-2xl border border-border bg-surface p-4 text-left transition hover:border-foreground/30">
            <p className="flex items-center gap-2 text-sm font-semibold"><Landmark className="size-4" /> Contratos</p>
            <p className="mt-1 text-sm text-muted-foreground">{p.contratos_vigentes} vigente(s){p.contratos_vencendo_30 ? <> · <span className="text-warning">{p.contratos_vencendo_30} vencendo em 30 dias</span></> : ""}</p>
            {p.contratos_a_vencer.slice(0, 3).map((c) => (
              <p key={c.id} className="mt-1 flex items-center justify-between gap-2 text-xs">
                <span className="truncate">{c.titulo}</span><Tag tone={STATUS_CONTRATO_TONE[c.status] ?? "muted"}>{dataBR(c.data_fim)}</Tag>
              </p>
            ))}
          </button>
          <button type="button" onClick={() => onGo("assinaturas")} className="w-full rounded-2xl border border-border bg-surface p-4 text-left transition hover:border-foreground/30">
            <p className="flex items-center gap-2 text-sm font-semibold"><FileSignature className="size-4" /> Assinaturas</p>
            <p className="mt-1 text-sm text-muted-foreground">{p.assinaturas_pendentes ? `${p.assinaturas_pendentes} aguardando assinatura` : "Nenhuma pendente"}</p>
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Processos ───────────────────────────────────────────────────────────────

const COLS: ColumnDef<Processo>[] = [
  { key: "titulo", label: "Processo", render: (p) => (
    <span className="block min-w-0">
      <span className="block truncate font-medium">{p.titulo}</span>
      <span className="block truncate text-xs text-muted-foreground">
        {p.numero_cnj || "sem número CNJ"}{p.tribunal ? ` · ${p.tribunal.toUpperCase()}` : ""}{p.orgao_julgador ? ` · ${p.orgao_julgador}` : ""}
      </span>
    </span>
  ) },
  { key: "tipo", label: "Área", render: (p) => label(TIPO_PROCESSO, p.tipo) },
  { key: "partes", label: "Partes", render: (p) => (
    <span className="block max-w-[220px] truncate text-xs">{p.cliente_nome || p.parte}<span className="text-muted-foreground"> × {p.parte_contraria || "—"}</span></span>
  ) },
  { key: "status", label: "Situação", render: (p) => <Tag tone={STATUS_PROC_TONE[p.status]}>{label(STATUS_PROCESSO, p.status)}</Tag> },
  { key: "probabilidade_perda", label: "Risco", render: (p) => <Tag tone={PROB_TONE[p.probabilidade_perda]}>{label(PROBABILIDADE, p.probabilidade_perda)}</Tag> },
  { key: "valor_causa", label: "Valor da causa", align: "right", render: (p) => brl(p.valor_causa) },
  { key: "andamento", label: "Último andamento", render: (p) => p.ultimo_andamento
    ? <span className="block max-w-[220px] truncate text-xs"><span className="text-muted-foreground">{dataBR(p.ultimo_andamento.data)} · </span>{p.ultimo_andamento.descricao}</span>
    : <span className="text-xs text-muted-foreground">—</span> },
];

export function ProcessosTab({ reloadKey, onChanged }: { reloadKey: number; onChanged: () => void }) {
  const [aberto, setAberto] = useState<Processo | null>(null);
  const [key, setKey] = useState(0);
  return (
    <>
      <ErpCrud<Processo>
        resource="juridico/processos"
        title="Processos"
        description="Contencioso com número CNJ, andamentos (manuais ou do DataJud/CNJ), prazos, documentos e provisão (CPC 25)."
        singular="processo"
        fields={PROCESSO_FIELDS}
        columns={COLS}
        defaults={{ tipo: "civel", polo: "passivo", fase: "conhecimento", status: "em_andamento", probabilidade_perda: "possivel" }}
        filters={[
          { label: "Ativos", params: { status: "em_andamento" } },
          { label: "Todos", params: {} },
          { label: "Perda provável", params: { probabilidade_perda: "provavel" } },
          { label: "Trabalhistas", params: { tipo: "trabalhista" } },
          { label: "Encerrados", params: { status: "ganho" } },
        ]}
        onRowClick={setAberto}
        reloadKey={reloadKey + key}
        onChanged={onChanged}
        emptyText="Nenhum processo cadastrado."
      />
      {aberto && <ProcessoDetalhe processo={aberto} onClose={() => setAberto(null)} onChanged={() => { setKey((k) => k + 1); onChanged(); }} />}
    </>
  );
}

function ProcessoDetalhe({ processo: inicial, onClose, onChanged }: { processo: Processo; onClose: () => void; onChanged: () => void }) {
  const [p, setP] = useState(inicial);
  const [tab, setTab] = useState<"andamentos" | "prazos" | "documentos">("andamentos");
  const [andamentos, setAndamentos] = useState<Andamento[] | null>(null);
  const [prazos, setPrazos] = useState<Prazo[]>([]);
  const [docs, setDocs] = useState<DocumentoJuridico[]>([]);
  const [sync, setSync] = useState(false);
  const [edit, setEdit] = useState(false);
  const [novo, setNovo] = useState({ data: new Date().toISOString().slice(0, 10), descricao: "" });

  const load = useCallback(() => {
    listAndamentos(p.id).then(setAndamentos).catch(() => setAndamentos([]));
    listPrazos({ processo: String(p.id) }).then(setPrazos).catch(() => setPrazos([]));
    listDocumentosJuridicos({ processo: String(p.id) }).then(setDocs).catch(() => setDocs([]));
  }, [p.id]);
  useEffect(load, [load]);

  const info: [string, React.ReactNode][] = [
    ["Número CNJ", p.numero_cnj || "—"], ["Tribunal", p.tribunal ? p.tribunal.toUpperCase() : "—"],
    ["Vara / órgão", p.orgao_julgador || "—"], ["Comarca", p.foro || "—"],
    ["Classe", p.classe || "—"], ["Fase", label(FASE, p.fase)],
    ["Cliente", p.cliente_nome || p.parte], ["Parte contrária", p.parte_contraria || "—"],
    ["Advogado", p.advogado || "—"], ["Distribuição", dataBR(p.data_distribuicao)],
    ["Valor da causa", brl(p.valor_causa)], ["Provisão", Number(p.valor_provisionado) ? brl(p.valor_provisionado) : "não provisiona"],
  ];

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[92vh] max-w-[min(1000px,96vw)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(1000px,96vw)]">
        <DialogHeader className="space-y-1 border-b border-border px-5 py-4 text-left">
          <DialogTitle className="flex flex-wrap items-center gap-2 pr-8">
            <Gavel className="size-4" /> {p.titulo}
            <Tag tone={STATUS_PROC_TONE[p.status]}>{label(STATUS_PROCESSO, p.status)}</Tag>
            <Tag tone={PROB_TONE[p.probabilidade_perda]}>perda {label(PROBABILIDADE, p.probabilidade_perda).toLowerCase()}</Tag>
          </DialogTitle>
          <DialogDescription>{label(TIPO_PROCESSO, p.tipo)} · {p.polo === "ativo" ? "autor" : p.polo === "passivo" ? "réu" : "terceiro"}{p.assunto ? ` · ${p.assunto}` : ""}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-4">
            {info.map(([k, v]) => (
              <div key={k} className="min-w-0"><dt className="text-[11px] uppercase tracking-wider text-muted-foreground">{k}</dt><dd className="truncate">{v}</dd></div>
            ))}
          </dl>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setEdit(true)}>Editar dados</Button>
            <Button size="sm" variant="outline" disabled={sync || !p.numero_cnj} title={p.numero_cnj ? "Buscar andamentos na API pública do CNJ" : "Informe o número CNJ"} onClick={async () => {
              setSync(true);
              try {
                const r = await syncDataJud(p.id);
                toast.success(r.mensagem);
                load();
                onChanged();
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Falhou.");
              } finally {
                setSync(false);
              }
            }}>
              {sync ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} Buscar andamentos (DataJud)
            </Button>
            {p.ultima_sincronizacao && <span className="self-center text-xs text-muted-foreground">última busca {dataBR(p.ultima_sincronizacao)} · {p.sincronizacao_msg}</span>}
          </div>

          <div className="mt-5 flex gap-1 border-b border-border">
            {([["andamentos", `Andamentos (${andamentos?.length ?? 0})`], ["prazos", `Prazos (${prazos.length})`], ["documentos", `Documentos (${docs.length})`]] as const).map(([id, l]) => (
              <button key={id} type="button" onClick={() => setTab(id)}
                className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === id ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{l}</button>
            ))}
          </div>

          {tab === "andamentos" && (
            <div className="space-y-3 pt-3">
              <form className="flex flex-wrap items-start gap-2" onSubmit={async (e) => {
                e.preventDefault();
                if (!novo.descricao.trim()) return;
                await createAndamento({ processo: p.id, data: `${novo.data}T12:00:00`, descricao: novo.descricao });
                setNovo((n) => ({ ...n, descricao: "" }));
                load();
                onChanged();
              }}>
                <Input type="date" value={novo.data} onChange={(e) => setNovo((n) => ({ ...n, data: e.target.value }))} className="w-40" />
                <Textarea rows={1} value={novo.descricao} onChange={(e) => setNovo((n) => ({ ...n, descricao: e.target.value }))} placeholder="Novo andamento (ex.: Juntada de contestação)" className="min-h-9 flex-1" />
                <Button size="sm" type="submit" disabled={!novo.descricao.trim()}><Plus className="size-3.5" /> Registrar</Button>
              </form>
              <ol className="relative space-y-3 border-l border-border pl-5">
                {andamentos?.map((a) => (
                  <li key={a.id} className="relative">
                    <span className={`absolute -left-[25px] top-1.5 size-2.5 rounded-full ring-4 ring-background ${a.origem === "datajud" ? "bg-sky-500" : "bg-primary"}`} />
                    <p className="text-xs text-muted-foreground">{dataBR(a.data)} · {a.origem === "datajud" ? "DataJud (CNJ)" : "manual"}</p>
                    <p className="text-sm">{a.descricao}</p>
                  </li>
                ))}
                {andamentos && !andamentos.length && <li className="text-sm text-muted-foreground">Nenhum andamento ainda.</li>}
              </ol>
            </div>
          )}
          {tab === "prazos" && (
            <ul className="divide-y divide-border pt-2">
              {prazos.map((z) => {
                const t = prazoTexto(z.dias_restantes);
                return (
                  <li key={z.id} className="flex items-center gap-3 py-2 text-sm">
                    {z.concluido ? <CheckCircle2 className="size-4 text-success" /> : <AlertTriangle className={`size-4 ${t.tone === "error" ? "text-destructive" : "text-muted-foreground"}`} />}
                    <span className="w-24 shrink-0 tabular-nums">{dataBR(z.prazo)}</span>
                    <span className={`min-w-0 flex-1 truncate ${z.concluido ? "text-muted-foreground line-through" : ""}`}>{z.titulo}</span>
                    {!z.concluido && <Tag tone={t.tone}>{t.texto}</Tag>}
                  </li>
                );
              })}
              {!prazos.length && <li className="py-6 text-center text-sm text-muted-foreground">Sem prazos. Crie na aba Prazos, ligando a este processo.</li>}
            </ul>
          )}
          {tab === "documentos" && (
            <ul className="divide-y divide-border pt-2">
              {docs.map((d) => (
                <li key={d.id} className="flex items-center gap-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{d.titulo}</span>
                  <Tag tone={d.status === "assinado" ? "ok" : d.status === "em_assinatura" ? "violet" : "muted"}>{d.status.replace("_", " ")}</Tag>
                </li>
              ))}
              {!docs.length && <li className="py-6 text-center text-sm text-muted-foreground">Sem documentos. Gere de um modelo na aba Documentos.</li>}
            </ul>
          )}
        </div>
        <ErpFormDialog
          open={edit}
          onOpenChange={setEdit}
          title="Editar processo"
          fields={PROCESSO_FIELDS}
          initial={p as unknown as Record<string, unknown>}
          onSubmit={async (payload) => {
            setP(await erpUpdate<Processo>("juridico/processos", p.id, payload));
            toast.success("Processo atualizado.");
            onChanged();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

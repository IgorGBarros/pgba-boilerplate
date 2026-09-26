// frontend/src/components/empresa/juridico/agenda.tsx — Prazos (com calculadora CPC) e Contratos (ciclo de vida)
import { useState } from "react";
import { Calculator, Check, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErpCrud, type ColumnDef, type FieldDef } from "@/components/empresa/erp-crud";
import { brl, dataBR } from "@/components/empresa/erp-utils";
import { calcularPrazo, updatePrazo, type ContratoJuridico, type Prazo } from "@/lib/api";
import {
  CONTRATO_FIELDS, STATUS_CONTRATO, STATUS_CONTRATO_TONE, TIPO_CONTRATO, Tag, label, opts, prazoTexto,
} from "@/components/empresa/juridico/shared";

// ─── Prazos ──────────────────────────────────────────────────────────────────

const URGENCIA = opts([["critica", "Crítica"], ["alta", "Alta"], ["media", "Média"], ["baixa", "Baixa"]]);
const URG_TONE = { critica: "error", alta: "warn", media: "info", baixa: "muted" } as const;

const PRAZO_FIELDS: FieldDef[] = [
  { name: "titulo", label: "O que fazer", required: true, wide: true, placeholder: "Ex.: Contestação" },
  { name: "tipo", label: "Tipo", type: "select", options: opts([["peca_processual", "Peça processual"], ["audiencia", "Audiência"], ["contrato", "Contrato"], ["administrativo", "Administrativo"], ["outro", "Outro"]]) },
  { name: "processo", label: "Processo", type: "relation", relation: "processos_juridicos" },
  { name: "contrato", label: "Contrato", type: "relation", relation: "contratos_juridicos" },
  { name: "data_inicio", label: "Intimação / publicação", type: "date", help: "Com a quantidade de dias, o vencimento é calculado (CPC 219/224, feriados nacionais e recesso)." },
  { name: "dias", label: "Prazo (dias)", type: "number" },
  { name: "contagem", label: "Contagem", type: "select", options: opts([["uteis", "Dias úteis (processual)"], ["corridos", "Dias corridos"]]) },
  { name: "prazo", label: "Vencimento", type: "date", help: "Preencha aqui só se não informar intimação + dias." },
  { name: "urgencia", label: "Urgência", type: "select", options: URGENCIA },
  { name: "responsavel", label: "Responsável" },
  { name: "descricao", label: "Observações", type: "textarea" },
];

function Calculadora() {
  const [inicio, setInicio] = useState(new Date().toISOString().slice(0, 10));
  const [dias, setDias] = useState("15");
  const [contagem, setContagem] = useState<"uteis" | "corridos">("uteis");
  const [res, setRes] = useState<{ vencimento: string; pulados: { data: string; motivo: string }[] } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <p className="flex items-center gap-2 text-sm font-semibold"><Calculator className="size-4" /> Calculadora de prazo</p>
      <p className="text-xs text-muted-foreground">CPC 219 (dias úteis), 224 (exclui o dia do começo) e 220 (recesso 20/12–20/01). Feriados nacionais incluídos — confira feriados locais e suspensões do tribunal.</p>
      <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try { setRes(await calcularPrazo(inicio, Number(dias), contagem)); }
        catch (err) { toast.error(err instanceof Error ? err.message : "Não foi possível calcular."); }
        finally { setBusy(false); }
      }}>
        <label className="space-y-1 text-xs"><span className="block text-muted-foreground">Intimação</span><Input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} className="w-40" /></label>
        <label className="space-y-1 text-xs"><span className="block text-muted-foreground">Dias</span><Input type="number" min={1} value={dias} onChange={(e) => setDias(e.target.value)} className="w-20" /></label>
        <label className="space-y-1 text-xs"><span className="block text-muted-foreground">Contagem</span>
          <select value={contagem} onChange={(e) => setContagem(e.target.value as "uteis" | "corridos")} className="h-9 rounded-md border border-border bg-background px-2 text-sm">
            <option value="uteis">Dias úteis</option><option value="corridos">Dias corridos</option>
          </select>
        </label>
        <Button size="sm" type="submit" disabled={busy || !dias}>{busy && <Loader2 className="size-3.5 animate-spin" />} Calcular</Button>
        {res && (
          <p className="ml-auto text-sm">Vence em <strong className="font-display text-lg">{dataBR(res.vencimento)}</strong></p>
        )}
      </form>
      {res && res.pulados.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          Não contados: {res.pulados.slice(0, 6).map((p) => `${dataBR(p.data)} (${p.motivo})`).join(", ")}{res.pulados.length > 6 ? ` e mais ${res.pulados.length - 6}` : ""}.
        </p>
      )}
    </div>
  );
}

export function PrazosTab({ onChanged }: { onChanged: () => void }) {
  const [key, setKey] = useState(0);
  const cols: ColumnDef<Prazo>[] = [
    { key: "prazo", label: "Vencimento", render: (z) => {
      const t = prazoTexto(z.dias_restantes);
      return <span className="flex flex-col items-start gap-0.5"><span className="tabular-nums font-medium">{dataBR(z.prazo)}</span>{!z.concluido && <Tag tone={t.tone}>{t.texto}</Tag>}</span>;
    } },
    { key: "titulo", label: "Prazo", render: (z) => (
      <span className="block min-w-0">
        <span className={`block truncate ${z.concluido ? "text-muted-foreground line-through" : "font-medium"}`}>{z.titulo}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {z.processo_numero || z.processo_titulo || z.contrato_titulo || "—"}
          {z.dias ? ` · ${z.dias} dias ${z.contagem === "uteis" ? "úteis" : "corridos"} de ${dataBR(z.data_inicio)}` : ""}
        </span>
      </span>
    ) },
    { key: "urgencia", label: "Urgência", render: (z) => <Tag tone={URG_TONE[z.urgencia]}>{label(URGENCIA, z.urgencia)}</Tag> },
    { key: "responsavel", label: "Responsável", render: (z) => z.responsavel || "—" },
  ];
  return (
    <div className="space-y-4">
      <Calculadora />
      <ErpCrud<Prazo>
        resource="juridico/prazos"
        title="Agenda de prazos"
        description="Informe a intimação e os dias: o vencimento é calculado. Marque como cumprido quando protocolar."
        singular="prazo"
        fields={PRAZO_FIELDS}
        columns={cols}
        defaults={{ tipo: "peca_processual", contagem: "uteis", urgencia: "media" }}
        filters={[
          { label: "Em aberto", params: { concluido: "false", ordering: "prazo" } },
          { label: "Cumpridos", params: { concluido: "true", ordering: "-prazo" } },
          { label: "Todos", params: { ordering: "prazo" } },
        ]}
        reloadKey={key}
        onChanged={onChanged}
        rowActions={(z, reload) => (
          <Button size="sm" variant="ghost" className="h-7" title={z.concluido ? "Reabrir" : "Marcar como cumprido"} onClick={async (e) => {
            e.stopPropagation();
            await updatePrazo(z.id, { concluido: !z.concluido });
            toast.success(z.concluido ? "Prazo reaberto." : "Prazo cumprido.");
            reload();
            setKey((k) => k + 1);
            onChanged();
          }}>
            {z.concluido ? <RotateCcw className="size-3.5" /> : <Check className="size-3.5" />}
          </Button>
        )}
        emptyText="Nenhum prazo aqui."
      />
    </div>
  );
}

// ─── Contratos ───────────────────────────────────────────────────────────────

const CONTRATO_COLS: ColumnDef<ContratoJuridico>[] = [
  { key: "titulo", label: "Contrato", render: (c) => (
    <span className="block min-w-0">
      <span className="block truncate font-medium">{c.titulo}</span>
      <span className="block truncate text-xs text-muted-foreground">{c.parceiro_nome || c.partes} · {label(TIPO_CONTRATO, c.tipo)}</span>
    </span>
  ) },
  { key: "status", label: "Etapa", render: (c) => <Tag tone={STATUS_CONTRATO_TONE[c.status] ?? "muted"}>{label(STATUS_CONTRATO, c.status)}</Tag> },
  { key: "vigencia", label: "Vigência", render: (c) => (
    <span className="flex flex-col items-start gap-0.5 text-xs">
      <span>{dataBR(c.data_inicio)} → {dataBR(c.data_fim)}</span>
      {c.dias_para_vencer != null && c.dias_para_vencer <= c.aviso_dias && !["cancelado", "vencido"].includes(c.status) && (
        <Tag tone={c.dias_para_vencer < 0 ? "error" : "warn"}>{c.dias_para_vencer < 0 ? "vencido" : `vence em ${c.dias_para_vencer} dias`}</Tag>
      )}
    </span>
  ) },
  { key: "renovacao", label: "Renovação", render: (c) => ({ automatica: "Automática", negociacao: "Negociar", nao_renovar: "Não renovar" })[c.renovacao] },
  { key: "valor_anual", label: "Valor anual", align: "right", render: (c) => brl(c.valor_anual) },
];

export function ContratosTab({ onChanged }: { onChanged: () => void }) {
  return (
    <ErpCrud<ContratoJuridico>
      resource="juridico/contratos"
      title="Contratos"
      description="Ciclo de vida: rascunho → revisão → assinatura → vigente → renovação. Aviso de vencimento conforme os dias configurados."
      singular="contrato"
      fields={CONTRATO_FIELDS}
      columns={CONTRATO_COLS}
      defaults={{ tipo: "servico", status: "rascunho", renovacao: "negociacao", aviso_dias: 30 }}
      filters={[
        { label: "Todos", params: {} },
        { label: "Vigentes", params: { status: "vigente" } },
        { label: "Em revisão", params: { status: "em_revisao" } },
        { label: "Aguardando assinatura", params: { status: "aguardando_assinatura" } },
        { label: "A vencer", params: { ordering: "data_fim", status: "expirando" } },
      ]}
      onChanged={onChanged}
      emptyText="Nenhum contrato cadastrado."
    />
  );
}

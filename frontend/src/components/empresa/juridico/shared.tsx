// frontend/src/components/empresa/juridico/shared.tsx — rótulos, cores e peças do Jurídico
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { FieldDef } from "@/components/empresa/erp-crud";
import type { Option } from "@/components/empresa/erp-utils";
import { fetchBlob } from "@/lib/api";

export const opts = (pairs: [string, string][]): Option[] => pairs.map(([value, label]) => ({ value, label }));

export const TIPO_PROCESSO = opts([
  ["civel", "Cível"], ["trabalhista", "Trabalhista"], ["tributario", "Tributário"], ["consumidor", "Consumidor"],
  ["contratual", "Contratual"], ["criminal", "Criminal"], ["regulatorio", "Regulatório"],
  ["administrativo", "Administrativo"], ["outro", "Outro"],
]);
export const STATUS_PROCESSO = opts([
  ["em_andamento", "Em andamento"], ["suspenso", "Suspenso"], ["acordo", "Acordo"], ["ganho", "Ganho"],
  ["perdido", "Perdido"], ["arquivado", "Arquivado"],
]);
export const PROBABILIDADE = opts([["provavel", "Provável (provisiona)"], ["possivel", "Possível (só divulga)"], ["remota", "Remota"]]);
export const FASE = opts([["conhecimento", "Conhecimento"], ["recursal", "Recursal"], ["execucao", "Execução / cumprimento"], ["encerrado", "Encerrado"]]);
export const POLO = opts([["passivo", "Réu (polo passivo)"], ["ativo", "Autor (polo ativo)"], ["terceiro", "Terceiro"]]);
export const TIPO_CONTRATO = opts([
  ["servico", "Serviço"], ["fornecimento", "Fornecimento"], ["locacao", "Locação"], ["parceria", "Parceria"],
  ["nda", "NDA"], ["trabalhista", "Trabalhista"], ["outro", "Outro"],
]);
export const STATUS_CONTRATO = opts([
  ["rascunho", "Rascunho"], ["em_revisao", "Em revisão"], ["aguardando_assinatura", "Aguardando assinatura"],
  ["vigente", "Vigente"], ["expirando", "Expirando"], ["vencido", "Vencido"], ["negociacao", "Em negociação"],
  ["cancelado", "Cancelado"],
]);
export const TIPO_DOC = opts([
  ["contrato", "Contrato"], ["procuracao", "Procuração"], ["peticao", "Petição"], ["notificacao", "Notificação"],
  ["parecer", "Parecer"], ["ata", "Ata"], ["termo", "Termo / declaração"], ["outro", "Outro"],
]);

export const label = (list: Option[], v: string) => list.find((o) => o.value === v)?.label.replace(/ \(.*\)$/, "") ?? v;

type Tone = "ok" | "warn" | "error" | "muted" | "info" | "violet";
const TONES: Record<Tone, string> = {
  ok: "border-success/30 bg-success/10 text-success",
  warn: "border-warning/30 bg-warning/10 text-warning",
  error: "border-destructive/30 bg-destructive/10 text-destructive",
  muted: "border-border bg-secondary text-muted-foreground",
  info: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  violet: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
};
export function Tag({ tone = "muted", children, title }: { tone?: Tone; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${TONES[tone]}`}>
      {children}
    </span>
  );
}

export const STATUS_PROC_TONE: Record<string, Tone> = {
  em_andamento: "info", suspenso: "warn", acordo: "violet", ganho: "ok", perdido: "error", arquivado: "muted",
};
export const PROB_TONE: Record<string, Tone> = { provavel: "error", possivel: "warn", remota: "muted" };
export const STATUS_CONTRATO_TONE: Record<string, Tone> = {
  rascunho: "muted", em_revisao: "info", aguardando_assinatura: "violet", vigente: "ok", expirando: "warn",
  vencido: "error", negociacao: "info", cancelado: "muted",
};

/** "vence hoje", "em 3 dias", "vencido há 2 dias" */
export function prazoTexto(dias: number | null | undefined): { texto: string; tone: Tone } {
  if (dias == null) return { texto: "—", tone: "muted" };
  if (dias < 0) return { texto: `vencido há ${-dias} dia${dias === -1 ? "" : "s"}`, tone: "error" };
  if (dias === 0) return { texto: "vence hoje", tone: "error" };
  if (dias <= 3) return { texto: `em ${dias} dia${dias === 1 ? "" : "s"}`, tone: "warn" };
  if (dias <= 15) return { texto: `em ${dias} dias`, tone: "info" };
  return { texto: `em ${dias} dias`, tone: "muted" };
}

export const PROCESSO_FIELDS: FieldDef[] = [
  { name: "titulo", label: "Título / assunto", required: true, wide: true, placeholder: "Ex.: Reclamação trabalhista — João Silva" },
  { name: "numero_cnj", label: "Número CNJ", placeholder: "0000000-00.0000.0.00.0000", help: "Valida o dígito e identifica o tribunal (captura no DataJud)." },
  { name: "tipo", label: "Área", type: "select", options: TIPO_PROCESSO, required: true },
  { name: "cliente", label: "Cliente (parceiro)", type: "relation", relation: "parceiros" },
  { name: "parte", label: "Parte representada", required: true, placeholder: "Nome da empresa ou cliente" },
  { name: "polo", label: "Polo", type: "select", options: POLO },
  { name: "parte_contraria", label: "Parte contrária" },
  { name: "advogado", label: "Advogado responsável" },
  { name: "foro", label: "Comarca / foro" },
  { name: "orgao_julgador", label: "Vara / órgão julgador" },
  { name: "fase", label: "Fase", type: "select", options: FASE },
  { name: "status", label: "Situação", type: "select", options: STATUS_PROCESSO },
  { name: "data_distribuicao", label: "Distribuição", type: "date" },
  { name: "valor_causa", label: "Valor da causa", type: "money" },
  { name: "probabilidade_perda", label: "Probabilidade de perda", type: "select", options: PROBABILIDADE,
    help: "CPC 25: só “provável” entra na provisão contábil." },
  { name: "valor_estimado_perda", label: "Valor estimado da perda", type: "money", help: "Base da provisão / contingência." },
  { name: "observacoes", label: "Observações", type: "textarea" },
];

export const CONTRATO_FIELDS: FieldDef[] = [
  { name: "titulo", label: "Objeto do contrato", required: true, wide: true },
  { name: "tipo", label: "Tipo", type: "select", options: TIPO_CONTRATO, required: true },
  { name: "parceiro", label: "Parte (parceiro)", type: "relation", relation: "parceiros" },
  { name: "partes", label: "Partes (texto)", help: "Preenchido com o parceiro se ficar vazio." },
  { name: "responsavel", label: "Responsável interno" },
  { name: "status", label: "Etapa", type: "select", options: STATUS_CONTRATO },
  { name: "data_inicio", label: "Início", type: "date", required: true },
  { name: "data_fim", label: "Fim", type: "date" },
  { name: "aviso_dias", label: "Avisar antes do fim (dias)", type: "number" },
  { name: "valor_anual", label: "Valor anual", type: "money" },
  { name: "indice_reajuste", label: "Índice de reajuste", placeholder: "IPCA, IGP-M…" },
  { name: "renovacao", label: "Renovação", type: "select", options: opts([["negociacao", "Negociação"], ["automatica", "Automática"], ["nao_renovar", "Não renovar"]]) },
  { name: "observacoes", label: "Observações", type: "textarea" },
];

/** Mostra um PDF da API (com login) num modal, via blob URL. */
export function PdfViewer({ path, title, onClose, auth = true }: { path: string; title: string; onClose: () => void; auth?: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let u: string | null = null;
    fetchBlob(path, auth)
      .then((b) => { u = URL.createObjectURL(b); setUrl(u); })
      .catch((e) => setErr(e instanceof Error ? e.message : "Não foi possível abrir."));
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [path, auth]);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[90vh] max-w-[min(1000px,96vw)] flex-col gap-2 p-3 sm:max-w-[min(1000px,96vw)]">
        <DialogHeader className="px-2 pt-1 text-left">
          <DialogTitle className="text-base">{title}</DialogTitle>
          <DialogDescription className="sr-only">Visualização do documento em PDF</DialogDescription>
        </DialogHeader>
        {err ? <p className="p-6 text-sm text-destructive">{err}</p> : url ? (
          <iframe title={title} src={url} className="min-h-0 w-full flex-1 rounded-lg border border-border bg-white" />
        ) : (
          <p className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Carregando…</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

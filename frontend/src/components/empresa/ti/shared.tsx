// frontend/src/components/empresa/ti/shared.tsx — status, prioridades e peças do setor TI
import type { ReactNode } from "react";
import type { FatoTI, PrioridadeChamado, StatusChamado, StatusSaude } from "@/lib/api";
import { Tag } from "@/components/empresa/marketing/shared";

export { Tag };

export const SAUDE: Record<StatusSaude, { label: string; dot: string; tone: "ok" | "warn" | "error" | "muted"; text: string }> = {
  ok: { label: "Funcionando", dot: "bg-success", tone: "ok", text: "text-success" },
  alerta: { label: "Atenção", dot: "bg-warning", tone: "warn", text: "text-warning" },
  falha: { label: "Fora do ar", dot: "bg-destructive", tone: "error", text: "text-destructive" },
  desconhecido: { label: "Sem dado", dot: "bg-muted-foreground opacity-50", tone: "muted", text: "text-muted-foreground" },
};

export function Dot({ status, pulse = false }: { status: StatusSaude; pulse?: boolean }) {
  return (
    <span className="relative inline-flex size-2.5 shrink-0">
      {pulse && status === "falha" && <span className="absolute inset-0 animate-ping rounded-full bg-destructive/60" />}
      <span className={`relative inline-flex size-2.5 rounded-full ${SAUDE[status].dot}`} />
    </span>
  );
}

export const PRIORIDADE: Record<PrioridadeChamado, { label: string; tone: "error" | "warn" | "info" | "muted"; sla: number }> = {
  critica: { label: "Crítica", tone: "error", sla: 4 },
  alta: { label: "Alta", tone: "warn", sla: 8 },
  media: { label: "Média", tone: "info", sla: 24 },
  baixa: { label: "Baixa", tone: "muted", sla: 72 },
};

export const STATUS_CHAMADO: Record<StatusChamado, { label: string; tone: "info" | "violet" | "warn" | "ok" | "muted" }> = {
  aberto: { label: "Aberto", tone: "info" },
  em_atendimento: { label: "Em atendimento", tone: "violet" },
  aguardando: { label: "Aguardando", tone: "warn" },
  resolvido: { label: "Resolvido", tone: "ok" },
  fechado: { label: "Fechado", tone: "muted" },
};

export const CATEGORIAS: { value: string; label: string }[] = [
  { value: "sistema", label: "Sistema (PGBA)" },
  { value: "banco", label: "Banco de dados" },
  { value: "integracao", label: "Integração / API / MCP" },
  { value: "ia", label: "IA / agentes" },
  { value: "acesso", label: "Acesso" },
  { value: "software", label: "Software" },
  { value: "hardware", label: "Hardware" },
  { value: "rede", label: "Rede" },
  { value: "infraestrutura", label: "Infraestrutura" },
  { value: "equipamento", label: "Equipamento" },
  { value: "mobile", label: "Mobile" },
  { value: "outro", label: "Outro" },
];
export const categoriaLabel = (c: string) => CATEGORIAS.find((x) => x.value === c)?.label ?? c;

export const GRUPOS: Record<string, string> = {
  plataforma: "Plataforma",
  ia: "IA dos setores",
  conector: "Conectores (Data Lake)",
  mcp: "Servidores MCP",
  email: "E-mails dos setores",
  social: "Redes sociais",
  agentes: "Agentes",
};

export const TASK_STATUS: Record<string, string> = {
  created: "Task criada",
  in_progress: "Task em andamento",
  paused_ceo: "Task pausada",
  adapted: "Task adaptada",
  approved: "Task aprovada",
  rejected: "Task rejeitada",
};

export const selectCls = "h-9 w-full rounded-md border border-border bg-background px-2 text-sm";

export function relativo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `há ${h} h`;
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export function dataHora(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function duracao(min: number | null | undefined): string {
  if (min == null) return "—";
  const m = Math.abs(min);
  if (m < 60) return `${m} min`;
  if (m < 60 * 48) return `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ""}`.trim();
  return `${Math.round(m / 1440)} dias`;
}

export function SlaInfo({ minutos, estourado, resolvido }: { minutos: number | null; estourado: boolean; resolvido: boolean }) {
  if (minutos == null) return <span className="text-xs text-muted-foreground">—</span>;
  if (resolvido) return <span className={`text-xs ${estourado ? "text-destructive" : "text-success"}`}>{estourado ? "fora do SLA" : "no SLA"}</span>;
  if (estourado) return <span className="text-xs font-medium text-destructive">estourou há {duracao(minutos)}</span>;
  return <span className={`text-xs ${minutos < 120 ? "font-medium text-warning" : "text-muted-foreground"}`}>vence em {duracao(minutos)}</span>;
}

/** Texto com [F#] virando chip — o fato aparece ao passar o mouse. */
export function ComCitacoes({ texto, fatos }: { texto: string; fatos?: FatoTI[] }) {
  const partes = texto.split(/(\[F\d+\])/g);
  return (
    <>
      {partes.map((p, i) => {
        const m = p.match(/^\[(F\d+)\]$/);
        if (!m) return <span key={i}>{p}</span>;
        const fato = fatos?.find((f) => f.id === m[1]);
        return (
          <span key={i} title={fato?.texto ?? "fato"} className="mx-0.5 inline-flex cursor-help items-center rounded border border-sky-500/30 bg-sky-500/10 px-1 font-mono text-[10px] text-sky-700 dark:text-sky-300">
            {m[1]}
          </span>
        );
      })}
    </>
  );
}

export function Fatos({ fatos }: { fatos?: FatoTI[] }) {
  if (!fatos?.length) return null;
  return (
    <details className="rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs">
      <summary className="cursor-pointer select-none text-muted-foreground">Fatos do monitoramento usados ({fatos.length})</summary>
      <ol className="mt-2 space-y-1">
        {fatos.map((f) => (
          <li key={f.id} className="flex gap-2">
            <span className="shrink-0 font-mono text-sky-700 dark:text-sky-300">{f.id}</span>
            <span className="text-muted-foreground">{f.texto}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}

export function Kpi({ label, valor, detalhe, tone }: { label: string; valor: ReactNode; detalhe?: ReactNode; tone?: "error" | "warn" | "ok" }) {
  const cor = tone === "error" ? "text-destructive" : tone === "warn" ? "text-warning" : tone === "ok" ? "text-success" : "";
  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 font-display text-2xl font-semibold tabular-nums ${cor}`}>{valor}</p>
      {detalhe && <p className="mt-0.5 text-xs text-muted-foreground">{detalhe}</p>}
    </div>
  );
}

export function Vazio({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">{children}</div>;
}

export function erroTexto(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

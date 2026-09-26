// frontend/src/components/empresa/marketing/shared.tsx — redes, status e peças do Marketing
import { useEffect, useState } from "react";
import { Facebook, ImageIcon, Instagram, Linkedin, Loader2, Twitch, Video, Youtube } from "lucide-react";
import { fetchBlob, marketing, type Midia, type RedeSocial, type StatusPublicacao } from "@/lib/api";

// Ícones de marca que o lucide não tem — caminhos do Simple Icons (CC0)
const PATHS: Partial<Record<RedeSocial, string>> = {
  x: "M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z",
  tiktok: "M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z",
  discord: "M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.058a.082.082 0 0 0 .031.056 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.042-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .078-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.029 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.331c-1.182 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z",
};

export const REDES: Record<RedeSocial, { nome: string; cor: string; dica: string }> = {
  instagram: { nome: "Instagram", cor: "#E4405F", dica: "Feed, carrossel, Reels e stories" },
  tiktok: { nome: "TikTok", cor: "#111111", dica: "Vídeo vertical" },
  youtube: { nome: "YouTube", cor: "#FF0000", dica: "Vídeos e Shorts" },
  facebook: { nome: "Facebook", cor: "#1877F2", dica: "Página: texto, fotos e vídeo" },
  linkedin: { nome: "LinkedIn", cor: "#0A66C2", dica: "Perfil (ou página): texto, fotos e vídeo" },
  x: { nome: "X", cor: "#111111", dica: "Posts de até 280 caracteres" },
  discord: { nome: "Discord", cor: "#5865F2", dica: "Canal da sua comunidade (webhook)" },
  twitch: { nome: "Twitch", cor: "#9146FF", dica: "Anúncio no chat do canal" },
};
export const ORDEM_REDES = Object.keys(REDES) as RedeSocial[];

export function RedeIcon({ rede, className = "size-4", colorido = true }: { rede: RedeSocial; className?: string; colorido?: boolean }) {
  const cor = colorido && rede !== "x" && rede !== "tiktok" ? REDES[rede].cor : undefined;
  const style = cor ? { color: cor } : undefined;
  if (PATHS[rede]) {
    return (
      <svg viewBox="0 0 24 24" className={className} style={style} fill="currentColor" aria-label={REDES[rede].nome} role="img">
        <path d={PATHS[rede]} />
      </svg>
    );
  }
  const Icon = { instagram: Instagram, youtube: Youtube, facebook: Facebook, linkedin: Linkedin, twitch: Twitch }[rede as "instagram"];
  return <Icon className={className} style={style} aria-label={REDES[rede].nome} />;
}

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

export const STATUS: Record<StatusPublicacao, { label: string; tone: Tone; dot: string }> = {
  rascunho: { label: "Rascunho", tone: "muted", dot: "bg-muted-foreground/60" },
  revisao: { label: "Aguardando aprovação", tone: "warn", dot: "bg-warning" },
  agendada: { label: "Aprovada · agendada", tone: "info", dot: "bg-sky-500" },
  publicando: { label: "Publicando", tone: "violet", dot: "bg-violet-500" },
  publicada: { label: "Publicada", tone: "ok", dot: "bg-success" },
  parcial: { label: "Publicada em parte", tone: "warn", dot: "bg-warning" },
  erro: { label: "Falhou", tone: "error", dot: "bg-destructive" },
  cancelada: { label: "Cancelada", tone: "muted", dot: "bg-border" },
};

export const FORMATOS_POST: { value: string; label: string }[] = [
  { value: "post", label: "Post (imagem + texto)" },
  { value: "carrossel", label: "Carrossel" },
  { value: "reels", label: "Reels / Short / TikTok" },
  { value: "video", label: "Vídeo" },
  { value: "story", label: "Story" },
  { value: "texto", label: "Só texto" },
];

export const selectCls = "h-9 w-full rounded-md border border-border bg-background px-2 text-sm";

export function quando(iso: string | null): string {
  if (!iso) return "sem data";
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** <input type="datetime-local"> ↔ ISO */
export function paraLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export const deLocal = (v: string): string | null => (v ? new Date(v).toISOString() : null);

/** Blob URL de um arquivo da API (com login). */
export function useBlobUrl(path: string | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!path) return;
    let u: string | null = null;
    let vivo = true;
    fetchBlob(path)
      .then((b) => { if (vivo) { u = URL.createObjectURL(b); setUrl(u); } })
      .catch(() => setUrl(null));
    return () => { vivo = false; if (u) URL.revokeObjectURL(u); };
  }, [path]);
  return url;
}

export function MidiaThumb({ midia, className = "aspect-square", onClick, selecionada }: {
  midia: Pick<Midia, "id" | "tipo" | "titulo"> & Partial<Pick<Midia, "duracao" | "formato">>;
  className?: string;
  onClick?: () => void;
  selecionada?: boolean;
}) {
  const url = useBlobUrl(marketing.midiaPath(midia.id, true));
  return (
    <button type="button" onClick={onClick} title={midia.titulo}
      className={`group relative overflow-hidden rounded-lg border bg-secondary ${selecionada ? "border-primary ring-2 ring-primary" : "border-border"} ${className}`}>
      {url ? <img src={url} alt={midia.titulo} className="size-full object-cover transition group-hover:scale-[1.03]" />
        : <span className="grid size-full place-items-center text-muted-foreground"><Loader2 className="size-4 animate-spin" /></span>}
      <span className="absolute bottom-1.5 left-1.5 inline-flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
        {midia.tipo === "video" ? <Video className="size-3" /> : <ImageIcon className="size-3" />}
        {midia.tipo === "video" && midia.duracao ? `${Math.round(midia.duracao)}s` : midia.formato || ""}
      </span>
    </button>
  );
}

export function MidiaPlayer({ midia }: { midia: Pick<Midia, "id" | "tipo" | "titulo"> }) {
  const url = useBlobUrl(marketing.midiaPath(midia.id));
  if (!url) return <div className="grid aspect-[9/16] place-items-center rounded-lg bg-secondary"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;
  return midia.tipo === "video"
    ? <video src={url} controls className="max-h-[70vh] w-full rounded-lg bg-black" />
    : <img src={url} alt={midia.titulo} className="max-h-[70vh] w-full rounded-lg object-contain" />;
}

export async function baixarMidia(m: Pick<Midia, "id" | "titulo" | "mime">) {
  const b = await fetchBlob(`${marketing.midiaPath(m.id)}?baixar=1`);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(b);
  const ext = (m.mime || "").split("/")[1] || "bin";
  a.download = `${(m.titulo || "midia").replace(/[^\p{L}\p{N} _-]/gu, "").slice(0, 60) || "midia"}.${ext === "quicktime" ? "mov" : ext}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function Kpi({ label, value, hint, icon, tone }: { label: string; value: React.ReactNode; hint?: string; icon: React.ReactNode; tone?: "error" | "warn" | "ok" }) {
  const cls = tone === "error" ? "text-destructive" : tone === "warn" ? "text-warning" : tone === "ok" ? "text-success" : "";
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
        <span className="grid size-7 place-items-center rounded-lg bg-secondary text-muted-foreground">{icon}</span>
      </div>
      <p className={`mt-2 font-display text-2xl font-semibold tabular-nums ${cls}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function Campo({ label, help, children, className = "" }: { label: string; help?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block space-y-1 ${className}`}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {help && <span className="block text-[11px] text-muted-foreground">{help}</span>}
    </label>
  );
}

export const erroMsg = (e: unknown, padrao = "Não deu certo.") => (e instanceof Error ? e.message : padrao);

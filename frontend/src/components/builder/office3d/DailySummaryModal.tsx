// office3d/DailySummaryModal.tsx — resumo do dia escrito pelo CEO.
//
// O texto vem do backend (agency/summary.py): o CEO só redige a partir de
// fatos numerados que o sistema registrou; cada afirmação cita o fato [E#].
// Aqui a citação vira um chip — passar o mouse mostra o fato de origem.
// Citação a fato inexistente já chega removida (e é avisada).
import { Fragment, useEffect, useState } from "react";
import { BookmarkPlus, Crown, Loader2, RotateCw, X } from "lucide-react";
import {
  ApiError,
  getDailySummary,
  saveDailySummary,
  type DailySummary,
  type DailySummaryFact,
} from "@/lib/api";
import { providerName } from "./providers";

function Cited({ text, facts }: { text: string; facts: Map<string, DailySummaryFact> }) {
  const parts = text.split(/(\[E\d+\])/g);
  return (
    <>
      {parts.map((part, i) => {
        const m = part.match(/^\[(E\d+)\]$/);
        if (!m) return <Fragment key={i}>{part}</Fragment>;
        const fact = facts.get(m[1]);
        return (
          <span
            key={i}
            title={fact?.text ?? "fato não encontrado"}
            className="mx-0.5 cursor-help rounded bg-stone-100 px-1 align-[1px] font-mono text-[9px] text-stone-500 hover:bg-amber-100 hover:text-amber-800"
          >
            {m[1]}
          </span>
        );
      })}
    </>
  );
}

function SummaryMarkdown({ markdown, facts }: { markdown: string; facts: Map<string, DailySummaryFact> }) {
  return (
    <div className="space-y-1 text-[12px] leading-relaxed text-stone-800">
      {markdown.split("\n").map((line, i) => {
        const t = line.trim();
        if (!t) return null;
        if (t.startsWith("#")) {
          return <p key={i} className="pt-2 text-[10px] font-semibold uppercase tracking-wider text-stone-500">{t.replace(/^#+\s*/, "")}</p>;
        }
        if (/^[-*]\s/.test(t)) {
          return <p key={i} className="pl-3 -indent-3">• <Cited text={t.replace(/^[-*]\s/, "")} facts={facts} /></p>;
        }
        return <p key={i}><Cited text={t} facts={facts} /></p>;
      })}
    </div>
  );
}

export function DailySummaryModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [data, setData] = useState<DailySummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showFacts, setShowFacts] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setError(null); setSaved(null);
    try {
      setData(await getDailySummary());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Falha ao gerar o resumo.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && !data && !loading) load();
    // gera só ao abrir; "gerar de novo" é explícito (cada resumo é uma chamada de IA)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  const facts = new Map((data?.facts ?? []).map((f) => [f.id, f]));

  const save = async () => {
    if (!data) return;
    setSaving(true); setError(null);
    try {
      const out = await saveDailySummary({ markdown: data.summary, facts: data.facts, day: data.until });
      setSaved(out.indexing_queued
        ? "Salvo no Cérebro (fonte “Resumos do dia (CEO)”). A indexação roda em segundo plano."
        : "Salvo no Cérebro, mas a indexação não foi enfileirada (Celery fora do ar?) — reprocesse depois.");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Falha ao salvar.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-stone-900/25 p-4" onClick={onClose}>
      <div
        className="flex max-h-[88%] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-stone-200 bg-[#faf8f4] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 border-b border-stone-200 px-4 py-3">
          <span className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-amber-100 text-amber-700"><Crown className="size-4" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-800">Resumo do dia</p>
            <p className="text-xs text-stone-500">
              {data?.author ? `Escrito por ${data.author}` : "Escrito pela IA do tenant (sem CEO cadastrado)"}
              {data?.provider && ` · ${providerName(data.provider)}${data.model ? ` ${data.model}` : ""}`}
            </p>
          </div>
          <button type="button" onClick={load} disabled={loading} title="Gerar de novo" className="rounded-full p-1 text-stone-400 hover:bg-stone-200 hover:text-stone-800 disabled:opacity-40">
            <RotateCw className="size-4" />
          </button>
          <button type="button" onClick={onClose} className="rounded-full p-1 text-stone-400 hover:bg-stone-200 hover:text-stone-800"><X className="size-4" /></button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {loading && <p className="flex items-center gap-2 py-8 text-sm text-stone-500"><Loader2 className="size-4 animate-spin" /> O CEO está lendo o dia…</p>}
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
          {data && !loading && (
            <>
              <SummaryMarkdown markdown={data.summary} facts={facts} />
              {data.invalid_citations.length > 0 && (
                <p className="mt-3 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
                  O texto citou fatos que não existem ({data.invalid_citations.join(", ")}) — as citações foram removidas; confira essas frases.
                </p>
              )}
              <button type="button" onClick={() => setShowFacts((v) => !v)} className="mt-3 text-[11px] text-stone-500 underline">
                {showFacts ? "Esconder" : "Ver"} os {data.facts.length} fatos de origem
              </button>
              {showFacts && (
                <ul className="mt-1 space-y-0.5 rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-[10px] text-stone-600">
                  {data.facts.map((f) => (
                    <li key={f.id}><b className="font-mono text-stone-400">{f.id}</b> {f.text}</li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-stone-200 px-4 py-2.5">
          {saved && <p className="mr-auto text-[11px] text-emerald-700">{saved}</p>}
          <button type="button" onClick={onClose} className="rounded-full px-3 py-1 text-xs text-stone-600 hover:bg-stone-200">Fechar</button>
          <button
            type="button"
            onClick={save}
            disabled={!data || data.facts.length === 0 || saving || !!saved}
            className="flex items-center gap-1.5 rounded-full bg-stone-900 px-3.5 py-1 text-xs font-semibold text-white hover:bg-stone-700 disabled:opacity-40"
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <BookmarkPlus className="size-3.5" />}
            Salvar no Cérebro
          </button>
        </div>
      </div>
    </div>
  );
}

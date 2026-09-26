// office3d/SendMessageForm.tsx — pedir algo a outro setor a partir de um agente.
//
// Só REGISTRA o pedido (SectorMessage pendente, sector-messages/request/):
// setor nunca fala direto com outro setor. O envelope nasce na porta do
// setor de origem e espera alguém com permissão mediar (clique nele →
// MessageModal). O backend recusa mandar pro próprio setor.
import { useEffect, useState } from "react";
import { Loader2, Mail } from "lucide-react";
import { ApiError, requestSectorMessage, type Sector, type SectorMessage } from "@/lib/api";
import type { OfficeAgent } from "../office-types";

export function SendMessageForm({
  agent,
  sectors,
  onSent,
}: {
  agent: OfficeAgent;
  sectors: Sector[];
  onSent: (m: SectorMessage) => void;
}) {
  const [open, setOpen] = useState(false);
  const [toSector, setToSector] = useState<number | "">("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<SectorMessage | null>(null);

  useEffect(() => {
    setOpen(false); setToSector(""); setContent(""); setError(null); setSent(null);
  }, [agent.id]);

  const targets = sectors.filter((s) => s.id !== agent.sectorId);

  const send = async () => {
    if (toSector === "" || !content.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const m = await requestSectorMessage(agent.id, toSector, content.trim());
      setSent(m);
      setContent("");
      onSent(m);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Falha ao enviar o pedido.");
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={targets.length === 0}
        className="flex items-center gap-1.5 rounded-full border border-stone-200 bg-white px-3 py-1 text-[11px] font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-40"
      >
        <Mail className="size-3.5" /> Enviar para outro setor…
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-stone-200 bg-white px-3 py-2.5">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-stone-500">Pedido para outro setor</p>
      <p className="mb-2 text-[11px] text-stone-500">
        Vira um envelope na porta {agent.sectorId == null ? "da sala da diretoria" : `de ${agent.sectorName}`}, esperando um
        orquestrador (ou o CEO) mediar. A resposta vem do setor de destino, com o cérebro dele.
      </p>
      <select
        value={toSector}
        onChange={(e) => setToSector(e.target.value === "" ? "" : Number(e.target.value))}
        className="mb-1.5 h-8 w-full rounded-lg border border-stone-200 bg-white px-2 text-xs text-stone-800"
      >
        <option value="">Para qual setor…</option>
        {targets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={3}
        placeholder="O que você precisa do outro setor?"
        className="w-full resize-none rounded-lg border border-stone-200 px-2.5 py-1.5 text-xs text-stone-800 outline-none focus:border-stone-400"
      />
      {error && <p className="mt-1.5 rounded bg-red-50 px-2 py-1 text-[11px] text-red-700">{error}</p>}
      {sent && (
        <p className="mt-1.5 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
          ✉ Enviado para {sent.to_sector_name} — aguardando mediação (clique no envelope na porta).
        </p>
      )}
      <div className="mt-1.5 flex justify-end gap-1.5">
        <button type="button" onClick={() => setOpen(false)} className="rounded-full px-3 py-1 text-[11px] text-stone-600 hover:bg-stone-100">
          Fechar
        </button>
        <button
          type="button"
          onClick={send}
          disabled={busy || toSector === "" || !content.trim()}
          className="flex items-center gap-1 rounded-full bg-stone-900 px-3 py-1 text-[11px] font-semibold text-white hover:bg-stone-700 disabled:opacity-40"
        >
          {busy ? <Loader2 className="size-3 animate-spin" /> : <Mail className="size-3" />}
          Enviar pedido
        </button>
      </div>
    </div>
  );
}

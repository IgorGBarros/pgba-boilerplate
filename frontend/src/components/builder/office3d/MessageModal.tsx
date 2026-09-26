// office3d/MessageModal.tsx — mediar uma SectorMessage pendente pela planta.
//
// Abre ao clicar num envelope pendente. Só oferece como mediador quem o
// backend aceita (agency.services.relay_message): CEO, Orquestrador-Geral
// ou o orquestrador do setor de ORIGEM ou de DESTINO. Isso importa: se um
// agente sem permissão tentar mediar, o backend marca a mensagem como
// REJEITADA de vez — não é um erro que dá pra tentar de novo.
//
// A mediação roda a pergunta de verdade no setor de destino (ask_as_agent,
// RAG escopado ao cérebro dele), então pode levar alguns segundos. Quando
// volta "answered", o próprio fluxo de transição da planta dispara o
// mediador andando com o envelope (Envelopes/errand).
import { useMemo, useState } from "react";
import { Loader2, Mail, X } from "lucide-react";
import { ApiError, relaySectorMessage, type SectorMessage } from "@/lib/api";
import type { OfficeAgent } from "../office-types";

export function MessageModal({
  message,
  agents,
  onClose,
  onRelayed,
}: {
  message: SectorMessage | null;
  agents: OfficeAgent[];
  onClose: () => void;
  onRelayed: (updated: SectorMessage) => void;
}) {
  const [mediatorId, setMediatorId] = useState<number | "">("");
  const [answeringId, setAnsweringId] = useState<number | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SectorMessage | null>(null);

  const fromAgent = agents.find((a) => a.id === message?.from_agent);
  const fromSectorId = fromAgent?.sectorId ?? null;

  const mediators = useMemo(() => {
    if (!message) return [];
    return agents
      .filter((a) =>
        a.access_level === "ceo"
        || a.access_level === "general_orchestrator"
        || (a.access_level === "sector_orchestrator" && (a.sectorId === fromSectorId || a.sectorId === message.to_sector)),
      )
      .sort((a, b) => Number(b.access_level === "sector_orchestrator") - Number(a.access_level === "sector_orchestrator"));
  }, [agents, message, fromSectorId]);

  const answerers = useMemo(
    () => (message ? agents.filter((a) => a.sectorId === message.to_sector) : []),
    [agents, message],
  );

  if (!message) return null;

  const close = () => {
    setMediatorId(""); setAnsweringId(""); setError(null); setResult(null); setBusy(false);
    onClose();
  };

  const relay = async () => {
    if (mediatorId === "") return;
    setBusy(true);
    setError(null);
    try {
      const updated = await relaySectorMessage(message.id, mediatorId, answeringId === "" ? undefined : answeringId);
      setResult(updated);
      onRelayed(updated);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Falha ao mediar a mensagem.");
    } finally {
      setBusy(false);
    }
  };

  const labelOf = (a: OfficeAgent) =>
    a.access_level === "ceo" ? "CEO" : a.access_level === "general_orchestrator" ? "Orquestrador-Geral" : `Orquestrador · ${a.sectorName}`;

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-stone-900/25 p-4" onClick={close}>
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl border border-stone-200 bg-[#faf8f4] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 border-b border-stone-200 px-4 py-3">
          <span className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-amber-100 text-amber-700">
            <Mail className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-800">Mensagem entre setores</p>
            <p className="text-xs text-stone-500">
              {message.from_agent_name}{fromAgent ? ` (${fromAgent.sectorName})` : ""} → <b className="text-stone-800">{message.to_sector_name}</b>
            </p>
          </div>
          <button onClick={close} className="rounded-full p-1 text-stone-400 hover:bg-stone-200 hover:text-stone-800"><X className="size-4" /></button>
        </div>

        <div className="space-y-3 px-4 py-3 text-xs text-stone-600">
          <blockquote className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-[13px] leading-relaxed text-stone-800">
            {message.content}
          </blockquote>

          {result ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
                Respondida · mediada por {result.relayed_by_name}
              </p>
              <p className="whitespace-pre-wrap text-[13px] text-stone-800">{result.response || "(resposta vazia)"}</p>
            </div>
          ) : message.status !== "pending" ? (
            <p className="text-stone-500">Esta mensagem já está {message.status === "answered" ? "respondida" : "rejeitada"}.</p>
          ) : (
            <>
              <p className="text-[11px] text-stone-500">
                Setor nunca fala direto com outro setor: alguém com permissão precisa mediar.
                A pergunta roda no setor de destino, com o cérebro dele.
              </p>
              <label className="block">
                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-stone-500">Quem media</span>
                <select
                  value={mediatorId}
                  onChange={(e) => setMediatorId(e.target.value === "" ? "" : Number(e.target.value))}
                  className="h-8 w-full rounded-lg border border-stone-200 bg-white px-2 text-xs text-stone-800"
                >
                  <option value="">Escolha…</option>
                  {mediators.map((a) => <option key={a.id} value={a.id}>{a.name} — {labelOf(a)}</option>)}
                </select>
                {mediators.length === 0 && (
                  <span className="mt-1 block text-[11px] text-amber-700">
                    Nenhum agente com permissão (CEO, Orquestrador-Geral ou orquestrador de um dos dois setores) está cadastrado.
                  </span>
                )}
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-stone-500">Quem responde (opcional)</span>
                <select
                  value={answeringId}
                  onChange={(e) => setAnsweringId(e.target.value === "" ? "" : Number(e.target.value))}
                  className="h-8 w-full rounded-lg border border-stone-200 bg-white px-2 text-xs text-stone-800"
                >
                  <option value="">Orquestrador de {message.to_sector_name} (padrão)</option>
                  {answerers.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </label>
              {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-red-700">{error}</p>}
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-stone-200 px-4 py-2.5">
          <button onClick={close} className="rounded-full px-3 py-1 text-xs text-stone-600 hover:bg-stone-200">
            {result ? "Fechar" : "Cancelar"}
          </button>
          {!result && message.status === "pending" && (
            <button
              onClick={relay}
              disabled={mediatorId === "" || busy}
              className="flex items-center gap-1.5 rounded-full bg-stone-900 px-3.5 py-1 text-xs font-semibold text-white hover:bg-stone-700 disabled:opacity-40"
            >
              {busy && <Loader2 className="size-3.5 animate-spin" />}
              {busy ? "Mediando… (a resposta está sendo gerada)" : "Mediar"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

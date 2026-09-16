// frontend/src/components/builder/SectorMessagesPanel.tsx
import { useEffect, useState } from "react";
import { Plus, Send, MessagesSquare, Loader2, X, Clock } from "lucide-react";
import {
  listSectorMessages,
  requestSectorMessage,
  relaySectorMessage,
  listAgents,
  listSectors,
  type SectorMessage,
  type Agent,
  type Sector,
  ApiError,
} from "@/lib/api";

const STATUS_LABEL: Record<SectorMessage["status"], string> = {
  pending: "Pendente",
  answered: "Respondida",
  rejected: "Rejeitada",
};

const STATUS_COLOR: Record<SectorMessage["status"], string> = {
  pending: "bg-yellow-500/15 text-yellow-400",
  answered: "bg-green-500/15 text-green-400",
  rejected: "bg-red-500/15 text-red-400",
};

/**
 * Comunicação entre setores — sempre mediada (§8). Um agente nunca fala
 * direto com outro setor: pede aqui (`request`), e um orquestrador
 * (sector_orchestrator/general_orchestrator/ceo) encaminha (`relay`).
 * Agente operacional tentando mediar é rejeitado com 403 — a UI só
 * mostra o botão de encaminhar pra manter isso visível, mas quem decide
 * de verdade é sempre o backend.
 */
export default function SectorMessagesPanel() {
  const [messages, setMessages] = useState<SectorMessage[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [newMessageOpen, setNewMessageOpen] = useState(false);

  async function refresh() {
    try {
      const [messagesData, agentsData, sectorsData] = await Promise.all([listSectorMessages(), listAgents(), listSectors()]);
      setMessages(messagesData);
      setAgents(agentsData);
      setSectors(sectorsData);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao carregar mensagens.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 15000);
    return () => clearInterval(interval);
  }, []);

  async function handleRelay(message: SectorMessage) {
    // Simplificação deliberada: pede qual agente vai mediar via prompt.
    // Um orquestrador de verdade (sector_orchestrator/general_orchestrator/
    // ceo) precisa existir — se o ID digitado não tiver permissão, o
    // backend rejeita com 403 e a mensagem de erro aparece igual.
    const relayingIdStr = prompt(
      "ID do agente que vai mediar (precisa ser orquestrador de setor, orquestrador geral ou CEO):",
    );
    if (!relayingIdStr) return;
    const relayingId = Number(relayingIdStr);
    if (!relayingId) return;

    setBusyId(message.id);
    setError(null);
    try {
      const updated = await relaySectorMessage(message.id, relayingId);
      setMessages((prev) => prev.map((m) => (m.id === message.id ? updated : m)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao encaminhar mensagem.");
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return (
      <div className="space-y-2 p-6">
        {[0, 1].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-card border border-white/10 bg-surface-raised" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4 overflow-y-auto p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessagesSquare className="h-4 w-4 text-slate-400" />
          <h2 className="text-sm font-semibold text-slate-200">Comunicação entre setores</h2>
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-slate-400">{messages.length}</span>
        </div>
        <button
          onClick={() => setNewMessageOpen(true)}
          className="flex items-center gap-1.5 rounded-card bg-brand-500 px-3 py-1.5 text-xs font-medium text-white shadow-sm shadow-brand-500/30 transition hover:bg-brand-700"
        >
          <Plus className="h-3.5 w-3.5" />
          Nova mensagem
        </button>
      </div>

      {error && <p className="rounded-card border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</p>}

      {messages.length === 0 && !error && (
        <p className="rounded-card border border-dashed border-white/10 py-8 text-center text-sm text-slate-500">
          Nenhuma mensagem entre setores ainda — um agente nunca fala direto com outro setor, sempre passa por um
          orquestrador.
        </p>
      )}

      {messages.map((msg) => {
        const isBusy = busyId === msg.id;
        return (
          <div key={msg.id} className="rounded-card border border-white/10 bg-surface-raised p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-slate-100">{msg.from_agent_name}</span>
                  <span className="text-xs text-slate-500">→</span>
                  <span className="text-sm font-medium text-slate-100">{msg.to_sector_name}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_COLOR[msg.status]}`}>
                    {STATUS_LABEL[msg.status]}
                  </span>
                </div>
                <p className="mt-1.5 text-xs text-slate-300">{msg.content}</p>

                {msg.response && (
                  <div className="mt-2 rounded-md bg-black/20 px-3 py-2 text-xs text-slate-300">
                    <p className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">
                      Resposta {msg.relayed_by_name ? `(via ${msg.relayed_by_name})` : ""}
                    </p>
                    {msg.response}
                  </div>
                )}

                <p className="mt-1.5 flex items-center gap-1 text-[10px] text-slate-500">
                  <Clock className="h-3 w-3" />
                  {new Date(msg.created_at).toLocaleString("pt-BR")}
                </p>
              </div>

              {msg.status === "pending" && (
                <div className="shrink-0">
                  {isBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin text-slate-500" />
                  ) : (
                    <button
                      onClick={() => handleRelay(msg)}
                      className="flex items-center gap-1 rounded-lg bg-blue-500/15 px-2.5 py-1.5 text-xs font-medium text-blue-400 transition hover:bg-blue-500/25"
                    >
                      <Send className="h-3.5 w-3.5" />
                      Encaminhar
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}

      {newMessageOpen && (
        <NewSectorMessageModal
          agents={agents}
          sectors={sectors}
          onClose={() => setNewMessageOpen(false)}
          onCreated={(m) => setMessages((prev) => [m, ...prev])}
        />
      )}
    </div>
  );
}

interface NewSectorMessageModalProps {
  agents: Agent[];
  sectors: Sector[];
  onClose: () => void;
  onCreated: (message: SectorMessage) => void;
}

function NewSectorMessageModal({ agents, sectors, onClose, onCreated }: NewSectorMessageModalProps) {
  const [fromAgentId, setFromAgentId] = useState<number | "">("");
  const [toSectorId, setToSectorId] = useState<number | "">("");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mesmo cuidado do TaskBoard: nunca inicializar com agents[0]?.id direto
  // no useState — se a lista ainda não tiver carregado quando o modal
  // abre, o valor fica travado em "" pra sempre.
  useEffect(() => {
    if (fromAgentId === "" && agents.length > 0) setFromAgentId(agents[0].id);
    if (toSectorId === "" && sectors.length > 0) setToSectorId(sectors[0].id);
  }, [agents, sectors, fromAgentId, toSectorId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!fromAgentId || !toSectorId || !content.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const message = await requestSectorMessage(fromAgentId, toSectorId, content.trim());
      onCreated(message);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao criar mensagem.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md space-y-4 rounded-card border border-white/10 bg-surface-raised p-5"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-100">Pedir informação a outro setor</h3>
          <button type="button" onClick={onClose} className="text-slate-500 hover:text-slate-200">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div>
          <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">De (agente)</label>
          <select
            value={fromAgentId}
            onChange={(e) => setFromAgentId(Number(e.target.value))}
            className="w-full rounded-md border border-white/10 bg-surface px-3 py-2 text-sm text-slate-100 focus:border-brand-500 focus:outline-none"
          >
            {agents.map((a) => (
              <option key={a.id} value={a.id}>{a.name} {a.sector_name ? `(${a.sector_name})` : ""}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Para (setor)</label>
          <select
            value={toSectorId}
            onChange={(e) => setToSectorId(Number(e.target.value))}
            className="w-full rounded-md border border-white/10 bg-surface px-3 py-2 text-sm text-slate-100 focus:border-brand-500 focus:outline-none"
          >
            {sectors.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Pergunta</label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={3}
            required
            autoFocus
            className="w-full resize-none rounded-md border border-white/10 bg-surface px-3 py-2 text-sm text-slate-100 focus:border-brand-500 focus:outline-none"
            placeholder="O que você quer perguntar pro outro setor?"
          />
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={loading || !fromAgentId || !toSectorId || !content.trim()}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:opacity-40"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {loading ? "Enviando..." : "Enviar pedido"}
        </button>
      </form>
    </div>
  );
}

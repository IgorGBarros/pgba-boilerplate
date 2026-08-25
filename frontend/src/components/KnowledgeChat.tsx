// frontend/src/components/KnowledgeChat.tsx
import { useState } from "react";
import { queryKnowledge, ApiError, type RagSource } from "@/lib/api";

/**
 * Exemplo funcional de UI consumindo o RAG do backend
 * (POST /api/v1/ingestion/query/). Serve como referência de padrão para
 * agentes gerarem novas telas: estado de loading, erro tratado, e as
 * fontes SEMPRE exibidas junto da resposta (nunca só o texto gerado —
 * ver harness/guardrails.py no backend, a mesma filosofia vale na UI).
 */
export default function KnowledgeChat() {
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [sources, setSources] = useState<RagSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setError(null);
    try {
      const result = await queryKnowledge(query, { generateAnswer: true });
      setAnswer(result.answer ?? null);
      setSources(result.sources);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao consultar a base de conhecimento.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Pergunte algo sobre a base de conhecimento..."
          className="flex-1 rounded-card border border-white/10 bg-surface-raised px-4 py-2 text-sm outline-none focus:border-brand-500"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-card bg-brand-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:opacity-50"
        >
          {loading ? "Buscando..." : "Perguntar"}
        </button>
      </form>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {answer && (
        <div className="rounded-card border border-white/10 bg-surface-raised p-4">
          <p className="text-sm leading-relaxed">{answer}</p>
        </div>
      )}

      {sources.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wide text-slate-400">Fontes</p>
          {sources.map((s, i) => (
            <div key={i} className="rounded-card border border-white/5 bg-surface-raised/50 p-3 text-xs">
              <p className="font-medium text-slate-300">
                {s.document_title} · {s.source_name}
              </p>
              <p className="mt-1 text-slate-500 line-clamp-2">{s.content}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

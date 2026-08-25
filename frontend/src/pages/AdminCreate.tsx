// frontend/src/pages/AdminCreate.tsx
import { useEffect, useRef, useState } from "react";
import {
  connectGenerateStream,
  triggerGeneratePage,
  type GenerateLogEvent,
} from "@/lib/devserver";

const STAGE_PROGRESS: Record<GenerateLogEvent["stage"], number> = {
  plan: 10,
  write: 35,
  validate: 60,
  routes: 85,
  done: 95,
  complete: 100,
  error: 100,
};

/**
 * Painel "Criar página" — preencha o que a tela deve fazer, acompanhe a
 * geração em tempo real (planejar → escrever → validar → autocorrigir se
 * preciso → atualizar rotas), igual ao loop descrito em
 * `.agent/SKILL.md`, só que automatizado e visível.
 *
 * Requer `npm run dev:admin` (Vite + devserver juntos) — ver README.
 */
export default function AdminCreate() {
  const [prompt, setPrompt] = useState("");
  const [name, setName] = useState("");
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<GenerateLogEvent[]>([]);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    return () => eventSourceRef.current?.close();
  }, []);

  async function handleCreate() {
    if (!prompt.trim() || running) return;

    setRunning(true);
    setLogs([]);
    setProgress(0);
    setStatus("running");

    const jobId = `job_${Date.now()}`;
    const accessToken = localStorage.getItem("pgba_access_token") ?? undefined;

    const source = connectGenerateStream(jobId, (event) => {
      setLogs((prev) => [...prev, event]);
      setProgress(STAGE_PROGRESS[event.stage] ?? 0);

      if (event.stage === "complete") {
        setStatus("done");
        setRunning(false);
        source.close();
      }
      if (event.stage === "error") {
        setStatus("error");
        setRunning(false);
        source.close();
      }
    });
    eventSourceRef.current = source;

    try {
      await triggerGeneratePage({ jobId, prompt, name: name || undefined, accessToken });
    } catch (err) {
      setLogs((prev) => [
        ...prev,
        { stage: "error", message: err instanceof Error ? err.message : "Falha ao iniciar geração." },
      ]);
      setStatus("error");
      setRunning(false);
      source.close();
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-6 p-6">
      <div>
        <h2 className="font-display text-lg">Criar página</h2>
        <p className="text-sm text-slate-400">
          Descreva a tela que você quer. A geração passa pelo mesmo loop de validação de um
          agente de código — typecheck, autocorreção se necessário, e só então fica pronta.
        </p>
      </div>

      <div className="space-y-4 rounded-card border border-white/10 bg-surface-raised p-4">
        <div>
          <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">
            O que a página deve mostrar
          </label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={running}
            rows={3}
            placeholder="ex: um card de boas-vindas com título, descrição e botão verde de call-to-action"
            className="w-full rounded-card border border-white/10 bg-surface px-3 py-2 text-sm outline-none focus:border-brand-500 disabled:opacity-50"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">
            Nome da página (opcional)
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={running}
            placeholder="ex: BoasVindas (derivado do texto acima se deixar em branco)"
            className="w-full rounded-card border border-white/10 bg-surface px-3 py-2 text-sm outline-none focus:border-brand-500 disabled:opacity-50"
          />
        </div>

        <button
          onClick={handleCreate}
          disabled={!prompt.trim() || running}
          className="w-full rounded-card bg-brand-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running ? "Gerando..." : "Criar página"}
        </button>
      </div>

      {logs.length > 0 && (
        <div className="overflow-hidden rounded-card border border-white/10">
          <div className="flex items-center gap-2 border-b border-white/10 bg-surface-raised px-4 py-2">
            <span className="h-2.5 w-2.5 rounded-full bg-red-400/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-yellow-400/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-green-400/70" />
            <span className="ml-2 text-xs text-slate-400">Geração em andamento</span>
          </div>

          <div className="h-1.5 w-full bg-surface-raised">
            <div
              className={`h-full transition-all duration-300 ${
                status === "error" ? "bg-red-500" : status === "done" ? "bg-green-500" : "bg-brand-500"
              }`}
              style={{ width: `${progress}%` }}
            />
          </div>

          <div className="max-h-64 space-y-1 overflow-y-auto bg-black/40 p-4 font-mono text-xs text-green-400">
            {logs.map((event, i) => (
              <div key={i} className="whitespace-pre-wrap">
                [{event.stage}] {event.message}
              </div>
            ))}
          </div>

          {status === "done" && (
            <div className="border-t border-white/10 bg-surface-raised p-3 text-center text-sm text-green-400">
              ✅ Pronto — a página já aparece em "Páginas geradas".
            </div>
          )}
        </div>
      )}
    </div>
  );
}

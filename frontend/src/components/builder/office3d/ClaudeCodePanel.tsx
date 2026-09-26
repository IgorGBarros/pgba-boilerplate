// office3d/ClaudeCodePanel.tsx — rodar uma Task do Desenvolvimento no Claude Code local.
import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Play, SquareTerminal, X } from "lucide-react";
import { ApiError, type Task } from "@/lib/api";
import {
  connectClaudeCodeStream,
  finishClaudeCode,
  getClaudeCodeStatus,
  type ClaudeCodeEvent,
  type ClaudeCodeStatus,
} from "@/lib/devserver";
import { launchClaudeCode, newClaudeJobId, type ClaudeCodeMode } from "./claudeCode";

const MAX_LINES = 200;

export function ClaudeCodePanel({
  task,
  onTaskUpdated,
  onClose,
}: {
  task: Task;
  onTaskUpdated: (t: Task) => void;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<ClaudeCodeStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<ClaudeCodeEvent[]>([]);
  const [note, setNote] = useState("");
  const sourceRef = useRef<EventSource | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => { getClaudeCodeStatus().then(setStatus); }, []);
  useEffect(() => () => sourceRef.current?.close(), []);
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [lines]);

  const running = task.status === "in_progress" && task.runs_externally && task.progress < 1;
  const canStart = task.status === "created" || task.status === "adapted";

  const start = async (mode: ClaudeCodeMode) => {
    setBusy(true);
    setError(null);
    setLines([]);
    // Conecta o log ANTES de disparar: o devserver já emite na partida
    const jobId = newClaudeJobId(task.id);
    sourceRef.current?.close();
    const source = connectClaudeCodeStream(jobId, (event) => {
      setLines((prev) => [...prev.slice(-MAX_LINES), event]);
      if (event.stage === "complete") source.close();
    });
    sourceRef.current = source;
    try {
      const { task: updated } = await launchClaudeCode(task, mode, jobId);
      onTaskUpdated(updated);
      if (mode === "terminal") {
        setLines((prev) => [...prev, { stage: "plan", message: "Quando terminar no terminal, use “Concluí” abaixo." }]);
      }
    } catch (err) {
      source.close();
      const closed = (err as { task?: Task }).task;
      if (closed) onTaskUpdated(closed);
      setError(err instanceof ApiError || err instanceof Error ? err.message : "Falha ao iniciar o Claude Code.");
    } finally {
      setBusy(false);
    }
  };

  const finish = async (success: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const out = await finishClaudeCode({ taskId: task.id, success, note: note.trim() || undefined, workspace: task.workspace || undefined });
      setLines((prev) => [...prev, {
        stage: success ? "done" : "error",
        message: out.stopped
          ? "Execução interrompida — a tarefa foi fechada como falha."
          : success ? `Tarefa concluída (${out.files?.length ?? 0} arquivo(s) alterado(s)). Revise e aprove no quadro.` : "Tarefa marcada como falha.",
      }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao concluir.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 rounded-xl border border-violet-200 bg-violet-50/50 px-3 py-2.5">
      <div className="mb-1.5 flex items-center gap-2">
        <SquareTerminal className="size-3.5 text-violet-700" />
        <p className="text-[10px] font-semibold uppercase tracking-wider text-violet-800">Claude Code · tarefa #{task.id}</p>
        <span className="ml-auto text-[10px] text-stone-500">
          {status === null ? "verificando…" : status.available ? status.version : "indisponível"}
        </span>
        <button type="button" onClick={onClose} className="rounded-full p-0.5 text-stone-400 hover:bg-violet-100 hover:text-stone-800" aria-label="Fechar">
          <X className="size-3.5" />
        </button>
      </div>
      <p className="mb-2 line-clamp-2 text-[11px] text-stone-700">{task.brief}</p>
      <p className="mb-2 text-[10px] text-stone-500">
        Roda na SUA máquina (devserver), {task.workspace ? <>no projeto <code>{task.workspace}</code></> : "no repositório do boilerplate"}.
        O Claude Code não faz push: o resultado volta pro quadro pra revisão.
      </p>

      {status && !status.available && (
        <p className="mb-2 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-800">{status.error}</p>
      )}
      {error && <p className="mb-2 rounded bg-red-50 px-2 py-1 text-[11px] text-red-700">{error}</p>}

      {canStart && (
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => start("terminal")}
            disabled={busy || !status?.available}
            title="Abre uma janela de terminal com o Claude Code interativo, já com o pedido"
            className="flex items-center gap-1 rounded-full bg-violet-700 px-3 py-1 text-[11px] font-semibold text-white hover:bg-violet-800 disabled:opacity-40"
          >
            {busy ? <Loader2 className="size-3 animate-spin" /> : <SquareTerminal className="size-3" />} Abrir no terminal
          </button>
          <button
            type="button"
            onClick={() => start("headless")}
            disabled={busy || !status?.available}
            title="Roda em segundo plano, mostra o log aqui e fecha a tarefa sozinho"
            className="flex items-center gap-1 rounded-full border border-violet-300 bg-white px-3 py-1 text-[11px] font-medium text-violet-800 hover:bg-violet-50 disabled:opacity-40"
          >
            <Play className="size-3" /> Rodar aqui (com log)
          </button>
        </div>
      )}

      {lines.length > 0 && (
        <div ref={logRef} className="mt-2 max-h-40 space-y-0.5 overflow-y-auto rounded-lg bg-stone-900 px-2 py-1.5 font-mono text-[10px] leading-relaxed">
          {lines.map((l, i) => (
            <p
              key={i}
              className={`whitespace-pre-wrap ${
                l.stage === "error" ? "text-red-300" : l.stage === "done" ? "text-emerald-300" : l.stage === "tool" ? "text-violet-300" : "text-stone-200"
              }`}
            >
              {l.stage === "tool" ? "→ " : ""}{l.message}
            </p>
          ))}
        </div>
      )}

      {running && (
        <div className="mt-2 space-y-1.5">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Resumo do que foi feito (opcional)"
            className="h-7 w-full rounded-lg border border-stone-200 bg-white px-2 text-[11px] text-stone-800 outline-none focus:border-violet-400"
          />
          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => finish(false)}
              disabled={busy}
              className="rounded-full border border-stone-200 bg-white px-3 py-1 text-[11px] text-stone-700 hover:bg-stone-100 disabled:opacity-40"
            >
              Falhou / interromper
            </button>
            <button
              type="button"
              onClick={() => finish(true)}
              disabled={busy}
              className="flex items-center gap-1 rounded-full bg-stone-900 px-3 py-1 text-[11px] font-semibold text-white hover:bg-stone-700 disabled:opacity-40"
            >
              <Check className="size-3" /> Concluí
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

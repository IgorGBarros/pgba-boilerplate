// office3d/RoomTaskBoard.tsx — quadro de tarefas (agency.Task) dentro da sala.
//
// Mesmo ciclo de vida de agency/tasks.py, sem regra nova no navegador:
// cada botão só aparece no status em que o backend aceita a ação
// (executar: criada/adaptada; pausar: criada/em andamento; retomar com
// nova instrução: pausada; aprovar/rejeitar: qualquer uma ainda não
// decidida). Se o backend recusar mesmo assim (409), a mensagem dele
// aparece no cartão.
//
// Aprovar aqui não manda arquivos, então não abre PR — PR de uma Task com
// projeto continua sendo pelo quadro de tarefas do Studio, que tem os
// arquivos em mãos.
import { useMemo, useState } from "react";
import { Check, Loader2, Pause, Play, Plus, RotateCcw, SquareTerminal, X } from "lucide-react";
import {
  ApiError,
  adaptTask,
  approveTask,
  createTask,
  executeTask,
  interruptTask,
  rejectTask,
  type Task,
} from "@/lib/api";
import type { OfficeAgent } from "../office-types";
import { ClaudeCodePanel } from "./ClaudeCodePanel";

type Column = "doing" | "review" | "next" | "done";

const COLUMNS: Array<{ id: Column; label: string; hint: string }> = [
  { id: "doing", label: "Fazendo", hint: "Em execução agora" },
  { id: "review", label: "Revisar", hint: "Terminou — esperando aprovar ou rejeitar" },
  { id: "next", label: "Próximas", hint: "Criadas, adaptadas ou pausadas" },
  { id: "done", label: "Feitas", hint: "Aprovadas ou rejeitadas (últimas)" },
];

function taskColumn(t: Task): Column {
  if (t.status === "approved" || t.status === "rejected") return "done";
  if (t.status === "in_progress") return t.progress >= 1 ? "review" : "doing";
  return "next";
}

const STATUS_LABEL: Record<Task["status"], string> = {
  created: "criada",
  in_progress: "em andamento",
  paused_ceo: "pausada",
  adapted: "adaptada",
  approved: "aprovada",
  rejected: "rejeitada",
};

const DONE_LIMIT = 6;

export function RoomTaskBoard({
  tasks,
  agents,
  onTaskUpdated,
  claudeCode = false,
}: {
  /** Tasks dos agentes desta sala. */
  tasks: Task[];
  agents: OfficeAgent[];
  onTaskUpdated: (t: Task) => void;
  /** Sala do Desenvolvimento: tarefas podem ir pro Claude Code local. */
  claudeCode?: boolean;
}) {
  const [newAgent, setNewAgent] = useState<number | "">("");
  const [claudeTaskId, setClaudeTaskId] = useState<number | null>(null);
  const claudeTask = tasks.find((t) => t.id === claudeTaskId) ?? null;
  const [brief, setBrief] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const byColumn = useMemo(() => {
    const m: Record<Column, Task[]> = { doing: [], review: [], next: [], done: [] };
    for (const t of tasks) m[taskColumn(t)].push(t);
    m.done.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    m.done = m.done.slice(0, DONE_LIMIT);
    return m;
  }, [tasks]);

  const create = async (run: boolean | "claude") => {
    if (newAgent === "" || !brief.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const task = await createTask({ agentId: newAgent, brief: brief.trim() });
      onTaskUpdated(task);
      if (run === "claude") setClaudeTaskId(task.id);
      else if (run) onTaskUpdated(await executeTask(task.id));
      setBrief("");
    } catch (e) {
      setCreateError(e instanceof ApiError ? e.message : "Falha ao criar a tarefa.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {COLUMNS.map((col) => (
          <div key={col.id} className="min-w-0 rounded-xl border border-stone-200 bg-stone-50/60 p-1.5">
            <p className="mb-1 flex items-center justify-between px-1 text-[9px] font-semibold uppercase tracking-wider text-stone-500" title={col.hint}>
              {col.label}
              <span className="font-mono text-stone-400">{byColumn[col.id].length}</span>
            </p>
            <div className="space-y-1.5">
              {byColumn[col.id].length === 0 && <p className="px-1 py-2 text-center text-[10px] text-stone-300">—</p>}
              {byColumn[col.id].map((t) => (
                <TaskCard
                  key={t.id}
                  task={t}
                  onTaskUpdated={onTaskUpdated}
                  onClaudeCode={claudeCode ? () => setClaudeTaskId(t.id) : undefined}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {claudeTask && (
        <ClaudeCodePanel task={claudeTask} onTaskUpdated={onTaskUpdated} onClose={() => setClaudeTaskId(null)} />
      )}

      {agents.length > 0 && (
        <div className="mt-2 rounded-xl border border-dashed border-stone-300 bg-white px-2.5 py-2">
          <p className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-stone-500">
            <Plus className="size-3" /> Nova tarefa
          </p>
          <div className="flex flex-col gap-1.5 sm:flex-row">
            <select
              value={newAgent}
              onChange={(e) => setNewAgent(e.target.value === "" ? "" : Number(e.target.value))}
              className="h-8 rounded-lg border border-stone-200 bg-white px-2 text-xs text-stone-800 sm:w-40"
            >
              <option value="">Para quem…</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <input
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder="O que precisa ser feito?"
              className="h-8 min-w-0 flex-1 rounded-lg border border-stone-200 bg-white px-2.5 text-xs text-stone-800 outline-none focus:border-stone-400"
            />
          </div>
          {createError && <p className="mt-1.5 rounded bg-red-50 px-2 py-1 text-[11px] text-red-700">{createError}</p>}
          <div className="mt-1.5 flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => create(false)}
              disabled={creating || newAgent === "" || !brief.trim()}
              className="rounded-full border border-stone-200 px-3 py-1 text-[11px] text-stone-700 hover:bg-stone-100 disabled:opacity-40"
            >
              Criar
            </button>
            {claudeCode && (
              <button
                type="button"
                onClick={() => create("claude")}
                disabled={creating || newAgent === "" || !brief.trim()}
                title="Cria a tarefa e abre o painel do Claude Code local"
                className="flex items-center gap-1 rounded-full bg-violet-700 px-3 py-1 text-[11px] font-semibold text-white hover:bg-violet-800 disabled:opacity-40"
              >
                <SquareTerminal className="size-3" />
                Criar → Claude Code
              </button>
            )}
            <button
              type="button"
              onClick={() => create(true)}
              disabled={creating || newAgent === "" || !brief.trim()}
              className="flex items-center gap-1 rounded-full bg-stone-900 px-3 py-1 text-[11px] font-semibold text-white hover:bg-stone-700 disabled:opacity-40"
            >
              {creating ? <Loader2 className="size-3 animate-spin" /> : <Play className="size-3" />}
              Criar e executar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function TaskCard({
  task,
  onTaskUpdated,
  onClaudeCode,
}: {
  task: Task;
  onTaskUpdated: (t: Task) => void;
  onClaudeCode?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // "pause" pede a instrução do CEO; "adapt" pede o novo brief
  const [prompt, setPrompt] = useState<null | "pause" | "adapt">(null);
  const [text, setText] = useState("");
  const [expanded, setExpanded] = useState(false);

  const run = async (fn: () => Promise<Task>) => {
    setBusy(true);
    setError(null);
    try {
      onTaskUpdated(await fn());
      setPrompt(null);
      setText("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Falha na ação.");
    } finally {
      setBusy(false);
    }
  };

  const decided = task.status === "approved" || task.status === "rejected";
  const canExecute = (task.status === "created" || task.status === "adapted") && !task.runs_externally;
  const canPause = task.status === "created" || (task.status === "in_progress" && task.progress < 1);
  const output = typeof task.result?.output === "string" ? task.result.output : null;
  const failure = typeof task.result?.error === "string" ? task.result.error : null;

  return (
    <div className="rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-[11px]">
      <button type="button" onClick={() => setExpanded((v) => !v)} className="block w-full text-left">
        <p className={`text-stone-800 ${expanded ? "" : "line-clamp-2"}`}>{task.brief}</p>
        <p
          className="mt-0.5 truncate text-[9px] text-stone-400"
          title={task.runs_externally ? "Rodando fora do Django (ex: geração de página)" : undefined}
        >
          {[
            task.agent_name,
            STATUS_LABEL[task.status],
            task.version > 1 ? `v${task.version}` : null,
            task.runs_externally ? "externa" : null,
          ].filter(Boolean).join(" · ")}
        </p>
      </button>
      {task.status === "in_progress" && task.progress < 1 && (
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-stone-100">
          <div className="h-full animate-pulse rounded-full bg-emerald-500" style={{ width: `${Math.max(task.progress * 100, 12)}%` }} />
        </div>
      )}
      {expanded && (output || failure) && (
        <p className={`mt-1 max-h-24 overflow-auto whitespace-pre-wrap rounded px-1.5 py-1 text-[10px] ${failure ? "bg-red-50 text-red-700" : "bg-stone-50 text-stone-600"}`}>
          {failure ?? output}
        </p>
      )}
      {error && <p className="mt-1 rounded bg-red-50 px-1.5 py-0.5 text-[10px] text-red-700">{error}</p>}

      {prompt && (
        <div className="mt-1.5 space-y-1">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            autoFocus
            placeholder={prompt === "pause" ? "O que ajustar?" : "Novo pedido (continua de onde parou)"}
            className="w-full resize-none rounded border border-stone-200 px-1.5 py-1 text-[10px] text-stone-800 outline-none focus:border-stone-400"
          />
          <div className="flex justify-end gap-1">
            <button type="button" onClick={() => setPrompt(null)} className="rounded px-1.5 py-0.5 text-[10px] text-stone-500 hover:bg-stone-100">
              Cancelar
            </button>
            <button
              type="button"
              disabled={busy || !text.trim()}
              onClick={() => run(() => (prompt === "pause" ? interruptTask(task.id, text.trim()) : adaptTask(task.id, text.trim())))}
              className="rounded bg-stone-900 px-1.5 py-0.5 text-[10px] font-semibold text-white disabled:opacity-40"
            >
              {prompt === "pause" ? "Pausar" : "Retomar"}
            </button>
          </div>
        </div>
      )}

      {!decided && !prompt && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {busy && <Loader2 className="size-3 animate-spin text-stone-400" />}
          {onClaudeCode && task.task_type !== "generate_page"
            && (canExecute || (task.runs_externally && task.status === "in_progress" && task.progress < 1)) && (
            <ActionButton title="Claude Code local (terminal ou em segundo plano)" onClick={onClaudeCode} disabled={busy}>
              <SquareTerminal className="size-3" />
            </ActionButton>
          )}
          {canExecute && (
            <ActionButton title="Executar agora (IA do setor)" onClick={() => run(() => executeTask(task.id))} disabled={busy}>
              <Play className="size-3" />
            </ActionButton>
          )}
          {canPause && (
            <ActionButton title="Pausar com uma instrução" onClick={() => setPrompt("pause")} disabled={busy}>
              <Pause className="size-3" />
            </ActionButton>
          )}
          {task.status === "paused_ceo" && (
            <ActionButton title="Retomar com nova instrução" onClick={() => setPrompt("adapt")} disabled={busy}>
              <RotateCcw className="size-3" />
            </ActionButton>
          )}
          <span className="ml-auto flex gap-1">
            <ActionButton title="Rejeitar" onClick={() => run(() => rejectTask(task.id))} disabled={busy}>
              <X className="size-3" />
            </ActionButton>
            <ActionButton
              title="Aprovar (sem PR — PR com arquivos é pelo quadro do Studio)"
              onClick={() => run(async () => approveTask(task.id, { triggerGit: false }))}
              disabled={busy}
              primary
            >
              <Check className="size-3" />
            </ActionButton>
          </span>
        </div>
      )}
    </div>
  );
}

function ActionButton({
  children,
  title,
  onClick,
  disabled,
  primary = false,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={`flex size-6 items-center justify-center rounded-full disabled:opacity-40 ${
        primary ? "bg-stone-900 text-white hover:bg-stone-700" : "border border-stone-200 text-stone-600 hover:bg-stone-100"
      }`}
    >
      {children}
    </button>
  );
}

// frontend/src/components/builder/TaskBoard.tsx
import { useEffect, useState } from "react";
import { Plus, Play, Pause, RotateCcw, Check, X, ExternalLink, Loader2 } from "lucide-react";
import {
  listTasks,
  listAgents,
  createTask,
  executeTask,
  interruptTask,
  adaptTask,
  approveTask,
  rejectTask,
  type Task,
  type Agent,
  ApiError,
} from "@/lib/api";
import { useRealtime } from "@/lib/useRealtime";

type Column = "fila" | "execucao" | "revisao" | "concluido";

const COLUMNS: { id: Column; label: string }[] = [
  { id: "fila", label: "Fila" },
  { id: "execucao", label: "Em execução" },
  { id: "revisao", label: "Revisão" },
  { id: "concluido", label: "Concluído" },
];

/**
 * Não existe uma coluna "revisão" separada no modelo real — uma tarefa
 * concluída fica em IN_PROGRESS com progress=1.0 (ver agency/tasks.py).
 * Essa função é só a projeção visual dos status reais em 4 colunas,
 * nunca um status novo — created/adapted → fila; in_progress
 * (progress<1) + paused_ceo → execução; in_progress (progress>=1) →
 * revisão; approved/rejected → concluído.
 */
function columnFor(task: Task): Column {
  if (task.status === "created" || task.status === "adapted") return "fila";
  if (task.status === "paused_ceo") return "execucao";
  if (task.status === "in_progress") return task.progress >= 1 ? "revisao" : "execucao";
  return "concluido";
}

const STATUS_COLOR: Record<Task["status"], string> = {
  created: "bg-slate-500/15 text-slate-400",
  in_progress: "bg-blue-500/15 text-blue-400",
  paused_ceo: "bg-yellow-500/15 text-yellow-400",
  adapted: "bg-purple-500/15 text-purple-400",
  approved: "bg-green-500/15 text-green-400",
  rejected: "bg-red-500/15 text-red-400",
};

const STATUS_LABEL: Record<Task["status"], string> = {
  created: "Criada",
  in_progress: "Em andamento",
  paused_ceo: "Pausada",
  adapted: "Adaptada",
  approved: "Aprovada",
  rejected: "Rejeitada",
};

/**
 * Kanban do ciclo de vida completo de agency.Task — criar, executar
 * (dispara o modelo configurado no harness), interromper no meio (CEO
 * pausa e dá nova instrução), adaptar (retoma com o ajuste), aprovar
 * (se tiver projeto vinculado, cria PR de verdade no GitHub) ou
 * rejeitar. Atualiza em tempo real via WebSocket.
 */
export default function TaskBoard() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyTaskId, setBusyTaskId] = useState<number | null>(null);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const { connected, lastTaskEvent } = useRealtime();

  async function refresh() {
    try {
      const [tasksData, agentsData] = await Promise.all([listTasks(), listAgents()]);
      setTasks(tasksData);
      setAgents(agentsData);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao carregar tarefas.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (!lastTaskEvent) return;
    setTasks((prev) => {
      const exists = prev.some((t) => t.id === lastTaskEvent.id);
      if (exists) return prev.map((t) => (t.id === lastTaskEvent.id ? lastTaskEvent : t));
      return [lastTaskEvent, ...prev];
    });
  }, [lastTaskEvent]);

  async function runAction(taskId: number, action: () => Promise<Task>) {
    setBusyTaskId(taskId);
    setError(null);
    try {
      const updated = await action();
      setTasks((prev) => prev.map((t) => (t.id === taskId ? updated : t)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao executar ação.");
    } finally {
      setBusyTaskId(null);
    }
  }

  async function handleInterrupt(task: Task) {
    const instructions = prompt("Instrução pro agente ao retomar (o que ajustar):");
    if (!instructions) return;
    await runAction(task.id, () => interruptTask(task.id, instructions));
  }

  async function handleAdapt(task: Task) {
    const newBrief = prompt("Novo brief pra retomar a tarefa:", task.brief);
    if (!newBrief) return;
    await runAction(task.id, () => adaptTask(task.id, newBrief));
  }

  async function handleApprove(task: Task) {
    setBusyTaskId(task.id);
    setError(null);
    try {
      const result = await approveTask(task.id);
      setTasks((prev) => prev.map((t) => (t.id === task.id ? result : t)));
      if (result.pr_url) window.open(result.pr_url, "_blank");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao aprovar.");
    } finally {
      setBusyTaskId(null);
    }
  }

  if (loading) {
    return (
      <div className="grid gap-4 p-4 sm:p-6 md:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-40 animate-pulse rounded-card border border-white/10 bg-surface-raised" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden p-4 sm:p-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-slate-200">Tarefas</h2>
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-slate-400">{tasks.length}</span>
          <span className={`flex items-center gap-1 text-[10px] ${connected ? "text-green-400" : "text-slate-500"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-green-400" : "bg-slate-600"}`} />
            {connected ? "tempo real" : "reconectando..."}
          </span>
        </div>
        <button
          onClick={() => setNewTaskOpen(true)}
          className="flex items-center gap-1.5 rounded-card bg-brand-500 px-3 py-1.5 text-xs font-medium text-white shadow-sm shadow-brand-500/30 transition hover:bg-brand-700"
        >
          <Plus className="h-3.5 w-3.5" />
          Nova tarefa
        </button>
      </div>

      {error && <p className="mb-4 rounded-card border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</p>}

      <div className="grid flex-1 gap-4 overflow-hidden md:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map((col) => {
          const items = tasks.filter((t) => columnFor(t) === col.id);
          return (
            <div key={col.id} className="flex flex-col overflow-hidden rounded-card border border-white/10 bg-surface-raised">
              <div className="flex items-center justify-between border-b border-white/10 px-3 py-2.5">
                <p className="text-xs font-semibold text-slate-300">{col.label}</p>
                <span className="text-[11px] tabular-nums text-slate-500">{items.length}</span>
              </div>
              <div className="flex-1 space-y-2 overflow-y-auto p-2.5">
                {items.length === 0 ? (
                  <p className="py-6 text-center text-xs text-slate-600">Vazio</p>
                ) : (
                  items.map((task) => {
                    const isBusy = busyTaskId === task.id;
                    return (
                      <div key={task.id} className="rounded-md border border-white/10 bg-black/20 p-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-xs font-medium text-slate-100">{task.agent_name}</span>
                          <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ${STATUS_COLOR[task.status]}`}>
                            {STATUS_LABEL[task.status]}
                          </span>
                          {task.version > 1 && <span className="text-[9px] text-slate-500">v{task.version}</span>}
                        </div>
                        <p className="mt-1.5 line-clamp-3 whitespace-pre-wrap text-[11px] text-slate-400">{task.brief}</p>
                        {task.workspace && <p className="mt-1 font-mono text-[10px] text-slate-600">workspace: {task.workspace}</p>}

                        {task.status === "in_progress" && (
                          <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/5">
                            <div className="h-full bg-blue-400 transition-all" style={{ width: `${Math.round(task.progress * 100)}%` }} />
                          </div>
                        )}

                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {isBusy && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-500" />}

                          {!isBusy && (task.status === "created" || task.status === "adapted") && (
                            <button
                              onClick={() => runAction(task.id, () => executeTask(task.id))}
                              className="flex items-center gap-1 rounded-md bg-blue-500/15 px-2 py-1 text-[10px] font-medium text-blue-400 transition hover:bg-blue-500/25"
                            >
                              <Play className="h-3 w-3" />
                              Executar
                            </button>
                          )}

                          {!isBusy && task.status === "in_progress" && task.progress < 1 && (
                            <button
                              onClick={() => handleInterrupt(task)}
                              className="flex items-center gap-1 rounded-md bg-yellow-500/15 px-2 py-1 text-[10px] font-medium text-yellow-400 transition hover:bg-yellow-500/25"
                            >
                              <Pause className="h-3 w-3" />
                              Interromper
                            </button>
                          )}

                          {!isBusy && task.status === "paused_ceo" && (
                            <button
                              onClick={() => handleAdapt(task)}
                              className="flex items-center gap-1 rounded-md bg-purple-500/15 px-2 py-1 text-[10px] font-medium text-purple-400 transition hover:bg-purple-500/25"
                            >
                              <RotateCcw className="h-3 w-3" />
                              Adaptar
                            </button>
                          )}

                          {!isBusy && task.status === "in_progress" && task.progress >= 1 && (
                            <>
                              <button
                                onClick={() => handleApprove(task)}
                                className="flex items-center gap-1 rounded-md bg-green-500/15 px-2 py-1 text-[10px] font-medium text-green-400 transition hover:bg-green-500/25"
                              >
                                <Check className="h-3 w-3" />
                                Aprovar
                              </button>
                              <button
                                onClick={() => runAction(task.id, () => rejectTask(task.id))}
                                className="flex items-center gap-1 rounded-md bg-red-500/15 px-2 py-1 text-[10px] font-medium text-red-400 transition hover:bg-red-500/25"
                              >
                                <X className="h-3 w-3" />
                                Rejeitar
                              </button>
                            </>
                          )}
                        </div>

                        {task.result && Object.keys(task.result).length > 0 && (
                          <pre className="mt-2 max-h-24 overflow-auto rounded bg-black/30 p-1.5 text-[9px] text-slate-500">
                            {JSON.stringify(task.result, null, 2)}
                          </pre>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>

      {newTaskOpen && (
        <NewTaskModal agents={agents} onClose={() => setNewTaskOpen(false)} onCreated={(t) => setTasks((prev) => [t, ...prev])} />
      )}
    </div>
  );
}

interface NewTaskModalProps {
  agents: Agent[];
  onClose: () => void;
  onCreated: (task: Task) => void;
}

function NewTaskModal({ agents, onClose, onCreated }: NewTaskModalProps) {
  const [agentId, setAgentId] = useState<number | "">("");
  const [brief, setBrief] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (agentId === "" && agents.length > 0) {
      setAgentId(agents[0].id);
    }
  }, [agents, agentId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!agentId || !brief.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const task = await createTask({ agentId: Number(agentId), brief: brief.trim() });
      onCreated(task);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao criar tarefa.");
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
          <h3 className="text-sm font-semibold text-slate-100">Nova tarefa</h3>
          <button type="button" onClick={onClose} className="text-slate-500 hover:text-slate-200">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div>
          <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Agente</label>
          <select
            value={agentId}
            onChange={(e) => setAgentId(Number(e.target.value))}
            className="w-full rounded-md border border-white/10 bg-surface px-3 py-2 text-sm text-slate-100 focus:border-brand-500 focus:outline-none"
          >
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} {a.sector_name ? `(${a.sector_name})` : ""}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Brief</label>
          <textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            rows={4}
            required
            autoFocus
            className="w-full resize-none rounded-md border border-white/10 bg-surface px-3 py-2 text-sm text-slate-100 focus:border-brand-500 focus:outline-none"
            placeholder="O que essa tarefa pede — o prompt que o agente vai executar."
          />
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={loading || !agentId || !brief.trim()}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:opacity-40"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
          {loading ? "Criando..." : "Criar tarefa"}
        </button>
      </form>
    </div>
  );
}

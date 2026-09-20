import { useEffect, useRef, useState } from "react";
import {
  Bot,
  Building2,
  CheckCircle2,
  Circle,
  Clock,
  Loader2,
  Pause,
  Plus,
  RotateCcw,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/empresa/shared";
import { useRealtime } from "@/lib/RealtimeContext";
import {
  approveTask,
  executeTask,
  interruptTask,
  listTasks,
  type Task,
  type TaskStatus,
} from "@/lib/api";

type Column = { id: string; label: string; statuses: TaskStatus[]; icon: React.ReactNode };

const columns: Column[] = [
  {
    id: "backlog",
    label: "Fila",
    statuses: ["created"],
    icon: <Circle className="size-3.5 text-slate-400" />,
  },
  {
    id: "execucao",
    label: "Em execução",
    statuses: ["in_progress", "adapted"],
    icon: <Loader2 className="size-3.5 animate-spin text-blue-500" />,
  },
  {
    id: "revisao",
    label: "Revisão",
    statuses: ["paused_ceo"],
    icon: <Pause className="size-3.5 text-amber-500" />,
  },
  {
    id: "concluido",
    label: "Concluído",
    statuses: ["approved", "rejected"],
    icon: <CheckCircle2 className="size-3.5 text-green-500" />,
  },
];

async function moveTask(task: Task, toColId: string): Promise<Task | null> {
  try {
    if (toColId === "execucao") return await executeTask(task.id);
    if (toColId === "revisao") return await interruptTask(task.id, "Movido manualmente");
    if (toColId === "concluido") return await approveTask(task.id);
    return null;
  } catch {
    return null;
  }
}

// Cores por status
const STATUS_CONFIG: Record<
  TaskStatus,
  { label: string; color: string; icon: React.ReactNode }
> = {
  created: {
    label: "Aguardando",
    color: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
    icon: <Clock className="size-3" />,
  },
  in_progress: {
    label: "Executando",
    color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
    icon: <Loader2 className="size-3 animate-spin" />,
  },
  adapted: {
    label: "Adaptada",
    color: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
    icon: <RotateCcw className="size-3" />,
  },
  paused_ceo: {
    label: "Em revisão",
    color: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    icon: <Pause className="size-3" />,
  },
  approved: {
    label: "Aprovada",
    color: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
    icon: <CheckCircle2 className="size-3" />,
  },
  rejected: {
    label: "Rejeitada",
    color: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
    icon: <XCircle className="size-3" />,
  },
};

// Paleta determinística por nome de setor (hash simples)
const SECTOR_COLORS = [
  "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
  "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300",
  "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300",
  "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
  "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300",
];

function sectorColor(name: string | null): string {
  if (!name) return SECTOR_COLORS[0]!;
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) & 0xffff;
  return SECTOR_COLORS[hash % SECTOR_COLORS.length]!;
}

function relativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "agora";
  if (mins < 60) return `${mins}min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

// ─── Card ─────────────────────────────────────────────────────────────────────
function TaskCard({ task }: { task: Task }) {
  const s = STATUS_CONFIG[task.status];
  const pct = task.progress > 0 && task.progress < 1 ? Math.round(task.progress * 100) : null;

  return (
    <article className="group relative rounded-xl border border-border bg-card shadow-sm transition-all hover:shadow-md hover:border-primary/40 active:opacity-70 cursor-grab active:cursor-grabbing">
      {/* Top accent line by status */}
      <div
        className={`h-1 rounded-t-xl ${
          task.status === "in_progress" || task.status === "adapted"
            ? "bg-blue-400"
            : task.status === "paused_ceo"
            ? "bg-amber-400"
            : task.status === "approved"
            ? "bg-green-400"
            : task.status === "rejected"
            ? "bg-red-400"
            : "bg-slate-300"
        }`}
      />

      <div className="p-4 space-y-3">
        {/* Header row: sector chip + task id */}
        <div className="flex items-center justify-between gap-2">
          {task.sector_name && (
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${sectorColor(
                task.sector_name,
              )}`}
            >
              <Building2 className="size-3" />
              {task.sector_name}
            </span>
          )}
          <span className="ml-auto font-mono text-[10px] text-muted-foreground">
            #{task.id}
          </span>
        </div>

        {/* Brief */}
        <p className="text-sm font-medium leading-snug line-clamp-3 text-foreground">
          {task.brief}
        </p>

        {/* Progress bar */}
        {pct !== null && (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground">Progresso</span>
              <span className="text-[10px] font-semibold tabular-nums text-primary">
                {pct}%
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
              <div
                className="h-full rounded-full bg-primary transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}

        {/* Footer: agent + status + time */}
        <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/60">
          <div className="flex items-center gap-1.5 min-w-0">
            <div className="grid size-5 shrink-0 place-items-center rounded-full bg-primary/10">
              <Bot className="size-3 text-primary" />
            </div>
            <span className="truncate text-[11px] text-muted-foreground max-w-[100px]">
              {task.agent_name}
            </span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {task.project_name && (
              <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                {task.project_name}
              </span>
            )}
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${s.color}`}
            >
              {s.icon}
              {s.label}
            </span>
          </div>
        </div>

        {/* Timestamp */}
        <p className="text-[10px] text-muted-foreground/60 text-right">
          {relativeTime(task.updated_at)}
        </p>
      </div>
    </article>
  );
}

// ─── Column header accent ──────────────────────────────────────────────────────
const COL_STYLE: Record<
  string,
  { header: string; drop: string; empty: string }
> = {
  backlog: {
    header: "bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700",
    drop: "ring-slate-400",
    empty: "border-slate-300 dark:border-slate-700",
  },
  execucao: {
    header: "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800",
    drop: "ring-blue-400",
    empty: "border-blue-300 dark:border-blue-800",
  },
  revisao: {
    header: "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800",
    drop: "ring-amber-400",
    empty: "border-amber-300 dark:border-amber-800",
  },
  concluido: {
    header: "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800",
    drop: "ring-green-400",
    empty: "border-green-300 dark:border-green-800",
  },
};

// ─── Tasks ─────────────────────────────────────────────────────────────────────
export function Tasks({ onNewTask }: { onNewTask: (sector?: string) => void }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const draggedId = useRef<number | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);

  const { lastTaskEvent } = useRealtime();

  useEffect(() => {
    listTasks()
      .then(setTasks)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // Atualiza em tempo real via WebSocket
  useEffect(() => {
    if (!lastTaskEvent) return;
    setTasks((prev) => {
      const idx = prev.findIndex((t) => t.id === lastTaskEvent.id);
      return idx >= 0
        ? prev.map((t) => (t.id === lastTaskEvent.id ? lastTaskEvent : t))
        : [lastTaskEvent, ...prev];
    });
  }, [lastTaskEvent]);

  const handleDrop = async (colId: string) => {
    setDragOverCol(null);
    const id = draggedId.current;
    if (id == null) return;
    const task = tasks.find((t) => t.id === id);
    if (!task) return;

    const col = columns.find((c) => c.id === colId);
    if (col?.statuses.includes(task.status)) return;

    const targetStatus: TaskStatus =
      colId === "execucao" ? "in_progress"
      : colId === "revisao" ? "paused_ceo"
      : colId === "concluido" ? "approved"
      : task.status;

    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, status: targetStatus } : t)),
    );

    const result = await moveTask(task, colId);
    if (result) {
      setTasks((prev) => prev.map((t) => (t.id === result.id ? result : t)));
    } else {
      setTasks((prev) => prev.map((t) => (t.id === id ? task : t)));
      toast.error("Não foi possível mover a tarefa.");
    }
  };

  // Agrupa tarefas por setor dentro de cada coluna para exibição visual
  const totalActive = tasks.filter(
    (t) => t.status === "in_progress" || t.status === "adapted",
  ).length;

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Helpdesk interno"
        description="Tarefas direcionadas a setores e agentes — arraste entre colunas para mover de etapa."
        action={
          <div className="flex items-center gap-3">
            {totalActive > 0 && (
              <span className="flex items-center gap-1.5 rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                <Loader2 className="size-3 animate-spin" />
                {totalActive} em execução
              </span>
            )}
            <Button size="sm" onClick={() => onNewTask()}>
              <Plus className="size-4" />
              Nova tarefa
            </Button>
          </div>
        }
      />

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="rounded-xl border border-border h-48 animate-pulse bg-elevated" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {columns.map((column) => {
            const items = tasks.filter((t) => column.statuses.includes(t.status));
            const isOver = dragOverCol === column.id;
            const style = COL_STYLE[column.id]!;

            return (
              <div
                key={column.id}
                className={`flex flex-col rounded-xl border transition-all duration-150 ${style.header} ${
                  isOver ? `ring-2 ${style.drop} ring-offset-1` : ""
                }`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOverCol(column.id);
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node))
                    setDragOverCol(null);
                }}
                onDrop={() => handleDrop(column.id)}
              >
                {/* Cabeçalho */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-inherit">
                  <div className="flex items-center gap-2">
                    {column.icon}
                    <span className="text-sm font-semibold">{column.label}</span>
                  </div>
                  <span className="grid size-5 place-items-center rounded-full bg-background/80 text-[11px] font-bold tabular-nums text-muted-foreground shadow-sm">
                    {items.length}
                  </span>
                </div>

                {/* Cards */}
                <div className="flex-1 space-y-3 p-3 min-h-[120px]">
                  {items.length === 0 ? (
                    <div
                      className={`flex h-20 items-center justify-center rounded-lg border-2 border-dashed text-xs text-muted-foreground transition-colors ${
                        isOver
                          ? `${style.empty} text-foreground`
                          : style.empty
                      }`}
                    >
                      {isOver ? "Soltar aqui" : "Nenhuma tarefa"}
                    </div>
                  ) : (
                    items.map((task) => (
                      <div
                        key={task.id}
                        draggable
                        onDragStart={() => {
                          draggedId.current = task.id;
                        }}
                        onDragEnd={() => {
                          draggedId.current = null;
                        }}
                      >
                        <TaskCard task={task} />
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

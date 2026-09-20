import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/empresa/shared";
import {
  approveTask,
  executeTask,
  interruptTask,
  listTasks,
  type Task,
  type TaskStatus,
} from "@/lib/api";

type Column = { id: string; label: string; statuses: TaskStatus[] };

const columns: Column[] = [
  { id: "backlog",  label: "Fila",         statuses: ["created"] },
  { id: "execucao", label: "Em execução",  statuses: ["in_progress", "adapted"] },
  { id: "revisao",  label: "Revisão",      statuses: ["paused_ceo"] },
  { id: "concluido",label: "Concluído",    statuses: ["approved", "rejected"] },
];

// Mapeamento de destino → ação da API
async function moveTask(task: Task, toColId: string): Promise<Task | null> {
  try {
    if (toColId === "execucao") return await executeTask(task.id);
    if (toColId === "revisao")  return await interruptTask(task.id, "Movido manualmente");
    if (toColId === "concluido") return await approveTask(task.id);
    return null;
  } catch {
    return null;
  }
}

const STATUS_BADGE: Record<TaskStatus, "default" | "secondary" | "destructive"> = {
  created:    "secondary",
  in_progress:"default",
  adapted:    "default",
  paused_ceo: "destructive",
  approved:   "secondary",
  rejected:   "secondary",
};

const STATUS_LABEL: Record<TaskStatus, string> = {
  created:    "Fila",
  in_progress:"Executando",
  adapted:    "Adaptada",
  paused_ceo: "Pausada",
  approved:   "Aprovada",
  rejected:   "Rejeitada",
};

function progressLabel(t: Task): string {
  if (t.progress > 0 && t.progress < 1) return `${Math.round(t.progress * 100)}%`;
  return "";
}

// ─── Cor de destaque por coluna ────────────────────────────────────────────────
const COL_ACCENT: Record<string, string> = {
  backlog:  "border-slate-400 bg-slate-50/60 dark:bg-slate-800/30",
  execucao: "border-blue-400 bg-blue-50/60 dark:bg-blue-900/20",
  revisao:  "border-amber-400 bg-amber-50/60 dark:bg-amber-900/20",
  concluido:"border-green-400 bg-green-50/60 dark:bg-green-900/20",
};

const COL_HEADER: Record<string, string> = {
  backlog:  "bg-slate-100 dark:bg-slate-800/50",
  execucao: "bg-blue-100 dark:bg-blue-900/30",
  revisao:  "bg-amber-100 dark:bg-amber-900/30",
  concluido:"bg-green-100 dark:bg-green-900/30",
};

export function Tasks({ onNewTask }: { onNewTask: (sector?: string) => void }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const draggedId = useRef<number | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);

  useEffect(() => {
    listTasks()
      .then(setTasks)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleDrop = async (colId: string) => {
    setDragOverCol(null);
    const id = draggedId.current;
    if (id == null) return;
    const task = tasks.find((t) => t.id === id);
    if (!task) return;

    // Não fazer nada se já está nessa coluna
    const col = columns.find((c) => c.id === colId);
    if (col?.statuses.includes(task.status)) return;

    // Atualiza localmente de forma optimista
    const targetStatus = colId === "execucao" ? "in_progress"
      : colId === "revisao" ? "paused_ceo"
      : colId === "concluido" ? "approved"
      : task.status;

    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, status: targetStatus as TaskStatus } : t)),
    );

    const result = await moveTask(task, colId);
    if (result) {
      setTasks((prev) => prev.map((t) => (t.id === result.id ? result : t)));
    } else {
      // Rollback optimistic update
      setTasks((prev) => prev.map((t) => (t.id === id ? task : t)));
      toast.error("Não foi possível mover a tarefa. Tente novamente.");
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Helpdesk interno"
        description="Tarefas direcionadas a setores e agentes — arraste entre colunas para mover de etapa."
        action={
          <Button size="sm" onClick={() => onNewTask()}>
            <Plus className="size-4" />
            Nova tarefa
          </Button>
        }
      />

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="panel h-40 animate-pulse bg-elevated" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {columns.map((column) => {
            const items = tasks.filter((t) => column.statuses.includes(t.status));
            const isOver = dragOverCol === column.id;

            return (
              <div
                key={column.id}
                className={`panel flex flex-col transition-all duration-150 ${
                  isOver ? `ring-2 ring-primary ring-offset-1 ${COL_ACCENT[column.id]}` : ""
                }`}
                onDragOver={(e) => { e.preventDefault(); setDragOverCol(column.id); }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverCol(null);
                }}
                onDrop={() => handleDrop(column.id)}
              >
                {/* Cabeçalho da coluna */}
                <div
                  className={`flex items-center justify-between rounded-t-[calc(var(--radius)-1px)] px-4 py-3 ${COL_HEADER[column.id]}`}
                >
                  <p className="text-sm font-semibold">{column.label}</p>
                  <span className="grid size-5 place-items-center rounded-full bg-background/60 text-xs font-bold tabular-nums text-muted-foreground shadow-sm">
                    {items.length}
                  </span>
                </div>

                {/* Cards */}
                <div className="flex-1 space-y-2.5 p-3">
                  {items.length === 0 ? (
                    <div
                      className={`flex h-16 items-center justify-center rounded-md border-2 border-dashed text-sm text-muted-foreground transition-colors ${
                        isOver ? "border-primary text-primary" : "border-border"
                      }`}
                    >
                      {isOver ? "Soltar aqui" : "Vazio"}
                    </div>
                  ) : (
                    items.map((task) => (
                      <article
                        key={task.id}
                        draggable
                        onDragStart={() => { draggedId.current = task.id; }}
                        onDragEnd={() => { draggedId.current = null; }}
                        className="cursor-grab rounded-md border border-border bg-elevated p-3 active:cursor-grabbing active:opacity-60 hover:border-primary/50 transition-all"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-xs text-muted-foreground">
                            T-{task.id}
                          </span>
                          <Badge variant={STATUS_BADGE[task.status]} className="text-[11px]">
                            {STATUS_LABEL[task.status]}
                          </Badge>
                        </div>
                        <p className="mt-2 text-sm font-medium leading-snug line-clamp-2">
                          {task.brief}
                        </p>
                        <p className="mt-1.5 text-xs text-muted-foreground">
                          {task.agent_name}
                          {task.project_name && (
                            <span className="ml-1 rounded bg-primary/10 px-1 py-0.5 text-primary">
                              {task.project_name}
                            </span>
                          )}
                        </p>
                        {progressLabel(task) && (
                          <div className="mt-2">
                            <div className="flex items-center gap-1.5">
                              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-border">
                                <div
                                  className="h-full rounded-full bg-primary transition-all"
                                  style={{ width: `${task.progress * 100}%` }}
                                />
                              </div>
                              <span className="text-[10px] tabular-nums text-muted-foreground">
                                {progressLabel(task)}
                              </span>
                            </div>
                          </div>
                        )}
                      </article>
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

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/empresa/shared";
import { listTasks, type Task, type TaskStatus } from "@/lib/api";

type Column = { id: string; label: string; statuses: TaskStatus[] };

const columns: Column[] = [
  { id: "backlog", label: "Fila", statuses: ["created"] },
  { id: "execucao", label: "Em execução", statuses: ["in_progress", "adapted"] },
  { id: "revisao", label: "Revisão", statuses: ["paused_ceo"] },
  { id: "concluido", label: "Concluído", statuses: ["approved", "rejected"] },
];

function priorityBadge(status: TaskStatus) {
  if (status === "paused_ceo") return "destructive" as const;
  if (status === "in_progress") return "default" as const;
  return "secondary" as const;
}

function progressLabel(t: Task): string {
  if (t.progress > 0 && t.progress < 1) return `${Math.round(t.progress * 100)}%`;
  return "";
}

export function Tasks({ onNewTask }: { onNewTask: (sector?: string) => void }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listTasks()
      .then(setTasks)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Helpdesk interno"
        description="Tarefas direcionadas a setores e agentes, do pedido à entrega."
        action={
          <Button size="sm" onClick={() => onNewTask()}>
            <Plus className="size-4" />
            Nova tarefa
          </Button>
        }
      />

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="panel h-40 animate-pulse bg-elevated" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {columns.map((column) => {
            const items = tasks.filter((t) => column.statuses.includes(t.status));
            return (
              <div key={column.id} className="panel flex flex-col">
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                  <p className="text-sm font-semibold">{column.label}</p>
                  <span className="text-xs text-muted-foreground tabular-nums">{items.length}</span>
                </div>
                <div className="flex-1 space-y-3 p-3">
                  {items.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">Vazio</p>
                  ) : (
                    items.map((task) => (
                      <article
                        key={task.id}
                        className="rounded-md border border-border bg-elevated p-3"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-xs text-muted-foreground">
                            T-{task.id}
                          </span>
                          <Badge variant={priorityBadge(task.status)} className="text-[11px]">
                            {task.status}
                          </Badge>
                        </div>
                        <p className="mt-2 text-sm font-medium leading-snug line-clamp-2">
                          {task.brief}
                        </p>
                        <p className="mt-2 text-xs text-muted-foreground">
                          {task.agent_name}
                          {task.project_name && ` · ${task.project_name}`}
                        </p>
                        {progressLabel(task) && (
                          <div className="mt-2">
                            <div className="h-1 overflow-hidden rounded-full bg-border">
                              <div
                                className="h-full rounded-full bg-primary"
                                style={{ width: `${task.progress * 100}%` }}
                              />
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

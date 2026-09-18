import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/empresa/shared";
import { tasks, type Task, type TaskStatus } from "@/lib/pgba-data";

const columns: { id: TaskStatus; label: string }[] = [
  { id: "backlog", label: "Fila" },
  { id: "execucao", label: "Em execução" },
  { id: "revisao", label: "Revisão" },
  { id: "concluido", label: "Concluído" },
];

function priorityVariant(p: Task["priority"]) {
  if (p === "alta") return "destructive" as const;
  if (p === "media") return "default" as const;
  return "secondary" as const;
}

export function Tasks({ onNewTask }: { onNewTask: (sector?: string) => void }) {
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

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {columns.map((column) => {
          const items = tasks.filter((t) => t.status === column.id);
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
                        <span className="font-mono text-xs text-muted-foreground">{task.id}</span>
                        <Badge variant={priorityVariant(task.priority)} className="text-[11px]">
                          {task.priority}
                        </Badge>
                      </div>
                      <p className="mt-2 text-sm font-medium leading-snug">{task.title}</p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {task.sector} · {task.agent}
                      </p>
                      <p className="font-mono text-xs text-muted-foreground">{task.project}</p>
                    </article>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

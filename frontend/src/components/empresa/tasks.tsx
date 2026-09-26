import { useEffect, useRef, useState } from "react";
import {
  Bot,
  Building2,
  Calendar,
  CheckCircle2,
  Circle,
  Clock,
  ExternalLink,
  Loader2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Tag,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SectionHeader } from "@/components/empresa/shared";
import { useRealtime } from "@/lib/RealtimeContext";
import {
  approveTask,
  executeTask,
  interruptTask,
  rejectTask,
  listTasks,
  type Task,
  type TaskStatus,
} from "@/lib/api";

// ─── Configuração de colunas ──────────────────────────────────────────────────
type Column = { id: string; label: string; statuses: TaskStatus[] };

const columns: Column[] = [
  { id: "backlog",   label: "Fila",         statuses: ["created"] },
  { id: "execucao",  label: "Em execução",  statuses: ["in_progress", "adapted"] },
  { id: "revisao",   label: "Revisão",      statuses: ["paused_ceo"] },
  { id: "concluido", label: "Concluído",    statuses: ["approved", "rejected"] },
];

// Tarefas que não podem mais ser movidas
const LOCKED_STATUSES: TaskStatus[] = ["approved", "rejected"];

async function moveTask(task: Task, toColId: string): Promise<Task | null> {
  try {
    if (toColId === "execucao")  return await executeTask(task.id);
    if (toColId === "revisao")   return await interruptTask(task.id, "Movido manualmente");
    if (toColId === "concluido") return await approveTask(task.id);
    return null;
  } catch {
    return null;
  }
}

// ─── Status: label, cor de badge, cor da linha de topo ───────────────────────
const STATUS_CONFIG: Record<
  TaskStatus,
  { label: string; badge: string; accent: string; icon: React.ReactNode }
> = {
  created: {
    label: "Aguardando",
    badge: "bg-secondary text-foreground border border-border",
    accent: "bg-muted-foreground",
    icon: <Circle className="size-3" />,
  },
  in_progress: {
    label: "Executando",
    badge: "bg-blue-500/20 text-blue-700 dark:text-blue-300 border border-blue-500/30",
    accent: "bg-blue-500",
    icon: <Loader2 className="size-3 animate-spin" />,
  },
  adapted: {
    label: "Adaptada",
    badge: "bg-violet-500/20 text-violet-700 dark:text-violet-300 border border-violet-500/30",
    accent: "bg-violet-500",
    icon: <RotateCcw className="size-3" />,
  },
  paused_ceo: {
    label: "Em revisão",
    badge: "bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/30",
    accent: "bg-amber-400",
    icon: <Pause className="size-3" />,
  },
  approved: {
    label: "Aprovada",
    badge: "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30",
    accent: "bg-emerald-500",
    icon: <CheckCircle2 className="size-3" />,
  },
  rejected: {
    label: "Rejeitada",
    badge: "bg-red-500/20 text-red-600 dark:text-red-400 border border-red-500/30",
    accent: "bg-red-500",
    icon: <XCircle className="size-3" />,
  },
};

// Cabeçalho de cada coluna — cores sutis para dark/light
const COL_HEADER: Record<string, string> = {
  backlog:   "border-border/60",
  execucao:  "border-blue-500/30",
  revisao:   "border-amber-500/30",
  concluido: "border-emerald-500/30",
};

const COL_ICON: Record<string, React.ReactNode> = {
  backlog:   <Circle className="size-3.5 text-muted-foreground" />,
  execucao:  <Loader2 className="size-3.5 animate-spin text-blue-600 dark:text-blue-400" />,
  revisao:   <Pause className="size-3.5 text-amber-600 dark:text-amber-400" />,
  concluido: <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-400" />,
};

// Paleta de setor determinística (funciona nos dois temas)
const SECTOR_PALETTE = [
  "bg-violet-500/15 text-violet-700 dark:text-violet-300 border border-violet-500/25",
  "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border border-cyan-500/25",
  "bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/25",
  "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/25",
  "bg-orange-500/15 text-orange-700 dark:text-orange-300 border border-orange-500/25",
  "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border border-indigo-500/25",
];

function sectorColor(name: string | null): string {
  if (!name) return SECTOR_PALETTE[0]!;
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return SECTOR_PALETTE[h % SECTOR_PALETTE.length]!;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return "agora";
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// ─── Modal de detalhes ────────────────────────────────────────────────────────
function TaskDetailModal({
  task,
  onClose,
  onUpdate,
}: {
  task: Task;
  onClose: () => void;
  onUpdate: (t: Task) => void;
}) {
  const s = STATUS_CONFIG[task.status];
  const pct = task.progress > 0 && task.progress < 1 ? Math.round(task.progress * 100) : null;
  const locked = LOCKED_STATUSES.includes(task.status);
  const [busy, setBusy] = useState(false);

  async function act(fn: () => Promise<Task>) {
    setBusy(true);
    try {
      const updated = await fn();
      onUpdate(updated);
      onClose();
      toast.success("Tarefa atualizada");
    } catch {
      toast.error("Não foi possível executar a ação.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg bg-card border-border/60">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className={`h-8 w-1 rounded-full ${s.accent}`} />
            <div className="min-w-0">
              <p className="font-mono text-xs text-muted-foreground mb-0.5">Tarefa #{task.id}</p>
              <DialogTitle className="text-base leading-snug">{task.brief}</DialogTitle>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {/* Status + progresso */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${s.badge}`}>
              {s.icon}
              {s.label}
            </span>
            {pct !== null && (
              <span className="text-xs text-muted-foreground">{pct}% concluído</span>
            )}
          </div>

          {pct !== null && (
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full transition-all ${s.accent}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          )}

          {/* Informações principais */}
          <div className="grid grid-cols-2 gap-3 rounded-lg border border-border/50 bg-muted/30 p-3 text-sm">
            {task.sector_name && (
              <div className="flex items-center gap-2">
                <Building2 className="size-3.5 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Setor</p>
                  <p className="font-medium text-xs">{task.sector_name}</p>
                </div>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Bot className="size-3.5 text-muted-foreground shrink-0" />
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Agente</p>
                <p className="font-medium text-xs">{task.agent_name}</p>
              </div>
            </div>
            {task.project_name && (
              <div className="flex items-center gap-2">
                <Tag className="size-3.5 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Projeto</p>
                  {task.project_github_url ? (
                    <a
                      href={task.project_github_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 font-medium text-xs text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      {task.project_name}
                      <ExternalLink className="size-3" />
                    </a>
                  ) : (
                    <p className="font-medium text-xs">{task.project_name}</p>
                  )}
                </div>
              </div>
            )}
            {task.task_type && (
              <div className="flex items-center gap-2">
                <Play className="size-3.5 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Tipo</p>
                  <p className="font-medium text-xs">{task.task_type}</p>
                </div>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Calendar className="size-3.5 text-muted-foreground shrink-0" />
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Criada</p>
                <p className="font-medium text-xs">{fmtDate(task.created_at)}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="size-3.5 text-muted-foreground shrink-0" />
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Atualizada</p>
                <p className="font-medium text-xs">{fmtDate(task.updated_at)}</p>
              </div>
            </div>
          </div>

          {/* Snapshots */}
          {task.snapshots && task.snapshots.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Histórico ({task.snapshots.length})
              </p>
              <div className="space-y-1 max-h-24 overflow-y-auto rounded-lg border border-border/50 bg-muted/20 p-2">
                {task.snapshots.map((snap) => (
                  <div key={snap.version} className="flex items-center gap-2 text-xs">
                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                      v{snap.version}
                    </span>
                    <span className="text-muted-foreground">{fmtDate(snap.created_at)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Arquivos */}
          {task.current_files && task.current_files.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Arquivos
              </p>
              <div className="flex flex-wrap gap-1.5">
                {task.current_files.map((f) => (
                  <span key={f} className="inline-flex items-center gap-1 rounded bg-muted/60 px-2 py-0.5 text-[10px] font-mono text-muted-foreground">
                    <ExternalLink className="size-2.5" />
                    {f.split("/").pop()}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Ações — bloqueadas se aprovada ou rejeitada */}
          {!locked && (
            <div className="flex gap-2 pt-1 border-t border-border/50 flex-wrap">
              {task.status === "created" && (
                <Button
                  size="sm"
                  className="gap-1.5 h-8 text-xs"
                  disabled={busy}
                  onClick={() => act(() => executeTask(task.id))}
                >
                  <Play className="size-3" />
                  Executar
                </Button>
              )}
              {(task.status === "in_progress" || task.status === "adapted") && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 h-8 text-xs"
                    disabled={busy}
                    onClick={() => act(() => interruptTask(task.id, "Pausado via modal"))}
                  >
                    <Pause className="size-3" />
                    Pausar
                  </Button>
                  <Button
                    size="sm"
                    className="gap-1.5 h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                    disabled={busy}
                    onClick={() => act(() => approveTask(task.id))}
                  >
                    <CheckCircle2 className="size-3" />
                    Aprovar
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    className="gap-1.5 h-8 text-xs"
                    disabled={busy}
                    onClick={() => act(() => rejectTask(task.id))}
                  >
                    <XCircle className="size-3" />
                    Rejeitar
                  </Button>
                </>
              )}
              {task.status === "paused_ceo" && (
                <>
                  <Button
                    size="sm"
                    className="gap-1.5 h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                    disabled={busy}
                    onClick={() => act(() => approveTask(task.id))}
                  >
                    <CheckCircle2 className="size-3" />
                    Aprovar
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    className="gap-1.5 h-8 text-xs"
                    disabled={busy}
                    onClick={() => act(() => rejectTask(task.id))}
                  >
                    <XCircle className="size-3" />
                    Rejeitar
                  </Button>
                </>
              )}
              {busy && <Loader2 className="size-4 animate-spin text-muted-foreground self-center" />}
            </div>
          )}

          {locked && (
            <p className="text-xs text-muted-foreground italic">
              Esta tarefa está encerrada e não pode ser alterada.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Card ─────────────────────────────────────────────────────────────────────
function TaskCard({
  task,
  onClick,
}: {
  task: Task;
  onClick: () => void;
}) {
  const s = STATUS_CONFIG[task.status];
  const pct = task.progress > 0 && task.progress < 1 ? Math.round(task.progress * 100) : null;
  const locked = LOCKED_STATUSES.includes(task.status);

  return (
    <article
      onClick={onClick}
      className={`group relative rounded-xl border bg-card/90 shadow-sm transition-all
        hover:shadow-md hover:border-primary/30 select-none
        ${locked
          ? "border-border/40 opacity-80 cursor-pointer"
          : "border-border/60 cursor-grab active:cursor-grabbing active:opacity-60"
        }`}
    >
      {/* Accent line */}
      <div className={`h-[3px] rounded-t-xl ${s.accent} opacity-80`} />

      <div className="p-3.5 space-y-2.5">
        {/* Setor + ID */}
        <div className="flex items-center justify-between gap-2">
          {task.sector_name ? (
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${sectorColor(task.sector_name)}`}>
              <Building2 className="size-2.5" />
              {task.sector_name}
            </span>
          ) : (
            <span />
          )}
          <span className="font-mono text-[10px] text-muted-foreground/60">#{task.id}</span>
        </div>

        {/* Brief */}
        <p className="text-sm font-medium leading-snug line-clamp-3 text-foreground/90">
          {task.brief}
        </p>

        {/* Barra de progresso */}
        {pct !== null && (
          <div className="h-1 w-full overflow-hidden rounded-full bg-muted/60">
            <div
              className={`h-full rounded-full ${s.accent} transition-all duration-500`}
              style={{ width: `${pct}%` }}
            />
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-border/30">
          <div className="flex items-center gap-1.5 min-w-0">
            <div className="grid size-5 shrink-0 place-items-center rounded-full bg-primary/15">
              <Bot className="size-2.5 text-primary" />
            </div>
            <span className="truncate text-[10px] text-muted-foreground max-w-[90px]">
              {task.agent_name}
            </span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {task.project_name && (
              <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary/80">
                {task.project_name}
              </span>
            )}
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${s.badge}`}>
              {s.icon}
              {s.label}
            </span>
          </div>
        </div>

        {/* Timestamp */}
        <p className="text-[9px] text-muted-foreground/40 text-right">
          {relativeTime(task.updated_at)}
        </p>
      </div>
    </article>
  );
}

// ─── Tasks ─────────────────────────────────────────────────────────────────────
export function Tasks({ onNewTask }: { onNewTask: (sector?: string) => void }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const draggedId = useRef<number | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);

  const { lastTaskEvent } = useRealtime();

  useEffect(() => {
    listTasks()
      .then(setTasks)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!lastTaskEvent) return;
    setTasks((prev) => {
      const idx = prev.findIndex((t) => t.id === lastTaskEvent.id);
      return idx >= 0
        ? prev.map((t) => (t.id === lastTaskEvent.id ? lastTaskEvent : t))
        : [lastTaskEvent, ...prev];
    });
    // Mantém o modal sincronizado se estiver aberto
    setSelectedTask((sel) => sel?.id === lastTaskEvent.id ? lastTaskEvent : sel);
  }, [lastTaskEvent]);

  const handleDrop = async (colId: string) => {
    setDragOverCol(null);
    const id = draggedId.current;
    if (id == null) return;
    const task = tasks.find((t) => t.id === id);
    if (!task) return;

    // Bloqueado para tarefas finais
    if (LOCKED_STATUSES.includes(task.status)) {
      toast.error("Tarefas aprovadas ou rejeitadas não podem ser movidas.");
      return;
    }

    const col = columns.find((c) => c.id === colId);
    if (col?.statuses.includes(task.status)) return;

    const targetStatus: TaskStatus =
      colId === "execucao"  ? "in_progress"
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

  const totalActive = tasks.filter(
    (t) => t.status === "in_progress" || t.status === "adapted",
  ).length;

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Tarefas de todos os setores"
        description="As mesmas tarefas que aparecem em cada agente e no quadro da sala do Escritório 3D — arraste entre colunas ou clique para agir."
        action={
          <div className="flex items-center gap-3">
            {totalActive > 0 && (
              <span className="flex items-center gap-1.5 rounded-full bg-blue-500/15 px-3 py-1 text-xs font-semibold text-blue-600 dark:text-blue-400 border border-blue-500/25">
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
            <div key={i} className="rounded-xl border border-border/40 h-48 animate-pulse bg-muted/20" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {columns.map((column) => {
            const items = tasks.filter((t) => column.statuses.includes(t.status));
            const isOver = dragOverCol === column.id;
            const headerClass = COL_HEADER[column.id]!;

            return (
              <div
                key={column.id}
                className={`flex flex-col rounded-xl border bg-muted/10 transition-all duration-150 ${headerClass} ${
                  isOver ? "ring-1 ring-primary/40 ring-offset-1" : ""
                }`}
                onDragOver={(e) => { e.preventDefault(); setDragOverCol(column.id); }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node))
                    setDragOverCol(null);
                }}
                onDrop={() => handleDrop(column.id)}
              >
                {/* Cabeçalho da coluna */}
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/30">
                  <div className="flex items-center gap-2">
                    {COL_ICON[column.id]}
                    <span className="text-sm font-semibold text-foreground/80">{column.label}</span>
                  </div>
                  <span className="grid size-5 place-items-center rounded-full bg-muted text-[11px] font-bold tabular-nums text-muted-foreground">
                    {items.length}
                  </span>
                </div>

                {/* Cards */}
                <div className="flex-1 space-y-2.5 p-2.5 min-h-[120px]">
                  {items.length === 0 ? (
                    <div
                      className={`flex h-20 items-center justify-center rounded-lg border-2 border-dashed text-xs text-muted-foreground/50 transition-colors ${
                        isOver ? "border-primary/40 text-primary/60 bg-primary/5" : "border-border/30"
                      }`}
                    >
                      {isOver ? "Soltar aqui" : "Nenhuma tarefa"}
                    </div>
                  ) : (
                    items.map((task) => {
                      const locked = LOCKED_STATUSES.includes(task.status);
                      return (
                        <div
                          key={task.id}
                          draggable={!locked}
                          onDragStart={() => { if (!locked) draggedId.current = task.id; }}
                          onDragEnd={() => { draggedId.current = null; }}
                        >
                          <TaskCard
                            task={task}
                            onClick={() => setSelectedTask(task)}
                          />
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal de detalhes */}
      {selectedTask && (
        <TaskDetailModal
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
          onUpdate={(updated) => {
            setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
            setSelectedTask(updated);
          }}
        />
      )}
    </div>
  );
}

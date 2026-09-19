import { useEffect, useState } from "react";
import {
  Download,
  FolderGit2,
  GitBranch,
  MoreVertical,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SectionHeader } from "@/components/empresa/shared";
import { listProjects, deleteProject, updateProject, type Project } from "@/lib/api";
import { cn } from "@/lib/utils";

function statusVariant(status: Project["status"]) {
  if (status === "ready") return "default" as const;
  if (status === "pending") return "outline" as const;
  return "destructive" as const;
}

function statusLabel(status: Project["status"]) {
  if (status === "ready") return "ativo";
  if (status === "pending") return "pendente";
  return "falhou";
}

function formatDate(iso: string) {
  try {
    return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function ProjectRow({
  project,
  selected,
  onSelect,
  onDelete,
}: {
  project: Project;
  selected: number | null;
  onSelect: (p: Project) => void;
  onDelete: (p: Project) => void;
}) {
  const isSelected = selected === project.id;

  return (
    <div
      className={cn(
        "flex items-center gap-1 rounded-md pr-1 transition-colors hover:bg-accent",
        isSelected && "bg-accent",
      )}
    >
      <button
        type="button"
        onClick={() => onSelect(project)}
        className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left text-sm"
        style={{ paddingLeft: "8px" }}
      >
        <span className="w-3.5" />
        <FolderGit2 className="size-4 text-muted-foreground" />
        <span className="truncate font-medium">{project.name}</span>
        <Badge variant={statusVariant(project.status)} className="ml-auto text-[11px]">
          {statusLabel(project.status)}
        </Badge>
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-7" aria-label={`Ações de ${project.name}`}>
            <MoreVertical className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {project.github_repo_url && (
            <DropdownMenuItem onSelect={() => window.open(project.github_repo_url, "_blank")}>
              <GitBranch className="size-4" />
              Abrir no GitHub
            </DropdownMenuItem>
          )}
          <DropdownMenuItem variant="destructive" onSelect={() => onDelete(project)}>
            <Trash2 className="size-4" />
            Apagar
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function Projects({
  onNewProject,
  onImportProject,
  onNewTask,
  onOpenGerar,
}: {
  onNewProject: () => void;
  onImportProject: () => void;
  onNewTask: (sector?: string) => void;
  onOpenGerar?: () => void;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<Project | null>(null);
  const [editing, setEditing] = useState(false);
  const [editLocalPath, setEditLocalPath] = useState("");
  const [editGithub, setEditGithub] = useState("");
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    listProjects()
      .then((data) => {
        setProjects(data);
        if (data.length > 0 && selectedId === null) setSelectedId(data[0]!.id);
      })
      .catch(() => toast.error("Erro ao carregar projetos"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const selected = projects.find((p) => p.id === selectedId) ?? null;

  function startEdit() {
    if (!selected) return;
    setEditLocalPath(selected.local_path);
    setEditGithub(selected.github_full_name);
    setEditing(true);
  }

  async function saveEdit() {
    if (!selected) return;
    setSaving(true);
    try {
      const updated = await updateProject(selected.id, {
        localPath: editLocalPath,
        githubFullName: editGithub,
      });
      setProjects((ps) => ps.map((p) => (p.id === updated.id ? updated : p)));
      setEditing(false);
      toast.success("Projeto atualizado");
    } catch {
      toast.error("Erro ao salvar alterações");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Árvore de projetos"
        description="Projetos criados e importados pelo setor de Desenvolvimento."
        action={
          <div className="flex gap-2">
            <Button variant="ghost" size="icon" onClick={load} aria-label="Recarregar">
              <RefreshCw className={cn("size-4", loading && "animate-spin")} />
            </Button>
            <Button variant="secondary" size="sm" onClick={onImportProject}>
              <Download className="size-4" />
              Importar
            </Button>
            <Button size="sm" onClick={onNewProject}>
              <Plus className="size-4" />
              Novo projeto
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="panel p-3">
          {loading ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">Carregando...</p>
          ) : projects.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">
              Nenhum projeto ainda. Crie ou importe um.
            </p>
          ) : (
            projects.map((p) => (
              <ProjectRow
                key={p.id}
                project={p}
                selected={selectedId}
                onSelect={(proj) => { setSelectedId(proj.id); setEditing(false); }}
                onDelete={setDeleting}
              />
            ))
          )}
        </div>

        <aside className="panel space-y-4 p-5">
          {selected ? (
            <>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs uppercase tracking-widest text-muted-foreground">Selecionado</p>
                  <p className="mt-1 text-lg font-semibold">{selected.name}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {selected.github_full_name || selected.workspace || "—"}
                  </p>
                </div>
                {!editing && (
                  <Button variant="ghost" size="icon" className="size-7 shrink-0" onClick={startEdit} title="Editar pasta local / GitHub">
                    <Pencil className="size-3.5" />
                  </Button>
                )}
              </div>

              {editing ? (
                <div className="space-y-3">
                  <div>
                    <label className="mb-1 block text-[10px] uppercase tracking-wide text-muted-foreground">Pasta local</label>
                    <input
                      value={editLocalPath}
                      onChange={(e) => setEditLocalPath(e.target.value)}
                      placeholder="/Users/igor/projetos/nome"
                      className="w-full rounded border border-border bg-elevated px-2 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] uppercase tracking-wide text-muted-foreground">GitHub (owner/repo)</label>
                    <input
                      value={editGithub}
                      onChange={(e) => setEditGithub(e.target.value)}
                      placeholder="IgorGBarros/nome-repo"
                      className="w-full rounded border border-border bg-elevated px-2 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={saveEdit} disabled={saving} className="flex-1">
                      <Save className="size-3.5" />
                      {saving ? "Salvando..." : "Salvar"}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={saving}>
                      <X className="size-3.5" />
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <dl className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Tipo</dt>
                      <dd className="capitalize">{selected.origin === "created" ? "criado" : "importado"}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Workspace</dt>
                      <dd>{selected.workspace || "—"}</dd>
                    </div>
                    {selected.local_path && (
                      <div className="flex justify-between gap-2">
                        <dt className="shrink-0 text-muted-foreground">Pasta local</dt>
                        <dd className="truncate text-right font-mono text-xs" title={selected.local_path}>{selected.local_path}</dd>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Criado em</dt>
                      <dd>{formatDate(selected.created_at)}</dd>
                    </div>
                    {selected.requested_by_name && (
                      <div className="flex justify-between">
                        <dt className="text-muted-foreground">Solicitado por</dt>
                        <dd>{selected.requested_by_name}</dd>
                      </div>
                    )}
                  </dl>

                  {selected.github_full_name && (
                    <div className="space-y-2 rounded-md border border-border bg-elevated p-3 text-xs text-muted-foreground">
                      <p className="font-medium text-foreground">Repositório</p>
                      <p className="font-mono">{selected.github_full_name}</p>
                      {selected.github_repo_url && (
                        <a
                          href={selected.github_repo_url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1 text-primary hover:underline"
                        >
                          <GitBranch className="size-3" />
                          Abrir no GitHub
                        </a>
                      )}
                    </div>
                  )}

                  {selected.error_message && (
                    <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                      {selected.error_message}
                    </div>
                  )}

                  <div className="flex flex-col gap-2">
                    <Button variant="secondary" size="sm" onClick={() => onNewTask(selected.workspace || undefined)}>
                      Criar tarefa neste projeto
                    </Button>
                    {onOpenGerar && (
                      <Button variant="outline" size="sm" onClick={onOpenGerar}>
                        <Wand2 className="size-4" />
                        Gerar tela / código
                      </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={() => setDeleting(selected)}>
                      <Trash2 className="size-4" />
                      Apagar projeto
                    </Button>
                  </div>
                </>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Selecione um projeto da lista.</p>
          )}
        </aside>
      </div>

      <AlertDialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar "{deleting?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              O projeto será removido do sistema. O repositório no GitHub não será afetado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (deleting) {
                  try {
                    await deleteProject(deleting.id);
                    setProjects((ps) => ps.filter((p) => p.id !== deleting.id));
                    if (selectedId === deleting.id) setSelectedId(null);
                    toast.success("Projeto removido");
                  } catch {
                    toast.error("Erro ao remover projeto");
                  }
                }
                setDeleting(null);
              }}
            >
              Apagar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

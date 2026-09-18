import { useState } from "react";
import {
  ChevronRight,
  FolderOpen,
  Plus,
  Download,
  Pencil,
  Sparkles,
  FolderKanban,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/empresa/shared";
import { NodeDialog } from "@/components/empresa/detail-dialogs";
import { projectTree, type Project } from "@/lib/pgba-data";
import { cn } from "@/lib/utils";

const kindIcon = {
  motor: Sparkles,
  grupo: FolderOpen,
  projeto: FolderKanban,
} as const;

const stateVariant: Record<Project["state"], "default" | "secondary" | "outline"> = {
  ativo: "default",
  rascunho: "secondary",
  arquivado: "outline",
};

function ProjectNode({
  project,
  depth = 0,
  onEdit,
}: {
  project: Project;
  depth?: number;
  onEdit: (p: Project) => void;
}) {
  const [open, setOpen] = useState(true);
  const Icon = kindIcon[project.kind];
  const hasChildren = project.children && project.children.length > 0;

  return (
    <div>
      <div
        className={cn(
          "group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent",
          depth > 0 && "ml-4 border-l border-border pl-3"
        )}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="shrink-0 text-muted-foreground"
          >
            <ChevronRight
              className={cn("size-3.5 transition-transform", open && "rotate-90")}
            />
          </button>
        ) : (
          <span className="size-3.5 shrink-0" />
        )}

        <Icon className="size-4 shrink-0 text-primary" />

        <span className="min-w-0 flex-1 truncate font-medium">{project.name}</span>

        <Badge variant={stateVariant[project.state]} className="text-[11px]">
          {project.state}
        </Badge>

        <span className="hidden text-xs text-muted-foreground group-hover:inline">
          {project.updated}
        </span>

        <button
          type="button"
          onClick={() => onEdit(project)}
          className="hidden shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground group-hover:block"
        >
          <Pencil className="size-3.5" />
        </button>
      </div>

      {hasChildren && open && (
        <div>
          {project.children!.map((child) => (
            <ProjectNode key={child.id} project={child} depth={depth + 1} onEdit={onEdit} />
          ))}
        </div>
      )}
    </div>
  );
}

export function Projects({
  onNewProject,
  onImportProject,
  onNewTask,
}: {
  onNewProject: () => void;
  onImportProject: () => void;
  onNewTask: (sector?: string) => void;
}) {
  const [editing, setEditing] = useState<Project | null>(null);
  void onNewTask;

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Árvore de projetos"
        description="Motor principal e projetos derivados do workspace."
        action={
          <div className="flex gap-2">
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

      <div className="panel p-4">
        {projectTree.map((p) => (
          <ProjectNode key={p.id} project={p} onEdit={setEditing} />
        ))}
      </div>

      <NodeDialog
        open={!!editing}
        onOpenChange={(v) => !v && setEditing(null)}
        name={editing?.name ?? ""}
        path={editing?.path ?? ""}
        onSave={() => setEditing(null)}
      />
    </div>
  );
}

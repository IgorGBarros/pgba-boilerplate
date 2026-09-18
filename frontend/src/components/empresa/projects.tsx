import { useEffect, useState } from "react";
import {
  ChevronRight,
  Download,
  ExternalLink,
  FolderKanban,
  Plus,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/empresa/shared";
import { listProjects, type Project } from "@/lib/api";

const statusVariant: Record<Project["status"], "default" | "secondary" | "destructive"> = {
  ready: "default",
  pending: "secondary",
  failed: "destructive",
};

const originLabel: Record<Project["origin"], string> = {
  created: "criado",
  imported: "importado",
};

function formatDate(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 1) return "agora";
  if (h < 24) return `${h} h`;
  return `${Math.floor(diff / 86400000)} d`;
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
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  void onNewTask;

  useEffect(() => {
    listProjects()
      .then(setProjects)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const created = projects.filter((p) => p.origin === "created");
  const imported = projects.filter((p) => p.origin === "imported");

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Árvore de projetos"
        description="Motor principal e projetos derivados — criados ou importados do GitHub."
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

      {loading ? (
        <div className="panel h-48 animate-pulse bg-elevated" />
      ) : projects.length === 0 ? (
        <div className="panel flex flex-col items-center gap-2 py-12 text-center">
          <FolderKanban className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Nenhum projeto ainda.</p>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={onImportProject}>
              Importar existente
            </Button>
            <Button size="sm" onClick={onNewProject}>
              Criar novo
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {[
            { label: "Criados aqui", items: created },
            { label: "Importados", items: imported },
          ].map(({ label, items }) =>
            items.length === 0 ? null : (
              <div key={label} className="panel">
                <div className="flex items-center gap-2 border-b border-border px-4 py-2">
                  <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    {label}
                  </p>
                  <span className="text-xs text-muted-foreground">{items.length}</span>
                </div>
                <div className="divide-y divide-border">
                  {items.map((project) => (
                    <div key={project.id}>
                      <div
                        className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent"
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setExpanded((prev) => ({ ...prev, [project.id]: !prev[project.id] }))
                          }
                          className="shrink-0 text-muted-foreground"
                        >
                          <ChevronRight
                            className={`size-3.5 transition-transform ${
                              expanded[project.id] ? "rotate-90" : ""
                            }`}
                          />
                        </button>

                        <FolderKanban className="size-4 shrink-0 text-primary" />

                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{project.name}</p>
                          <p className="truncate font-mono text-xs text-muted-foreground">
                            {project.workspace || project.github_full_name || "—"}
                          </p>
                        </div>

                        <Badge variant={statusVariant[project.status]} className="text-[11px]">
                          {project.status}
                        </Badge>

                        <span className="hidden text-xs text-muted-foreground group-hover:inline">
                          {originLabel[project.origin]} · {formatDate(project.created_at)}
                        </span>

                        {project.github_repo_url && (
                          <a
                            href={project.github_repo_url}
                            target="_blank"
                            rel="noreferrer"
                            className="hidden shrink-0 text-muted-foreground hover:text-foreground group-hover:block"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <ExternalLink className="size-3.5" />
                          </a>
                        )}
                      </div>

                      {expanded[project.id] && project.description && (
                        <div className="ml-14 border-t border-border px-4 py-2">
                          <p className="text-xs text-muted-foreground">{project.description}</p>
                          {project.error_message && (
                            <p className="mt-1 text-xs text-destructive">{project.error_message}</p>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}

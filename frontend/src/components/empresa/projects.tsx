import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FolderKanban,
  MessageSquare,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SectionHeader } from "@/components/empresa/shared";
import { listProjects, deleteProject, updateProject, askStructured, type Project } from "@/lib/api";
import { useChatPersistence } from "@/hooks/useChatPersistence";
import ChatPanel from "@/components/builder/ChatPanel";
import HistorySidebar from "@/components/builder/HistorySidebar";
import type { ChatMessage } from "@/types/builder";

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

// ─── Edit Dialog ─────────────────────────────────────────────────────────────

function EditProjectDialog({
  project,
  open,
  onOpenChange,
  onSaved,
}: {
  project: Project | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: (updated: Project) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (project) {
      setName(project.name);
      setDescription(project.description ?? "");
    }
  }, [project]);

  const handleSave = async () => {
    if (!project) return;
    setSaving(true);
    try {
      const updated = await updateProject(project.id, { name, description });
      toast.success("Projeto atualizado");
      onSaved(updated);
      onOpenChange(false);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar projeto");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar projeto</DialogTitle>
          <DialogDescription>Altere o nome e a descrição do projeto.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ep-name">Nome</Label>
            <Input id="ep-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ep-desc">Descrição</Label>
            <Textarea
              id="ep-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Project Chat (Gerar inline) ─────────────────────────────────────────────

function ProjectChat({ project, onBack }: { project: Project; onBack: () => void }) {
  const storageKey = `project-chat-${project.id}`;
  const { messages, setMessages, history, clearAndArchive, deleteConversation, restoreConversation } =
    useChatPersistence(storageKey);
  const [isLoading, setIsLoading] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);

  const handleSend = async (content: string) => {
    const userMsg: ChatMessage = { id: crypto.randomUUID(), type: "user", content, timestamp: new Date() };
    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);
    try {
      const result = await askStructured(content);
      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        type: "assistant",
        content: result.answer,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erro ao enviar mensagem");
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header bar */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5 text-muted-foreground">
          <ArrowLeft className="size-4" />
          Projetos
        </Button>
        <span className="text-muted-foreground">/</span>
        <div className="flex items-center gap-2">
          <FolderKanban className="size-4 text-primary" />
          <span className="text-sm font-medium">{project.name}</span>
          {project.github_full_name && (
            <span className="font-mono text-xs text-muted-foreground">{project.github_full_name}</span>
          )}
        </div>
      </div>

      {/* Chat */}
      <div className="flex min-h-0 flex-1">
        <HistorySidebar
          isCollapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed((v) => !v)}
          activeConversationId={activeConversationId}
          onSelectConversation={(id) => { restoreConversation(id); setActiveConversationId(id); }}
          onNewChat={() => { clearAndArchive(); setActiveConversationId(null); }}
          conversations={history}
          onDeleteConversation={deleteConversation}
          onOpenSettings={() => {}}
        />
        <div className="min-w-0 flex-1">
          <ChatPanel
            messages={messages}
            isLoading={isLoading}
            onSend={handleSend}
            onReset={() => { clearAndArchive(); setActiveConversationId(null); }}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

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
  const [editProject, setEditProject] = useState<Project | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [activeProject, setActiveProject] = useState<Project | null>(null);

  void onNewTask;

  useEffect(() => {
    listProjects()
      .then(setProjects)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteProject(deleteTarget.id);
      setProjects((prev) => prev.filter((p) => p.id !== deleteTarget.id));
      if (activeProject?.id === deleteTarget.id) setActiveProject(null);
      toast.success(`Projeto "${deleteTarget.name}" removido da lista`);
      setDeleteOpen(false);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erro ao remover projeto");
    } finally {
      setDeleting(false);
    }
  };

  // ── Gerar view for selected project ────────────────────────────────────────
  if (activeProject) {
    return (
      <div style={{ height: "calc(100vh - 110px)" }}>
        <ProjectChat project={activeProject} onBack={() => setActiveProject(null)} />
      </div>
    );
  }

  const created = projects.filter((p) => p.origin === "created");
  const imported = projects.filter((p) => p.origin === "imported");

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Árvore de projetos"
        description="Motor principal e projetos derivados. Selecione um projeto para abrir o chat de geração."
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
            <Button variant="secondary" size="sm" onClick={onImportProject}>Importar existente</Button>
            <Button size="sm" onClick={onNewProject}>Criar novo</Button>
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
                      <div className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent">
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

                        {/* Clicking the name opens Gerar */}
                        <button
                          type="button"
                          className="min-w-0 flex-1 text-left"
                          onClick={() => setActiveProject(project)}
                        >
                          <p className="truncate text-sm font-medium hover:text-primary">
                            {project.name}
                          </p>
                          <p className="truncate font-mono text-xs text-muted-foreground">
                            {project.workspace || project.github_full_name || "—"}
                          </p>
                        </button>

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

                        {/* Open Gerar shortcut */}
                        <button
                          type="button"
                          title="Abrir chat do projeto"
                          className="hidden shrink-0 text-muted-foreground hover:text-primary group-hover:block"
                          onClick={() => setActiveProject(project)}
                        >
                          <MessageSquare className="size-3.5" />
                        </button>

                        {/* Edit / Delete */}
                        <div className="hidden shrink-0 items-center gap-1 group-hover:flex">
                          <button
                            type="button"
                            title="Editar projeto"
                            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditProject(project);
                              setEditOpen(true);
                            }}
                          >
                            <Pencil className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            title="Remover da lista"
                            className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteTarget(project);
                              setDeleteOpen(true);
                            }}
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      </div>

                      {expanded[project.id] && (project.description || project.error_message) && (
                        <div className="ml-14 border-t border-border px-4 py-2">
                          {project.description && (
                            <p className="text-xs text-muted-foreground">{project.description}</p>
                          )}
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

      {/* Edit dialog */}
      <EditProjectDialog
        project={editProject}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSaved={(updated) =>
          setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
        }
      />

      {/* Delete confirmation — só remove o registro, não toca em pasta ou GitHub */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remover projeto da lista</DialogTitle>
            <DialogDescription>
              Remove o projeto <strong className="text-foreground">"{deleteTarget?.name}"</strong>{" "}
              apenas da lista — o repositório GitHub e a pasta local{" "}
              <strong className="text-foreground">não serão afetados</strong>.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancelar</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? "Removendo..." : "Remover da lista"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Cpu,
  Download,
  FolderGit2,
  FolderOpen,
  MoreVertical,
  Pencil,
  Plus,
  Trash2,
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
import { NodeDialog } from "@/components/empresa/detail-dialogs";
import { projectTree as initialTree, type Project } from "@/lib/pgba-data";
import { cn } from "@/lib/utils";

function stateVariant(state: Project["state"]) {
  if (state === "ativo") return "default" as const;
  if (state === "rascunho") return "outline" as const;
  return "secondary" as const;
}

function removeNode(nodes: Project[], id: string): Project[] {
  return nodes
    .filter((n) => n.id !== id)
    .map((n) => (n.children ? { ...n, children: removeNode(n.children, id) } : n));
}

function updateNode(
  nodes: Project[],
  id: string,
  patch: { name: string; path: string },
): Project[] {
  return nodes.map((n) =>
    n.id === id
      ? { ...n, ...patch, children: n.children }
      : n.children
        ? { ...n, children: updateNode(n.children, id, patch) }
        : n,
  );
}

function flatten(nodes: Project[]): Project[] {
  return nodes.flatMap((n) => [n, ...(n.children ? flatten(n.children) : [])]);
}

function Node({
  node,
  depth,
  selected,
  onSelect,
  onEdit,
  onDelete,
}: {
  node: Project;
  depth: number;
  selected: string;
  onSelect: (p: Project) => void;
  onEdit: (p: Project) => void;
  onDelete: (p: Project) => void;
}) {
  const [open, setOpen] = useState(true);
  const hasChildren = !!node.children?.length;
  const Icon = node.kind === "motor" ? Cpu : hasChildren ? FolderOpen : FolderGit2;

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-1 rounded-md pr-1 transition-colors hover:bg-accent",
          selected === node.id && "bg-accent",
        )}
      >
        <button
          type="button"
          onClick={() => {
            onSelect(node);
            if (hasChildren) setOpen((v) => !v);
          }}
          className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left text-sm"
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
        >
          {hasChildren ? (
            open ? (
              <ChevronDown className="size-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="size-3.5 text-muted-foreground" />
            )
          ) : (
            <span className="w-3.5" />
          )}
          <Icon
            className={cn("size-4", node.kind === "motor" ? "text-primary" : "text-muted-foreground")}
          />
          <span className="truncate font-medium">{node.name}</span>
          <Badge variant={stateVariant(node.state)} className="ml-auto text-[11px]">
            {node.state}
          </Badge>
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-7" aria-label={`Ações de ${node.name}`}>
              <MoreVertical className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onEdit(node)}>
              <Pencil className="size-4" />
              Editar
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={() => onDelete(node)}>
              <Trash2 className="size-4" />
              Apagar
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {hasChildren && open ? (
        <div>
          {node.children!.map((child) => (
            <Node
              key={child.id}
              node={child}
              depth={depth + 1}
              selected={selected}
              onSelect={onSelect}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </div>
      ) : null}
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
  const [tree, setTree] = useState<Project[]>(initialTree);
  const [selectedId, setSelectedId] = useState(initialTree[0]!.id);
  const [editing, setEditing] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState<Project | null>(null);

  const selected = flatten(tree).find((n) => n.id === selectedId) ?? null;

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Árvore de projetos"
        description="Motor principal, template de workspace e todos os projetos derivados ou importados."
        action={
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={onImportProject}>
              <Download className="size-4" />
              Importar projeto
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
          {tree.map((node) => (
            <Node
              key={node.id}
              node={node}
              depth={0}
              selected={selectedId}
              onSelect={(p) => setSelectedId(p.id)}
              onEdit={setEditing}
              onDelete={setDeleting}
            />
          ))}
        </div>

        <aside className="panel space-y-4 p-5">
          {selected ? (
            <>
              <div>
                <p className="text-xs uppercase tracking-widest text-muted-foreground">
                  Selecionado
                </p>
                <p className="mt-1 text-lg font-semibold">{selected.name}</p>
                <p className="font-mono text-xs text-muted-foreground">{selected.path}</p>
              </div>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Tipo</dt>
                  <dd className="capitalize">{selected.kind}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Setor responsável</dt>
                  <dd>{selected.sector}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Atualizado</dt>
                  <dd>{selected.updated}</dd>
                </div>
              </dl>
              <div className="space-y-2 rounded-md border border-border bg-elevated p-3 text-xs text-muted-foreground">
                <p className="font-medium text-foreground">Preview isolado</p>
                <p className="font-mono">vite dev — porta 5183</p>
                <p className="font-mono">raiz: {selected.path}</p>
              </div>
              <div className="flex flex-col gap-2">
                <Button variant="secondary" size="sm" onClick={() => onNewTask(selected.sector)}>
                  Criar tarefa neste projeto
                </Button>
                <Button variant="outline" size="sm" onClick={() => setEditing(selected)}>
                  <Pencil className="size-4" />
                  Editar item
                </Button>
                <Button variant="outline" size="sm">
                  Abrir preview isolado
                </Button>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Selecione um item da árvore.</p>
          )}
        </aside>
      </div>

      <NodeDialog
        open={!!editing}
        onOpenChange={(v) => !v && setEditing(null)}
        name={editing?.name ?? ""}
        path={editing?.path ?? ""}
        onSave={(name, path) => {
          if (editing) setTree((t) => updateNode(t, editing.id, { name, path }));
        }}
      />

      <AlertDialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar "{deleting?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              O item e tudo que está dentro dele saem da árvore de projetos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleting) {
                  setTree((t) => removeNode(t, deleting.id));
                  toast.success("Item removido da árvore");
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

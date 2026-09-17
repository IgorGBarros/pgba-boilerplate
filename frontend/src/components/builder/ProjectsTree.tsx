// frontend/src/components/builder/ProjectsTree.tsx
import { useEffect, useState } from "react";
import { FolderTree, Github, Server, ExternalLink, Loader2, Monitor, Sparkles } from "lucide-react";
import { listProjects, type Project } from "@/lib/api";
import { listWorkspaces, type Workspace } from "@/lib/devserver";

const STATUS_COLOR: Record<Project["status"], string> = {
  pending: "bg-yellow-500/15 text-yellow-400",
  ready: "bg-green-500/15 text-green-400",
  failed: "bg-red-500/15 text-red-400",
};

const ORIGIN_LABEL: Record<Project["origin"], string> = {
  created: "Criado (template novo)",
  imported: "Importado (já existia)",
};

const ORIGIN_COLOR: Record<Project["origin"], string> = {
  created: "bg-blue-500/15 text-blue-400",
  imported: "bg-purple-500/15 text-purple-400",
};

/**
 * Árvore de projetos — desde a unificação, "projeto" é UMA coisa só
 * (nunca mais "local" separado de "GitHub"): todo Project nasce já com
 * pasta local vinculada (`Project.workspace`), seja criado do zero
 * (`create_project`) ou importado (`import_project`) — ver
 * NewProjectModal/ImportProjectModal. O Motor Principal continua à
 * parte, sempre existe, nunca é "um projeto" no banco.
 */
export default function ProjectsTree({ onOpenGerar }: { onOpenGerar: (workspace: string | null) => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selectedId, setSelectedId] = useState<number | "principal" | null>("principal");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const [pj, ws] = await Promise.all([listProjects(), listWorkspaces()]);
      setProjects(pj);
      setWorkspaces(ws);
      setError(null);
    } catch {
      setError("Falha ao carregar projetos.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 15000);
    return () => clearInterval(interval);
  }, []);

  const selected = selectedId === "principal" || selectedId === null ? null : projects.find((p) => p.id === selectedId) ?? null;
  const selectedWorkspace = selected ? workspaces.find((w) => w.name === selected.workspace) : undefined;

  if (loading) {
    return (
      <div className="space-y-2 p-6">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-16 animate-pulse rounded-card border border-white/10 bg-surface-raised" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-4 overflow-y-auto p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-4">
        {error && <p className="rounded-card border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</p>}

        <button
          onClick={() => setSelectedId("principal")}
          className={`flex w-full items-center gap-3 rounded-card border p-4 text-left transition ${
            selectedId === "principal" ? "border-brand-500 bg-brand-500/10" : "border-white/10 bg-surface-raised hover:border-white/20"
          }`}
        >
          <Server className="h-5 w-5 shrink-0 text-brand-500" />
          <div>
            <p className="text-sm font-medium text-slate-100">Motor Principal</p>
            <p className="text-xs text-slate-500">frontend/ — este próprio Studio, sempre no ar</p>
          </div>
        </button>

        <div>
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-200">
            <FolderTree className="h-4 w-4 text-slate-400" />
            Projetos
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-slate-400">{projects.length}</span>
          </h2>
          {projects.length === 0 ? (
            <p className="rounded-card border border-dashed border-white/10 py-6 text-center text-sm text-slate-500">
              Nenhum projeto ainda — crie ou importe um pelos botões acima.
            </p>
          ) : (
            <div className="space-y-2">
              {projects.map((p) => {
                const ws = workspaces.find((w) => w.name === p.workspace);
                return (
                  <button
                    key={p.id}
                    onClick={() => setSelectedId(p.id)}
                    className={`w-full rounded-card border p-4 text-left transition ${
                      selectedId === p.id ? "border-brand-500 bg-brand-500/10" : "border-white/10 bg-surface-raised hover:border-white/20"
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-slate-100">{p.name}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] ${ORIGIN_COLOR[p.origin]}`}>{ORIGIN_LABEL[p.origin]}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] ${STATUS_COLOR[p.status]}`}>{p.status}</span>
                      {p.status === "pending" && <Loader2 className="h-3 w-3 animate-spin text-yellow-400" />}
                    </div>
                    <p className="mt-1 font-mono text-[11px] text-slate-500">
                      frontend/workspace/{p.workspace || "?"}/ {ws?.running && `· rodando na porta ${ws.port}`}
                    </p>
                    {p.status === "failed" && p.error_message && <p className="mt-1 text-xs text-red-400">{p.error_message}</p>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Painel de seleção */}
      <aside className="space-y-3 rounded-card border border-white/10 bg-surface-raised p-4">
        {selectedId === "principal" ? (
          <>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-slate-500">Selecionado</p>
              <p className="mt-1 text-base font-semibold text-slate-100">Motor Principal</p>
              <p className="font-mono text-xs text-slate-500">frontend/</p>
            </div>
            <p className="text-xs text-slate-400">
              Toda a automação, credenciais e guardrails vivem aqui. Editar aqui estende o próprio PGBA Boilerplate — não um produto
              derivado.
            </p>
            <button
              onClick={() => onOpenGerar(null)}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-xs font-medium text-white hover:bg-brand-700"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Abrir Gerar
            </button>
          </>
        ) : selected ? (
          <>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-slate-500">Selecionado</p>
              <p className="mt-1 text-base font-semibold text-slate-100">{selected.name}</p>
              <p className="font-mono text-xs text-slate-500">frontend/workspace/{selected.workspace || "?"}/</p>
            </div>
            <dl className="space-y-1.5 text-xs">
              <div className="flex justify-between">
                <dt className="text-slate-500">Origem</dt>
                <dd className="text-slate-300">{ORIGIN_LABEL[selected.origin]}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Status</dt>
                <dd className="text-slate-300">{selected.status}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Responsável</dt>
                <dd className="text-slate-300">{selected.requested_by_name ?? "—"}</dd>
              </div>
            </dl>
            {selected.github_repo_url && (
              <a
                href={selected.github_repo_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-[11px] text-brand-500 hover:underline"
              >
                <Github className="h-3 w-3" />
                {selected.github_full_name}
                <ExternalLink className="h-3 w-3" />
              </a>
            )}

            <div className="space-y-1.5 rounded-md border border-white/10 bg-black/20 p-2.5 text-[11px] text-slate-400">
              <p className="flex items-center gap-1 font-medium text-slate-300">
                <Monitor className="h-3 w-3" />
                Preview isolado
              </p>
              {selectedWorkspace?.running ? (
                <p className="font-mono text-green-400">rodando · localhost:{selectedWorkspace.port}</p>
              ) : (
                <p className="font-mono">parado — inicie na aba Gerar</p>
              )}
            </div>

            <button
              onClick={() => onOpenGerar(selected.workspace || null)}
              disabled={!selected.workspace}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-40"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Abrir Gerar
            </button>
          </>
        ) : (
          <p className="text-sm text-slate-500">Selecione um item.</p>
        )}
      </aside>
    </div>
  );
}

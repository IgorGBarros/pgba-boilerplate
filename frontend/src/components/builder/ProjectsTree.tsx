// frontend/src/components/builder/ProjectsTree.tsx
import { useEffect, useState } from "react";
import { FolderTree, Github, Server, CircleDot, Circle, ExternalLink, Loader2 } from "lucide-react";
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
 * "Árvore de projetos, novo vs existente" — três categorias reais,
 * nunca misturadas porque são conceitos diferentes no sistema:
 * 1. Motor Principal — este próprio Studio (frontend/), sempre existe.
 * 2. Projetos locais — pastas em frontend/workspace/<nome>/, Vite
 *    isolado, porta própria. Sempre "novo" (não existe hoje um jeito
 *    de "importar" pasta local existente pra cá).
 * 3. Projetos no GitHub — agency.Project, com origin real no banco
 *    (criado via template vs importado de repositório que já existia).
 */
export default function ProjectsTree() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const [ws, pj] = await Promise.all([listWorkspaces(), listProjects()]);
      setWorkspaces(ws);
      setProjects(pj);
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
    <div className="space-y-6 overflow-y-auto p-4 sm:p-6">
      {error && <p className="rounded-card border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</p>}

      {/* Motor Principal */}
      <section>
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-200">
          <Server className="h-4 w-4 text-brand-500" />
          Motor Principal
        </h2>
        <div className="rounded-card border border-brand-500/30 bg-brand-500/5 p-4">
          <p className="text-sm font-medium text-slate-100">frontend/ (este próprio Studio)</p>
          <p className="mt-1 text-xs text-slate-400">
            Sempre no ar — toda a automação, credenciais e guardrails vivem aqui. Editar aqui estende o próprio PGBA Boilerplate.
          </p>
        </div>
      </section>

      {/* Projetos locais */}
      <section>
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-200">
          <FolderTree className="h-4 w-4 text-slate-400" />
          Projetos locais
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-slate-400">{workspaces.length}</span>
        </h2>
        {workspaces.length === 0 ? (
          <p className="rounded-card border border-dashed border-white/10 py-6 text-center text-sm text-slate-500">
            Nenhum projeto local ainda — crie um na aba Gerar.
          </p>
        ) : (
          <div className="space-y-2">
            {workspaces.map((w) => (
              <div key={w.name} className="flex items-center justify-between rounded-card border border-white/10 bg-surface-raised px-4 py-3">
                <div className="flex items-center gap-2">
                  {w.running ? <CircleDot className="h-3.5 w-3.5 text-green-400" /> : <Circle className="h-3.5 w-3.5 text-slate-600" />}
                  <span className="text-sm text-slate-100">{w.name}</span>
                  <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] text-blue-400">novo</span>
                </div>
                <span className="text-xs text-slate-500">
                  {w.running ? `rodando · localhost:${w.port}` : "parado"} · frontend/workspace/{w.name}/
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Projetos no GitHub */}
      <section>
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-200">
          <Github className="h-4 w-4 text-slate-400" />
          Projetos no GitHub
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-slate-400">{projects.length}</span>
        </h2>
        {projects.length === 0 ? (
          <p className="rounded-card border border-dashed border-white/10 py-6 text-center text-sm text-slate-500">
            Nenhum projeto publicado ou importado ainda.
          </p>
        ) : (
          <div className="space-y-2">
            {projects.map((p) => (
              <div key={p.id} className="rounded-card border border-white/10 bg-surface-raised px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-slate-100">{p.name}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] ${ORIGIN_COLOR[p.origin]}`}>{ORIGIN_LABEL[p.origin]}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] ${STATUS_COLOR[p.status]}`}>{p.status}</span>
                  {p.status === "pending" && <Loader2 className="h-3 w-3 animate-spin text-yellow-400" />}
                </div>
                {p.description && <p className="mt-1 text-xs text-slate-400">{p.description}</p>}
                {p.status === "failed" && p.error_message && <p className="mt-1 text-xs text-red-400">{p.error_message}</p>}
                {p.github_repo_url && (
                  <a
                    href={p.github_repo_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1.5 flex w-fit items-center gap-1 text-[11px] text-brand-500 hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" />
                    {p.github_full_name}
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

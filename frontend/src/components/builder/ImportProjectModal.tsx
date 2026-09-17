// frontend/src/components/builder/ImportProjectModal.tsx
import { useEffect, useState } from "react";
import { X, Download, Loader2 } from "lucide-react";
import { listAgents, importProject, type Agent, ApiError } from "@/lib/api";

interface ImportProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImported: () => void;
}

/**
 * Equivalente em UI do que `new-pgba -Name "..." -Import -GithubFullName
 * "usuario/repo" -Description "..."` já faz no PowerShell — mesmo
 * endpoint (`agency.services.import_project`), mesma confirmação real
 * contra a API do GitHub antes de marcar como pronto (nunca cria
 * repositório novo, só registra um que já existe).
 */
export default function ImportProjectModal({ isOpen, onClose, onImported }: ImportProjectModalProps) {
  const [name, setName] = useState("");
  const [githubFullName, setGithubFullName] = useState("");
  const [description, setDescription] = useState("");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentId, setAgentId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successUrl, setSuccessUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    listAgents()
      .then((data) => {
        setAgents(data);
        setAgentId((prev) => prev ?? data[0]?.id ?? null);
      })
      .catch(() => setAgents([]));
  }, [isOpen]);

  if (!isOpen) return null;

  const githubFormatValid = /^[\w.-]+\/[\w.-]+$/.test(githubFullName.trim());

  async function handleImport() {
    if (!name.trim() || !agentId || !githubFormatValid) return;
    setLoading(true);
    setError(null);
    setSuccessUrl(null);

    try {
      const project = await importProject({
        requestingAgentId: agentId,
        name: name.trim(),
        githubFullName: githubFullName.trim(),
        description: description.trim(),
      });
      if (project.status === "ready") {
        setSuccessUrl(project.github_repo_url);
        onImported();
      } else {
        setError(project.error_message || "Falha ao importar o projeto — o repositório existe e o token tem acesso a ele?");
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao importar o projeto.");
    } finally {
      setLoading(false);
    }
  }

  function handleClose() {
    setName("");
    setGithubFullName("");
    setDescription("");
    setSuccessUrl(null);
    setError(null);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={handleClose}>
      <div className="w-full max-w-md rounded-xl border border-white/10 bg-surface-raised shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-100">
            <Download className="h-4 w-4 text-brand-500" />
            Importar projeto existente
          </h2>
          <button onClick={handleClose} className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-white/5 hover:text-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        {successUrl ? (
          <div className="space-y-3 p-5">
            <p className="text-sm text-green-400">✅ Projeto importado com sucesso — repositório confirmado de verdade na API do GitHub.</p>
            <a href={successUrl} target="_blank" rel="noopener noreferrer" className="block truncate rounded-md bg-black/30 px-3 py-2 text-xs text-brand-500 underline">
              {successUrl}
            </a>
            <button onClick={handleClose} className="w-full rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
              Fechar
            </button>
          </div>
        ) : (
          <div className="space-y-4 p-5">
            <div>
              <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Nome (só pra gestão interna, não muda o repositório)</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Sistema-Financeiro"
                className="w-full rounded-md border border-white/10 bg-surface px-3 py-2 text-sm text-slate-100 focus:border-brand-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Repositório GitHub (owner/repo)</label>
              <input
                value={githubFullName}
                onChange={(e) => setGithubFullName(e.target.value)}
                placeholder="IgorGBarros/Sistema-Financeiro"
                className="w-full rounded-md border border-white/10 bg-surface px-3 py-2 text-sm text-slate-100 focus:border-brand-500 focus:outline-none"
              />
              {githubFullName.trim() !== "" && !githubFormatValid && (
                <p className="mt-1 text-[10px] text-red-400">Formato precisa ser owner/repo, ex: IgorGBarros/Sistema-Financeiro.</p>
              )}
            </div>

            <div>
              <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Descrição (opcional)</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="Opcional"
                className="w-full resize-none rounded-md border border-white/10 bg-surface px-3 py-2 text-sm text-slate-100 focus:border-brand-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Agente responsável</label>
              <select
                value={agentId ?? ""}
                onChange={(e) => setAgentId(Number(e.target.value))}
                className="w-full rounded-md border border-white/10 bg-surface px-3 py-2 text-sm text-slate-100"
              >
                {agents.length === 0 && <option value="">Nenhum agente cadastrado</option>}
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.sector_name ?? "sem setor"})
                  </option>
                ))}
              </select>
            </div>

            {error && <p className="text-xs text-red-400">{error}</p>}

            <button
              onClick={handleImport}
              disabled={!name.trim() || !agentId || !githubFormatValid || loading}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-40"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {loading ? "Confirmando repositório..." : "Importar projeto"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

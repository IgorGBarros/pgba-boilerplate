// frontend/src/components/builder/NewProjectModal.tsx
import { useEffect, useState } from "react";
import { X, Rocket, Loader2 } from "lucide-react";
import { listAgents, createProject, type Agent, ApiError } from "@/lib/api";

interface NewProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
}

/**
 * O "crie um projeto" do Lovable — só que de verdade: cria um
 * repositório GitHub real com o template `simple-commercial` via
 * `agency.services.create_project` (mesmo fluxo do `new-pgba` no
 * PowerShell, agora também acessível pela UI).
 */
export default function NewProjectModal({ isOpen, onClose, onCreated }: NewProjectModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentId, setAgentId] = useState<number | null>(null);
  const [isPublic, setIsPublic] = useState(false);
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

  async function handleCreate() {
    if (!name.trim() || !agentId) return;
    setLoading(true);
    setError(null);
    setSuccessUrl(null);

    try {
      const project = await createProject({ requestingAgentId: agentId, name: name.trim(), description, isPublic });
      if (project.status === "ready") {
        setSuccessUrl(project.github_repo_url);
        onCreated();
      } else {
        setError(project.error_message || "Falha ao criar o projeto.");
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao criar o projeto.");
    } finally {
      setLoading(false);
    }
  }

  function handleClose() {
    setName("");
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
            <Rocket className="h-4 w-4 text-brand-500" />
            Novo projeto
          </h2>
          <button onClick={handleClose} className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-white/5 hover:text-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        {successUrl ? (
          <div className="space-y-3 p-5">
            <p className="text-sm text-green-400">✅ Projeto criado com sucesso.</p>
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
              <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Nome (vira o repositório GitHub)</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="loja-cliente-x"
                className="w-full rounded-md border border-white/10 bg-surface px-3 py-2 text-sm text-slate-100 focus:border-brand-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Descrição</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="Landing page + checkout simples"
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

            <label className="flex items-center gap-2 text-xs text-slate-400">
              <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} className="h-3.5 w-3.5 accent-brand-500" />
              Repositório público (padrão: privado)
            </label>

            {error && <p className="text-xs text-red-400">{error}</p>}

            <button
              onClick={handleCreate}
              disabled={!name.trim() || !agentId || loading}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-40"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
              {loading ? "Criando..." : "Criar projeto"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

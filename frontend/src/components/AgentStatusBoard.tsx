// frontend/src/components/AgentStatusBoard.tsx
import { useEffect, useState } from "react";
import { listAgents, type Agent, type AgentWorkStatus, ApiError } from "@/lib/api";

const POLL_INTERVAL_MS = 4000;

const STATUS_LABEL: Record<AgentWorkStatus, string> = {
  working: "Trabalhando",
  idle: "Ocioso",
  paused: "Pausado",
};

const STATUS_DOT: Record<AgentWorkStatus, string> = {
  working: "bg-green-400 animate-pulse",
  idle: "bg-slate-500",
  paused: "bg-yellow-400",
};

function timeAgo(iso: string | null): string {
  if (!iso) return "sem atividade registrada";
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "agora mesmo";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours}h`;
  return `há ${Math.floor(hours / 24)}d`;
}

function groupBySector(agents: Agent[]): Map<string, Agent[]> {
  const groups = new Map<string, Agent[]>();
  for (const agent of agents) {
    const key = agent.sector_name ?? "Sem setor (acesso total)";
    groups.set(key, [...(groups.get(key) ?? []), agent]);
  }
  return groups;
}

/**
 * Alternativa deliberadamente sem 3D ao "escritório virtual": não anima
 * ninguém andando até uma cadeira, só mostra — por setor — quem está
 * trabalhando agora (`work_status`) e em quê (`current_task`), com
 * atualização por polling a cada poucos segundos.
 *
 * `ask_as_agent` é síncrono: um agente fica `working` só pela duração da
 * própria chamada de IA, que pode ser mais curta que o intervalo de
 * polling. Por isso todo agente mostra também `last_active_at` — a
 * última interação registrada, para não parecer "sempre ocioso" só
 * porque o poll não pegou o instante exato.
 */
export default function AgentStatusBoard() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchAgents() {
      try {
        const data = await listAgents();
        if (!cancelled) {
          setAgents(data);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Falha ao consultar agentes.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchAgents();
    const interval = setInterval(fetchAgents, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (loading) {
    return <p className="p-6 text-sm text-slate-500">Carregando agentes...</p>;
  }

  if (error) {
    return <p className="p-6 text-sm text-red-400">{error}</p>;
  }

  if (agents.length === 0) {
    return (
      <p className="p-6 text-sm text-slate-500">
        Nenhum agente cadastrado ainda — crie setores e agentes em{" "}
        <code className="rounded bg-surface-raised px-1.5 py-0.5">/api/v1/agency/</code>.
      </p>
    );
  }

  const grouped = groupBySector(agents);
  const workingCount = agents.filter((a) => a.work_status === "working").length;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-2 text-sm text-slate-400">
        <span className={`h-2 w-2 rounded-full ${workingCount > 0 ? "bg-green-400 animate-pulse" : "bg-slate-600"}`} />
        {workingCount > 0
          ? `${workingCount} agente${workingCount > 1 ? "s" : ""} trabalhando agora`
          : "Nenhum agente trabalhando neste instante"}
      </div>

      {Array.from(grouped.entries()).map(([sectorName, sectorAgents]) => (
        <div key={sectorName} className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{sectorName}</p>
          <div className="space-y-1.5">
            {sectorAgents.map((agent) => (
              <div
                key={agent.id}
                className="flex items-center justify-between rounded-card border border-white/10 bg-surface-raised px-4 py-2.5"
              >
                <div className="flex items-center gap-3">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${STATUS_DOT[agent.work_status]}`} />
                  <div>
                    <p className="text-sm font-medium">{agent.name}</p>
                    <p className="text-xs text-slate-500">{agent.role}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs text-slate-300">
                    {agent.work_status === "working" && agent.current_task
                      ? agent.current_task
                      : STATUS_LABEL[agent.work_status]}
                  </p>
                  <p className="text-[11px] text-slate-500">{timeAgo(agent.last_active_at)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

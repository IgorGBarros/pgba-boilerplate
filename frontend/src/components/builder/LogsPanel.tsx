// frontend/src/components/builder/LogsPanel.tsx
import { useEffect, useMemo, useState } from "react";
import { ScrollText } from "lucide-react";
import { listTasks, listPendingApprovals, listSectorMessages, type Task, type PendingApproval, type SectorMessage } from "@/lib/api";
import { useRealtime } from "@/lib/useRealtime";

type LogLevel = "ok" | "alerta" | "info";

interface LogEntry {
  key: string;
  timestamp: string;
  level: LogLevel;
  agent: string;
  action: string;
}

const LEVEL_COLOR: Record<LogLevel, string> = {
  ok: "text-green-400",
  alerta: "text-yellow-400",
  info: "text-slate-500",
};

function taskToEntry(t: Task): LogEntry {
  const level: LogLevel = t.status === "rejected" ? "alerta" : t.status === "approved" ? "ok" : "info";
  const action =
    t.status === "created"
      ? `Task criada: "${t.brief.slice(0, 60)}"`
      : t.status === "in_progress"
        ? t.progress >= 1
          ? "Task concluída, aguardando revisão"
          : `Task em andamento (${Math.round(t.progress * 100)}%)`
        : t.status === "paused_ceo"
          ? "Task pausada pelo CEO"
          : t.status === "adapted"
            ? "Task adaptada, retomando"
            : t.status === "approved"
              ? "Task aprovada"
              : "Task rejeitada";
  return { key: `task-${t.id}-${t.updated_at}`, timestamp: t.updated_at, level, agent: t.agent_name, action };
}

function approvalToEntry(p: PendingApproval): LogEntry {
  const level: LogLevel = p.status === "rejected" ? "alerta" : p.status === "approved" ? "ok" : "info";
  const action =
    p.status === "pending"
      ? `Ação de risco ${p.risk} aguardando aprovação — ${p.function_name}`
      : p.status === "approved"
        ? `Aprovado: ${p.function_name}`
        : `Rejeitado: ${p.function_name}`;
  return { key: `approval-${p.id}-${p.status}`, timestamp: p.decided_at ?? p.created_at, level, agent: p.agent_name, action };
}

function messageToEntry(m: SectorMessage): LogEntry {
  const level: LogLevel = m.status === "rejected" ? "alerta" : m.status === "answered" ? "ok" : "info";
  const action =
    m.status === "pending"
      ? `Pediu informação ao setor ${m.to_sector_name}`
      : m.status === "answered"
        ? `Recebeu resposta do setor ${m.to_sector_name}${m.relayed_by_name ? ` (via ${m.relayed_by_name})` : ""}`
        : `Pedido ao setor ${m.to_sector_name} rejeitado`;
  return { key: `msg-${m.id}-${m.status}`, timestamp: m.answered_at ?? m.created_at, level, agent: m.from_agent_name, action };
}

/**
 * "O que cada agente está fazendo" — reconstruído a partir de dados
 * reais (Task/PendingApproval/SectorMessage), não um modelo de auditoria
 * dedicado (não existe um "AuditLog" persistido, ver
 * 07-Sistema-PGBA/03-Roadmap.md). Limitação honesta: mostra o estado
 * ATUAL de cada registro, não cada transição intermediária que já
 * aconteceu — uma Task que passou por 3 status hoje aparece com uma
 * linha só, a mais recente. Eventos ao vivo (WebSocket) chegam
 * completos e são inseridos no topo assim que acontecem.
 */
export default function LogsPanel() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [messages, setMessages] = useState<SectorMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { connected, lastTaskEvent, lastPendingApprovalEvent } = useRealtime();

  useEffect(() => {
    Promise.all([listTasks(), listPendingApprovals(), listSectorMessages()])
      .then(([t, a, m]) => {
        setTasks(t);
        setApprovals(a);
        setMessages(m);
        setError(null);
      })
      .catch(() => setError("Falha ao carregar logs."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!lastTaskEvent) return;
    setTasks((prev) => {
      const exists = prev.some((t) => t.id === lastTaskEvent.id);
      return exists ? prev.map((t) => (t.id === lastTaskEvent.id ? lastTaskEvent : t)) : [lastTaskEvent, ...prev];
    });
  }, [lastTaskEvent]);

  useEffect(() => {
    if (!lastPendingApprovalEvent) return;
    setApprovals((prev) => {
      const exists = prev.some((p) => p.id === lastPendingApprovalEvent.id);
      return exists ? prev.map((p) => (p.id === lastPendingApprovalEvent.id ? lastPendingApprovalEvent : p)) : [lastPendingApprovalEvent, ...prev];
    });
  }, [lastPendingApprovalEvent]);

  const entries = useMemo(() => {
    const all = [...tasks.map(taskToEntry), ...approvals.map(approvalToEntry), ...messages.map(messageToEntry)];
    return all.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, 100);
  }, [tasks, approvals, messages]);

  if (loading) {
    return (
      <div className="space-y-2 p-6">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-8 animate-pulse rounded bg-surface-raised" />
        ))}
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6">
      <div className="mb-4 flex items-center gap-2">
        <ScrollText className="h-4 w-4 text-slate-400" />
        <h2 className="text-sm font-semibold text-slate-200">Logs</h2>
        <span className={`flex items-center gap-1 text-[10px] ${connected ? "text-green-400" : "text-slate-500"}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-green-400" : "bg-slate-600"}`} />
          {connected ? "tempo real" : "reconectando..."}
        </span>
      </div>

      {error && <p className="mb-4 rounded-card border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</p>}

      {entries.length === 0 && !error && (
        <p className="rounded-card border border-dashed border-white/10 py-8 text-center text-sm text-slate-500">Nenhuma atividade ainda.</p>
      )}

      <div className="overflow-hidden rounded-card border border-white/10 bg-surface-raised">
        <div className="divide-y divide-white/5 font-mono text-xs">
          {entries.map((entry) => (
            <div key={entry.key} className="flex items-start gap-3 px-4 py-2.5">
              <span className="shrink-0 tabular-nums text-slate-600">{new Date(entry.timestamp).toLocaleString("pt-BR")}</span>
              <span className={`w-14 shrink-0 uppercase ${LEVEL_COLOR[entry.level]}`}>{entry.level}</span>
              <span className="shrink-0 text-brand-500">{entry.agent}</span>
              <span className="min-w-0 flex-1 truncate text-slate-300">{entry.action}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

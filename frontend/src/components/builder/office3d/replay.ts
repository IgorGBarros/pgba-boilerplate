// office3d/replay.ts — estado do escritório num instante do passado.
//
// Funções puras sobre os eventos de GET agency/timeline/ (interações de IA,
// mudanças de status de Task, mensagens entre setores, aprovações). Nada é
// inventado: só o que o backend registrou. Limites que vêm do dado:
// - uma pergunta avulsa (ask_as_agent) só registra quando TERMINA, sem
//   duração — o agente conta como trabalhando numa janela curta antes dela
//   (REPLAY_WORK_WINDOW_MS);
// - Task conta como trabalho do status "em andamento" até terminar
//   (task_finished) ou mudar de status;
// - mensagem/aprovação criada antes do início da janela e ainda sem
//   desfecho nela não aparece (não há evento dela no período).
import type { PendingApproval, SectorMessage, TimelineEvent } from "@/lib/api";

export const REPLAY_WORK_WINDOW_MS = 90_000;
/** Velocidades do replay: 1 s de tela = N s do dia. */
export const REPLAY_SPEEDS = [60, 300, 1800] as const;
const RECENT_EVENTS = 6;

export interface ReplayState {
  /** Agentes trabalhando no instante: id → o que faziam. */
  working: Map<number, string>;
  /** Agentes com tarefa pausada pelo CEO no instante. */
  paused: Set<number>;
  /** Mensagens entre setores como estavam no instante. */
  messages: SectorMessage[];
  /** Aprovações ainda pendentes no instante. */
  approvals: PendingApproval[];
  /** Últimos eventos até o instante (mais recente primeiro). */
  recent: TimelineEvent[];
}

const ms = (iso: string) => new Date(iso).getTime();

export function replayStateAt(events: TimelineEvent[], t: number): ReplayState {
  const working = new Map<number, string>();
  const paused = new Set<number>();
  const tasks = new Map<number, { agent: number; status: string; finished: boolean; text: string }>();
  const msgs = new Map<number, SectorMessage>();
  const approvals = new Map<number, PendingApproval>();
  const recent: TimelineEvent[] = [];

  for (const e of events) {
    const at = ms(e.at);
    if (at > t) break; // eventos vêm ordenados por `at`
    recent.push(e);
    switch (e.kind) {
      case "interaction":
        if (t - at <= REPLAY_WORK_WINDOW_MS) working.set(e.agent_id, e.text);
        break;
      case "task_status":
        tasks.set(e.task_id, { agent: e.agent_id, status: e.status, finished: e.finished, text: e.text });
        break;
      case "task_finished": {
        const cur = tasks.get(e.task_id);
        if (cur) cur.finished = true;
        break;
      }
      case "message_created":
      case "message_answered":
      case "message_rejected": {
        const cur = msgs.get(e.message_id) ?? {
          id: e.message_id,
          from_agent: e.agent_id,
          from_agent_name: e.agent_name,
          to_sector: e.to_sector_id,
          to_sector_name: e.to_sector_name,
          relayed_by: null,
          relayed_by_name: null,
          content: e.text,
          response: "",
          status: "pending" as const,
          rejection_reason: "",
          created_at: e.created_at,
          answered_at: null,
          rejected_at: null,
        };
        if (e.kind === "message_answered") {
          cur.status = "answered";
          cur.answered_at = e.at;
          cur.relayed_by = e.relayed_by_id ?? null;
          cur.relayed_by_name = e.relayed_by_name ?? null;
        } else if (e.kind === "message_rejected") {
          cur.status = "rejected";
          cur.rejected_at = e.at;
        }
        msgs.set(e.message_id, cur);
        break;
      }
      case "approval_created":
        approvals.set(e.approval_id, {
          id: e.approval_id,
          agent: e.agent_id,
          agent_name: e.agent_name,
          function_name: e.text,
          params: {},
          risk: e.risk,
          reason: "",
          status: "pending",
          result: null,
          decided_by: null,
          decided_by_email: null,
          created_at: e.at,
          decided_at: null,
        });
        break;
      case "approval_decided":
        approvals.delete(e.approval_id);
        break;
    }
  }

  for (const task of tasks.values()) {
    if (task.status === "in_progress" && !task.finished) working.set(task.agent, task.text);
    if (task.status === "paused_ceo") paused.add(task.agent);
  }
  for (const id of working.keys()) paused.delete(id);

  return {
    working,
    paused,
    messages: [...msgs.values()].filter((m) => ms(m.created_at) <= t),
    approvals: [...approvals.values()],
    recent: recent.slice(-RECENT_EVENTS).reverse(),
  };
}

/** Texto curto de um evento, pra lista do replay. */
export function describeEvent(e: TimelineEvent, agentName: (id: number) => string): string {
  switch (e.kind) {
    case "interaction":
      return `${e.agent_name} respondeu: “${e.text}”`;
    case "task_status":
      return `${agentName(e.agent_id)} · tarefa ${TASK_WORD[e.status] ?? e.status}: ${e.text}`;
    case "task_finished":
      return `${agentName(e.agent_id)} terminou: ${e.text}`;
    case "message_created":
      return `✉ ${e.agent_name} → ${e.to_sector_name}: “${e.text}”`;
    case "message_answered":
      return `✉ ${e.to_sector_name} respondeu ${e.agent_name}${e.relayed_by_name ? ` (mediado por ${e.relayed_by_name})` : ""}`;
    case "message_rejected":
      return `✉ pedido de ${e.agent_name} → ${e.to_sector_name} rejeitado`;
    case "approval_created":
      return `⚠ ${e.agent_name} pediu aprovação: ${e.text}`;
    case "approval_decided":
      return `⚠ ${e.text} ${e.status === "approved" ? "aprovada" : "rejeitada"}`;
  }
}

const TASK_WORD: Record<string, string> = {
  created: "criada",
  in_progress: "começou",
  paused_ceo: "pausada",
  adapted: "adaptada",
  approved: "aprovada",
  rejected: "rejeitada",
};

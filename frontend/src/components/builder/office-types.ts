// office-types.ts — tipos locais do Escritório 3D, desacoplados do backend
// Adaptados dos componentes do escritorio_virtual_agentes (projeto-irmão)
// para usar os tipos reais de Agent/Sector da api.ts.
import type { Agent, Sector } from "@/lib/api";

export type OfficeStatus =
  | "working"
  | "thinking"
  | "idle"
  | "meeting"
  | "blocked"
  | "paused";

export interface OfficeAgent {
  id: number;
  name: string;
  role: string;
  initials: string;
  status: OfficeStatus;
  currentTask: string;
  sectorId: number | null;
  sectorName: string;
  isOrchestrator: boolean;
  access_level: string;
  appearance: { shirtColor: string };
}

export interface ActivityLog {
  id: string;
  agentName: string;
  status: OfficeStatus;
  action: string;
  room: string;
  timestamp: Date;
}

export interface MeetingMessage {
  id: string;
  agentId: string;
  agentName: string;
  message: string;
  timestamp: Date;
  type: "system" | "task" | "response";
}

export type MeetingType = "all-sectors" | "single-sector";

export const STATUS_LABELS: Record<OfficeStatus, string> = {
  working: "Trabalhando",
  thinking: "Pensando",
  idle: "Ocioso",
  meeting: "Em Reunião",
  blocked: "Bloqueado",
  paused: "Pausado",
};

export const STATUS_DOT: Record<OfficeStatus, string> = {
  working: "bg-green-500",
  thinking: "bg-blue-400",
  idle: "bg-slate-500",
  meeting: "bg-purple-500",
  blocked: "bg-red-500",
  paused: "bg-yellow-400",
};

const AGENT_COLORS = [
  "#7c3aed", "#2563eb", "#059669", "#d97706",
  "#dc2626", "#0891b2", "#be185d", "#4f46e5",
];

function toOfficeStatus(workStatus: string): OfficeStatus {
  if (workStatus === "working") return "working";
  if (workStatus === "paused") return "paused";
  return "idle";
}

function deriveInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length >= 2)
    return `${words[0]![0]}${words[words.length - 1]![0]}`.toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

// Cor do agente: derivada de uma combinação setor + índice dentro do setor,
// de modo que agentes do mesmo setor ficam com tonalidades próximas.
export function toOfficeAgent(
  agent: Agent,
  sectors: Sector[],
  agentIndex: number,
): OfficeAgent {
  const sector = sectors.find((s) => s.id === agent.sector);
  return {
    id: agent.id,
    name: agent.name,
    role: agent.role,
    initials: deriveInitials(agent.name),
    status: toOfficeStatus(agent.work_status),
    currentTask: agent.current_task?.trim() || "Sem tarefa ativa",
    sectorId: agent.sector,
    sectorName: sector?.name ?? "Sem setor",
    isOrchestrator:
      agent.access_level === "general_orchestrator" ||
      agent.access_level === "sector_orchestrator",
    access_level: agent.access_level,
    appearance: { shirtColor: AGENT_COLORS[agentIndex % AGENT_COLORS.length]! },
  };
}

// Funções auxiliares para regras de hierarquia (CLAUDE.md §7)
export function getOrchestrators(agents: OfficeAgent[]): OfficeAgent[] {
  return agents.filter(
    (a) => a.isOrchestrator || a.access_level === "ceo",
  );
}

export function getSectorAgents(
  agents: OfficeAgent[],
  sectorId: number,
): OfficeAgent[] {
  return agents.filter(
    (a) => a.sectorId === sectorId && a.access_level === "operational",
  );
}

export function getSectorOrchestrator(
  agents: OfficeAgent[],
  sectorId: number,
): OfficeAgent | undefined {
  return agents.find(
    (a) => a.sectorId === sectorId && a.access_level === "sector_orchestrator",
  );
}

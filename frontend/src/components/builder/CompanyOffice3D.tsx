// frontend/src/components/builder/CompanyOffice3D.tsx
// Fase 1 — salas + agentes ao vivo + painel lateral + barra superior.
// Movimento/pathfinding é Fase 2 (combinado, ver CLAUDE.md §7).
import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Text } from "@react-three/drei";
import type * as THREE from "three";
import {
  Activity,
  Brain,
  ChevronRight,
  Users,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { listAgents, listSectors, type Agent, type Sector, ApiError } from "@/lib/api";
import { useRealtime } from "@/lib/useRealtime";

// ─── Constantes ───────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 30_000;
const ROOM_W = 8;   // largura da sala
const ROOM_D = 7;   // profundidade
const ROOM_GAP = 2; // corredor entre salas
const ROOMS_PER_ROW = 3;
const WALL_H = 2.6;
const WALL_T = 0.18;
const DOOR_W = 1.8;

// Paleta determinística por índice — nunca troca entre rerenders
const ROOM_PALETTES = [
  { floor: "#1a1060", wall: "#2a1d8a", accent: "#5b4fdb" },
  { floor: "#1a3a1a", wall: "#1f5c1f", accent: "#3da83d" },
  { floor: "#3a1010", wall: "#6b1e1e", accent: "#d94040" },
  { floor: "#2a1560", wall: "#4a2090", accent: "#9060e0" },
  { floor: "#0d3040", wall: "#0f4d66", accent: "#1a9ccc" },
  { floor: "#3a2200", wall: "#7a4700", accent: "#f0950a" },
  { floor: "#2a003a", wall: "#5c0080", accent: "#c040f0" },
  { floor: "#001a30", wall: "#003060", accent: "#1060c0" },
] as const;

const STATUS_COLOR = { working: "#4ade80", idle: "#64748b", paused: "#facc15" } as const;
const STATUS_LABEL = { working: "Trabalhando", idle: "Ocioso", paused: "Pausado" } as const;
const STATUS_EMISSIVE = { working: 0.6, idle: 0.05, paused: 0.3 } as const;

// ─── Utilitários ──────────────────────────────────────────────────────────────

function roomCenter(index: number): [number, number] {
  const col = index % ROOMS_PER_ROW;
  const row = Math.floor(index / ROOMS_PER_ROW);
  return [col * (ROOM_W + ROOM_GAP), row * (ROOM_D + ROOM_GAP)];
}

function agentSlot(i: number, total: number): [number, number] {
  const cols = Math.max(2, Math.ceil(Math.sqrt(total)));
  const col = i % cols;
  const row = Math.floor(i / cols);
  const cellW = (ROOM_W - 1.5) / cols;
  const cellD = (ROOM_D - 1.5) / Math.ceil(total / cols);
  const startX = -(ROOM_W / 2 - 1);
  const startZ = -(ROOM_D / 2 - 1);
  return [startX + col * cellW + cellW / 2, startZ + row * cellD + cellD / 2];
}

function inferRoomType(name: string): "tech" | "design" | "meeting" | "generic" {
  const n = name.toLowerCase();
  if (n.includes("dev") || n.includes("back") || n.includes("front") || n.includes("infra") || n.includes("devops")) return "tech";
  if (n.includes("design") || n.includes("ux") || n.includes("marketing")) return "design";
  if (n.includes("reunião") || n.includes("meeting")) return "meeting";
  return "generic";
}

// ─── Móveis 3D ────────────────────────────────────────────────────────────────

function Workstation({ x, z, color }: { x: number; z: number; color: string }) {
  return (
    <group position={[x, 0, z]}>
      {/* Mesa */}
      <mesh position={[0, 0.4, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.9, 0.06, 0.55]} />
        <meshStandardMaterial color="#e0ddd8" />
      </mesh>
      {/* Pé */}
      <mesh position={[0, 0.2, 0]}>
        <boxGeometry args={[0.06, 0.4, 0.06]} />
        <meshStandardMaterial color="#999" />
      </mesh>
      {/* Monitor */}
      <mesh position={[0, 0.75, -0.18]} castShadow>
        <boxGeometry args={[0.55, 0.35, 0.04]} />
        <meshStandardMaterial color="#111" emissive={color} emissiveIntensity={0.3} />
      </mesh>
      {/* Cadeira */}
      <mesh position={[0, 0.22, 0.4]} castShadow>
        <boxGeometry args={[0.45, 0.06, 0.45]} />
        <meshStandardMaterial color="#2a2a3a" />
      </mesh>
      <mesh position={[0, 0.5, 0.62]}>
        <boxGeometry args={[0.45, 0.45, 0.05]} />
        <meshStandardMaterial color="#2a2a3a" />
      </mesh>
    </group>
  );
}

function ServerRack({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 1, 0]} castShadow>
        <boxGeometry args={[0.5, 2, 0.6]} />
        <meshStandardMaterial color="#0d0d14" />
      </mesh>
      {[0.3, 0.6, 0.9, 1.2, 1.5].map((y) => (
        <mesh key={y} position={[0, y, 0.31]}>
          <boxGeometry args={[0.46, 0.1, 0.02]} />
          <meshStandardMaterial color="#111" emissive="#00ff88" emissiveIntensity={0.4} />
        </mesh>
      ))}
    </group>
  );
}

function DesignBoard({ x, z, color }: { x: number; z: number; color: string }) {
  const swatches = ["#ff6b6b", "#ffd93d", "#6bcb77", "#4d96ff", "#c77dff"];
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 1, 0]} castShadow>
        <boxGeometry args={[1.2, 0.9, 0.04]} />
        <meshStandardMaterial color="#f8f4ec" />
      </mesh>
      {swatches.map((c, i) => (
        <mesh key={i} position={[-0.44 + i * 0.22, 1.05, 0.03]}>
          <boxGeometry args={[0.16, 0.16, 0.02]} />
          <meshStandardMaterial color={c} emissive={c} emissiveIntensity={0.2} />
        </mesh>
      ))}
      <mesh position={[0, 0.5, 0.02]}>
        <boxGeometry args={[0.06, 1, 0.06]} />
        <meshStandardMaterial color={color} />
      </mesh>
    </group>
  );
}

function ConferenceTable({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.4, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.6, 0.07, 1.1]} />
        <meshStandardMaterial color="#3b2c1e" />
      </mesh>
      {[-1, 0, 1].map((cx) =>
        [-0.65, 0.65].map((cz) => (
          <mesh key={`${cx}${cz}`} position={[cx * 0.8, 0.22, cz]}>
            <boxGeometry args={[0.42, 0.06, 0.42]} />
            <meshStandardMaterial color="#2a2a3a" />
          </mesh>
        )),
      )}
    </group>
  );
}

// ─── Avatar do agente ─────────────────────────────────────────────────────────

function AgentAvatar({ agent, position }: { agent: Agent; position: [number, number, number] }) {
  const ringRef = useRef<THREE.Mesh>(null!);
  const color = STATUS_COLOR[agent.work_status];
  const emissive = STATUS_EMISSIVE[agent.work_status];
  const isWorking = agent.work_status === "working";

  useFrame(({ clock }) => {
    if (!ringRef.current) return;
    if (isWorking) {
      const t = clock.getElapsedTime();
      ringRef.current.scale.setScalar(1 + 0.1 * Math.sin(t * 3));
      // @ts-expect-error emissiveIntensity exists on MeshStandardMaterial
      ringRef.current.material.emissiveIntensity = 0.4 + 0.3 * Math.sin(t * 3);
    }
  });

  return (
    <group position={position}>
      {/* Anel de status no chão */}
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <torusGeometry args={[0.22, 0.04, 6, 20]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={emissive} />
      </mesh>
      {/* Corpo */}
      <mesh position={[0, 0.65, 0]} castShadow>
        <capsuleGeometry args={[0.2, 0.5, 4, 8]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={emissive * 0.5} />
      </mesh>
      {/* Cabeça */}
      <mesh position={[0, 1.2, 0]} castShadow>
        <sphereGeometry args={[0.16, 12, 12]} />
        <meshStandardMaterial color="#deb891" />
      </mesh>
      {/* Nome */}
      <Text
        position={[0, 1.6, 0]}
        fontSize={0.16}
        color="#f1f5f9"
        anchorX="center"
        anchorY="bottom"
        outlineWidth={0.008}
        outlineColor="#000"
      >
        {agent.name}
      </Text>
      {/* Tarefa (só quando trabalhando) */}
      {isWorking && agent.current_task && (
        <Text
          position={[0, 1.42, 0]}
          fontSize={0.1}
          color="#86efac"
          anchorX="center"
          anchorY="bottom"
          maxWidth={1.8}
          outlineWidth={0.006}
          outlineColor="#000"
        >
          {agent.current_task}
        </Text>
      )}
    </group>
  );
}

// ─── Sala ─────────────────────────────────────────────────────────────────────

function Room({ sector, agents, index }: { sector: Sector; agents: Agent[]; index: number }) {
  const [cx, cz] = roomCenter(index);
  const palette = ROOM_PALETTES[index % ROOM_PALETTES.length]!;
  const type = inferRoomType(sector.name);

  const wallProps = { color: palette.wall } as const;
  const halfW = ROOM_W / 2;
  const halfD = ROOM_D / 2;

  return (
    <group position={[cx, 0, cz]}>
      {/* Piso */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow position={[0, 0.01, 0]}>
        <planeGeometry args={[ROOM_W, ROOM_D]} />
        <meshStandardMaterial color={palette.floor} />
      </mesh>

      {/* Parede traseira */}
      <mesh position={[0, WALL_H / 2, -halfD]} castShadow>
        <boxGeometry args={[ROOM_W, WALL_H, WALL_T]} />
        <meshStandardMaterial {...wallProps} />
      </mesh>

      {/* Parede esquerda */}
      <mesh position={[-halfW, WALL_H / 2, 0]}>
        <boxGeometry args={[WALL_T, WALL_H, ROOM_D]} />
        <meshStandardMaterial {...wallProps} />
      </mesh>

      {/* Parede direita */}
      <mesh position={[halfW, WALL_H / 2, 0]}>
        <boxGeometry args={[WALL_T, WALL_H, ROOM_D]} />
        <meshStandardMaterial {...wallProps} />
      </mesh>

      {/* Parede frontal: dois segmentos flanqueando a porta */}
      <mesh position={[-(halfW / 2 + DOOR_W / 4), WALL_H / 2, halfD]}>
        <boxGeometry args={[halfW - DOOR_W / 2, WALL_H, WALL_T]} />
        <meshStandardMaterial {...wallProps} />
      </mesh>
      <mesh position={[(halfW / 2 + DOOR_W / 4), WALL_H / 2, halfD]}>
        <boxGeometry args={[halfW - DOOR_W / 2, WALL_H, WALL_T]} />
        <meshStandardMaterial {...wallProps} />
      </mesh>

      {/* Rótulo da sala */}
      <Text
        position={[0, WALL_H + 0.3, -halfD + 0.1]}
        fontSize={0.32}
        color="#f1f5f9"
        anchorX="center"
        anchorY="bottom"
        outlineWidth={0.01}
        outlineColor="#000"
      >
        {sector.name}
      </Text>

      {/* Faixa de cor no topo da parede traseira */}
      <mesh position={[0, WALL_H - 0.08, -halfD + WALL_T / 2]}>
        <boxGeometry args={[ROOM_W - WALL_T, 0.12, 0.04]} />
        <meshStandardMaterial color={palette.accent} emissive={palette.accent} emissiveIntensity={0.3} />
      </mesh>

      {/* Móveis por tipo de setor */}
      {type === "tech" && (
        <>
          <Workstation x={-2.8} z={-2.2} color={palette.accent} />
          <Workstation x={-1.0} z={-2.2} color={palette.accent} />
          <Workstation x={0.8} z={-2.2} color={palette.accent} />
          <ServerRack x={2.8} z={-2.2} />
          <ServerRack x={2.8} z={-0.6} />
        </>
      )}
      {type === "design" && (
        <>
          <Workstation x={-2} z={-2} color={palette.accent} />
          <Workstation x={0} z={-2} color={palette.accent} />
          <DesignBoard x={2.5} z={-2} color={palette.accent} />
        </>
      )}
      {type === "meeting" && <ConferenceTable x={0} z={-0.5} />}
      {type === "generic" && (
        <>
          <Workstation x={-2} z={-2.2} color={palette.accent} />
          <Workstation x={0.5} z={-2.2} color={palette.accent} />
        </>
      )}

      {/* Agentes */}
      {agents.map((agent, i) => {
        const [ax, az] = agentSlot(i, agents.length);
        return <AgentAvatar key={agent.id} agent={agent} position={[ax, 0, az]} />;
      })}
    </group>
  );
}

// ─── Painel lateral HTML ──────────────────────────────────────────────────────

function AgentInfoPanel({
  agents,
  sectors,
  open,
  onClose,
}: {
  agents: Agent[];
  sectors: Sector[];
  open: boolean;
  onClose: () => void;
}) {
  const sectorMap = useMemo(
    () => new Map(sectors.map((s) => [s.id, s.name])),
    [sectors],
  );

  if (!open) return null;

  return (
    <div className="absolute right-0 top-0 flex h-full w-72 flex-col border-l border-white/10 bg-[#0d1117]/90 backdrop-blur-sm">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <p className="text-sm font-bold tracking-widest text-white">AGENTS INFO</p>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-white">
          <X className="size-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto divide-y divide-white/5">
        {agents.map((agent) => (
          <div key={agent.id} className="px-4 py-3 text-xs">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-bold text-white">{agent.name}</p>
                <p className="truncate text-slate-400">{agent.role}</p>
              </div>
              <span className="shrink-0 rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400">
                {agent.access_level === "ceo"
                  ? "CEO"
                  : agent.access_level === "general_orchestrator"
                  ? "Geral"
                  : agent.access_level === "sector_orchestrator"
                  ? "Orq."
                  : "Op."}
              </span>
            </div>
            <div className="mt-1.5 space-y-0.5">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Status:</span>
                <span
                  style={{ color: STATUS_COLOR[agent.work_status] }}
                  className="font-medium"
                >
                  {STATUS_LABEL[agent.work_status]}
                </span>
              </div>
              {agent.current_task && (
                <div className="flex items-start justify-between gap-2">
                  <span className="shrink-0 text-slate-500">Task:</span>
                  <span className="truncate text-right text-slate-300">{agent.current_task}</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Setor:</span>
                <span className="text-slate-300">{sectorMap.get(agent.sector ?? -1) ?? "—"}</span>
              </div>
            </div>
            <button
              type="button"
              className="mt-2 w-full rounded bg-white/5 py-1 text-[10px] text-slate-300 transition hover:bg-white/10"
            >
              Chamar para Reunião
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Barra superior HTML ──────────────────────────────────────────────────────

function TopBar({
  agents,
  connected,
  panelOpen,
  onTogglePanel,
}: {
  agents: Agent[];
  connected: boolean;
  panelOpen: boolean;
  onTogglePanel: () => void;
}) {
  const working = agents.filter((a) => a.work_status === "working").length;
  const total = agents.length;
  const efficiency = total > 0 ? Math.round((working / total) * 100) : 0;

  const effColor =
    efficiency >= 70 ? "#4ade80" : efficiency >= 40 ? "#facc15" : "#f87171";

  return (
    <div className="absolute left-0 right-0 top-0 z-10 flex items-center gap-4 border-b border-white/10 bg-[#0d1117]/90 px-4 py-2 backdrop-blur-sm">
      {/* Título */}
      <div className="flex items-center gap-2">
        <Brain className="size-4 text-indigo-400" />
        <span className="text-sm font-bold text-white">Escritório Virtual de Agentes IA</span>
      </div>

      <div className="h-4 w-px bg-white/15" />

      {/* Trabalhando */}
      <div className="flex items-center gap-1.5 text-xs">
        <Activity className="size-3.5 text-green-400" />
        <span className="text-slate-400">Trabalhando:</span>
        <span className="font-mono font-bold text-white">{working}</span>
        <span className="text-slate-500">/ {total}</span>
      </div>

      {/* Barra de eficiência */}
      <div className="flex flex-1 items-center gap-2 text-xs">
        <span className="shrink-0 text-slate-400">Eficiência</span>
        <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${efficiency}%`, backgroundColor: effColor }}
          />
        </div>
        <span className="shrink-0 font-mono" style={{ color: effColor }}>
          {efficiency}%
        </span>
      </div>

      {/* Status WebSocket */}
      <div className="flex items-center gap-1.5 text-xs">
        {connected ? (
          <>
            <Wifi className="size-3.5 text-green-400" />
            <span className="text-green-400">ao vivo</span>
          </>
        ) : (
          <>
            <WifiOff className="size-3.5 text-slate-500" />
            <span className="text-slate-500">reconectando</span>
          </>
        )}
      </div>

      {/* Badges de status */}
      <div className="hidden items-center gap-1.5 sm:flex">
        {(["working", "idle", "paused"] as const).map((s) => {
          const count = agents.filter((a) => a.work_status === s).length;
          if (count === 0) return null;
          return (
            <Badge key={s} className="gap-1 text-[10px]" style={{ backgroundColor: STATUS_COLOR[s] + "22", color: STATUS_COLOR[s], border: `1px solid ${STATUS_COLOR[s]}44` }}>
              <span className="size-1.5 rounded-full" style={{ backgroundColor: STATUS_COLOR[s] }} />
              {count} {STATUS_LABEL[s]}
            </Badge>
          );
        })}
      </div>

      {/* Toggle painel */}
      <button
        type="button"
        onClick={onTogglePanel}
        className="flex items-center gap-1.5 rounded border border-white/15 bg-white/5 px-2.5 py-1 text-xs text-white transition hover:bg-white/10"
      >
        <Users className="size-3.5" />
        Agentes
        <ChevronRight className={`size-3 transition-transform ${panelOpen ? "rotate-180" : ""}`} />
      </button>
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function CompanyOffice3D() {
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [panelOpen, setPanelOpen] = useState(true);

  // Carregamento inicial + poll de segurança a cada 30s
  useEffect(() => {
    let cancelled = false;

    async function fetchAll() {
      try {
        const [s, a] = await Promise.all([listSectors(), listAgents()]);
        if (!cancelled) {
          setSectors(s);
          setAgents(a);
          setError(null);
        }
      } catch (err) {
        if (!cancelled)
          setError(err instanceof ApiError ? err.message : "Falha ao carregar o escritório.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchAll();
    const iv = setInterval(fetchAll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, []);

  // Atualizações ao vivo via WebSocket (work_status + current_task)
  const { connected, lastAgentEvent } = useRealtime();

  useEffect(() => {
    if (!lastAgentEvent) return;
    setAgents((prev) => {
      const exists = prev.some((a) => a.id === lastAgentEvent.id);
      return exists
        ? prev.map((a) => (a.id === lastAgentEvent.id ? lastAgentEvent : a))
        : [...prev, lastAgentEvent];
    });
  }, [lastAgentEvent]);

  const agentsBySector = useMemo(() => {
    const map = new Map<number, Agent[]>();
    for (const a of agents) {
      if (a.sector == null) continue;
      const list = map.get(a.sector) ?? [];
      list.push(a);
      map.set(a.sector, list);
    }
    return map;
  }, [agents]);

  // Dimensões do grid — para câmera adaptativa
  const cols = Math.min(sectors.length, ROOMS_PER_ROW);
  const rows = Math.ceil(sectors.length / ROOMS_PER_ROW);
  const gridW = cols * (ROOM_W + ROOM_GAP);
  const gridD = rows * (ROOM_D + ROOM_GAP);
  const camDist = Math.max(gridW, gridD) * 0.85;

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-[#0a0d14]">
        <p className="text-sm text-slate-500">Carregando escritório...</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex h-full items-center justify-center bg-[#0a0d14]">
        <p className="text-sm text-red-400">{error}</p>
      </div>
    );
  }
  if (sectors.length === 0) {
    return (
      <div className="flex h-full items-center justify-center bg-[#0a0d14]">
        <p className="text-sm text-slate-500">
          Nenhum setor cadastrado — crie um na aba "Empresa".
        </p>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#0a0d14]">
      {/* Barra superior */}
      <TopBar
        agents={agents}
        connected={connected}
        panelOpen={panelOpen}
        onTogglePanel={() => setPanelOpen((v) => !v)}
      />

      {/* Cena 3D — padding-top para não ficar sob a barra */}
      <div className="absolute inset-0 top-10">
        <Canvas
          shadows
          camera={{
            position: [gridW * 0.5, camDist * 0.6, gridD + camDist * 0.5],
            fov: 45,
          }}
        >
          <fog attach="fog" args={["#0a0d14", camDist * 1.8, camDist * 3.5]} />

          <ambientLight intensity={0.4} />
          <hemisphereLight args={["#1e2a4a", "#0a0d14", 0.5]} />
          <directionalLight
            position={[gridW * 0.5, 20, gridD * 0.5]}
            intensity={1.2}
            castShadow
            shadow-mapSize={[2048, 2048]}
          />
          <pointLight position={[gridW * 0.5, 5, gridD * 0.5]} intensity={0.8} color="#6080ff" />

          {/* Piso geral */}
          <mesh
            rotation={[-Math.PI / 2, 0, 0]}
            position={[gridW / 2 - (ROOM_W + ROOM_GAP) / 2, -0.02, gridD / 2 - (ROOM_D + ROOM_GAP) / 2]}
            receiveShadow
          >
            <planeGeometry args={[gridW + 6, gridD + 6]} />
            <meshStandardMaterial color="#0d1017" />
          </mesh>

          {/* Salas */}
          {sectors.map((sector, i) => (
            <Room
              key={sector.id}
              sector={sector}
              agents={agentsBySector.get(sector.id) ?? []}
              index={i}
            />
          ))}

          <OrbitControls
            target={[gridW / 2 - (ROOM_W + ROOM_GAP) / 2, 0, gridD / 2 - (ROOM_D + ROOM_GAP) / 2]}
            maxPolarAngle={Math.PI / 2.1}
            minDistance={8}
            maxDistance={camDist * 2}
          />
        </Canvas>
      </div>

      {/* Painel lateral de agentes */}
      <AgentInfoPanel
        agents={agents}
        sectors={sectors}
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
      />
    </div>
  );
}

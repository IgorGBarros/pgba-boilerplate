// frontend/src/components/builder/CompanyOffice3D.tsx
// Fase 1 — salas reais, avatares ao vivo, painéis HTML integrados.
// Fase 2 (movimento, pathfinding, animações) é combinado futuro — CLAUDE.md §7.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Text } from "@react-three/drei";
import type * as THREE from "three";
import { listAgents, listSectors, type Agent, type Sector, ApiError } from "@/lib/api";
import { useRealtime } from "@/lib/useRealtime";
import {
  toOfficeAgent,
  type OfficeAgent,
  type ActivityLog,
} from "./office-types";
import {
  ActivityPanel,
  AgentInfoPanel,
  AgentModal,
  MeetingModal,
  OfficeTopBar,
  RoomModal,
} from "./OfficeOverlays";

// ─── Constantes de layout ─────────────────────────────────────────────────────

const ROOM_W = 8;
const ROOM_D = 7;
const ROOM_GAP = 2;
const ROOMS_PER_ROW = 3;
const WALL_H = 2.6;
const WALL_T = 0.18;
const DOOR_W = 1.8;

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

const STATUS_COLOR_3D = {
  working: "#4ade80",
  thinking: "#60a5fa",
  idle: "#64748b",
  meeting: "#a78bfa",
  blocked: "#f87171",
  paused: "#facc15",
} as const;

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
  return [
    -(ROOM_W / 2 - 1) + col * cellW + cellW / 2,
    -(ROOM_D / 2 - 1) + row * cellD + cellD / 2,
  ];
}

function inferRoomType(name: string): "tech" | "design" | "meeting" | "generic" {
  const n = name.toLowerCase();
  if (n.includes("dev") || n.includes("back") || n.includes("front") || n.includes("infra")) return "tech";
  if (n.includes("design") || n.includes("ux") || n.includes("marketing")) return "design";
  if (n.includes("reunião") || n.includes("meeting")) return "meeting";
  return "generic";
}

// ─── Móveis 3D ────────────────────────────────────────────────────────────────

function Workstation({ x, z, color }: { x: number; z: number; color: string }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.4, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.9, 0.06, 0.55]} />
        <meshStandardMaterial color="#e0ddd8" />
      </mesh>
      <mesh position={[0, 0.2, 0]}>
        <boxGeometry args={[0.06, 0.4, 0.06]} />
        <meshStandardMaterial color="#999" />
      </mesh>
      <mesh position={[0, 0.75, -0.18]} castShadow>
        <boxGeometry args={[0.55, 0.35, 0.04]} />
        <meshStandardMaterial color="#111" emissive={color} emissiveIntensity={0.3} />
      </mesh>
      <mesh position={[0, 0.22, 0.4]}>
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
      <mesh position={[0, 1, 0]}>
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

function AgentAvatar3D({
  agent,
  position,
  onSelect,
}: {
  agent: OfficeAgent;
  position: [number, number, number];
  onSelect: (a: OfficeAgent) => void;
}) {
  const ringRef = useRef<THREE.Mesh>(null!);
  const color = STATUS_COLOR_3D[agent.status] ?? STATUS_COLOR_3D.idle;
  const isWorking = agent.status === "working";

  useFrame(({ clock }) => {
    if (!ringRef.current) return;
    if (isWorking) {
      const t = clock.getElapsedTime();
      ringRef.current.scale.setScalar(1 + 0.1 * Math.sin(t * 3));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (ringRef.current.material as any).emissiveIntensity =
        0.4 + 0.3 * Math.sin(t * 3);
    }
  });

  return (
    <group
      position={position}
      onClick={(e) => { e.stopPropagation(); onSelect(agent); }}
    >
      {/* Anel de status no chão */}
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <torusGeometry args={[0.22, 0.04, 6, 20]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.4}
        />
      </mesh>
      {/* Corpo */}
      <mesh position={[0, 0.65, 0]} castShadow>
        <capsuleGeometry args={[0.2, 0.5, 4, 8]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={isWorking ? 0.3 : 0.05}
        />
      </mesh>
      {/* Cabeça */}
      <mesh position={[0, 1.2, 0]} castShadow>
        <sphereGeometry args={[0.16, 12, 12]} />
        <meshStandardMaterial color="#deb891" />
      </mesh>
      {/* Nome */}
      <Text
        position={[0, 1.62, 0]}
        fontSize={0.15}
        color="#f1f5f9"
        anchorX="center"
        anchorY="bottom"
        outlineWidth={0.008}
        outlineColor="#000"
      >
        {agent.name}
      </Text>
      {/* Task (só quando trabalhando) */}
      {isWorking && agent.currentTask !== "Sem tarefa ativa" && (
        <Text
          position={[0, 1.44, 0]}
          fontSize={0.1}
          color="#86efac"
          anchorX="center"
          anchorY="bottom"
          maxWidth={1.8}
          outlineWidth={0.006}
          outlineColor="#000"
        >
          {agent.currentTask}
        </Text>
      )}
    </group>
  );
}

// ─── Sala ─────────────────────────────────────────────────────────────────────

function Room({
  sector,
  agents,
  index,
  onRoomClick,
  onAgentClick,
}: {
  sector: Sector;
  agents: OfficeAgent[];
  index: number;
  onRoomClick: (sectorId: number, name: string) => void;
  onAgentClick: (a: OfficeAgent) => void;
}) {
  const [cx, cz] = roomCenter(index);
  const palette = ROOM_PALETTES[index % ROOM_PALETTES.length]!;
  const type = inferRoomType(sector.name);
  const halfW = ROOM_W / 2;
  const halfD = ROOM_D / 2;

  return (
    <group position={[cx, 0, cz]}>
      {/* Piso — clicável para abrir RoomModal */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.01, 0]}
        receiveShadow
        onClick={(e) => { e.stopPropagation(); onRoomClick(sector.id, sector.name); }}
      >
        <planeGeometry args={[ROOM_W, ROOM_D]} />
        <meshStandardMaterial color={palette.floor} />
      </mesh>

      {/* Parede traseira */}
      <mesh position={[0, WALL_H / 2, -halfD]} castShadow>
        <boxGeometry args={[ROOM_W, WALL_H, WALL_T]} />
        <meshStandardMaterial color={palette.wall} />
      </mesh>
      {/* Parede esquerda */}
      <mesh position={[-halfW, WALL_H / 2, 0]}>
        <boxGeometry args={[WALL_T, WALL_H, ROOM_D]} />
        <meshStandardMaterial color={palette.wall} />
      </mesh>
      {/* Parede direita */}
      <mesh position={[halfW, WALL_H / 2, 0]}>
        <boxGeometry args={[WALL_T, WALL_H, ROOM_D]} />
        <meshStandardMaterial color={palette.wall} />
      </mesh>
      {/* Parede frontal (2 segmentos + vão de porta) */}
      <mesh position={[-(halfW / 2 + DOOR_W / 4), WALL_H / 2, halfD]}>
        <boxGeometry args={[halfW - DOOR_W / 2, WALL_H, WALL_T]} />
        <meshStandardMaterial color={palette.wall} />
      </mesh>
      <mesh position={[(halfW / 2 + DOOR_W / 4), WALL_H / 2, halfD]}>
        <boxGeometry args={[halfW - DOOR_W / 2, WALL_H, WALL_T]} />
        <meshStandardMaterial color={palette.wall} />
      </mesh>

      {/* Faixa de cor luminosa no topo */}
      <mesh position={[0, WALL_H - 0.08, -halfD + WALL_T / 2]}>
        <boxGeometry args={[ROOM_W - WALL_T, 0.12, 0.04]} />
        <meshStandardMaterial
          color={palette.accent}
          emissive={palette.accent}
          emissiveIntensity={0.35}
        />
      </mesh>

      {/* Rótulo do setor */}
      <Text
        position={[0, WALL_H + 0.3, -halfD + 0.1]}
        fontSize={0.3}
        color="#f1f5f9"
        anchorX="center"
        anchorY="bottom"
        outlineWidth={0.01}
        outlineColor="#000"
      >
        {sector.name}
      </Text>

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

      {/* Avatares dos agentes */}
      {agents.map((agent, i) => {
        const [ax, az] = agentSlot(i, agents.length);
        return (
          <AgentAvatar3D
            key={agent.id}
            agent={agent}
            position={[ax, 0, az]}
            onSelect={onAgentClick}
          />
        );
      })}
    </group>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function CompanyOffice3D() {
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [rawAgents, setRawAgents] = useState<Agent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // UI state
  const [activityOpen, setActivityOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(30_000); // 1x
  const [zoom, setZoom] = useState(1);

  // Modals
  const [selectedAgent, setSelectedAgent] = useState<OfficeAgent | null>(null);
  const [agentModalOpen, setAgentModalOpen] = useState(false);
  const [selectedRoom, setSelectedRoom] = useState<{ id: number; name: string } | null>(null);
  const [roomModalOpen, setRoomModalOpen] = useState(false);
  const [meetingOpen, setMeetingOpen] = useState(false);

  // Activity logs (gerados localmente a partir dos eventos WebSocket)
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);

  // Carregamento inicial + poll adaptativo (speed controla o intervalo)
  useEffect(() => {
    let cancelled = false;
    async function fetchAll() {
      try {
        const [s, a] = await Promise.all([listSectors(), listAgents()]);
        if (!cancelled) {
          setSectors(s);
          setRawAgents(a);
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
    if (paused) return;
    const iv = setInterval(fetchAll, speed);
    return () => { cancelled = true; clearInterval(iv); };
  }, [paused, speed]);

  // Atualizações ao vivo via WebSocket
  const { connected, lastAgentEvent } = useRealtime();

  const addLog = useCallback((agent: OfficeAgent, action: string) => {
    setActivityLogs((prev) => [
      {
        id: crypto.randomUUID(),
        agentName: agent.name,
        status: agent.status,
        action,
        room: agent.sectorName,
        timestamp: new Date(),
      },
      ...prev.slice(0, 99),
    ]);
  }, []);

  useEffect(() => {
    if (!lastAgentEvent) return;
    setRawAgents((prev) => {
      const exists = prev.some((a) => a.id === lastAgentEvent.id);
      return exists
        ? prev.map((a) => (a.id === lastAgentEvent.id ? lastAgentEvent : a))
        : [...prev, lastAgentEvent];
    });
  }, [lastAgentEvent]);

  // Derivar agentes enriquecidos uma vez
  const officeAgents = useMemo<OfficeAgent[]>(
    () => rawAgents.map((a, i) => toOfficeAgent(a, sectors, i)),
    [rawAgents, sectors],
  );

  // Registrar log quando status muda
  const prevStatusRef = useRef<Map<number, string>>(new Map());
  useEffect(() => {
    for (const agent of officeAgents) {
      const prev = prevStatusRef.current.get(agent.id);
      if (prev === undefined) {
        // Primeira carga — registrar estado inicial
        addLog(agent, `Status inicial: ${agent.status === "working" ? `trabalhando em "${agent.currentTask}"` : agent.status}`);
      } else if (prev !== agent.status) {
        const action =
          agent.status === "working"
            ? `Iniciou: ${agent.currentTask}`
            : agent.status === "idle"
            ? "Concluiu tarefa, aguardando"
            : agent.status === "paused"
            ? "Tarefa pausada"
            : `Status → ${agent.status}`;
        addLog(agent, action);
      }
      prevStatusRef.current.set(agent.id, agent.status);
    }
  }, [officeAgents, addLog]);

  const agentsBySector = useMemo(() => {
    const map = new Map<number, OfficeAgent[]>();
    for (const a of officeAgents) {
      if (a.sectorId == null) continue;
      const list = map.get(a.sectorId) ?? [];
      list.push(a);
      map.set(a.sectorId, list);
    }
    return map;
  }, [officeAgents]);

  const cols = Math.min(sectors.length, ROOMS_PER_ROW);
  const rows = Math.ceil(sectors.length / ROOMS_PER_ROW);
  const gridW = cols * (ROOM_W + ROOM_GAP);
  const gridD = rows * (ROOM_D + ROOM_GAP);
  const camDist = Math.max(gridW, gridD) * 0.85;

  const handleAgentClick = useCallback((a: OfficeAgent) => {
    setSelectedAgent(a);
    setAgentModalOpen(true);
  }, []);

  const handleRoomClick = useCallback((id: number, name: string) => {
    setSelectedRoom({ id, name });
    setRoomModalOpen(true);
  }, []);

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
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-[#0a0d14]">
      {/* Barra superior */}
      <OfficeTopBar
        agents={officeAgents}
        connected={connected}
        paused={paused}
        speed={speed}
        zoom={zoom}
        activityOpen={activityOpen}
        panelOpen={panelOpen}
        onTogglePause={() => setPaused((v) => !v)}
        onSpeedChange={setSpeed}
        onZoomIn={() => setZoom((v) => Math.min(v + 0.1, 2))}
        onZoomOut={() => setZoom((v) => Math.max(v - 0.1, 0.3))}
        onCallMeeting={() => setMeetingOpen(true)}
        onEndMeeting={() => {}}
        onToggleActivity={() => setActivityOpen((v) => !v)}
        onTogglePanel={() => setPanelOpen((v) => !v)}
      />

      {/* Layout: painéis laterais + canvas central */}
      <div className="relative flex min-h-0 flex-1">
        {/* Painel esquerdo — atividades */}
        <ActivityPanel
          logs={activityLogs}
          open={activityOpen}
          onClose={() => setActivityOpen(false)}
        />

        {/* Cena 3D — ocupa o espaço restante */}
        <div className="min-w-0 flex-1">
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
            <pointLight
              position={[gridW * 0.5, 5, gridD * 0.5]}
              intensity={0.8}
              color="#6080ff"
            />

            {/* Piso geral */}
            <mesh
              rotation={[-Math.PI / 2, 0, 0]}
              position={[
                gridW / 2 - (ROOM_W + ROOM_GAP) / 2,
                -0.02,
                gridD / 2 - (ROOM_D + ROOM_GAP) / 2,
              ]}
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
                onRoomClick={handleRoomClick}
                onAgentClick={handleAgentClick}
              />
            ))}

            <OrbitControls
              target={[
                gridW / 2 - (ROOM_W + ROOM_GAP) / 2,
                0,
                gridD / 2 - (ROOM_D + ROOM_GAP) / 2,
              ]}
              maxPolarAngle={Math.PI / 2.1}
              minDistance={8}
              maxDistance={camDist * 2}
            />
          </Canvas>
        </div>

        {/* Painel direito — lista de agentes */}
        <AgentInfoPanel
          agents={officeAgents}
          open={panelOpen}
          onClose={() => setPanelOpen(false)}
          onAgentClick={handleAgentClick}
        />
      </div>

      {/* Modais */}
      <AgentModal
        agent={selectedAgent}
        open={agentModalOpen}
        onClose={() => setAgentModalOpen(false)}
      />
      <RoomModal
        sectorId={selectedRoom?.id ?? null}
        sectorName={selectedRoom?.name ?? ""}
        agents={officeAgents}
        open={roomModalOpen}
        onClose={() => setRoomModalOpen(false)}
      />
      <MeetingModal
        open={meetingOpen}
        onClose={() => setMeetingOpen(false)}
        agents={officeAgents}
        sectors={sectors}
      />
    </div>
  );
}

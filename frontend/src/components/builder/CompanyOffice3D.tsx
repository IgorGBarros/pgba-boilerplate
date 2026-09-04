// frontend/src/components/builder/CompanyOffice3D.tsx
import { useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Text, RoundedBox } from "@react-three/drei";
import { listAgents, listSectors, type Agent, type Sector, ApiError } from "@/lib/api";
import { useRealtime } from "@/lib/useRealtime";

// Setor muda bem menos que work_status de agente — esse poll é rede de
// segurança agora; o status ao vivo do agente vem pelo WebSocket.
const POLL_INTERVAL_MS = 30000;
const ROOM_SIZE = 6;
const ROOM_GAP = 1.5;
const ROOMS_PER_ROW = 3;

// Paleta fixa por índice de setor — determinístico (não aleatório), pra
// a cor de uma sala não trocar toda hora que a lista é recarregada.
const ROOM_COLORS = ["#2f4bd6", "#1f8a5f", "#c2410c", "#7c3aed", "#0f766e", "#b45309", "#9d174d", "#4338ca"];

const STATUS_COLOR: Record<Agent["work_status"], string> = {
  working: "#4ade80",
  idle: "#94a3b8",
  paused: "#facc15",
};

function sectorPosition(index: number): [number, number] {
  const col = index % ROOMS_PER_ROW;
  const row = Math.floor(index / ROOMS_PER_ROW);
  const spacing = ROOM_SIZE + ROOM_GAP;
  return [col * spacing, row * spacing];
}

function agentPositionWithinRoom(agentIndex: number, totalInRoom: number): [number, number] {
  // Grade simples dentro da sala — só posicionamento estático (Fase 1:
  // "cena com salas e personagens parados", sem pathfinding ainda).
  const cols = Math.ceil(Math.sqrt(totalInRoom));
  const col = agentIndex % cols;
  const row = Math.floor(agentIndex / cols);
  const cellSize = ROOM_SIZE / (cols + 1);
  const offset = ROOM_SIZE / 2 - cellSize / 2;
  return [col * cellSize - offset, row * cellSize - offset];
}

interface AgentAvatarProps {
  agent: Agent;
  position: [number, number, number];
}

function AgentAvatar({ agent, position }: AgentAvatarProps) {
  const color = STATUS_COLOR[agent.work_status];
  const isWorking = agent.work_status === "working";

  return (
    <group position={position}>
      <mesh position={[0, 0.6, 0]} castShadow>
        <capsuleGeometry args={[0.22, 0.55, 4, 8]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={isWorking ? 0.6 : 0.1} />
      </mesh>
      <mesh position={[0, 1.15, 0]} castShadow>
        <sphereGeometry args={[0.16, 16, 16]} />
        <meshStandardMaterial color="#e2c9a0" />
      </mesh>
      <RoundedBox args={[0.7, 0.05, 0.45]} radius={0.02} position={[0, 0.3, 0.5]} castShadow>
        <meshStandardMaterial color="#3a3f4b" />
      </RoundedBox>
      <Text position={[0, 1.55, 0]} fontSize={0.16} color="#e2e8f0" anchorX="center" anchorY="bottom">
        {agent.name}
      </Text>
      {agent.work_status === "working" && agent.current_task && (
        <Text position={[0, 1.35, 0]} fontSize={0.1} color="#94e8b4" anchorX="center" anchorY="bottom" maxWidth={1.8}>
          {agent.current_task}
        </Text>
      )}
    </group>
  );
}

interface RoomProps {
  sector: Sector;
  agents: Agent[];
  index: number;
}

function Room({ sector, agents, index }: RoomProps) {
  const [x, z] = sectorPosition(index);
  const color = ROOM_COLORS[index % ROOM_COLORS.length];

  return (
    <group position={[x, 0, z]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[ROOM_SIZE, ROOM_SIZE]} />
        <meshStandardMaterial color={color} opacity={0.25} transparent />
      </mesh>
      <mesh position={[-ROOM_SIZE / 2, 0.5, 0]}>
        <boxGeometry args={[0.1, 1, ROOM_SIZE]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <mesh position={[0, 0.5, -ROOM_SIZE / 2]}>
        <boxGeometry args={[ROOM_SIZE, 1, 0.1]} />
        <meshStandardMaterial color={color} />
      </mesh>

      <Text position={[0, 1.6, -ROOM_SIZE / 2 + 0.3]} fontSize={0.3} color="#f1f5f9" anchorX="center" anchorY="bottom">
        {sector.name}
      </Text>

      {agents.map((agent, i) => {
        const [ax, az] = agentPositionWithinRoom(i, agents.length);
        return <AgentAvatar key={agent.id} agent={agent} position={[ax, 0, az]} />;
      })}
    </group>
  );
}

/**
 * Escritório 3D — Fase 1 (ver CLAUDE.md): salas por setor + agentes
 * parados nas próprias mesas, cor refletindo work_status real. SEM
 * pathfinding/movimento ainda — isso é combinadamente uma fase futura.
 * Inspirado conceitualmente no "office floor" do munder-difflin (avatar
 * reflete trabalho real), mas em 3D de verdade (Three.js via
 * @react-three/fiber) em vez de 2D, e sobre dado real do agency
 * (Sector/Agent), não sessões de CLI de código.
 */
export default function CompanyOffice3D() {
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchAll() {
      try {
        const [sectorsData, agentsData] = await Promise.all([listSectors(), listAgents()]);
        if (!cancelled) {
          setSectors(sectorsData);
          setAgents(agentsData);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Falha ao carregar o escritório.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchAll();
    const interval = setInterval(fetchAll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const { lastAgentEvent } = useRealtime();

  useEffect(() => {
    if (!lastAgentEvent) return;
    setAgents((prev) => {
      const exists = prev.some((a) => a.id === lastAgentEvent.id);
      if (exists) return prev.map((a) => (a.id === lastAgentEvent.id ? lastAgentEvent : a));
      return [...prev, lastAgentEvent];
    });
  }, [lastAgentEvent]);

  const agentsBySector = useMemo(() => {
    const map = new Map<number, Agent[]>();
    for (const agent of agents) {
      if (agent.sector == null) continue;
      const list = map.get(agent.sector) ?? [];
      list.push(agent);
      map.set(agent.sector, list);
    }
    return map;
  }, [agents]);

  const gridWidth = Math.min(sectors.length, ROOMS_PER_ROW) * (ROOM_SIZE + ROOM_GAP);
  const gridDepth = Math.ceil(sectors.length / ROOMS_PER_ROW) * (ROOM_SIZE + ROOM_GAP);

  if (loading) return <p className="p-6 text-sm text-slate-500">Carregando o escritório...</p>;
  if (error) return <p className="p-6 text-sm text-red-400">{error}</p>;
  if (sectors.length === 0) return <p className="p-6 text-sm text-slate-500">Nenhum setor cadastrado ainda — crie um na aba "Empresa".</p>;

  return (
    <div className="h-full w-full bg-black">
      <Canvas shadows camera={{ position: [gridWidth * 0.6, gridWidth * 0.55, gridDepth * 0.9 + 4], fov: 50 }}>
        <ambientLight intensity={0.5} />
        <directionalLight position={[10, 15, 8]} intensity={1} castShadow />

        {sectors.map((sector, i) => (
          <Room key={sector.id} sector={sector} agents={agentsBySector.get(sector.id) ?? []} index={i} />
        ))}

        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[gridWidth / 2 - (ROOM_SIZE + ROOM_GAP) / 2, -0.02, gridDepth / 2 - (ROOM_SIZE + ROOM_GAP) / 2]}
          receiveShadow
        >
          <planeGeometry args={[gridWidth + 4, gridDepth + 4]} />
          <meshStandardMaterial color="#111318" />
        </mesh>

        <OrbitControls target={[gridWidth / 2, 0, gridDepth / 2]} maxPolarAngle={Math.PI / 2.1} />
      </Canvas>
    </div>
  );
}

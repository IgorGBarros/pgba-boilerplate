// frontend/src/components/builder/CompanyOffice3D.tsx
// Fase 1 — salas reais, avatares voxel ao vivo, sala de reunião, painéis HTML.
// Fase 2 (movimento/pathfinding) é combinado futuro — CLAUDE.md §7.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Html, OrbitControls, Text } from "@react-three/drei";
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
  ConsoleModal,
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
const MEETING_ROOM_W = 10;
const MEETING_ROOM_D = 8;

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

// Cadeiras da sala de reunião — posições [x, z] relativas ao centro da sala
const MEETING_CHAIRS: Array<[number, number]> = [
  [-2.6, -1.1], [-1.3, -1.1], [0, -1.1], [1.3, -1.1], [2.6, -1.1],
  [-2.6,  1.1], [-1.3,  1.1], [0,  1.1], [1.3,  1.1], [2.6,  1.1],
  [-3.8, 0], [3.8, 0],
];

// Tonalidades de pele e cabelo determinísticas por agent.id
const SKIN_TONES = ["#f5c6a0", "#e8b88a", "#d4956b", "#c68642", "#8d5524"];
const HAIR_COLORS = ["#2d1810", "#5c3a2e", "#1a1a1a", "#4a3728", "#8b6914"];

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

function inferRoomType(name: string): "tech" | "design" | "generic" {
  const n = name.toLowerCase();
  if (n.includes("dev") || n.includes("back") || n.includes("front") || n.includes("infra")) return "tech";
  if (n.includes("design") || n.includes("ux") || n.includes("marketing")) return "design";
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

// ─── Anel de status pulsante ──────────────────────────────────────────────────

function StatusRing({ color, isWorking }: { color: string; isWorking: boolean }) {
  const ref = useRef<THREE.Mesh>(null!);

  useFrame(({ clock }) => {
    if (!ref.current) return;
    const mat = ref.current.material as THREE.MeshStandardMaterial;
    if (isWorking) {
      const t = clock.getElapsedTime();
      ref.current.scale.setScalar(1 + 0.12 * Math.sin(t * 3));
      mat.emissiveIntensity = 0.4 + 0.3 * Math.sin(t * 3);
    } else {
      ref.current.scale.setScalar(1);
      mat.emissiveIntensity = 0.15;
    }
  });

  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
      <torusGeometry args={[0.24, 0.04, 6, 24]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.15} />
    </mesh>
  );
}

// ─── Avatar voxel do agente ───────────────────────────────────────────────────

function AgentAvatar3D({
  agent,
  position,
  onSelect,
}: {
  agent: OfficeAgent;
  position: [number, number, number];
  onSelect: (a: OfficeAgent) => void;
}) {
  const groupRef = useRef<THREE.Group>(null!);
  const statusColor = STATUS_COLOR_3D[agent.status] ?? STATUS_COLOR_3D.idle;
  const isWorking = agent.status === "working";
  const isThinking = agent.status === "thinking";

  const skin = SKIN_TONES[agent.id % SKIN_TONES.length]!;
  const hair = HAIR_COLORS[agent.id % HAIR_COLORS.length]!;
  const shirt = agent.appearance.shirtColor;

  // Leve animação de "respiração" quando trabalhando
  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    groupRef.current.position.y = isWorking
      ? Math.sin(clock.getElapsedTime() * 2.5) * 0.03
      : 0;
  });

  const shortName = agent.name.split(" ").slice(0, 2).join(" ");

  return (
    <group
      ref={groupRef}
      position={position}
      onClick={(e) => { e.stopPropagation(); onSelect(agent); }}
    >
      {/* Sombra no chão */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <circleGeometry args={[0.22, 16]} />
        <meshBasicMaterial color="#000" transparent opacity={0.2} depthWrite={false} />
      </mesh>

      <StatusRing color={statusColor} isWorking={isWorking} />

      {/* Perna esquerda */}
      <mesh position={[-0.09, 0.24, 0]} castShadow>
        <boxGeometry args={[0.13, 0.46, 0.14]} />
        <meshStandardMaterial color="#1e3a5f" />
      </mesh>
      {/* Perna direita */}
      <mesh position={[0.09, 0.24, 0]} castShadow>
        <boxGeometry args={[0.13, 0.46, 0.14]} />
        <meshStandardMaterial color="#1e3a5f" />
      </mesh>
      {/* Sapato esquerdo */}
      <mesh position={[-0.09, 0.05, 0.04]}>
        <boxGeometry args={[0.13, 0.09, 0.2]} />
        <meshStandardMaterial color="#111" />
      </mesh>
      {/* Sapato direito */}
      <mesh position={[0.09, 0.05, 0.04]}>
        <boxGeometry args={[0.13, 0.09, 0.2]} />
        <meshStandardMaterial color="#111" />
      </mesh>
      {/* Torso */}
      <mesh position={[0, 0.74, 0]} castShadow>
        <boxGeometry args={[0.4, 0.5, 0.24]} />
        <meshStandardMaterial color={shirt} emissive={shirt} emissiveIntensity={isWorking ? 0.08 : 0} />
      </mesh>
      {/* Braço esquerdo */}
      <mesh position={[-0.27, 0.72, 0]} castShadow>
        <boxGeometry args={[0.12, 0.44, 0.18]} />
        <meshStandardMaterial color={shirt} />
      </mesh>
      {/* Braço direito */}
      <mesh position={[0.27, 0.72, 0]} castShadow>
        <boxGeometry args={[0.12, 0.44, 0.18]} />
        <meshStandardMaterial color={shirt} />
      </mesh>
      {/* Mão esquerda */}
      <mesh position={[-0.27, 0.52, 0]}>
        <boxGeometry args={[0.1, 0.1, 0.1]} />
        <meshStandardMaterial color={skin} />
      </mesh>
      {/* Mão direita */}
      <mesh position={[0.27, 0.52, 0]}>
        <boxGeometry args={[0.1, 0.1, 0.1]} />
        <meshStandardMaterial color={skin} />
      </mesh>
      {/* Pescoço */}
      <mesh position={[0, 1.06, 0]}>
        <boxGeometry args={[0.12, 0.12, 0.12]} />
        <meshStandardMaterial color={skin} />
      </mesh>
      {/* Cabeça */}
      <mesh position={[0, 1.32, 0]} castShadow>
        <boxGeometry args={[0.36, 0.32, 0.32]} />
        <meshStandardMaterial color={skin} />
      </mesh>
      {/* Cabelo topo */}
      <mesh position={[0, 1.5, 0]}>
        <boxGeometry args={[0.38, 0.1, 0.34]} />
        <meshStandardMaterial color={hair} />
      </mesh>
      {/* Cabelo traseiro */}
      <mesh position={[0, 1.42, -0.17]}>
        <boxGeometry args={[0.38, 0.26, 0.06]} />
        <meshStandardMaterial color={hair} />
      </mesh>
      {/* Olho esquerdo */}
      <mesh position={[-0.1, 1.33, 0.165]}>
        <boxGeometry args={[0.07, 0.06, 0.01]} />
        <meshBasicMaterial color="#1a1a2e" />
      </mesh>
      {/* Olho direito */}
      <mesh position={[0.1, 1.33, 0.165]}>
        <boxGeometry args={[0.07, 0.06, 0.01]} />
        <meshBasicMaterial color="#1a1a2e" />
      </mesh>

      {/* Tag com nome */}
      <Html
        center
        distanceFactor={8}
        position={[0, 1.92, 0]}
        style={{ pointerEvents: "none", userSelect: "none" }}
      >
        <div
          style={{
            background: "rgba(0,0,0,0.82)",
            color: "#f1f5f9",
            fontSize: "10px",
            padding: "2px 7px",
            borderRadius: "4px",
            whiteSpace: "nowrap",
            border: `1px solid ${statusColor}`,
          }}
        >
          {shortName}
        </div>
      </Html>

      {/* Tarefa atual (só quando trabalhando) */}
      {isWorking && agent.currentTask !== "Sem tarefa ativa" && (
        <Html
          center
          distanceFactor={8}
          position={[0, 2.14, 0]}
          style={{ pointerEvents: "none", userSelect: "none" }}
        >
          <div
            style={{
              background: "rgba(34,197,94,0.14)",
              color: "#86efac",
              fontSize: "9px",
              padding: "1px 5px",
              borderRadius: "3px",
              whiteSpace: "nowrap",
              maxWidth: "120px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              border: "1px solid rgba(34,197,94,0.25)",
            }}
          >
            {agent.currentTask.length > 22
              ? agent.currentTask.slice(0, 22) + "…"
              : agent.currentTask}
          </div>
        </Html>
      )}

      {/* Balão de pensamento */}
      {isThinking && (
        <Html
          center
          distanceFactor={8}
          position={[0.35, 1.65, 0]}
          style={{ pointerEvents: "none" }}
        >
          <span style={{ fontSize: "16px" }}>💭</span>
        </Html>
      )}
    </group>
  );
}

// ─── Sala de reunião ──────────────────────────────────────────────────────────

function MeetingRoom({
  position,
  agents,
  onAgentClick,
}: {
  position: [number, number, number];
  agents: OfficeAgent[];
  onAgentClick: (a: OfficeAgent) => void;
}) {
  const halfW = MEETING_ROOM_W / 2;
  const halfD = MEETING_ROOM_D / 2;

  return (
    <group position={position}>
      {/* Piso escuro com tom roxo-pink */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]} receiveShadow>
        <planeGeometry args={[MEETING_ROOM_W, MEETING_ROOM_D]} />
        <meshStandardMaterial color="#160826" />
      </mesh>
      {/* Faixas de luz pink no piso */}
      {([-halfD / 2, halfD / 2] as number[]).map((z, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, z]}>
          <planeGeometry args={[MEETING_ROOM_W - 0.5, 0.08]} />
          <meshBasicMaterial color="#ec4899" transparent opacity={0.3} />
        </mesh>
      ))}

      {/* Paredes */}
      <mesh position={[0, WALL_H / 2, -halfD]} castShadow>
        <boxGeometry args={[MEETING_ROOM_W, WALL_H, WALL_T]} />
        <meshStandardMaterial color="#2d1060" />
      </mesh>
      <mesh position={[-halfW, WALL_H / 2, 0]}>
        <boxGeometry args={[WALL_T, WALL_H, MEETING_ROOM_D]} />
        <meshStandardMaterial color="#2d1060" />
      </mesh>
      <mesh position={[halfW, WALL_H / 2, 0]}>
        <boxGeometry args={[WALL_T, WALL_H, MEETING_ROOM_D]} />
        <meshStandardMaterial color="#2d1060" />
      </mesh>
      {/* Parede frontal com vão de porta */}
      <mesh position={[-(halfW / 2 + DOOR_W / 4), WALL_H / 2, halfD]}>
        <boxGeometry args={[halfW - DOOR_W / 2, WALL_H, WALL_T]} />
        <meshStandardMaterial color="#2d1060" />
      </mesh>
      <mesh position={[(halfW / 2 + DOOR_W / 4), WALL_H / 2, halfD]}>
        <boxGeometry args={[halfW - DOOR_W / 2, WALL_H, WALL_T]} />
        <meshStandardMaterial color="#2d1060" />
      </mesh>

      {/* Faixa de cor pink luminosa no topo */}
      <mesh position={[0, WALL_H - 0.08, -halfD + WALL_T / 2]}>
        <boxGeometry args={[MEETING_ROOM_W - WALL_T, 0.12, 0.04]} />
        <meshStandardMaterial color="#ec4899" emissive="#ec4899" emissiveIntensity={0.55} />
      </mesh>

      {/* Tela/projetor na parede traseira */}
      <mesh position={[0, 1.25, -halfD + WALL_T + 0.03]}>
        <boxGeometry args={[5, 1.7, 0.03]} />
        <meshStandardMaterial color="#0d1020" emissive="#4c1d95" emissiveIntensity={0.18} />
      </mesh>
      <mesh position={[0, 1.25, -halfD + WALL_T + 0.045]}>
        <boxGeometry args={[5.1, 1.8, 0.01]} />
        <meshStandardMaterial color="#ec4899" emissive="#ec4899" emissiveIntensity={0.22} />
      </mesh>

      {/* Rótulo da sala */}
      <Text
        position={[0, WALL_H + 0.3, -halfD + 0.1]}
        fontSize={0.32}
        color="#f0abfc"
        anchorX="center"
        anchorY="bottom"
        outlineWidth={0.012}
        outlineColor="#000"
      >
        Sala de Reunião
      </Text>

      {/* Mesa de conferência */}
      <mesh position={[0, 0.41, 0]} castShadow receiveShadow>
        <boxGeometry args={[7.8, 0.08, 1.5]} />
        <meshStandardMaterial color="#3b2c1e" roughness={0.4} metalness={0.1} />
      </mesh>
      {/* Pernas da mesa */}
      {([-3.4, -1.6, 0, 1.6, 3.4] as number[]).map((x) =>
        ([-0.62, 0.62] as number[]).map((z) => (
          <mesh key={`ml-${x}-${z}`} position={[x, 0.2, z]}>
            <boxGeometry args={[0.07, 0.38, 0.07]} />
            <meshStandardMaterial color="#2a1e10" />
          </mesh>
        )),
      )}

      {/* Cadeiras */}
      {MEETING_CHAIRS.map(([cx, cz], i) => {
        const isFront = cz > 0;
        const isHead = Math.abs(cx) > 3;
        return (
          <group key={i} position={[cx, 0, cz]}>
            {/* Assento */}
            <mesh position={[0, 0.22, 0]}>
              <boxGeometry args={[0.38, 0.05, 0.38]} />
              <meshStandardMaterial color="#1e1e2e" />
            </mesh>
            {/* Encosto */}
            {!isHead && (
              <mesh position={[0, 0.5, isFront ? 0.17 : -0.17]}>
                <boxGeometry args={[0.38, 0.52, 0.04]} />
                <meshStandardMaterial color="#1e1e2e" />
              </mesh>
            )}
            {/* Pernas */}
            {([-0.14, 0.14] as number[]).map((lx) =>
              ([-0.14, 0.14] as number[]).map((lz) => (
                <mesh key={`cl-${lx}-${lz}`} position={[lx, 0.1, lz]}>
                  <boxGeometry args={[0.04, 0.2, 0.04]} />
                  <meshStandardMaterial color="#2a2a3a" />
                </mesh>
              )),
            )}
          </group>
        );
      })}

      {/* Agentes na reunião */}
      {agents.map((agent, i) => {
        const [cx, cz] = MEETING_CHAIRS[i % MEETING_CHAIRS.length]!;
        return (
          <AgentAvatar3D
            key={agent.id}
            agent={{ ...agent, status: "meeting" as const }}
            position={[cx, 0, cz]}
            onSelect={onAgentClick}
          />
        );
      })}
    </group>
  );
}

// ─── Sala de setor ────────────────────────────────────────────────────────────

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
      {/* Piso */}
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
      {/* Parede frontal com vão */}
      <mesh position={[-(halfW / 2 + DOOR_W / 4), WALL_H / 2, halfD]}>
        <boxGeometry args={[halfW - DOOR_W / 2, WALL_H, WALL_T]} />
        <meshStandardMaterial color={palette.wall} />
      </mesh>
      <mesh position={[(halfW / 2 + DOOR_W / 4), WALL_H / 2, halfD]}>
        <boxGeometry args={[halfW - DOOR_W / 2, WALL_H, WALL_T]} />
        <meshStandardMaterial color={palette.wall} />
      </mesh>

      {/* Faixa de cor no topo */}
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

      {/* Móveis */}
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
  const [speed, setSpeed] = useState(30_000);
  const [zoom, setZoom] = useState(1);

  // Meeting state
  const [meetingAgentIds, setMeetingAgentIds] = useState<Set<number>>(new Set());

  // Modais
  const [selectedAgent, setSelectedAgent] = useState<OfficeAgent | null>(null);
  const [agentModalOpen, setAgentModalOpen] = useState(false);
  const [selectedRoom, setSelectedRoom] = useState<{ id: number; name: string } | null>(null);
  const [roomModalOpen, setRoomModalOpen] = useState(false);
  const [meetingOpen, setMeetingOpen] = useState(false);
  const [consoleOpen, setConsoleOpen] = useState(false);

  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);

  // Carregamento + poll adaptativo
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

  const officeAgents = useMemo<OfficeAgent[]>(
    () => rawAgents.map((a, i) => toOfficeAgent(a, sectors, i)),
    [rawAgents, sectors],
  );

  const prevStatusRef = useRef<Map<number, string>>(new Map());
  useEffect(() => {
    for (const agent of officeAgents) {
      const prev = prevStatusRef.current.get(agent.id);
      if (prev === undefined) {
        addLog(agent, `Status inicial: ${agent.status === "working" ? `trabalhando em "${agent.currentTask}"` : agent.status}`);
      } else if (prev !== agent.status) {
        const action =
          agent.status === "working" ? `Iniciou: ${agent.currentTask}`
          : agent.status === "idle" ? "Concluiu tarefa, aguardando"
          : agent.status === "paused" ? "Tarefa pausada"
          : `Status → ${agent.status}`;
        addLog(agent, action);
      }
      prevStatusRef.current.set(agent.id, agent.status);
    }
  }, [officeAgents, addLog]);

  // Agentes na reunião
  const meetingAgents = useMemo(
    () => officeAgents.filter((a) => meetingAgentIds.has(a.id)),
    [officeAgents, meetingAgentIds],
  );

  // Agentes por setor (excluindo quem está na reunião)
  const agentsBySector = useMemo(() => {
    const map = new Map<number, OfficeAgent[]>();
    for (const a of officeAgents) {
      if (meetingAgentIds.has(a.id)) continue;
      if (a.sectorId == null) continue;
      const list = map.get(a.sectorId) ?? [];
      list.push(a);
      map.set(a.sectorId, list);
    }
    return map;
  }, [officeAgents, meetingAgentIds]);

  // Dimensões da cena
  const cols = Math.min(Math.max(sectors.length, 1), ROOMS_PER_ROW);
  const rows = Math.ceil(Math.max(sectors.length, 1) / ROOMS_PER_ROW);
  const gridW = cols * (ROOM_W + ROOM_GAP) - ROOM_GAP;
  const gridD = rows * (ROOM_D + ROOM_GAP) - ROOM_GAP;
  const totalD = gridD + ROOM_GAP + MEETING_ROOM_D + 2;
  const camDist = Math.max(gridW, totalD) * 0.82;

  // Posição da sala de reunião: abaixo do grid, centralizada
  const meetingRoomPos: [number, number, number] = [
    (cols - 1) * (ROOM_W + ROOM_GAP) / 2,
    0,
    rows * (ROOM_D + ROOM_GAP) + MEETING_ROOM_D / 2 + 1,
  ];

  // Centro da cena (incluindo sala de reunião)
  const sceneCenterX = (cols - 1) * (ROOM_W + ROOM_GAP) / 2;
  const sceneCenterZ = (gridD + meetingRoomPos[2]) / 2;

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
        onEndMeeting={() => setMeetingAgentIds(new Set())}
        onToggleActivity={() => setActivityOpen((v) => !v)}
        onTogglePanel={() => setPanelOpen((v) => !v)}
        onOpenConsole={() => setConsoleOpen(true)}
      />

      {/* Layout: painéis laterais + canvas central */}
      <div className="relative flex min-h-0 flex-1">
        {/* Painel esquerdo */}
        <ActivityPanel
          logs={activityLogs}
          open={activityOpen}
          onClose={() => setActivityOpen(false)}
        />

        {/* Cena 3D — ocupa o espaço restante */}
        <div className="min-w-0 flex-1" style={{ height: "100%" }}>
          <Canvas
            shadows
            camera={{
              position: [sceneCenterX, camDist * 0.6, sceneCenterZ + camDist * 0.7],
              fov: 45,
            }}
            style={{ width: "100%", height: "100%" }}
          >
            <fog attach="fog" args={["#0a0d14", camDist * 1.6, camDist * 3.2]} />
            <ambientLight intensity={0.4} />
            <hemisphereLight args={["#1e2a4a", "#0a0d14", 0.5]} />
            <directionalLight
              position={[sceneCenterX, 20, sceneCenterZ]}
              intensity={1.2}
              castShadow
              shadow-mapSize={[2048, 2048]}
            />
            <pointLight position={[sceneCenterX, 5, sceneCenterZ]} intensity={0.8} color="#6080ff" />
            {/* Luz extra para a sala de reunião */}
            <pointLight position={[meetingRoomPos[0], 4, meetingRoomPos[2]]} intensity={0.6} color="#ec4899" />

            {/* Piso geral */}
            <mesh
              rotation={[-Math.PI / 2, 0, 0]}
              position={[sceneCenterX, -0.02, sceneCenterZ]}
              receiveShadow
            >
              <planeGeometry args={[gridW + MEETING_ROOM_W + 10, totalD + 8]} />
              <meshStandardMaterial color="#0d1017" />
            </mesh>

            {/* Salas dos setores */}
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

            {/* Sala de reunião — sempre presente */}
            <MeetingRoom
              position={meetingRoomPos}
              agents={meetingAgents}
              onAgentClick={handleAgentClick}
            />

            <OrbitControls
              target={[sceneCenterX, 0, sceneCenterZ]}
              maxPolarAngle={Math.PI / 2.1}
              minDistance={8}
              maxDistance={camDist * 2.5}
            />
          </Canvas>
        </div>

        {/* Painel direito */}
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
        onStartMeeting={(ids) => {
          setMeetingAgentIds(new Set(ids));
          addLog(officeAgents[0] ?? { name: "Sistema" } as OfficeAgent, `Reunião iniciada com ${ids.length} participante(s)`);
        }}
        onEndMeeting={() => {
          setMeetingAgentIds(new Set());
        }}
      />
      <ConsoleModal
        open={consoleOpen}
        onClose={() => setConsoleOpen(false)}
      />
    </div>
  );
}

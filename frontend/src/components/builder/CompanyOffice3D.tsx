// frontend/src/components/builder/CompanyOffice3D.tsx
// Fase 1 — escritório iluminado, avatares voxel com movimento humanizado,
// sala de reunião, móveis detalhados, portas.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Html, OrbitControls, Text } from "@react-three/drei";
import * as THREE from "three";
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

const ROOM_W = 9;
const ROOM_D = 8;
const ROOM_GAP = 2.5;
const ROOMS_PER_ROW = 3;
const WALL_H = 3.2;
const WALL_T = 0.2;
const DOOR_W = 1.9;
const MEETING_ROOM_W = 11;
const MEETING_ROOM_D = 9;

// Paletas claras / pastel por setor
const ROOM_PALETTES = [
  { floor: "#e3f2fd", wall: "#1565c0", accent: "#2196f3", trim: "#bbdefb" },
  { floor: "#e8f5e9", wall: "#2e7d32", accent: "#4caf50", trim: "#c8e6c9" },
  { floor: "#fce4ec", wall: "#c62828", accent: "#ef5350", trim: "#f8bbd0" },
  { floor: "#f3e5f5", wall: "#6a1b9a", accent: "#ab47bc", trim: "#e1bee7" },
  { floor: "#fff8e1", wall: "#e65100", accent: "#ffa726", trim: "#ffecb3" },
  { floor: "#e0f2f1", wall: "#00695c", accent: "#26a69a", trim: "#b2dfdb" },
  { floor: "#fafafa", wall: "#37474f", accent: "#78909c", trim: "#eceff1" },
  { floor: "#e8eaf6", wall: "#283593", accent: "#5c6bc0", trim: "#c5cae9" },
] as const;

const STATUS_COLOR_3D = {
  working:  "#22c55e",
  thinking: "#60a5fa",
  idle:     "#94a3b8",
  meeting:  "#a78bfa",
  blocked:  "#f87171",
  paused:   "#facc15",
} as const;

const MEETING_CHAIRS: Array<[number, number]> = [
  [-2.8, -1.2], [-1.4, -1.2], [0, -1.2], [1.4, -1.2], [2.8, -1.2],
  [-2.8,  1.2], [-1.4,  1.2], [0,  1.2], [1.4,  1.2], [2.8,  1.2],
  [-4.1, 0], [4.1, 0],
];

const SKIN_TONES  = ["#f5c6a0", "#e8b88a", "#d4956b", "#c68642", "#8d5524"];
const HAIR_COLORS = ["#2d1810", "#5c3a2e", "#1a1a1a", "#4a3728", "#8b6914"];

// ─── Utilitários ──────────────────────────────────────────────────────────────

function roomCenter(index: number): [number, number] {
  const col = index % ROOMS_PER_ROW;
  const row = Math.floor(index / ROOMS_PER_ROW);
  return [col * (ROOM_W + ROOM_GAP), row * (ROOM_D + ROOM_GAP)];
}

function deskSlot(i: number, total: number): [number, number] {
  const cols = Math.max(2, Math.ceil(Math.sqrt(total)));
  const col = i % cols;
  const row = Math.floor(i / cols);
  const cellW = (ROOM_W - 2) / cols;
  const cellD = (ROOM_D - 2) / Math.ceil(total / cols);
  return [
    -(ROOM_W / 2 - 1.2) + col * cellW + cellW / 2,
    -(ROOM_D / 2 - 1.2) + row * cellD + cellD / 2,
  ];
}

function inferRoomType(name: string): "tech" | "design" | "generic" {
  const n = name.toLowerCase();
  if (n.includes("dev") || n.includes("back") || n.includes("front") || n.includes("infra")) return "tech";
  if (n.includes("design") || n.includes("ux") || n.includes("marketing")) return "design";
  return "generic";
}

// ─── Furniture ────────────────────────────────────────────────────────────────

function Workstation({ x, z, color }: { x: number; z: number; color: string }) {
  return (
    <group position={[x, 0, z]}>
      {/* Tampa */}
      <mesh position={[0, 0.76, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.6, 0.07, 0.9]} />
        <meshStandardMaterial color="#e8e0d4" roughness={0.4} metalness={0.05} />
      </mesh>
      {/* Pernas */}
      {([[-0.68, -0.35], [0.68, -0.35], [-0.68, 0.35], [0.68, 0.35]] as [number, number][]).map(([lx, lz], i) => (
        <mesh key={i} position={[lx, 0.37, lz]}>
          <boxGeometry args={[0.06, 0.74, 0.06]} />
          <meshStandardMaterial color="#8b7355" metalness={0.3} />
        </mesh>
      ))}
      {/* Monitor */}
      <group position={[0, 1.54, -0.3]}>
        <mesh castShadow>
          <boxGeometry args={[1.1, 0.7, 0.07]} />
          <meshStandardMaterial color="#111" />
        </mesh>
        <mesh position={[0, 0, 0.04]}>
          <boxGeometry args={[1.05, 0.65, 0.02]} />
          <meshStandardMaterial color="#050810" emissive={color} emissiveIntensity={0.3} />
        </mesh>
        {/* linhas de código */}
        {Array.from({ length: 5 }, (_, i) => (
          <mesh key={i} position={[-0.35 + (i % 3) * 0.28, -0.15 + Math.floor(i / 3) * 0.2, 0.045]}>
            <boxGeometry args={[0.22 + Math.sin(i) * 0.07, 0.018, 0.003]} />
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.6} />
          </mesh>
        ))}
        {/* haste */}
        <mesh position={[0, -0.42, -0.08]}>
          <cylinderGeometry args={[0.03, 0.03, 0.25, 6]} />
          <meshStandardMaterial color="#555" metalness={0.8} />
        </mesh>
      </group>
      {/* Teclado */}
      <mesh position={[0, 0.79, 0.22]} castShadow>
        <boxGeometry args={[0.72, 0.025, 0.24]} />
        <meshStandardMaterial color="#1a1a1a" />
      </mesh>
      {Array.from({ length: 24 }, (_, i) => (
        <mesh key={i} position={[-0.28 + (i % 8) * 0.08, 0.806, 0.12 + Math.floor(i / 8) * 0.07]}>
          <boxGeometry args={[0.06, 0.007, 0.055]} />
          <meshStandardMaterial color="#333" />
        </mesh>
      ))}
      {/* Mouse + pad */}
      <mesh position={[0.55, 0.782, 0.28]}>
        <boxGeometry args={[0.26, 0.004, 0.2]} />
        <meshStandardMaterial color="#4169e1" />
      </mesh>
      <mesh position={[0.55, 0.787, 0.28]}>
        <boxGeometry args={[0.08, 0.012, 0.12]} />
        <meshStandardMaterial color="#111" />
      </mesh>
      {/* Caneca */}
      <group position={[-0.58, 0.79, 0.3]}>
        <mesh>
          <cylinderGeometry args={[0.04, 0.035, 0.07, 8]} />
          <meshStandardMaterial color="#f0f0f0" />
        </mesh>
        <mesh position={[0.05, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.02, 0.007, 6, 12]} />
          <meshStandardMaterial color="#ccc" />
        </mesh>
        <mesh position={[0, 0.025, 0]}>
          <cylinderGeometry args={[0.036, 0.036, 0.018, 8]} />
          <meshStandardMaterial color="#6b3a2a" />
        </mesh>
      </group>
    </group>
  );
}

function PixelChair({ x, z, color = "#444" }: { x: number; z: number; color?: string }) {
  return (
    <group position={[x, 0, z]}>
      {/* Base com rodas */}
      <mesh position={[0, 0.14, 0]}>
        <cylinderGeometry args={[0.18, 0.18, 0.09, 8]} />
        <meshStandardMaterial color="#333" metalness={0.8} />
      </mesh>
      {([0, 72, 144, 216, 288] as number[]).map((angle, i) => {
        const rad = (angle * Math.PI) / 180;
        return (
          <group key={i} rotation={[0, rad, 0]}>
            <mesh position={[0, 0.12, 0.28]}>
              <boxGeometry args={[0.065, 0.05, 0.56]} />
              <meshStandardMaterial color="#333" metalness={0.7} />
            </mesh>
            <mesh position={[0, 0.08, 0.57]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.05, 0.05, 0.035, 8]} />
              <meshStandardMaterial color="#111" />
            </mesh>
          </group>
        );
      })}
      {/* Coluna */}
      <mesh position={[0, 0.52, 0]}>
        <cylinderGeometry args={[0.04, 0.05, 0.58, 8]} />
        <meshStandardMaterial color="#444" metalness={0.8} />
      </mesh>
      {/* Assento */}
      <mesh position={[0, 0.84, 0]} castShadow>
        <boxGeometry args={[0.7, 0.13, 0.7]} />
        <meshStandardMaterial color={color} roughness={0.7} />
      </mesh>
      {/* Encosto */}
      <mesh position={[0, 1.46, -0.3]} castShadow>
        <boxGeometry args={[0.68, 1.0, 0.13]} />
        <meshStandardMaterial color={color} roughness={0.7} />
      </mesh>
      {/* Apoios de braço */}
      {([-0.42, 0.42] as number[]).map((ax, i) => (
        <group key={i} position={[ax, 0.98, 0]}>
          <mesh position={[0, 0, -0.2]}>
            <boxGeometry args={[0.05, 0.52, 0.05]} />
            <meshStandardMaterial color="#555" metalness={0.6} />
          </mesh>
          <mesh position={[0, 0.22, 0]}>
            <boxGeometry args={[0.09, 0.05, 0.36]} />
            <meshStandardMaterial color={color} roughness={0.6} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function DoorMesh({ x, z, rotation = 0 }: { x: number; z: number; rotation?: number }) {
  const doorRef = useRef<THREE.Group>(null!);
  useFrame(({ clock }) => {
    if (doorRef.current)
      doorRef.current.rotation.y = Math.sin(clock.getElapsedTime() * 0.18) * 0.08;
  });
  return (
    <group position={[x, 0, z]} rotation={[0, rotation, 0]}>
      {/* Aro esquerdo */}
      <mesh position={[-0.84, WALL_H / 2, 0]} castShadow>
        <boxGeometry args={[0.14, WALL_H, 0.26]} />
        <meshStandardMaterial color="#8b6a3e" roughness={0.6} />
      </mesh>
      {/* Aro direito */}
      <mesh position={[0.84, WALL_H / 2, 0]} castShadow>
        <boxGeometry args={[0.14, WALL_H, 0.26]} />
        <meshStandardMaterial color="#8b6a3e" roughness={0.6} />
      </mesh>
      {/* Lintel */}
      <mesh position={[0, WALL_H - 0.1, 0]}>
        <boxGeometry args={[1.82, 0.18, 0.26]} />
        <meshStandardMaterial color="#8b6a3e" roughness={0.6} />
      </mesh>
      {/* Folha */}
      <group ref={doorRef} position={[-0.68, 0, 0]}>
        <mesh position={[0.68, (WALL_H - 0.22) / 2, 0]} castShadow>
          <boxGeometry args={[1.36, WALL_H - 0.22, 0.07]} />
          <meshStandardMaterial color="#c9a06e" roughness={0.4} />
        </mesh>
        <mesh position={[1.18, (WALL_H - 0.22) / 2, 0.045]}>
          <sphereGeometry args={[0.045, 8, 8]} />
          <meshStandardMaterial color="#c0c0c0" metalness={0.9} roughness={0.1} />
        </mesh>
      </group>
      {/* Luz de estado */}
      <mesh position={[0, WALL_H + 0.15, 0]}>
        <sphereGeometry args={[0.055, 8, 8]} />
        <meshStandardMaterial color="#00ff88" emissive="#00ff88" emissiveIntensity={0.5} />
      </mesh>
    </group>
  );
}

function ServerRack({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 1, 0]} castShadow>
        <boxGeometry args={[0.5, 2, 0.62]} />
        <meshStandardMaterial color="#0d0d14" />
      </mesh>
      {[0.3, 0.58, 0.86, 1.14, 1.42, 1.7].map((y) => (
        <mesh key={y} position={[0, y, 0.32]}>
          <boxGeometry args={[0.46, 0.1, 0.02]} />
          <meshStandardMaterial color="#111" emissive="#00ff88" emissiveIntensity={0.35} />
        </mesh>
      ))}
    </group>
  );
}

function DesignBoard({ x, z, color }: { x: number; z: number; color: string }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 1, 0]}>
        <boxGeometry args={[1.1, 0.85, 0.04]} />
        <meshStandardMaterial color="#f8f4ec" />
      </mesh>
      {(["#ff6b6b", "#ffd93d", "#6bcb77", "#4d96ff", "#c77dff"] as string[]).map((c, i) => (
        <mesh key={i} position={[-0.4 + i * 0.2, 1.06, 0.03]}>
          <boxGeometry args={[0.15, 0.15, 0.02]} />
          <meshStandardMaterial color={c} emissive={c} emissiveIntensity={0.2} />
        </mesh>
      ))}
      <mesh position={[0, 0.46, 0.02]}>
        <boxGeometry args={[0.05, 0.92, 0.05]} />
        <meshStandardMaterial color={color} />
      </mesh>
    </group>
  );
}

// ─── Anel de status ────────────────────────────────────────────────────────────

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

// ─── Sistema de movimento ─────────────────────────────────────────────────────

type MovState = {
  pos: THREE.Vector3;
  target: THREE.Vector3;
  isMoving: boolean;
  walkPhase: number;
  facingAngle: number;
  waitTimer: number;
  isSitting: boolean;
};

type RoomBounds = { minX: number; maxX: number; minZ: number; maxZ: number };

// ─── Avatar voxel com movimento humanizado ────────────────────────────────────

function AgentAvatar3D({
  agent,
  workPos,
  roomBounds,
  onSelect,
}: {
  agent: OfficeAgent;
  workPos: [number, number, number];
  roomBounds: RoomBounds;
  onSelect: (a: OfficeAgent) => void;
}) {
  const groupRef   = useRef<THREE.Group>(null!);
  const leftLegRef = useRef<THREE.Group>(null!);
  const rightLegRef= useRef<THREE.Group>(null!);
  const leftArmRef = useRef<THREE.Group>(null!);
  const rightArmRef= useRef<THREE.Group>(null!);

  const statusColor = STATUS_COLOR_3D[agent.status] ?? STATUS_COLOR_3D.idle;
  const isWorking  = agent.status === "working";
  const isMeeting  = agent.status === "meeting";
  const skin = SKIN_TONES[agent.id % SKIN_TONES.length]!;
  const hair = HAIR_COLORS[agent.id % HAIR_COLORS.length]!;
  const shirt = agent.appearance.shirtColor;

  const movRef = useRef<MovState>({
    pos: new THREE.Vector3(...workPos),
    target: new THREE.Vector3(...workPos),
    isMoving: false,
    walkPhase: Math.random() * Math.PI * 2,
    facingAngle: 0,
    waitTimer: Math.random() * 4,
    isSitting: isWorking || isMeeting,
  });

  const prevStatusRef = useRef(agent.status);

  useFrame((_, delta) => {
    const g  = groupRef.current;
    const mv = movRef.current;
    if (!g) return;

    const working = agent.status === "working";
    const meeting = agent.status === "meeting";
    const idle    = !working && !meeting;

    // Reage à mudança de status
    if (agent.status !== prevStatusRef.current) {
      prevStatusRef.current = agent.status;
      if (working) {
        mv.target.set(...workPos);
        mv.isMoving = true;
        mv.isSitting = false;
      } else if (meeting) {
        mv.target.set(...workPos);
        mv.isMoving = true;
        mv.isSitting = false;
      } else {
        mv.isSitting = false;
        mv.waitTimer = 0.5;
      }
    }

    const SPEED = 2.8;

    if (mv.isMoving) {
      const dir = mv.target.clone().sub(mv.pos);
      dir.y = 0;
      const dist = dir.length();

      if (dist < 0.08) {
        mv.pos.copy(mv.target);
        mv.isMoving  = false;
        mv.walkPhase = 0;
        mv.isSitting = working || meeting;
        mv.waitTimer = working || meeting ? 0 : 2 + Math.random() * 3.5;
      } else {
        const step = Math.min(SPEED * delta, dist);
        dir.normalize();
        mv.pos.addScaledVector(dir, step);
        mv.facingAngle = Math.atan2(dir.x, dir.z);
        mv.walkPhase  += delta * 7;
      }
    } else if (idle) {
      mv.waitTimer -= delta;
      if (mv.waitTimer <= 0) {
        const m = 1.5;
        mv.target.set(
          roomBounds.minX + m + Math.random() * Math.max(0.1, roomBounds.maxX - roomBounds.minX - m * 2),
          0,
          roomBounds.minZ + m + Math.random() * Math.max(0.1, roomBounds.maxZ - roomBounds.minZ - m * 2),
        );
        mv.isMoving  = true;
        mv.isSitting = false;
      }
    }

    // Aplica posição ao grupo
    g.position.set(mv.pos.x, mv.isSitting ? -0.18 : 0, mv.pos.z);
    if (mv.isMoving) g.rotation.y = mv.facingAngle;

    // Animação de pernas/braços
    const wp = mv.walkPhase;
    const sit = mv.isSitting && !mv.isMoving;
    const walk = mv.isMoving;

    if (leftLegRef.current)
      leftLegRef.current.rotation.x = sit ? -Math.PI / 2.4 : walk ? Math.sin(wp) * 0.42 : 0;
    if (rightLegRef.current)
      rightLegRef.current.rotation.x = sit ? -Math.PI / 2.4 : walk ? -Math.sin(wp) * 0.42 : 0;
    if (leftArmRef.current)
      leftArmRef.current.rotation.x = walk ? -Math.sin(wp) * 0.32 : (sit ? -0.5 : 0);
    if (rightArmRef.current)
      rightArmRef.current.rotation.x = walk ? Math.sin(wp) * 0.32 : (sit ? -0.5 : 0);

    // Bob leve quando trabalhando
    if (isWorking && !mv.isMoving)
      g.position.y = -0.18 + Math.sin(Date.now() / 400) * 0.015;
  });

  const shortName = agent.name.split(" ").slice(0, 2).join(" ");

  return (
    <group
      ref={groupRef}
      position={workPos}
      onClick={(e) => { e.stopPropagation(); onSelect(agent); }}
    >
      {/* Sombra */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <circleGeometry args={[0.22, 16]} />
        <meshBasicMaterial color="#000" transparent opacity={0.15} depthWrite={false} />
      </mesh>

      <StatusRing color={statusColor} isWorking={isWorking} />

      {/* ── Perna esquerda + sapato ── */}
      <group ref={leftLegRef} position={[-0.09, 0.38, 0]}>
        <mesh position={[0, 0, 0]} castShadow>
          <boxGeometry args={[0.13, 0.46, 0.14]} />
          <meshStandardMaterial color="#1e3a5f" />
        </mesh>
        <mesh position={[0, -0.27, 0.04]}>
          <boxGeometry args={[0.13, 0.09, 0.2]} />
          <meshStandardMaterial color="#111" />
        </mesh>
      </group>

      {/* ── Perna direita + sapato ── */}
      <group ref={rightLegRef} position={[0.09, 0.38, 0]}>
        <mesh position={[0, 0, 0]} castShadow>
          <boxGeometry args={[0.13, 0.46, 0.14]} />
          <meshStandardMaterial color="#1e3a5f" />
        </mesh>
        <mesh position={[0, -0.27, 0.04]}>
          <boxGeometry args={[0.13, 0.09, 0.2]} />
          <meshStandardMaterial color="#111" />
        </mesh>
      </group>

      {/* Torso */}
      <mesh position={[0, 0.74, 0]} castShadow>
        <boxGeometry args={[0.4, 0.5, 0.24]} />
        <meshStandardMaterial color={shirt} emissive={shirt} emissiveIntensity={isWorking ? 0.06 : 0} />
      </mesh>

      {/* ── Braço esquerdo + mão ── */}
      <group ref={leftArmRef} position={[-0.27, 0.76, 0]}>
        <mesh position={[0, 0, 0]} castShadow>
          <boxGeometry args={[0.12, 0.44, 0.18]} />
          <meshStandardMaterial color={shirt} />
        </mesh>
        <mesh position={[0, -0.26, 0]}>
          <boxGeometry args={[0.1, 0.1, 0.1]} />
          <meshStandardMaterial color={skin} />
        </mesh>
      </group>

      {/* ── Braço direito + mão ── */}
      <group ref={rightArmRef} position={[0.27, 0.76, 0]}>
        <mesh position={[0, 0, 0]} castShadow>
          <boxGeometry args={[0.12, 0.44, 0.18]} />
          <meshStandardMaterial color={shirt} />
        </mesh>
        <mesh position={[0, -0.26, 0]}>
          <boxGeometry args={[0.1, 0.1, 0.1]} />
          <meshStandardMaterial color={skin} />
        </mesh>
      </group>

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
      {/* Olho esq */}
      <mesh position={[-0.1, 1.33, 0.165]}>
        <boxGeometry args={[0.07, 0.06, 0.01]} />
        <meshBasicMaterial color="#1a1a2e" />
      </mesh>
      {/* Olho dir */}
      <mesh position={[0.1, 1.33, 0.165]}>
        <boxGeometry args={[0.07, 0.06, 0.01]} />
        <meshBasicMaterial color="#1a1a2e" />
      </mesh>

      {/* Tag com nome */}
      <Html center distanceFactor={8} position={[0, 1.95, 0]} style={{ pointerEvents: "none", userSelect: "none" }}>
        <div style={{
          background: "rgba(10,15,25,0.88)",
          color: "#f1f5f9",
          fontSize: "10px",
          padding: "2px 7px",
          borderRadius: "4px",
          whiteSpace: "nowrap",
          border: `1px solid ${statusColor}`,
        }}>
          {shortName}
        </div>
      </Html>

      {isWorking && agent.currentTask !== "Sem tarefa ativa" && (
        <Html center distanceFactor={8} position={[0, 2.16, 0]} style={{ pointerEvents: "none", userSelect: "none" }}>
          <div style={{
            background: "rgba(34,197,94,0.14)",
            color: "#86efac",
            fontSize: "9px",
            padding: "1px 5px",
            borderRadius: "3px",
            whiteSpace: "nowrap",
            maxWidth: "120px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            border: "1px solid rgba(34,197,94,0.22)",
          }}>
            {agent.currentTask.length > 22 ? agent.currentTask.slice(0, 22) + "…" : agent.currentTask}
          </div>
        </Html>
      )}

      {agent.status === "thinking" && (
        <Html center distanceFactor={8} position={[0.35, 1.66, 0]} style={{ pointerEvents: "none" }}>
          <span style={{ fontSize: "15px" }}>💭</span>
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
  const [px, , pz] = position;
  const halfW = MEETING_ROOM_W / 2;
  const halfD = MEETING_ROOM_D / 2;

  return (
    <group position={position}>
      {/* Piso */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]} receiveShadow>
        <planeGeometry args={[MEETING_ROOM_W, MEETING_ROOM_D]} />
        <meshStandardMaterial color="#f0e8f8" />
      </mesh>
      {/* Faixas pink no piso */}
      {([-halfD / 2, halfD / 2] as number[]).map((z, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, z]}>
          <planeGeometry args={[MEETING_ROOM_W - 0.6, 0.07]} />
          <meshBasicMaterial color="#ec4899" transparent opacity={0.28} />
        </mesh>
      ))}

      {/* Paredes */}
      <mesh position={[0, WALL_H / 2, -halfD]} castShadow>
        <boxGeometry args={[MEETING_ROOM_W, WALL_H, WALL_T]} />
        <meshStandardMaterial color="#4a1070" />
      </mesh>
      <mesh position={[-halfW, WALL_H / 2, 0]}>
        <boxGeometry args={[WALL_T, WALL_H, MEETING_ROOM_D]} />
        <meshStandardMaterial color="#4a1070" />
      </mesh>
      <mesh position={[halfW, WALL_H / 2, 0]}>
        <boxGeometry args={[WALL_T, WALL_H, MEETING_ROOM_D]} />
        <meshStandardMaterial color="#4a1070" />
      </mesh>
      {/* Frente com vão */}
      <mesh position={[-(halfW / 2 + DOOR_W / 4), WALL_H / 2, halfD]}>
        <boxGeometry args={[halfW - DOOR_W / 2, WALL_H, WALL_T]} />
        <meshStandardMaterial color="#4a1070" />
      </mesh>
      <mesh position={[(halfW / 2 + DOOR_W / 4), WALL_H / 2, halfD]}>
        <boxGeometry args={[halfW - DOOR_W / 2, WALL_H, WALL_T]} />
        <meshStandardMaterial color="#4a1070" />
      </mesh>

      {/* Faixa luminosa pink */}
      <mesh position={[0, WALL_H - 0.08, -halfD + WALL_T / 2]}>
        <boxGeometry args={[MEETING_ROOM_W - WALL_T, 0.12, 0.04]} />
        <meshStandardMaterial color="#ec4899" emissive="#ec4899" emissiveIntensity={0.55} />
      </mesh>

      {/* Tela */}
      <mesh position={[0, 1.3, -halfD + WALL_T + 0.03]}>
        <boxGeometry args={[5.2, 1.8, 0.03]} />
        <meshStandardMaterial color="#050810" emissive="#4c1d95" emissiveIntensity={0.18} />
      </mesh>
      <mesh position={[0, 1.3, -halfD + WALL_T + 0.046]}>
        <boxGeometry args={[5.3, 1.9, 0.01]} />
        <meshStandardMaterial color="#ec4899" emissive="#ec4899" emissiveIntensity={0.22} />
      </mesh>

      {/* Rótulo */}
      <Text position={[0, WALL_H + 0.3, -halfD + 0.1]} fontSize={0.34} color="#f0abfc"
        anchorX="center" anchorY="bottom" outlineWidth={0.012} outlineColor="#000">
        Sala de Reunião
      </Text>

      {/* Mesa */}
      <mesh position={[0, 0.42, 0]} castShadow receiveShadow>
        <boxGeometry args={[8.2, 0.08, 1.6]} />
        <meshStandardMaterial color="#3b2c1e" roughness={0.4} metalness={0.1} />
      </mesh>
      {([-3.6, -1.8, 0, 1.8, 3.6] as number[]).map((mx) =>
        ([-0.65, 0.65] as number[]).map((mz) => (
          <mesh key={`${mx}-${mz}`} position={[mx, 0.2, mz]}>
            <boxGeometry args={[0.07, 0.38, 0.07]} />
            <meshStandardMaterial color="#2a1e10" />
          </mesh>
        )),
      )}

      {/* Cadeiras */}
      {MEETING_CHAIRS.map(([cx, cz], i) => (
        <PixelChair key={i} x={cx} z={cz} color="#1e1e2e" />
      ))}

      {/* Porta */}
      <DoorMesh x={0} z={halfD} rotation={Math.PI} />

      {/* Agentes na reunião */}
      {agents.map((agent, i) => {
        const [cx, cz] = MEETING_CHAIRS[i % MEETING_CHAIRS.length]!;
        return (
          <AgentAvatar3D
            key={agent.id}
            agent={{ ...agent, status: "meeting" as const }}
            workPos={[px + cx, 0, pz + cz]}
            roomBounds={{ minX: px - 3, maxX: px + 3, minZ: pz - 2, maxZ: pz + 2 }}
            onSelect={onAgentClick}
          />
        );
      })}
    </group>
  );
}

// ─── Sala de setor ─────────────────────────────────────────────────────────────

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
  onRoomClick: (id: number, name: string) => void;
  onAgentClick: (a: OfficeAgent) => void;
}) {
  const [cx, cz] = roomCenter(index);
  const palette = ROOM_PALETTES[index % ROOM_PALETTES.length]!;
  const type = inferRoomType(sector.name);
  const halfW = ROOM_W / 2;
  const halfD = ROOM_D / 2;

  // Bounds para movimento ocioso
  const roomBounds: RoomBounds = {
    minX: cx - halfW + 1.4,
    maxX: cx + halfW - 1.4,
    minZ: cz - halfD + 1.4,
    maxZ: cz + halfD - 1.4,
  };

  return (
    <group position={[cx, 0, cz]}>
      {/* Piso */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]} receiveShadow
        onClick={(e) => { e.stopPropagation(); onRoomClick(sector.id, sector.name); }}>
        <planeGeometry args={[ROOM_W, ROOM_D]} />
        <meshStandardMaterial color={palette.floor} />
      </mesh>
      {/* Moldura colorida no piso */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]}>
        <ringGeometry args={[Math.min(halfW, halfD) - 0.5, Math.min(halfW, halfD) - 0.2, 32]} />
        <meshBasicMaterial color={palette.accent} transparent opacity={0.15} />
      </mesh>

      {/* Paredes */}
      <mesh position={[0, WALL_H / 2, -halfD]} castShadow>
        <boxGeometry args={[ROOM_W, WALL_H, WALL_T]} />
        <meshStandardMaterial color={palette.wall} />
      </mesh>
      <mesh position={[-halfW, WALL_H / 2, 0]}>
        <boxGeometry args={[WALL_T, WALL_H, ROOM_D]} />
        <meshStandardMaterial color={palette.wall} />
      </mesh>
      <mesh position={[halfW, WALL_H / 2, 0]}>
        <boxGeometry args={[WALL_T, WALL_H, ROOM_D]} />
        <meshStandardMaterial color={palette.wall} />
      </mesh>
      {/* Frente com vão */}
      <mesh position={[-(halfW / 2 + DOOR_W / 4), WALL_H / 2, halfD]}>
        <boxGeometry args={[halfW - DOOR_W / 2, WALL_H, WALL_T]} />
        <meshStandardMaterial color={palette.wall} />
      </mesh>
      <mesh position={[(halfW / 2 + DOOR_W / 4), WALL_H / 2, halfD]}>
        <boxGeometry args={[halfW - DOOR_W / 2, WALL_H, WALL_T]} />
        <meshStandardMaterial color={palette.wall} />
      </mesh>

      {/* Faixa accent */}
      <mesh position={[0, WALL_H - 0.08, -halfD + WALL_T / 2]}>
        <boxGeometry args={[ROOM_W - WALL_T, 0.14, 0.04]} />
        <meshStandardMaterial color={palette.accent} emissive={palette.accent} emissiveIntensity={0.28} />
      </mesh>

      {/* Moldura / trim no rodapé */}
      <mesh position={[0, 0.06, -halfD + WALL_T / 2]}>
        <boxGeometry args={[ROOM_W - WALL_T, 0.12, 0.04]} />
        <meshStandardMaterial color={palette.trim} />
      </mesh>

      {/* Rótulo */}
      <Text position={[0, WALL_H + 0.28, -halfD + 0.1]} fontSize={0.3} color="#ffffff"
        anchorX="center" anchorY="bottom" outlineWidth={0.01} outlineColor="#000">
        {sector.name}
      </Text>

      {/* Móveis */}
      {type === "tech" && (
        <>
          <Workstation x={-2.8} z={-2.4} color={palette.accent} />
          <PixelChair x={-2.8} z={-1.1} color={palette.wall} />
          <Workstation x={-0.8} z={-2.4} color={palette.accent} />
          <PixelChair x={-0.8} z={-1.1} color={palette.wall} />
          <Workstation x={1.2} z={-2.4} color={palette.accent} />
          <PixelChair x={1.2} z={-1.1} color={palette.wall} />
          <ServerRack x={3.4} z={-2.6} />
        </>
      )}
      {type === "design" && (
        <>
          <Workstation x={-2.2} z={-2.4} color={palette.accent} />
          <PixelChair x={-2.2} z={-1.1} color={palette.wall} />
          <Workstation x={0.5} z={-2.4} color={palette.accent} />
          <PixelChair x={0.5} z={-1.1} color={palette.wall} />
          <DesignBoard x={3.4} z={-2.2} color={palette.accent} />
        </>
      )}
      {type === "generic" && (
        <>
          <Workstation x={-2} z={-2.4} color={palette.accent} />
          <PixelChair x={-2} z={-1.1} color={palette.wall} />
          <Workstation x={1} z={-2.4} color={palette.accent} />
          <PixelChair x={1} z={-1.1} color={palette.wall} />
        </>
      )}

      {/* Porta */}
      <DoorMesh x={0} z={halfD} />

      {/* Avatares */}
      {agents.map((agent, i) => {
        const [ax, az] = deskSlot(i, agents.length);
        return (
          <AgentAvatar3D
            key={agent.id}
            agent={agent}
            workPos={[cx + ax, 0, cz + az]}
            roomBounds={roomBounds}
            onSelect={onAgentClick}
          />
        );
      })}
    </group>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function CompanyOffice3D() {
  const [sectors, setSectors]   = useState<Sector[]>([]);
  const [rawAgents, setRawAgents] = useState<Agent[]>([]);
  const [error, setError]       = useState<string | null>(null);
  const [loading, setLoading]   = useState(true);

  const [activityOpen, setActivityOpen] = useState(false);
  const [panelOpen,   setPanelOpen]     = useState(true);
  const [paused,      setPaused]        = useState(false);
  const [speed,       setSpeed]         = useState(30_000);
  const [zoom,        setZoom]          = useState(1);
  const [meetingAgentIds, setMeetingAgentIds] = useState<Set<number>>(new Set());

  const [selectedAgent, setSelectedAgent] = useState<OfficeAgent | null>(null);
  const [agentModalOpen, setAgentModalOpen] = useState(false);
  const [selectedRoom,   setSelectedRoom]   = useState<{ id: number; name: string } | null>(null);
  const [roomModalOpen,  setRoomModalOpen]  = useState(false);
  const [meetingOpen,    setMeetingOpen]    = useState(false);
  const [consoleOpen,    setConsoleOpen]    = useState(false);
  const [activityLogs,   setActivityLogs]   = useState<ActivityLog[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function fetchAll() {
      try {
        const [s, a] = await Promise.all([listSectors(), listAgents()]);
        if (!cancelled) { setSectors(s); setRawAgents(a); setError(null); }
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Falha ao carregar.");
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
      { id: crypto.randomUUID(), agentName: agent.name, status: agent.status, action, room: agent.sectorName, timestamp: new Date() },
      ...prev.slice(0, 99),
    ]);
  }, []);

  useEffect(() => {
    if (!lastAgentEvent) return;
    setRawAgents((prev) =>
      prev.some((a) => a.id === lastAgentEvent.id)
        ? prev.map((a) => (a.id === lastAgentEvent.id ? lastAgentEvent : a))
        : [...prev, lastAgentEvent],
    );
  }, [lastAgentEvent]);

  const officeAgents = useMemo<OfficeAgent[]>(
    () => rawAgents.map((a, i) => toOfficeAgent(a, sectors, i)),
    [rawAgents, sectors],
  );

  const prevStatusRef = useRef<Map<number, string>>(new Map());
  useEffect(() => {
    for (const agent of officeAgents) {
      const prev = prevStatusRef.current.get(agent.id);
      if (prev !== undefined && prev !== agent.status) {
        const action =
          agent.status === "working" ? `Iniciou: ${agent.currentTask}`
          : agent.status === "idle"   ? "Concluiu tarefa, aguardando"
          : `Status → ${agent.status}`;
        addLog(agent, action);
      }
      prevStatusRef.current.set(agent.id, agent.status);
    }
  }, [officeAgents, addLog]);

  const meetingAgents    = useMemo(() => officeAgents.filter((a) => meetingAgentIds.has(a.id)), [officeAgents, meetingAgentIds]);
  const agentsBySector   = useMemo(() => {
    const map = new Map<number, OfficeAgent[]>();
    for (const a of officeAgents) {
      if (meetingAgentIds.has(a.id) || a.sectorId == null) continue;
      const list = map.get(a.sectorId) ?? [];
      list.push(a);
      map.set(a.sectorId, list);
    }
    return map;
  }, [officeAgents, meetingAgentIds]);

  const cols    = Math.min(Math.max(sectors.length, 1), ROOMS_PER_ROW);
  const rows    = Math.ceil(Math.max(sectors.length, 1) / ROOMS_PER_ROW);
  const gridW   = cols * (ROOM_W + ROOM_GAP) - ROOM_GAP;
  const gridD   = rows * (ROOM_D + ROOM_GAP) - ROOM_GAP;
  const camDist = Math.max(gridW, gridD + MEETING_ROOM_D) * 0.78;

  const meetingRoomPos: [number, number, number] = [
    (cols - 1) * (ROOM_W + ROOM_GAP) / 2,
    0,
    rows * (ROOM_D + ROOM_GAP) + MEETING_ROOM_D / 2 + 1.2,
  ];
  const sceneCX = (cols - 1) * (ROOM_W + ROOM_GAP) / 2;
  const sceneCZ = (gridD + meetingRoomPos[2]) / 2;

  const handleAgentClick = useCallback((a: OfficeAgent) => { setSelectedAgent(a); setAgentModalOpen(true); }, []);
  const handleRoomClick  = useCallback((id: number, name: string) => { setSelectedRoom({ id, name }); setRoomModalOpen(true); }, []);

  if (loading) return (
    <div className="flex h-full items-center justify-center bg-[#f0f2f8]">
      <p className="text-sm text-slate-500">Carregando escritório...</p>
    </div>
  );
  if (error) return (
    <div className="flex h-full items-center justify-center bg-[#f0f2f8]">
      <p className="text-sm text-red-500">{error}</p>
    </div>
  );

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-[#e8edf5]">
      <OfficeTopBar
        agents={officeAgents} connected={connected} paused={paused} speed={speed} zoom={zoom}
        activityOpen={activityOpen} panelOpen={panelOpen}
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

      <div className="relative flex min-h-0 flex-1">
        <ActivityPanel logs={activityLogs} open={activityOpen} onClose={() => setActivityOpen(false)} />

        <div className="min-w-0 flex-1" style={{ height: "100%" }}>
          <Canvas
            shadows
            camera={{ position: [sceneCX, camDist * 0.65, sceneCZ + camDist * 0.75], fov: 44 }}
            style={{ width: "100%", height: "100%" }}
          >
            {/* Cena clara e bem iluminada */}
            <color attach="background" args={["#e8edf5"]} />
            <fog attach="fog" args={["#d0d8ee", camDist * 2.5, camDist * 5]} />

            <ambientLight intensity={1.1} />
            <hemisphereLight args={["#ffffff", "#c8d4f0", 0.8]} />
            <directionalLight
              position={[sceneCX + 10, 25, sceneCZ + 10]}
              intensity={2.0}
              castShadow
              shadow-mapSize={[2048, 2048]}
              shadow-camera-near={1}
              shadow-camera-far={camDist * 4}
              shadow-camera-left={-gridW * 1.2}
              shadow-camera-right={gridW * 1.2}
              shadow-camera-top={gridD * 1.4}
              shadow-camera-bottom={-gridD * 0.4}
            />
            <directionalLight position={[sceneCX - 8, 18, sceneCZ - 5]} intensity={0.8} />
            <pointLight position={[sceneCX, 6, sceneCZ]} intensity={0.6} color="#ffffff" />
            <pointLight position={[meetingRoomPos[0], 4, meetingRoomPos[2]]} intensity={0.5} color="#ec4899" />

            {/* Piso geral branco com linhas de grade */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[sceneCX, -0.02, sceneCZ]} receiveShadow>
              <planeGeometry args={[gridW + MEETING_ROOM_W + 12, gridD + MEETING_ROOM_D + 14]} />
              <meshStandardMaterial color="#f5f7fc" roughness={0.9} />
            </mesh>
            {/* Grade */}
            {Array.from({ length: Math.floor((gridW + 16) / 2) + 1 }, (_, i) => (
              <mesh key={`gv${i}`} rotation={[-Math.PI / 2, 0, 0]}
                position={[sceneCX - (gridW / 2 + 6) + i * 2, -0.015, sceneCZ]}>
                <planeGeometry args={[0.04, gridD + MEETING_ROOM_D + 14]} />
                <meshBasicMaterial color="#c8d0e8" />
              </mesh>
            ))}
            {Array.from({ length: Math.floor((gridD + MEETING_ROOM_D + 14) / 2) + 1 }, (_, i) => (
              <mesh key={`gh${i}`} rotation={[-Math.PI / 2, 0, 0]}
                position={[sceneCX, -0.015, sceneCZ - (gridD / 2 + 5) + i * 2]}>
                <planeGeometry args={[gridW + MEETING_ROOM_W + 12, 0.04]} />
                <meshBasicMaterial color="#c8d0e8" />
              </mesh>
            ))}

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

            {/* Sala de reunião */}
            <MeetingRoom
              position={meetingRoomPos}
              agents={meetingAgents}
              onAgentClick={handleAgentClick}
            />

            <OrbitControls
              target={[sceneCX, 0, sceneCZ]}
              maxPolarAngle={Math.PI / 2.1}
              minDistance={8}
              maxDistance={camDist * 2.8}
            />
          </Canvas>
        </div>

        <AgentInfoPanel agents={officeAgents} open={panelOpen} onClose={() => setPanelOpen(false)} onAgentClick={handleAgentClick} />
      </div>

      <AgentModal agent={selectedAgent} open={agentModalOpen} onClose={() => setAgentModalOpen(false)} />
      <RoomModal sectorId={selectedRoom?.id ?? null} sectorName={selectedRoom?.name ?? ""} agents={officeAgents} open={roomModalOpen} onClose={() => setRoomModalOpen(false)} />
      <MeetingModal
        open={meetingOpen}
        onClose={() => setMeetingOpen(false)}
        agents={officeAgents}
        sectors={sectors}
        onStartMeeting={(ids) => {
          setMeetingAgentIds(new Set(ids));
          addLog(officeAgents[0] ?? { name: "Sistema" } as OfficeAgent, `Reunião iniciada com ${ids.length} participante(s)`);
        }}
        onEndMeeting={() => setMeetingAgentIds(new Set())}
      />
      <ConsoleModal open={consoleOpen} onClose={() => setConsoleOpen(false)} />
    </div>
  );
}

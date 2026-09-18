// frontend/src/components/builder/CompanyOffice3D.tsx
// Fase 2 — corredores interligados, movimento por waypoints (porta → corredor → destino)
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Html, OrbitControls, Text } from "@react-three/drei";
import * as THREE from "three";
import { listAgents, listSectors, patchAgentAutonomy, type Agent, type Sector, ApiError } from "@/lib/api";
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

const ROOM_W         = 9;
const ROOM_D         = 8;
const ROOM_GAP_X     = 0;    // Salas conectadas — sem gap lateral
const ROOM_GAP_Z     = 2.2;
const ROOMS_PER_ROW  = 3;
const WALL_H         = 2.6;  // Paredes levemente mais baixas
const WALL_T         = 0.2;
const DOOR_W         = 1.9;
const CORRIDOR_D     = 3.6;
const DIVIDER_H      = 0.9;  // Meia-parede entre salas adjacentes
const DIVIDER_OPENING = 2.4; // Abertura de passagem entre salas
const WALK_SPEED       = 3.6;
const ARRIVAL_THRESHOLD = 0.14;

// Contexto compartilhado: posições dos agentes para animação de porta
const AgentPosCtx = createContext<React.MutableRefObject<THREE.Vector3[]>>(
  { current: [] } as React.MutableRefObject<THREE.Vector3[]>,
);

// Mapeamento: slider 0-2 → polling em ms e autonomy_level
const AUTONOMY_SPEEDS   = [60_000, 30_000, 10_000];
const AUTONOMY_LEVELS   = [0, 2, 4];
const AUTONOMY_LABELS   = ["Observador", "Executor", "Autônomo"] as const;

// Escala global de móveis — mantém proporção com agentes a 0.65×
const FURNITURE_SCALE = 0.70;

// Paletas pastel por setor
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

// Paleta da sala de reunião
const MEETING_PALETTE = { floor: "#f0e8f8", wall: "#4a1070", accent: "#ec4899", trim: "#e1bee7" };
// Paleta CEO
const CEO_PALETTE = { floor: "#e8f5e9", wall: "#1b5e20", accent: "#43a047", trim: "#c8e6c9" };

const STATUS_COLOR_3D = {
  working: "#22c55e", thinking: "#60a5fa", idle: "#94a3b8",
  meeting: "#a78bfa", blocked: "#f87171", paused: "#facc15",
} as const;

// Cadeiras menores para sala de reunião integrada
const MEETING_CHAIRS_SMALL: Array<[number, number]> = [
  [-2.4, -1.1], [-0.8, -1.1], [0.8, -1.1], [2.4, -1.1],
  [-2.4,  1.1], [-0.8,  1.1], [0.8,  1.1], [2.4,  1.1],
  [-3.5, 0], [3.5, 0],
];

const SKIN_TONES  = ["#f5c6a0", "#e8b88a", "#d4956b", "#c68642", "#8d5524"];
const HAIR_COLORS = ["#2d1810", "#5c3a2e", "#1a1a1a", "#4a3728", "#8b6914"];

// ─── Utilitários de layout ────────────────────────────────────────────────────

function roomCenter(index: number): [number, number] {
  const col = index % ROOMS_PER_ROW;
  const row = Math.floor(index / ROOMS_PER_ROW);
  return [col * (ROOM_W + ROOM_GAP_X), row * (ROOM_D + ROOM_GAP_Z)];
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

function corridorZ(numRows: number) {
  return numRows * (ROOM_D + ROOM_GAP_Z) + 2.0;
}

function roomDoorVec(cx: number, cz: number): THREE.Vector3 {
  return new THREE.Vector3(cx, 0, cz + ROOM_D / 2 + 0.22);
}

function buildPath(
  fromDoor: THREE.Vector3,
  toDoor: THREE.Vector3,
  targetPos: THREE.Vector3,
  corrZ: number,
): THREE.Vector3[] {
  const dx = Math.abs(fromDoor.x - toDoor.x);
  const dz = Math.abs(fromDoor.z - toDoor.z);
  const dist = dx + dz;

  if (dist < 1.0) return [targetPos.clone()];

  if (dist < ROOM_W + ROOM_GAP_X + 2) {
    return [
      fromDoor.clone(),
      new THREE.Vector3(fromDoor.x, 0, corrZ),
      new THREE.Vector3(toDoor.x, 0, corrZ),
      toDoor.clone(),
      targetPos.clone(),
    ];
  }

  return [
    fromDoor.clone(),
    new THREE.Vector3(fromDoor.x, 0, corrZ),
    new THREE.Vector3(toDoor.x, 0, corrZ),
    toDoor.clone(),
    targetPos.clone(),
  ];
}

function inferRoomType(name: string): "tech" | "design" | "ceo" | "meeting" | "control" | "payment" | "generic" {
  const n = name.toLowerCase();
  if (n.includes("ceo") || n.includes("diretor") || n.includes("executiv") || n.includes("president")) return "ceo";
  if (n.includes("reuni") || n.includes("meeting")) return "meeting";
  if (n.includes("controle") || n.includes("control") || n.includes("monit")) return "control";
  if (n.includes("pagamento") || n.includes("payment") || n.includes("finan")) return "payment";
  if (n.includes("dev") || n.includes("back") || n.includes("front") || n.includes("infra") || n.includes("devops")) return "tech";
  if (n.includes("design") || n.includes("ux") || n.includes("market") || n.includes("criat")) return "design";
  return "generic";
}

// ─── Furniture ────────────────────────────────────────────────────────────────

function Workstation({ x, z, color }: { x: number; z: number; color: string }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.76, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.6, 0.07, 0.9]} />
        <meshStandardMaterial color="#e8e0d4" roughness={0.4} />
      </mesh>
      {([[-0.68, -0.35], [0.68, -0.35], [-0.68, 0.35], [0.68, 0.35]] as [number,number][]).map(([lx, lz], i) => (
        <mesh key={i} position={[lx, 0.37, lz]}>
          <boxGeometry args={[0.06, 0.74, 0.06]} />
          <meshStandardMaterial color="#8b7355" />
        </mesh>
      ))}
      <group position={[0, 1.54, -0.3]}>
        <mesh>
          <boxGeometry args={[1.1, 0.7, 0.07]} />
          <meshStandardMaterial color="#111" />
        </mesh>
        <mesh position={[0, 0, 0.04]}>
          <boxGeometry args={[1.05, 0.65, 0.02]} />
          <meshStandardMaterial color="#050810" emissive={color} emissiveIntensity={0.3} />
        </mesh>
        {Array.from({ length: 5 }, (_, i) => (
          <mesh key={i} position={[-0.35 + (i % 3) * 0.28, -0.15 + Math.floor(i / 3) * 0.2, 0.045]}>
            <boxGeometry args={[0.22 + Math.sin(i) * 0.07, 0.018, 0.003]} />
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.6} />
          </mesh>
        ))}
        <mesh position={[0, -0.42, -0.08]}>
          <cylinderGeometry args={[0.03, 0.03, 0.25, 6]} />
          <meshStandardMaterial color="#555" metalness={0.8} />
        </mesh>
      </group>
      <mesh position={[0, 0.79, 0.22]}>
        <boxGeometry args={[0.72, 0.025, 0.24]} />
        <meshStandardMaterial color="#1a1a1a" />
      </mesh>
      {Array.from({ length: 24 }, (_, i) => (
        <mesh key={i} position={[-0.28 + (i % 8) * 0.08, 0.806, 0.12 + Math.floor(i / 8) * 0.07]}>
          <boxGeometry args={[0.06, 0.007, 0.055]} />
          <meshStandardMaterial color="#333" />
        </mesh>
      ))}
      <mesh position={[0.55, 0.782, 0.28]}>
        <boxGeometry args={[0.26, 0.004, 0.2]} />
        <meshStandardMaterial color="#4169e1" />
      </mesh>
      <mesh position={[0.55, 0.787, 0.28]}>
        <boxGeometry args={[0.08, 0.012, 0.12]} />
        <meshStandardMaterial color="#111" />
      </mesh>
      <group position={[-0.58, 0.79, 0.3]}>
        <mesh>
          <cylinderGeometry args={[0.04, 0.035, 0.07, 8]} />
          <meshStandardMaterial color="#f0f0f0" />
        </mesh>
        <mesh position={[0, 0.025, 0]}>
          <cylinderGeometry args={[0.036, 0.036, 0.018, 8]} />
          <meshStandardMaterial color="#6b3a2a" />
        </mesh>
      </group>
    </group>
  );
}

function PixelChair({ x, z, color = "#444", rotation = 0 }: { x: number; z: number; color?: string; rotation?: number }) {
  return (
    <group position={[x, 0, z]} rotation={[0, rotation, 0]}>
      {/* Base com rodas */}
      <mesh position={[0, 0.07, 0]}>
        <cylinderGeometry args={[0.14, 0.14, 0.05, 8]} />
        <meshStandardMaterial color="#333" metalness={0.8} />
      </mesh>
      {([0, 72, 144, 216, 288] as number[]).map((angle, i) => {
        const rad = (angle * Math.PI) / 180;
        return (
          <group key={i} rotation={[0, rad, 0]}>
            <mesh position={[0, 0.05, 0.16]}>
              <boxGeometry args={[0.04, 0.04, 0.32]} />
              <meshStandardMaterial color="#333" metalness={0.7} />
            </mesh>
            <mesh position={[0, 0.03, 0.32]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.03, 0.03, 0.022, 8]} />
              <meshStandardMaterial color="#111" />
            </mesh>
          </group>
        );
      })}
      {/* Haste */}
      <mesh position={[0, 0.26, 0]}>
        <cylinderGeometry args={[0.025, 0.032, 0.38, 8]} />
        <meshStandardMaterial color="#444" metalness={0.8} />
      </mesh>
      {/* Assento */}
      <mesh position={[0, 0.44, 0]} castShadow>
        <boxGeometry args={[0.52, 0.07, 0.52]} />
        <meshStandardMaterial color={color} roughness={0.7} />
      </mesh>
      {/* Encosto */}
      <mesh position={[0, 0.69, -0.2]} castShadow>
        <boxGeometry args={[0.5, 0.48, 0.07]} />
        <meshStandardMaterial color={color} roughness={0.7} />
      </mesh>
      {/* Apoios de braço */}
      {([-0.3, 0.3] as number[]).map((ax, i) => (
        <group key={i} position={[ax, 0.52, 0]}>
          <mesh position={[0, 0, -0.09]}>
            <boxGeometry args={[0.035, 0.22, 0.035]} />
            <meshStandardMaterial color="#555" metalness={0.6} />
          </mesh>
          <mesh position={[0, 0.1, 0]}>
            <boxGeometry args={[0.06, 0.035, 0.22]} />
            <meshStandardMaterial color={color} roughness={0.6} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function DoorMesh({
  x, z, rotation = 0, roomCX, roomCZ,
}: {
  x: number; z: number; rotation?: number; roomCX: number; roomCZ: number;
}) {
  const doorRef   = useRef<THREE.Group>(null!);
  const agentPosR = useContext(AgentPosCtx);
  const openRef   = useRef(0); // current door open angle

  useFrame((_, delta) => {
    if (!doorRef.current) return;
    // Calcula posição mundial da porta
    const wx = roomCX + x;
    const wz = roomCZ + z;
    let nearest = Infinity;
    for (const p of agentPosR.current) {
      if (!p) continue;
      const dx = p.x - wx, dz = p.z - wz;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < nearest) nearest = d;
    }
    const target = nearest < 2.4 ? -Math.PI / 2 : 0;
    openRef.current += (target - openRef.current) * Math.min(1, delta * 6);
    doorRef.current.rotation.y = openRef.current;
  });
  return (
    <group position={[x, 0, z]} rotation={[0, rotation, 0]}>
      <mesh position={[-0.84, WALL_H / 2, 0]}>
        <boxGeometry args={[0.14, WALL_H, 0.26]} />
        <meshStandardMaterial color="#8b6a3e" />
      </mesh>
      <mesh position={[0.84, WALL_H / 2, 0]}>
        <boxGeometry args={[0.14, WALL_H, 0.26]} />
        <meshStandardMaterial color="#8b6a3e" />
      </mesh>
      <mesh position={[0, WALL_H - 0.1, 0]}>
        <boxGeometry args={[1.82, 0.18, 0.26]} />
        <meshStandardMaterial color="#8b6a3e" />
      </mesh>
      <group ref={doorRef} position={[-0.68, 0, 0]}>
        <mesh position={[0.68, (WALL_H - 0.22) / 2, 0]} castShadow>
          <boxGeometry args={[1.36, WALL_H - 0.22, 0.07]} />
          <meshStandardMaterial color="#c9a06e" roughness={0.4} />
        </mesh>
        <mesh position={[1.18, (WALL_H - 0.22) / 2, 0.045]}>
          <sphereGeometry args={[0.045, 8, 8]} />
          <meshStandardMaterial color="#c0c0c0" metalness={0.9} />
        </mesh>
      </group>
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
      <mesh position={[0, 0.7, 0]} castShadow>
        <boxGeometry args={[0.44, 1.4, 0.54]} />
        <meshStandardMaterial color="#0d0d14" />
      </mesh>
      {[0.2, 0.42, 0.64, 0.86, 1.08, 1.28].map((y) => (
        <mesh key={y} position={[0, y, 0.28]}>
          <boxGeometry args={[0.4, 0.08, 0.02]} />
          <meshStandardMaterial color="#111" emissive="#00ff88" emissiveIntensity={0.35} />
        </mesh>
      ))}
    </group>
  );
}

// ─── Novos móveis ─────────────────────────────────────────────────────────────

function Plant({ x, z, tall = false }: { x: number; z: number; tall?: boolean }) {
  const h = tall ? 1.6 : 1.0;
  return (
    <group position={[x, 0, z]}>
      {/* Vaso */}
      <mesh position={[0, 0.18, 0]}>
        <cylinderGeometry args={[0.14, 0.1, 0.35, 8]} />
        <meshStandardMaterial color="#8b6552" roughness={0.8} />
      </mesh>
      {/* Terra */}
      <mesh position={[0, 0.37, 0]}>
        <cylinderGeometry args={[0.13, 0.13, 0.04, 8]} />
        <meshStandardMaterial color="#3d2b1a" roughness={1} />
      </mesh>
      {/* Tronco */}
      <mesh position={[0, 0.37 + h * 0.3, 0]}>
        <cylinderGeometry args={[0.03, 0.05, h * 0.6, 6]} />
        <meshStandardMaterial color="#4a7c43" roughness={0.9} />
      </mesh>
      {/* Folhagem */}
      <mesh position={[0, 0.37 + h * 0.75, 0]}>
        <sphereGeometry args={[tall ? 0.38 : 0.28, 8, 6]} />
        <meshStandardMaterial color="#2d8a3e" roughness={0.9} />
      </mesh>
      <mesh position={[0.14, 0.37 + h * 0.6, 0.08]}>
        <sphereGeometry args={[tall ? 0.26 : 0.2, 7, 5]} />
        <meshStandardMaterial color="#38a84d" roughness={0.9} />
      </mesh>
      <mesh position={[-0.12, 0.37 + h * 0.65, -0.06]}>
        <sphereGeometry args={[tall ? 0.22 : 0.17, 7, 5]} />
        <meshStandardMaterial color="#27a33c" roughness={0.9} />
      </mesh>
    </group>
  );
}

function Sofa({ x, z, rotation = 0, color = "#334155" }: { x: number; z: number; rotation?: number; color?: string }) {
  return (
    <group position={[x, 0, z]} rotation={[0, rotation, 0]}>
      {/* Base */}
      <mesh position={[0, 0.22, 0]} castShadow>
        <boxGeometry args={[2.2, 0.45, 0.9]} />
        <meshStandardMaterial color={color} roughness={0.8} />
      </mesh>
      {/* Encosto */}
      <mesh position={[0, 0.62, -0.36]} castShadow>
        <boxGeometry args={[2.2, 0.62, 0.2]} />
        <meshStandardMaterial color={color} roughness={0.8} />
      </mesh>
      {/* Braços */}
      <mesh position={[-1.05, 0.42, 0]}>
        <boxGeometry args={[0.18, 0.42, 0.9]} />
        <meshStandardMaterial color={color} roughness={0.7} />
      </mesh>
      <mesh position={[1.05, 0.42, 0]}>
        <boxGeometry args={[0.18, 0.42, 0.9]} />
        <meshStandardMaterial color={color} roughness={0.7} />
      </mesh>
      {/* Almofadas */}
      {([-0.6, 0, 0.6] as number[]).map((ox, i) => (
        <mesh key={i} position={[ox, 0.52, 0.1]}>
          <boxGeometry args={[0.62, 0.22, 0.68]} />
          <meshStandardMaterial color={color === "#334155" ? "#475569" : color} roughness={0.85} />
        </mesh>
      ))}
      {/* Pés */}
      {([[-0.9, -0.38], [0.9, -0.38], [-0.9, 0.38], [0.9, 0.38]] as [number,number][]).map(([fx, fz], i) => (
        <mesh key={i} position={[fx, 0.05, fz]}>
          <boxGeometry args={[0.09, 0.1, 0.09]} />
          <meshStandardMaterial color="#1a1a2e" metalness={0.7} />
        </mesh>
      ))}
    </group>
  );
}

function ExecutiveDesk({ x, z, color = "#2d1e0e" }: { x: number; z: number; color?: string }) {
  return (
    <group position={[x, 0, z]}>
      {/* Tampa principal */}
      <mesh position={[0, 0.78, 0]} castShadow>
        <boxGeometry args={[2.4, 0.07, 1.1]} />
        <meshStandardMaterial color="#8b6914" roughness={0.3} metalness={0.1} />
      </mesh>
      {/* Extensão lateral */}
      <mesh position={[-1.5, 0.78, 0.65]} castShadow>
        <boxGeometry args={[1.4, 0.07, 1.2]} />
        <meshStandardMaterial color="#8b6914" roughness={0.3} metalness={0.1} />
      </mesh>
      {/* Gavetas */}
      <mesh position={[0.9, 0.42, 0]}>
        <boxGeometry args={[0.52, 0.72, 0.95]} />
        <meshStandardMaterial color={color} roughness={0.5} />
      </mesh>
      {[0.22, 0.54].map((dy, i) => (
        <mesh key={i} position={[0.9, dy, 0.48]}>
          <boxGeometry args={[0.44, 0.08, 0.02]} />
          <meshStandardMaterial color="#5a4020" />
        </mesh>
      ))}
      {[0.22, 0.54].map((dy, i) => (
        <mesh key={i} position={[0.9, dy + 0.04, 0.495]}>
          <sphereGeometry args={[0.022, 6, 6]} />
          <meshStandardMaterial color="#c0a040" metalness={0.9} />
        </mesh>
      ))}
      {/* Pernas */}
      {([[-0.95, -0.43], [0.95, -0.43], [-0.95, 0.43]] as [number,number][]).map(([px, pz], i) => (
        <mesh key={i} position={[px, 0.37, pz]}>
          <boxGeometry args={[0.07, 0.74, 0.07]} />
          <meshStandardMaterial color={color} />
        </mesh>
      ))}
      {/* Monitor */}
      <group position={[-0.2, 1.56, -0.3]}>
        <mesh>
          <boxGeometry args={[1.2, 0.75, 0.07]} />
          <meshStandardMaterial color="#111" />
        </mesh>
        <mesh position={[0, 0, 0.045]}>
          <boxGeometry args={[1.15, 0.7, 0.02]} />
          <meshStandardMaterial color="#050810" emissive="#4c6ef5" emissiveIntensity={0.3} />
        </mesh>
        <mesh position={[0, -0.45, -0.05]}>
          <cylinderGeometry args={[0.035, 0.035, 0.3, 6]} />
          <meshStandardMaterial color="#555" metalness={0.8} />
        </mesh>
        <mesh position={[0, -0.62, -0.05]}>
          <boxGeometry args={[0.3, 0.04, 0.22]} />
          <meshStandardMaterial color="#444" metalness={0.7} />
        </mesh>
      </group>
      {/* Telefone */}
      <group position={[0.85, 0.83, -0.2]}>
        <mesh>
          <boxGeometry args={[0.22, 0.04, 0.3]} />
          <meshStandardMaterial color="#2a2a2a" />
        </mesh>
        <mesh position={[0, 0.04, -0.05]}>
          <boxGeometry args={[0.18, 0.03, 0.16]} />
          <meshStandardMaterial color="#1a1a1a" />
        </mesh>
      </group>
      {/* Caneta + porta canetas */}
      <mesh position={[-0.9, 0.85, -0.25]}>
        <cylinderGeometry args={[0.045, 0.045, 0.1, 8]} />
        <meshStandardMaterial color="#c0a040" metalness={0.6} />
      </mesh>
    </group>
  );
}

function Whiteboard({ x, z, rotation = 0 }: { x: number; z: number; rotation?: number }) {
  return (
    <group position={[x, 0, z]} rotation={[0, rotation, 0]}>
      {/* Moldura */}
      <mesh position={[0, 0.92, 0]}>
        <boxGeometry args={[1.9, 1.0, 0.06]} />
        <meshStandardMaterial color="#888" metalness={0.5} />
      </mesh>
      {/* Superfície branca */}
      <mesh position={[0, 0.92, 0.04]}>
        <boxGeometry args={[1.78, 0.9, 0.02]} />
        <meshStandardMaterial color="#f8f8f8" roughness={0.1} />
      </mesh>
      {/* Linhas de escrita simuladas */}
      {[0.22, 0.06, -0.1, -0.26].map((dy, i) => (
        <mesh key={i} position={[-0.2 + (i % 2) * 0.15, 0.92 + dy, 0.06]}>
          <boxGeometry args={[0.65 + i * 0.1, 0.01, 0.005]} />
          <meshStandardMaterial color="#3b82f6" />
        </mesh>
      ))}
      {/* Calha de marcadores */}
      <mesh position={[0, 0.43, 0.035]}>
        <boxGeometry args={[1.78, 0.05, 0.05]} />
        <meshStandardMaterial color="#aaa" metalness={0.4} />
      </mesh>
      {/* Marcadores */}
      {([-0.3, 0, 0.3] as number[]).map((mx, i) => (
        <mesh key={i} position={[mx, 0.46, 0.07]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.012, 0.012, 0.12, 6]} />
          <meshStandardMaterial color={["#ef4444", "#3b82f6", "#22c55e"][i]} />
        </mesh>
      ))}
    </group>
  );
}

function CoffeeMachine({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      {/* Balcão */}
      <mesh position={[0, 0.45, 0]} castShadow>
        <boxGeometry args={[1.4, 0.9, 0.7]} />
        <meshStandardMaterial color="#5c4a3a" roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.91, 0]}>
        <boxGeometry args={[1.4, 0.04, 0.7]} />
        <meshStandardMaterial color="#8b6914" roughness={0.3} />
      </mesh>
      {/* Máquina de café */}
      <group position={[-0.32, 1.22, -0.08]}>
        <mesh>
          <boxGeometry args={[0.5, 0.56, 0.44]} />
          <meshStandardMaterial color="#1a1a1a" metalness={0.6} />
        </mesh>
        <mesh position={[0, 0.05, 0.23]}>
          <boxGeometry args={[0.28, 0.12, 0.02]} />
          <meshStandardMaterial color="#111" emissive="#f97316" emissiveIntensity={0.5} />
        </mesh>
        <mesh position={[0, -0.08, 0.24]}>
          <cylinderGeometry args={[0.06, 0.06, 0.04, 8]} />
          <meshStandardMaterial color="#4a3020" roughness={0.8} />
        </mesh>
        {/* Display */}
        <mesh position={[0, 0.2, 0.23]}>
          <boxGeometry args={[0.18, 0.1, 0.01]} />
          <meshStandardMaterial color="#050505" emissive="#22c55e" emissiveIntensity={0.4} />
        </mesh>
      </group>
      {/* Xícaras */}
      {([-0.05, 0.25] as number[]).map((ox, i) => (
        <group key={i} position={[0.32 + ox * 0.5, 0.94, 0.1]}>
          <mesh>
            <cylinderGeometry args={[0.055, 0.044, 0.06, 8]} />
            <meshStandardMaterial color={i === 0 ? "#f8f8f8" : "#e2c8a0"} />
          </mesh>
          <mesh position={[0.06, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <torusGeometry args={[0.025, 0.008, 4, 8]} />
            <meshStandardMaterial color={i === 0 ? "#f8f8f8" : "#e2c8a0"} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Bookshelf({ x, z, rotation = 0, color = "#5a3a1a" }: { x: number; z: number; rotation?: number; color?: string }) {
  const bookColors = ["#ef4444", "#3b82f6", "#22c55e", "#f59e0b", "#8b5cf6", "#06b6d4", "#f97316", "#64748b"];
  return (
    <group position={[x, 0, z]} rotation={[0, rotation, 0]}>
      {/* Estrutura — 1.5m de altura */}
      <mesh position={[0, 0.75, 0]} castShadow>
        <boxGeometry args={[1.2, 1.5, 0.32]} />
        <meshStandardMaterial color={color} roughness={0.6} />
      </mesh>
      {/* Prateleiras e livros */}
      {[0.22, 0.56, 0.9, 1.24].map((shelf, si) => (
        <group key={si}>
          <mesh position={[0, shelf, 0.02]}>
            <boxGeometry args={[1.12, 0.035, 0.28]} />
            <meshStandardMaterial color="#6b4a2a" />
          </mesh>
          {Array.from({ length: 7 }, (_, bi) => (
            <mesh key={bi} position={[-0.46 + bi * 0.155, shelf + 0.1, 0.07]}>
              <boxGeometry args={[0.11, 0.18 + (bi % 3) * 0.03, 0.2]} />
              <meshStandardMaterial color={bookColors[(si * 4 + bi) % bookColors.length]!} roughness={0.7} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

function DesignTable({ x, z, color = "#e0e0e0" }: { x: number; z: number; color?: string }) {
  return (
    <group position={[x, 0, z]}>
      {/* Mesa inclinável */}
      <mesh position={[0, 0.85, 0]} rotation={[0.15, 0, 0]} castShadow>
        <boxGeometry args={[1.8, 0.05, 1.2]} />
        <meshStandardMaterial color={color} roughness={0.3} />
      </mesh>
      {/* Pernas */}
      {([[-0.78, -0.5], [0.78, -0.5], [-0.78, 0.5], [0.78, 0.5]] as [number,number][]).map(([px, pz], i) => (
        <mesh key={i} position={[px, 0.42, pz]}>
          <boxGeometry args={[0.06, 0.84, 0.06]} />
          <meshStandardMaterial color="#888" metalness={0.7} />
        </mesh>
      ))}
      {/* Canetas e régua */}
      <mesh position={[0.72, 0.9, 0.1]}>
        <boxGeometry args={[0.04, 0.02, 0.52]} />
        <meshStandardMaterial color="#ddd" />
      </mesh>
      {([-0.1, 0, 0.1] as number[]).map((pz, i) => (
        <mesh key={i} position={[0.72, 0.93, pz]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.01, 0.01, 0.18, 6]} />
          <meshStandardMaterial color={["#ef4444","#3b82f6","#1a1a1a"][i]} />
        </mesh>
      ))}
    </group>
  );
}

function ControlDesk({ x, z, color = "#1a1a2e" }: { x: number; z: number; color?: string }) {
  return (
    <group position={[x, 0, z]}>
      {/* Mesa em L */}
      <mesh position={[0, 0.76, 0]} castShadow>
        <boxGeometry args={[2.8, 0.07, 1.0]} />
        <meshStandardMaterial color="#2a2a3e" roughness={0.4} />
      </mesh>
      <mesh position={[0.9, 0.76, -0.85]} castShadow>
        <boxGeometry args={[1.0, 0.07, 0.68]} />
        <meshStandardMaterial color="#2a2a3e" roughness={0.4} />
      </mesh>
      {/* Monitores múltiplos */}
      {([-0.95, 0, 0.95] as number[]).map((mx, i) => (
        <group key={i} position={[mx, 1.55, -0.3]}>
          <mesh>
            <boxGeometry args={[0.85, 0.55, 0.06]} />
            <meshStandardMaterial color="#111" />
          </mesh>
          <mesh position={[0, 0, 0.04]}>
            <boxGeometry args={[0.8, 0.5, 0.02]} />
            <meshStandardMaterial color="#050810" emissive={["#22c55e","#3b82f6","#f59e0b"][i]!} emissiveIntensity={0.4} />
          </mesh>
          <mesh position={[0, -0.32, -0.05]}>
            <cylinderGeometry args={[0.025, 0.025, 0.22, 5]} />
            <meshStandardMaterial color="#444" />
          </mesh>
        </group>
      ))}
      {/* Pernas */}
      {([[-1.2, -0.38], [1.2, -0.38], [-1.2, 0.38]] as [number,number][]).map(([px, pz], i) => (
        <mesh key={i} position={[px, 0.37, pz]}>
          <boxGeometry args={[0.07, 0.74, 0.07]} />
          <meshStandardMaterial color={color} />
        </mesh>
      ))}
    </group>
  );
}

function CoffeeTable({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.38, 0]}>
        <boxGeometry args={[0.8, 0.06, 0.5]} />
        <meshStandardMaterial color="#6b4226" roughness={0.5} />
      </mesh>
      {([[-0.3, -0.18], [0.3, -0.18], [-0.3, 0.18], [0.3, 0.18]] as [number,number][]).map(([fx, fz], i) => (
        <mesh key={i} position={[fx, 0.18, fz]}>
          <boxGeometry args={[0.05, 0.36, 0.05]} />
          <meshStandardMaterial color="#5a3a1a" />
        </mesh>
      ))}
      {/* Xícara na mesa */}
      <mesh position={[0.1, 0.43, 0]}>
        <cylinderGeometry args={[0.045, 0.036, 0.05, 8]} />
        <meshStandardMaterial color="#f0f0f0" />
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

// ─── Sistema de movimento com waypoints ──────────────────────────────────────

type RoomBounds = { minX: number; maxX: number; minZ: number; maxZ: number };

type MovState = {
  pos: THREE.Vector3;
  waypoints: THREE.Vector3[];
  wpIdx: number;
  isMoving: boolean;
  walkPhase: number;
  facingAngle: number;
  idleTimer: number;
  isSitting: boolean;
};

// ─── Avatar voxel ─────────────────────────────────────────────────────────────

function AgentAvatar3D({
  agent,
  homePos,
  meetingPos,
  fromDoor,
  meetingDoor,
  corrZ,
  roomBounds,
  onSelect,
}: {
  agent: OfficeAgent;
  homePos: [number, number, number];
  meetingPos: [number, number, number] | null;
  fromDoor: THREE.Vector3;
  meetingDoor: THREE.Vector3;
  corrZ: number;
  roomBounds: RoomBounds;
  onSelect: (a: OfficeAgent) => void;
}) {
  const groupRef    = useRef<THREE.Group>(null!);
  const leftLegRef  = useRef<THREE.Group>(null!);
  const rightLegRef = useRef<THREE.Group>(null!);
  const leftArmRef  = useRef<THREE.Group>(null!);
  const rightArmRef = useRef<THREE.Group>(null!);
  const agentPosR   = useContext(AgentPosCtx);

  const statusColor = STATUS_COLOR_3D[agent.status] ?? STATUS_COLOR_3D.idle;
  const skin = SKIN_TONES[agent.id % SKIN_TONES.length]!;
  const hair = HAIR_COLORS[agent.id % HAIR_COLORS.length]!;
  const shirt = agent.appearance.shirtColor;

  const prevStatus = useRef(agent.status);
  const prevMeetingPos = useRef<string>("null");

  const movRef = useRef<MovState>({
    pos: new THREE.Vector3(...homePos),
    waypoints: [],
    wpIdx: 0,
    isMoving: false,
    walkPhase: Math.random() * Math.PI * 2,
    facingAngle: 0,
    idleTimer: 1 + Math.random() * 3,
    isSitting: agent.status === "working",
  });

  useFrame((_, delta) => {
    const g = groupRef.current;
    const mv = movRef.current;
    if (!g) return;

    const status = agent.status;
    const mPosKey = meetingPos ? meetingPos.join(",") : "null";

    if (status !== prevStatus.current || mPosKey !== prevMeetingPos.current) {
      const prev = prevStatus.current;
      prevStatus.current = status;
      prevMeetingPos.current = mPosKey;

      if (status === "meeting" && meetingPos) {
        const toDoor = meetingDoor.clone();
        const path = buildPath(fromDoor, toDoor, new THREE.Vector3(...meetingPos), corrZ);
        mv.waypoints = path;
        mv.wpIdx = 0;
        mv.isMoving = path.length > 0;
        mv.isSitting = false;
      } else if (status !== "meeting" && prev === "meeting") {
        const toDoor = fromDoor.clone();
        const path = buildPath(meetingDoor, toDoor, new THREE.Vector3(...homePos), corrZ);
        mv.waypoints = path;
        mv.wpIdx = 0;
        mv.isMoving = path.length > 0;
        mv.isSitting = false;
      } else if (status === "working") {
        mv.waypoints = [new THREE.Vector3(...homePos)];
        mv.wpIdx = 0;
        mv.isMoving = true;
        mv.isSitting = false;
      } else {
        mv.isSitting = false;
        mv.idleTimer = 0.5;
      }
    }

    if (mv.isMoving && mv.waypoints.length > 0) {
      const wp = mv.waypoints[mv.wpIdx];
      if (!wp) { mv.isMoving = false; return; }

      const dir = wp.clone().sub(mv.pos);
      dir.y = 0;
      const dist = dir.length();

      if (dist < ARRIVAL_THRESHOLD) {
        mv.pos.copy(wp);
        mv.wpIdx++;
        if (mv.wpIdx >= mv.waypoints.length) {
          mv.isMoving  = false;
          mv.walkPhase = 0;
          mv.isSitting = status === "working" || status === "meeting";
          mv.idleTimer = status === "idle" || status === "thinking" ? 1.5 + Math.random() * 3 : 0;
        }
      } else {
        const step = Math.min(WALK_SPEED * delta, dist);
        dir.normalize();
        mv.pos.addScaledVector(dir, step);
        mv.facingAngle = Math.atan2(dir.x, dir.z);
        mv.walkPhase += delta * 7;
      }
    } else if (status === "idle" || status === "thinking" || status === "paused") {
      mv.idleTimer -= delta;
      if (mv.idleTimer <= 0 && !mv.isMoving) {
        const m = 1.4;
        const tx = roomBounds.minX + m + Math.random() * Math.max(0.1, roomBounds.maxX - roomBounds.minX - m * 2);
        const tz = roomBounds.minZ + m + Math.random() * Math.max(0.1, roomBounds.maxZ - roomBounds.minZ - m * 2);
        mv.waypoints = [new THREE.Vector3(tx, 0, tz)];
        mv.wpIdx = 0;
        mv.isMoving = true;
        mv.isSitting = false;
      }
    }

    // Publica posição mundial para animação de portas
    agentPosR.current[agent.id] = mv.pos;

    const sit = mv.isSitting && !mv.isMoving;
    g.position.set(mv.pos.x, sit ? 0.04 : 0, mv.pos.z);
    if (mv.isMoving) g.rotation.y = mv.facingAngle;

    const wp = mv.walkPhase;
    const walk = mv.isMoving;
    if (leftLegRef.current)
      leftLegRef.current.rotation.x = sit ? -Math.PI / 2.4 : walk ? Math.sin(wp) * 0.42 : 0;
    if (rightLegRef.current)
      rightLegRef.current.rotation.x = sit ? -Math.PI / 2.4 : walk ? -Math.sin(wp) * 0.42 : 0;
    if (leftArmRef.current)
      leftArmRef.current.rotation.x = walk ? -Math.sin(wp) * 0.32 : sit ? -0.5 : 0;
    if (rightArmRef.current)
      rightArmRef.current.rotation.x = walk ? Math.sin(wp) * 0.32 : sit ? -0.5 : 0;

    if (status === "working" && sit)
      g.position.y = 0.04 + Math.sin(Date.now() / 400) * 0.016;
  });

  const shortName = agent.name.split(" ").slice(0, 2).join(" ");
  const isWorking = agent.status === "working";

  return (
    <group
      ref={groupRef}
      position={homePos}
      onClick={(e) => { e.stopPropagation(); onSelect(agent); }}
    >
      {/* Sombra e anel de status ficam fora do grupo escalado */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <circleGeometry args={[0.16, 16]} />
        <meshBasicMaterial color="#000" transparent opacity={0.14} depthWrite={false} />
      </mesh>
      <StatusRing color={statusColor} isWorking={isWorking} />

      {/* Corpo do agente escalado a 0.65× para ficar proporcional aos móveis */}
      <group scale={[0.65, 0.65, 0.65]}>
        <group ref={leftLegRef} position={[-0.09, 0.38, 0]}>
          <mesh castShadow>
            <boxGeometry args={[0.13, 0.46, 0.14]} />
            <meshStandardMaterial color="#1e3a5f" />
          </mesh>
          <mesh position={[0, -0.27, 0.04]}>
            <boxGeometry args={[0.13, 0.09, 0.2]} />
            <meshStandardMaterial color="#111" />
          </mesh>
        </group>
        <group ref={rightLegRef} position={[0.09, 0.38, 0]}>
          <mesh castShadow>
            <boxGeometry args={[0.13, 0.46, 0.14]} />
            <meshStandardMaterial color="#1e3a5f" />
          </mesh>
          <mesh position={[0, -0.27, 0.04]}>
            <boxGeometry args={[0.13, 0.09, 0.2]} />
            <meshStandardMaterial color="#111" />
          </mesh>
        </group>

        <mesh position={[0, 0.74, 0]} castShadow>
          <boxGeometry args={[0.4, 0.5, 0.24]} />
          <meshStandardMaterial color={shirt} emissive={shirt} emissiveIntensity={isWorking ? 0.06 : 0} />
        </mesh>

        <group ref={leftArmRef} position={[-0.27, 0.76, 0]}>
          <mesh castShadow>
            <boxGeometry args={[0.12, 0.44, 0.18]} />
            <meshStandardMaterial color={shirt} />
          </mesh>
          <mesh position={[0, -0.26, 0]}>
            <boxGeometry args={[0.1, 0.1, 0.1]} />
            <meshStandardMaterial color={skin} />
          </mesh>
        </group>
        <group ref={rightArmRef} position={[0.27, 0.76, 0]}>
          <mesh castShadow>
            <boxGeometry args={[0.12, 0.44, 0.18]} />
            <meshStandardMaterial color={shirt} />
          </mesh>
          <mesh position={[0, -0.26, 0]}>
            <boxGeometry args={[0.1, 0.1, 0.1]} />
            <meshStandardMaterial color={skin} />
          </mesh>
        </group>

        <mesh position={[0, 1.06, 0]}>
          <boxGeometry args={[0.12, 0.12, 0.12]} />
          <meshStandardMaterial color={skin} />
        </mesh>
        <mesh position={[0, 1.32, 0]} castShadow>
          <boxGeometry args={[0.36, 0.32, 0.32]} />
          <meshStandardMaterial color={skin} />
        </mesh>
        <mesh position={[0, 1.5, 0]}>
          <boxGeometry args={[0.38, 0.1, 0.34]} />
          <meshStandardMaterial color={hair} />
        </mesh>
        <mesh position={[0, 1.42, -0.17]}>
          <boxGeometry args={[0.38, 0.26, 0.06]} />
          <meshStandardMaterial color={hair} />
        </mesh>
        <mesh position={[-0.1, 1.33, 0.165]}>
          <boxGeometry args={[0.07, 0.06, 0.01]} />
          <meshBasicMaterial color="#1a1a2e" />
        </mesh>
        <mesh position={[0.1, 1.33, 0.165]}>
          <boxGeometry args={[0.07, 0.06, 0.01]} />
          <meshBasicMaterial color="#1a1a2e" />
        </mesh>
      </group>

      {/* Labels fora do grupo escalado, posições ajustadas para 0.65× */}
      <Html center distanceFactor={8} position={[0, 1.2, 0]} style={{ pointerEvents: "none", userSelect: "none" }}>
        <div style={{
          background: "rgba(10,15,25,0.88)", color: "#f1f5f9", fontSize: "10px",
          padding: "2px 7px", borderRadius: "4px", whiteSpace: "nowrap",
          border: `1px solid ${statusColor}`,
        }}>
          {shortName}
        </div>
      </Html>

      {isWorking && agent.currentTask !== "Sem tarefa ativa" && (
        <Html center distanceFactor={8} position={[0, 1.38, 0]} style={{ pointerEvents: "none", userSelect: "none" }}>
          <div style={{
            background: "rgba(34,197,94,0.14)", color: "#86efac", fontSize: "9px",
            padding: "1px 5px", borderRadius: "3px", whiteSpace: "nowrap",
            maxWidth: "110px", overflow: "hidden", textOverflow: "ellipsis",
            border: "1px solid rgba(34,197,94,0.22)",
          }}>
            {agent.currentTask.length > 20 ? agent.currentTask.slice(0, 20) + "…" : agent.currentTask}
          </div>
        </Html>
      )}
      {agent.status === "thinking" && (
        <Html center distanceFactor={8} position={[0.28, 1.08, 0]} style={{ pointerEvents: "none" }}>
          <span style={{ fontSize: "13px" }}>💭</span>
        </Html>
      )}
    </group>
  );
}

// ─── Corredor visual ───────────────────────────────────────────────────────────

function CorridorFloor({ corrZ, gridW }: { corrZ: number; gridW: number }) {
  return (
    <group position={[gridW / 2, 0, corrZ]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]} receiveShadow>
        <planeGeometry args={[gridW + 8, CORRIDOR_D]} />
        <meshStandardMaterial color="#dde4f2" roughness={0.6} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.018, 0]}>
        <planeGeometry args={[gridW + 8, 0.06]} />
        <meshBasicMaterial color="#a0b0d8" transparent opacity={0.6} />
      </mesh>
      {Array.from({ length: Math.ceil((gridW + 6) / 3) }, (_, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]}
          position={[-gridW / 2 - 2 + i * 3, 0.02, 0]}>
          <circleGeometry args={[0.12, 8]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.7} />
        </mesh>
      ))}
    </group>
  );
}

// ─── Sala de setor (sem agentes) ──────────────────────────────────────────────

function Room({
  sector,
  index,
  col,
  totalCols,
  isMeetingRoom = false,
  onRoomClick,
}: {
  sector: Sector;
  index: number;
  col: number;
  totalCols: number;
  isMeetingRoom?: boolean;
  onRoomClick: (id: number, name: string) => void;
}) {
  const [cx, cz] = roomCenter(index);
  const type = isMeetingRoom ? "meeting" : inferRoomType(sector.name);

  const palette =
    type === "meeting" ? MEETING_PALETTE :
    type === "ceo"     ? CEO_PALETTE :
    ROOM_PALETTES[index % ROOM_PALETTES.length]!;

  const halfW = ROOM_W / 2;
  const halfD = ROOM_D / 2;

  // Geometria dos vãos de passagem entre salas adjacentes
  const divSegLen = (ROOM_D - DIVIDER_OPENING) / 2;                     // 2.8
  const divSeg1Z  = -((halfD + DIVIDER_OPENING / 2) / 2);               // -2.6
  const divSeg2Z  =   (halfD + DIVIDER_OPENING / 2) / 2;                // +2.6

  return (
    <group position={[cx, 0, cz]}>
      {/* Piso */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]} receiveShadow
        onClick={(e) => { e.stopPropagation(); onRoomClick(sector.id, sector.name); }}>
        <planeGeometry args={[ROOM_W, ROOM_D]} />
        <meshStandardMaterial color={palette.floor} />
      </mesh>
      {/* Moldura interna no piso */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]}>
        <ringGeometry args={[Math.min(halfW, halfD) - 0.5, Math.min(halfW, halfD) - 0.2, 32]} />
        <meshBasicMaterial color={palette.accent} transparent opacity={0.15} />
      </mesh>

      {/* Parede traseira */}
      <mesh position={[0, WALL_H / 2, -halfD]} castShadow>
        <boxGeometry args={[ROOM_W, WALL_H, WALL_T]} />
        <meshStandardMaterial color={palette.wall} />
      </mesh>

      {/* Parede esquerda: sólida se for o primeiro da fileira; meia-parede com passagem se tiver vizinho */}
      {col === 0 ? (
        <mesh position={[-halfW, WALL_H / 2, 0]}>
          <boxGeometry args={[WALL_T, WALL_H, ROOM_D]} />
          <meshStandardMaterial color={palette.wall} />
        </mesh>
      ) : (
        <>
          <mesh position={[-halfW, DIVIDER_H / 2, divSeg1Z]}>
            <boxGeometry args={[WALL_T, DIVIDER_H, divSegLen]} />
            <meshStandardMaterial color={palette.wall} />
          </mesh>
          <mesh position={[-halfW, DIVIDER_H / 2, divSeg2Z]}>
            <boxGeometry args={[WALL_T, DIVIDER_H, divSegLen]} />
            <meshStandardMaterial color={palette.wall} />
          </mesh>
        </>
      )}

      {/* Parede direita: sólida apenas se for o último da fileira; sem parede (próxima sala renderiza a meia-parede) */}
      {col === totalCols - 1 && (
        <mesh position={[halfW, WALL_H / 2, 0]}>
          <boxGeometry args={[WALL_T, WALL_H, ROOM_D]} />
          <meshStandardMaterial color={palette.wall} />
        </mesh>
      )}

      {/* Parede frontal (com vão para porta) */}
      <mesh position={[-(halfW / 2 + DOOR_W / 4), WALL_H / 2, halfD]}>
        <boxGeometry args={[halfW - DOOR_W / 2, WALL_H, WALL_T]} />
        <meshStandardMaterial color={palette.wall} />
      </mesh>
      <mesh position={[(halfW / 2 + DOOR_W / 4), WALL_H / 2, halfD]}>
        <boxGeometry args={[halfW - DOOR_W / 2, WALL_H, WALL_T]} />
        <meshStandardMaterial color={palette.wall} />
      </mesh>

      {/* Faixa accent no topo */}
      <mesh position={[0, WALL_H - 0.08, -halfD + WALL_T / 2]}>
        <boxGeometry args={[ROOM_W - WALL_T, 0.14, 0.04]} />
        <meshStandardMaterial color={palette.accent} emissive={palette.accent} emissiveIntensity={0.28} />
      </mesh>
      {/* Rodapé */}
      <mesh position={[0, 0.06, -halfD + WALL_T / 2]}>
        <boxGeometry args={[ROOM_W - WALL_T, 0.12, 0.04]} />
        <meshStandardMaterial color={palette.trim} />
      </mesh>

      {/* Nome da sala */}
      <Text position={[0, WALL_H + 0.28, -halfD + 0.1]} fontSize={0.3} color="#ffffff"
        anchorX="center" anchorY="bottom" outlineWidth={0.01} outlineColor="#000">
        {sector.name}
      </Text>

      {/* ─── Móveis por tipo ─────────────────────────────────────────────── */}

      {type === "ceo" && (
        <>
          <ExecutiveDesk x={0.2} z={-1.8} />
          <PixelChair x={0.2} z={-0.6} color="#1a1a2e" rotation={Math.PI} />
          <Sofa x={-2.2} z={0.6} rotation={Math.PI / 2} color="#2d4a3e" />
          <CoffeeTable x={-2.2} z={1.8} />
          <Plant x={3.2} z={-3.2} tall />
          <Plant x={-3.2} z={-3.2} />
          <Whiteboard x={0} z={-3.7} />
          <Bookshelf x={3.5} z={-1.0} color="#3d2b1a" />
          {/* Quadros na parede */}
          <mesh position={[-1.5, 1.6, -halfD + WALL_T + 0.02]}>
            <boxGeometry args={[1.0, 0.65, 0.03]} />
            <meshStandardMaterial color="#1a2a1a" emissive="#2d6a2d" emissiveIntensity={0.1} />
          </mesh>
          <mesh position={[1.8, 1.7, -halfD + WALL_T + 0.02]}>
            <boxGeometry args={[0.8, 0.5, 0.03]} />
            <meshStandardMaterial color="#1a1a2a" emissive="#2d2d6a" emissiveIntensity={0.1} />
          </mesh>
          {/* Capacete no canto da mesa */}
          <mesh position={[1.8, 0.7, -0.8]}>
            <sphereGeometry args={[0.12, 8, 6]} />
            <meshStandardMaterial color="#f5c033" roughness={0.4} />
          </mesh>
        </>
      )}

      {type === "meeting" && (
        <>
          {/* Mesa de conferência */}
          <mesh position={[0, 0.42, 0]} castShadow>
            <boxGeometry args={[6.0, 0.07, 1.2]} />
            <meshStandardMaterial color="#3b2c1e" roughness={0.4} />
          </mesh>
          {([-2.5, -1.25, 0, 1.25, 2.5] as number[]).map((mx) =>
            ([-0.52, 0.52] as number[]).map((mz) => (
              <mesh key={`${mx}-${mz}`} position={[mx, 0.2, mz]}>
                <boxGeometry args={[0.06, 0.38, 0.06]} />
                <meshStandardMaterial color="#2a1e10" />
              </mesh>
            ))
          )}
          {MEETING_CHAIRS_SMALL.map(([cchx, cchz], i) => {
            const rot = cchz < -0.5 ? 0 : cchz > 0.5 ? Math.PI : cchx < 0 ? Math.PI / 2 : -Math.PI / 2;
            return <PixelChair key={i} x={cchx} z={cchz} color="#1e1e2e" rotation={rot} />;
          })}
          {/* Tela de projeção */}
          <mesh position={[0, 1.3, -halfD + WALL_T + 0.04]}>
            <boxGeometry args={[4.0, 1.2, 0.03]} />
            <meshStandardMaterial color="#050810" emissive="#4c1d95" emissiveIntensity={0.25} />
          </mesh>
          {/* Projetor no teto */}
          <mesh position={[0, WALL_H - 0.1, 0.5]}>
            <boxGeometry args={[0.24, 0.12, 0.4]} />
            <meshStandardMaterial color="#222" metalness={0.6} />
          </mesh>
          <Whiteboard x={-3.2} z={-halfD + WALL_T + 0.04} />
          <Plant x={3.5} z={3.0} />
          <Plant x={-3.5} z={3.0} />
          {/* Faixa accent na parede */}
          <mesh position={[0, WALL_H - 0.08, -halfD + WALL_T / 2]}>
            <boxGeometry args={[ROOM_W - WALL_T, 0.12, 0.04]} />
            <meshStandardMaterial color={palette.accent} emissive={palette.accent} emissiveIntensity={0.55} />
          </mesh>
        </>
      )}

      {type === "tech" && (
        <>
          <Workstation x={-2.8} z={-2.4} color={palette.accent} />
          <PixelChair x={-2.8} z={-1.1} color={palette.wall} rotation={Math.PI} />
          <Workstation x={-0.6} z={-2.4} color={palette.accent} />
          <PixelChair x={-0.6} z={-1.1} color={palette.wall} rotation={Math.PI} />
          <Workstation x={1.6} z={-2.4} color={palette.accent} />
          <PixelChair x={1.6} z={-1.1} color={palette.wall} rotation={Math.PI} />
          <ServerRack x={3.5} z={-2.8} />
          <ServerRack x={3.5} z={-1.4} />
          <Plant x={-3.4} z={3.0} />
          <CoffeeMachine x={-2.5} z={2.8} />
          {/* Quadro técnico na parede */}
          <mesh position={[0.5, 1.8, -halfD + WALL_T + 0.02]}>
            <boxGeometry args={[2.2, 1.2, 0.03]} />
            <meshStandardMaterial color="#0a0f1a" emissive={palette.accent} emissiveIntensity={0.08} />
          </mesh>
        </>
      )}

      {type === "design" && (
        <>
          <Workstation x={-2.5} z={-2.4} color={palette.accent} />
          <PixelChair x={-2.5} z={-1.1} color={palette.wall} rotation={Math.PI} />
          <DesignTable x={0.8} z={-1.8} color="#f0e8d8" />
          <PixelChair x={0.8} z={-0.5} color={palette.wall} rotation={Math.PI} />
          <Workstation x={2.8} z={-2.4} color={palette.accent} />
          <PixelChair x={2.8} z={-1.1} color={palette.wall} rotation={Math.PI} />
          <Whiteboard x={-3.5} z={-halfD + WALL_T + 0.04} />
          <Plant x={3.4} z={3.0} tall />
          <Plant x={-3.4} z={3.0} />
          {/* Mesa de amostras */}
          <mesh position={[0, 0.62, 2.6]} castShadow>
            <boxGeometry args={[2.0, 0.06, 0.8]} />
            <meshStandardMaterial color="#e8d8b8" roughness={0.4} />
          </mesh>
          {/* Amostras de cor */}
          {[0,1,2,3,4,5].map((i) => (
            <mesh key={i} position={[-0.7 + i * 0.28, 0.66, 2.6]}>
              <boxGeometry args={[0.22, 0.02, 0.28]} />
              <meshStandardMaterial color={["#ef4444","#f59e0b","#22c55e","#3b82f6","#8b5cf6","#ec4899"][i]} />
            </mesh>
          ))}
        </>
      )}

      {type === "control" && (
        <>
          <ControlDesk x={0} z={-1.0} />
          <PixelChair x={-0.95} z={0.4} color="#1a1a2e" rotation={Math.PI} />
          <PixelChair x={0} z={0.4} color="#1a1a2e" rotation={Math.PI} />
          <PixelChair x={0.95} z={0.4} color="#1a1a2e" rotation={Math.PI} />
          <ServerRack x={-3.4} z={-2.8} />
          <ServerRack x={-2.7} z={-2.8} />
          <ServerRack x={3.4} z={-2.8} />
          <Plant x={3.4} z={3.0} />
          {/* Painel de luzes de status */}
          <mesh position={[0, 1.0, -halfD + WALL_T + 0.03]}>
            <boxGeometry args={[4.0, 0.6, 0.04]} />
            <meshStandardMaterial color="#0a0f1a" emissive="#00ff88" emissiveIntensity={0.08} />
          </mesh>
          {Array.from({ length: 8 }, (_, i) => (
            <mesh key={i} position={[-1.6 + i * 0.46, 1.0, -halfD + WALL_T + 0.06]}>
              <circleGeometry args={[0.06, 8]} />
              <meshStandardMaterial
                color={["#22c55e","#22c55e","#f59e0b","#22c55e","#3b82f6","#22c55e","#f87171","#22c55e"][i]!}
                emissive={["#22c55e","#22c55e","#f59e0b","#22c55e","#3b82f6","#22c55e","#f87171","#22c55e"][i]!}
                emissiveIntensity={0.8}
              />
            </mesh>
          ))}
        </>
      )}

      {type === "payment" && (
        <>
          <Workstation x={-2.0} z={-2.4} color={palette.accent} />
          <PixelChair x={-2.0} z={-1.1} color={palette.wall} rotation={Math.PI} />
          <Workstation x={0.4} z={-2.4} color={palette.accent} />
          <PixelChair x={0.4} z={-1.1} color={palette.wall} rotation={Math.PI} />
          <Workstation x={2.8} z={-2.4} color={palette.accent} />
          <PixelChair x={2.8} z={-1.1} color={palette.wall} rotation={Math.PI} />
          <Plant x={3.4} z={3.0} />
          <Bookshelf x={-3.8} z={-1.2} color="#2d4060" />
          {/* Cofre */}
          <mesh position={[-3.5, 0.3, -2.5]} castShadow>
            <boxGeometry args={[0.5, 0.6, 0.5]} />
            <meshStandardMaterial color="#1a1a2e" metalness={0.7} />
          </mesh>
          <mesh position={[-3.5, 0.62, -2.5]}>
            <cylinderGeometry args={[0.08, 0.08, 0.06, 8]} />
            <meshStandardMaterial color="#c0c0c0" metalness={0.9} />
          </mesh>
        </>
      )}

      {type === "generic" && (
        <>
          <Workstation x={-2.2} z={-2.4} color={palette.accent} />
          <PixelChair x={-2.2} z={-1.1} color={palette.wall} rotation={Math.PI} />
          <Workstation x={0.8} z={-2.4} color={palette.accent} />
          <PixelChair x={0.8} z={-1.1} color={palette.wall} rotation={Math.PI} />
          <Workstation x={2.8} z={-2.4} color={palette.accent} />
          <PixelChair x={2.8} z={-1.1} color={palette.wall} rotation={Math.PI} />
          <Plant x={3.4} z={3.0} />
          <CoffeeMachine x={-2.5} z={2.8} />
        </>
      )}

      <DoorMesh x={0} z={halfD} roomCX={cx} roomCZ={cz} />
    </group>
  );
}

// ─── Piso entre fileiras ──────────────────────────────────────────────────────

function InterRowPassage({ corrZ, gridW }: { corrZ: number; gridW: number }) {
  const rows = Math.max(1, Math.floor(corrZ / (ROOM_D + ROOM_GAP_Z)));
  const passages: JSX.Element[] = [];
  for (let r = 1; r < rows; r++) {
    const z = r * (ROOM_D + ROOM_GAP_Z) - ROOM_GAP_Z / 2;
    passages.push(
      <mesh key={r} rotation={[-Math.PI / 2, 0, 0]} position={[gridW / 2, 0.011, z]} receiveShadow>
        <planeGeometry args={[gridW + 4, ROOM_GAP_Z]} />
        <meshStandardMaterial color="#eaeff8" roughness={0.85} />
      </mesh>
    );
  }
  return <>{passages}</>;
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function CompanyOffice3D() {
  const [sectors,   setSectors]   = useState<Sector[]>([]);
  const [rawAgents, setRawAgents] = useState<Agent[]>([]);
  const [error,   setError]     = useState<string | null>(null);
  const [loading, setLoading]   = useState(true);

  const [activityOpen,   setActivityOpen]   = useState(false);
  const [panelOpen,      setPanelOpen]      = useState(true);
  const [paused,         setPaused]         = useState(false);
  const [autonomySlider, setAutonomySlider] = useState(1); // 0=Baixo 1=Médio 2=Alto
  const [zoom,           setZoom]           = useState(1);

  // Intervalo de polling derivado do slider (não estado separado)
  const speed = AUTONOMY_SPEEDS[autonomySlider] ?? 30_000;

  // Ref compartilhado: posições mundiais dos agentes para animação de portas
  const agentPosRef = useRef<THREE.Vector3[]>([]);
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

  // Quando uma reunião local está ativa, sobrescreve o status dos participantes
  // para "meeting" independentemente do que o backend retorna — sem isso o
  // AgentAvatar3D nunca recebe status=meeting e os agentes não se movem.
  const officeAgents = useMemo<OfficeAgent[]>(
    () => rawAgents.map((a, i) => {
      const agent = toOfficeAgent(a, sectors, i);
      if (meetingAgentIds.has(agent.id) && agent.status !== "meeting") {
        return { ...agent, status: "meeting" as const };
      }
      return agent;
    }),
    [rawAgents, sectors, meetingAgentIds],
  );

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

  // ─── Geometria da cena ─────────────────────────────────────────────────────
  // Layout do grid:
  //   índice 0         → Sala CEO (sempre canto superior esquerdo — paredes verdes)
  //   índices 1..N     → setores reais (cada sector[i] ocupa slot i+1)
  //   índice N+1       → Sala de Reunião
  const CEO_ROOM_INDEX     = 0;
  const totalRooms         = sectors.length + 2; // +1 CEO, +1 Reunião
  const cols               = Math.min(Math.max(totalRooms, 1), ROOMS_PER_ROW);
  const rows               = Math.ceil(Math.max(totalRooms, 1) / ROOMS_PER_ROW);
  const gridW              = cols * (ROOM_W + ROOM_GAP_X) - ROOM_GAP_X;
  const CORR_Z             = corridorZ(rows);

  // Posição da Sala CEO
  const [ceoCX, ceoCZ]    = roomCenter(CEO_ROOM_INDEX);
  const ceoDoor            = roomDoorVec(ceoCX, ceoCZ);

  // Sala de Reunião: último slot
  const meetingRoomIndex   = sectors.length + 1;
  const [meetingCX, meetingCZ] = roomCenter(meetingRoomIndex);
  const meetingRoomPos: [number, number, number] = [meetingCX, 0, meetingCZ];
  const meetingDoor        = roomDoorVec(meetingCX, meetingCZ);

  const sceneCX = (cols - 1) * (ROOM_W + ROOM_GAP_X) / 2;
  const sceneCZ = rows * (ROOM_D + ROOM_GAP_Z) / 2;

  // Distância de câmera que enquadra todo o escritório
  const camDist = Math.max(gridW, CORR_Z + 4) * 0.65 + 8;

  const meetingAgentList = useMemo(
    () => officeAgents.filter((a) => meetingAgentIds.has(a.id)),
    [officeAgents, meetingAgentIds],
  );

  // Agentes da sala CEO: CEO + general_orchestrator (sector=null)
  const ceoRoomAgents = useMemo(
    () => officeAgents.filter(
      (a) => a.access_level === "ceo" || a.access_level === "general_orchestrator",
    ),
    [officeAgents],
  );

  const handleAgentClick  = useCallback((a: OfficeAgent) => { setSelectedAgent(a); setAgentModalOpen(true); }, []);
  const handleRoomClick   = useCallback((id: number, name: string) => {
    if (id === -1) { setMeetingOpen(true); return; }
    setSelectedRoom({ id, name }); setRoomModalOpen(true);
  }, []);

  const handleAutonomyChange = useCallback((slider: number) => {
    setAutonomySlider(slider);
    const level = AUTONOMY_LEVELS[slider] ?? 0;
    // Patcha todos os agentes em background (erro não-crítico)
    for (const agent of rawAgents) {
      patchAgentAutonomy(agent.id, level).catch(() => {});
    }
  }, [rawAgents]);

  // Setores fictícios para salas especiais (reutiliza o componente Room)
  const ceoRoomSector: Sector = useMemo(
    () => ({ id: -2, name: "CEO", knowledge_source: null } as unknown as Sector),
    [],
  );
  const meetingRoomSector: Sector = useMemo(
    () => ({ id: -1, name: "Sala de Reunião", knowledge_source: null } as unknown as Sector),
    [],
  );

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
        agents={officeAgents} connected={connected} paused={paused}
        autonomySlider={autonomySlider} zoom={zoom}
        activityOpen={activityOpen} panelOpen={panelOpen}
        onTogglePause={() => setPaused((v) => !v)}
        onAutonomyChange={handleAutonomyChange}
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
            camera={{
              position: [sceneCX + camDist * 0.7, camDist * 0.65, sceneCZ + camDist * 0.85],
              fov: 46,
            }}
            style={{ width: "100%", height: "100%" }}
          >
            <AgentPosCtx.Provider value={agentPosRef}>
            <color attach="background" args={["#e8edf5"]} />
            <fog attach="fog" args={["#d0d8ee", camDist * 3, camDist * 6]} />

            <ambientLight intensity={1.2} />
            <hemisphereLight args={["#ffffff", "#c8d4f0", 0.9]} />
            <directionalLight
              position={[sceneCX + 12, 28, sceneCZ + 10]}
              intensity={2.2} castShadow
              shadow-mapSize={[2048, 2048]}
              shadow-camera-left={-gridW * 1.4} shadow-camera-right={gridW * 1.4}
              shadow-camera-top={CORR_Z * 1.5}  shadow-camera-bottom={-6}
              shadow-camera-near={1} shadow-camera-far={camDist * 5}
            />
            <directionalLight position={[sceneCX - 10, 20, sceneCZ - 8]} intensity={0.9} />
            <pointLight position={[sceneCX, 7, sceneCZ]} intensity={0.7} color="#ffffff" />
            {/* Luz por sala */}
            {Array.from({ length: cols }, (_, c) =>
              Array.from({ length: rows }, (_, r) => (
                <pointLight
                  key={`${c}-${r}`}
                  position={[c * (ROOM_W + ROOM_GAP_X), 4, r * (ROOM_D + ROOM_GAP_Z)]}
                  intensity={0.3}
                  color="#fffaf0"
                  distance={10}
                />
              ))
            )}

            {/* Piso global */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[sceneCX, -0.02, sceneCZ]} receiveShadow>
              <planeGeometry args={[gridW + 16, rows * (ROOM_D + ROOM_GAP_Z) + 12]} />
              <meshStandardMaterial color="#f5f7fc" roughness={0.9} />
            </mesh>
            {/* Grade sutil */}
            {Array.from({ length: Math.floor((gridW + 16) / 2) + 1 }, (_, i) => (
              <mesh key={`gv${i}`} rotation={[-Math.PI / 2, 0, 0]}
                position={[sceneCX - (gridW / 2 + 6) + i * 2, -0.014, sceneCZ]}>
                <planeGeometry args={[0.035, rows * (ROOM_D + ROOM_GAP_Z) + 12]} />
                <meshBasicMaterial color="#c8d0e8" />
              </mesh>
            ))}

            {/* Passagens entre fileiras */}
            <InterRowPassage corrZ={CORR_Z} gridW={gridW} />

            {/* Corredor principal (apenas se houver mais de uma fileira) */}
            {rows > 1 && <CorridorFloor corrZ={CORR_Z} gridW={gridW} />}

            {/* Sala CEO — índice 0, canto superior esquerdo */}
            {(() => {
              const roomRow = Math.floor(CEO_ROOM_INDEX / ROOMS_PER_ROW);
              const isLast  = roomRow === rows - 1;
              const rowCols = isLast ? (totalRooms - roomRow * ROOMS_PER_ROW) : cols;
              return (
                <Room
                  sector={ceoRoomSector}
                  index={CEO_ROOM_INDEX}
                  col={CEO_ROOM_INDEX % ROOMS_PER_ROW}
                  totalCols={rowCols}
                  onRoomClick={handleRoomClick}
                />
              );
            })()}

            {/* Salas dos setores — começam no índice 1 (0 é reservado para CEO) */}
            {sectors.map((sector, i) => {
              const idx     = i + 1;
              const roomRow = Math.floor(idx / ROOMS_PER_ROW);
              const isLast  = roomRow === rows - 1;
              const rowCols = isLast ? (totalRooms - roomRow * ROOMS_PER_ROW) : cols;
              return (
                <Room
                  key={sector.id}
                  sector={sector}
                  index={idx}
                  col={idx % ROOMS_PER_ROW}
                  totalCols={rowCols}
                  onRoomClick={handleRoomClick}
                />
              );
            })}

            {/* Sala de reunião — integrada no grid, no último slot */}
            {(() => {
              const idx     = meetingRoomIndex;
              const roomRow = Math.floor(idx / ROOMS_PER_ROW);
              const isLast  = roomRow === rows - 1;
              const rowCols = isLast ? (totalRooms - roomRow * ROOMS_PER_ROW) : cols;
              return (
                <Room
                  sector={meetingRoomSector}
                  index={idx}
                  col={idx % ROOMS_PER_ROW}
                  totalCols={rowCols}
                  isMeetingRoom
                  onRoomClick={handleRoomClick}
                />
              );
            })()}

            {/* Agentes */}
            {officeAgents.map((agent) => {
              // CEO e Orquestrador-Geral (sector=null) ficam na Sala CEO
              const isCeoRoom =
                agent.access_level === "ceo" || agent.access_level === "general_orchestrator";

              let cx: number, cz: number;
              let sAgents: OfficeAgent[];
              let aIdx: number;
              let fromDoor: THREE.Vector3;

              if (isCeoRoom) {
                [cx, cz] = [ceoCX, ceoCZ];
                sAgents  = ceoRoomAgents;
                aIdx     = ceoRoomAgents.findIndex((a) => a.id === agent.id);
                fromDoor = ceoDoor;
              } else {
                // Sector rooms estão no índice sIdx+1 (slot 0 é CEO)
                const sIdx = sectors.findIndex((s) => s.id === agent.sectorId);
                const pos  = sIdx >= 0 ? roomCenter(sIdx + 1) : roomCenter(CEO_ROOM_INDEX);
                cx = pos[0]; cz = pos[1];
                sAgents  = agentsBySector.get(agent.sectorId ?? -1) ?? [];
                aIdx     = sAgents.findIndex((a) => a.id === agent.id);
                fromDoor = roomDoorVec(cx, cz);
              }

              const [ax, az] = deskSlot(aIdx >= 0 ? aIdx : 0, Math.max(sAgents.length, 1));
              const homePos: [number, number, number] = [cx + ax, 0, cz + az];

              const mIdx = meetingAgentList.findIndex((a) => a.id === agent.id);
              const meetingPos: [number, number, number] | null =
                mIdx >= 0
                  ? [
                      meetingRoomPos[0] + (MEETING_CHAIRS_SMALL[mIdx % MEETING_CHAIRS_SMALL.length]?.[0] ?? 0),
                      0,
                      meetingRoomPos[2] + (MEETING_CHAIRS_SMALL[mIdx % MEETING_CHAIRS_SMALL.length]?.[1] ?? 0),
                    ]
                  : null;

              const roomBounds: RoomBounds = {
                minX: cx - ROOM_W / 2 + 1.5,
                maxX: cx + ROOM_W / 2 - 1.5,
                minZ: cz - ROOM_D / 2 + 1.5,
                maxZ: cz + ROOM_D / 2 - 1.5,
              };

              return (
                <AgentAvatar3D
                  key={agent.id}
                  agent={agent}
                  homePos={homePos}
                  meetingPos={meetingPos}
                  fromDoor={fromDoor}
                  meetingDoor={meetingDoor}
                  corrZ={CORR_Z}
                  roomBounds={roomBounds}
                  onSelect={handleAgentClick}
                />
              );
            })}

            {/* OrbitControls sem limite de ângulo polar → 360° completo */}
            <OrbitControls
              target={[sceneCX, 0, sceneCZ]}
              enableDamping
              dampingFactor={0.06}
              minDistance={6}
              maxDistance={camDist * 3.5}
            />
            </AgentPosCtx.Provider>
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
          addLog(
            officeAgents[0] ?? ({ name: "Sistema" } as OfficeAgent),
            `Reunião iniciada com ${ids.length} participante(s)`,
          );
        }}
        onEndMeeting={() => setMeetingAgentIds(new Set())}
      />
      <ConsoleModal open={consoleOpen} onClose={() => setConsoleOpen(false)} />
    </div>
  );
}

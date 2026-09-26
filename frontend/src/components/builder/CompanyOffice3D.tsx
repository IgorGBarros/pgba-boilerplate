// frontend/src/components/builder/CompanyOffice3D.tsx
// Fase 3 — planta isométrica: câmera ortográfica, paredes em corte ("casa de
// boneca"), uma mesa por agente com crachá, Cérebro central ligado a cada
// setor por fios de dados e cartões de KPI flutuantes. Mantém tudo da Fase 2
// (corredores, movimento por waypoints porta → corredor → destino, reunião).
//
// Ideias de layout inspiradas no Agents Office (github.com/ajsahni/agents-office);
// nenhum código daquele projeto foi copiado — a licença dele (PolyForm
// Noncommercial + termos adicionais) proíbe incorporá-lo em outro produto.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Html, OrbitControls, Environment, Lightformer, ContactShadows } from "@react-three/drei";
import * as THREE from "three";
import {
  getAIStatus, getSectorMetrics, getTimeline,
  listAgents, listPendingApprovals, listSectorMessages, listSectors, listTasks, patchAgentAutonomy,
  type AIProvider, type AIStatus, type Agent, type PendingApproval, type Sector, type SectorMessage, type SectorMetric,
  type Task, type Timeline, ApiError,
} from "@/lib/api";
import { ReplayBar } from "./office3d/ReplayBar";
import { DailySummaryModal } from "./office3d/DailySummaryModal";
import { AIConfigModal } from "./office3d/AIConfigModal";
import { REPLAY_SPEEDS, replayStateAt } from "./office3d/replay";
import { getClaudeAutoOpen, isClaudeCodeSector, launchClaudeCode } from "./office3d/claudeCode";
import { BrainHub, type BrainLink } from "./office3d/BrainHub";
import { BrainGraph } from "./office3d/BrainGraph";
import { MessageModal } from "./office3d/MessageModal";
import { ApprovalModal } from "./office3d/ApprovalModal";
import { ENVELOPE_COLORS, EnvelopeMesh, Envelopes, type Flight, type PendingEnvelope, type V3 } from "./office3d/Envelopes";
import { SectorCard, type SectorStats } from "./office3d/SectorCard";
import { IsoCamera, type CamMode } from "./office3d/IsoCamera";
import {
  DESK_SEAT_Z, IDLE_X_RANGE, MEETING_SEATS,
  ceoDeskLayout, deskLayout, seatLaneLocal, frontToOutside, frontToSeat, hallway, errandRoute, meetingEntry, meetingExit, outsideToFront, roomNav, seatToFront,
  type NavGrid, type Pt, type RoomNav, type Seat,
} from "./office3d/navigation";
import { box, cyl, mergedGeometry, mergedMaterial, sphere, type Part } from "./office3d/merge";
import { floorTexture, labelTexture, screenTexture, type FloorPattern, type ScreenKind } from "./office3d/textures";
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
const ROOM_GAP_X     = 2.2;  // Corredor vertical entre colunas de salas (rota entre fileiras)
const ROOM_GAP_Z     = 2.2;
// Colunas de salas: calculado pela quantidade de salas (ver roomColumns) —
// com muitos setores, 3 colunas fixas viravam 5+ fileiras e a planta
// ficava minúscula numa tela larga.
const MAX_ROOM_COLS  = 5;
const WALL_H         = 2.6;  // Paredes do fundo/esquerda (altura cheia)
const FRONT_WALL_H   = 0.55; // Paredes frente/direita em corte — deixa ver dentro da sala
const SLAB_H         = 0.32; // Espessura da laje elevada de cada sala
const WALL_T         = 0.2;
const DOOR_W         = 1.9;
const CORRIDOR_D     = 3.6;
const WALK_SPEED       = 3.6;
const LABEL_DF         = 0.026; // distanceFactor p/ Html com câmera ortográfica (escala = zoom × df)
// Abaixo deste zoom (px por unidade) o rótulo do agente fica < ~50% do
// tamanho e ilegível — some (CSS), em vez de poluir a planta inteira.
const LABEL_MIN_ZOOM   = 20;

/**
 * Marca no container do canvas se o zoom está "longe" — um atributo só,
 * trocado quando cruza o limite (sem re-render do React). O CSS em
 * CompanyOffice3D esconde os rótulos dos agentes nesse caso.
 */
function ZoomLevelMarker() {
  const last = useRef<string>("");
  useFrame(({ camera, gl }) => {
    const level = camera.zoom < LABEL_MIN_ZOOM ? "far" : "near";
    if (level === last.current) return;
    last.current = level;
    const host = gl.domElement.parentElement?.parentElement;
    host?.setAttribute("data-office-zoom", level);
  });
  return null;
}
const ARRIVAL_THRESHOLD = 0.14;

// Contexto compartilhado: posições dos agentes para animação de porta
const AgentPosCtx = createContext<React.MutableRefObject<THREE.Vector3[]>>(
  { current: [] } as React.MutableRefObject<THREE.Vector3[]>,
);

// Mapeamento: slider 0-2 → polling em ms e autonomy_level
const AUTONOMY_SPEEDS   = [60_000, 30_000, 10_000];
const AUTONOMY_LEVELS   = [0, 2, 4];
// const AUTONOMY_LABELS   = ["Observador", "Executor", "Autônomo"] as const;

// Escala global de móveis — mantém proporção com agentes a 0.65×
// const FURNITURE_SCALE = 0.70;

// Paredes neutras para todos os setores; CEO tem parede verde distinta
const NEUTRAL_WALL  = "#eae6de";
const NEUTRAL_TRIM  = "#ccc8c0";

// Cor do piso por tipo de sala — identidade visual do departamento
function getRoomFloor(type: string): string {
  switch (type) {
    case "tech":    return "#f5dcc8"; // salmão — Backend, Frontend, DevOps
    case "design":  return "#f5ccd8"; // rosa — Design / UX
    case "payment": return "#f5ccd8"; // rosa — Pagamento
    case "control": return "#c4d4e8"; // azul aço — Sala de Controle
    case "ceo":     return "#e0eedc"; // verde suave — CEO
    case "meeting": return "#f0e4d4"; // pêssego — Sala de Reunião
    case "mercado": return "#c8e8d4"; // verde trading — Inteligência de Mercado
    default:        return "#ece8e0"; // neutro quente — genérico
  }
}

const ROOM_PALETTES = [
  { floor: "#f5dcc8", wall: NEUTRAL_WALL, accent: "#1565c0", trim: NEUTRAL_TRIM },
  { floor: "#f5dcc8", wall: NEUTRAL_WALL, accent: "#2e7d32", trim: NEUTRAL_TRIM },
  { floor: "#f5ccd8", wall: NEUTRAL_WALL, accent: "#b71c1c", trim: NEUTRAL_TRIM },
  { floor: "#f5ccd8", wall: NEUTRAL_WALL, accent: "#6a1b9a", trim: NEUTRAL_TRIM },
  { floor: "#f5dcc8", wall: NEUTRAL_WALL, accent: "#e65100", trim: NEUTRAL_TRIM },
  { floor: "#c4d4e8", wall: NEUTRAL_WALL, accent: "#00695c", trim: NEUTRAL_TRIM },
  { floor: "#c4d4e8", wall: NEUTRAL_WALL, accent: "#37474f", trim: NEUTRAL_TRIM },
  { floor: "#ece8e0", wall: NEUTRAL_WALL, accent: "#283593", trim: NEUTRAL_TRIM },
] as const;

// Paleta da sala de reunião
const MEETING_PALETTE = { floor: "#f0e4d4", wall: NEUTRAL_WALL, accent: "#6d28d9", trim: NEUTRAL_TRIM };
// Paleta CEO — parede verde distinta como no layout de referência
const CEO_PALETTE = { floor: "#e0eedc", wall: "#2d5a30", accent: "#4caf50", trim: "#b8d4b8" };

const STATUS_COLOR_3D = {
  working: "#22c55e", thinking: "#60a5fa", idle: "#94a3b8",
  meeting: "#a78bfa", blocked: "#f87171", paused: "#facc15",
} as const;

const SKIN_TONES  = ["#f5c6a0", "#e8b88a", "#d4956b", "#c68642", "#8d5524"];
const HAIR_COLORS = ["#2d1810", "#5c3a2e", "#1a1a1a", "#4a3728", "#8b6914"];

// ─── Utilitários de layout ────────────────────────────────────────────────────

/** Colunas da grade de salas: próximo de uma planta "larga" (proporção de tela), no máximo 5. */
function roomColumns(totalRooms: number): number {
  if (totalRooms <= 3) return Math.max(totalRooms, 1);
  return Math.min(MAX_ROOM_COLS, Math.ceil(Math.sqrt(totalRooms * 1.6)));
}

function roomCenter(index: number, cols: number): [number, number] {
  const col = index % cols;
  const row = Math.floor(index / cols);
  return [col * (ROOM_W + ROOM_GAP_X), row * (ROOM_D + ROOM_GAP_Z)];
}

// Corredor logo à frente da última fileira de salas (na Fase 2 ficava a ~6
// unidades de distância, com um vazio no meio da planta).
function corridorZ(numRows: number) {
  return (numRows - 1) * (ROOM_D + ROOM_GAP_Z) + ROOM_D / 2 + CORRIDOR_D / 2 + 0.25;
}

function inferRoomType(name: string): "tech" | "design" | "ceo" | "meeting" | "control" | "payment" | "mercado" | "generic" {
  const n = name.toLowerCase();
  if (n.includes("ceo") || n.includes("diretor") || n.includes("executiv") || n.includes("president")) return "ceo";
  if (n.includes("reuni") || n.includes("meeting")) return "meeting";
  if (n.includes("controle") || n.includes("control") || n.includes("monit")) return "control";
  if (n.includes("mercado") || n.includes("inteligência") || n.includes("trading") || n.includes("bolsa")) return "mercado";
  if (n.includes("pagamento") || n.includes("payment") || n.includes("finan")) return "payment";
  if (n.includes("dev") || n.includes("back") || n.includes("front") || n.includes("infra") || n.includes("devops")) return "tech";
  if (n.includes("design") || n.includes("ux") || n.includes("market") || n.includes("criat")) return "design";
  return "generic";
}

// ─── Furniture ────────────────────────────────────────────────────────────────

function Workstation({
  x, z, color, active = false, kind = "code", variant = 0, width = 1.6,
}: {
  x: number; z: number; color: string;
  active?: boolean; kind?: ScreenKind; variant?: number; width?: number;
}) {
  const tex = useMemo(() => screenTexture(color, kind, variant), [color, kind, variant]);
  // Tampo, painel, pernas, moldura/pé do monitor, teclado, mouse e caneca
  // fundidos (1 draw call); só a tela fica separada, porque tem textura e
  // acende quando o agente desta mesa está trabalhando.
  const geo = useMemo(() => mergedGeometry(`desk:${width}:${color}`, () => {
    const legX = width / 2 - 0.12;
    return [
      { geo: box(width, 0.07, 0.9), pos: [0, 0.76, 0], color: "#d9c7a7" },
      { geo: box(width - 0.1, 0.55, 0.04), pos: [0, 0.45, -0.42], color: "#b8a88a" },
      { geo: box(0.06, 0.74, 0.06), pos: [-legX, 0.37, 0.35], color: "#6b5a45" },
      { geo: box(0.06, 0.74, 0.06), pos: [legX, 0.37, 0.35], color: "#6b5a45" },
      { geo: box(0.92, 0.58, 0.05), pos: [0, 1.2, -0.28], color: "#1a1d24" },
      { geo: box(0.05, 0.2, 0.05), pos: [0, 0.84, -0.3], color: "#444444" },
      { geo: box(0.6, 0.02, 0.2), pos: [0, 0.8, 0.12], color: "#2a2d33" },
      { geo: box(0.08, 0.02, 0.12), pos: [0.45, 0.8, 0.16], color: "#2a2d33" },
      { geo: cyl(0.045, 0.04, 0.1, 10), pos: [-width / 2 + 0.22, 0.84, 0.2], color },
    ];
  }), [width, color]);
  return (
    <group position={[x, 0, z]}>
      <mesh geometry={geo} material={mergedMaterial} castShadow receiveShadow />
      {/* Tela com textura: acesa quando o agente desta mesa está trabalhando */}
      <mesh position={[0, 1.2, -0.252]}>
        <planeGeometry args={[0.86, 0.52]} />
        <meshBasicMaterial map={tex} color={active ? "#ffffff" : "#5b6474"} toneMapped={false} />
      </mesh>
    </group>
  );
}

function PixelChair({ x, z, color = "#444", rotation = 0 }: { x: number; z: number; color?: string; rotation?: number }) {
  // Base com 5 pés/rodas + haste + assento + encosto + braços — 18 peças
  // fundidas numa geometria só (cacheada por cor).
  const geo = useMemo(() => mergedGeometry(`chair:${color}`, () => {
    const parts: Part[] = [
      { geo: cyl(0.14, 0.14, 0.05, 8), pos: [0, 0.07, 0], color: "#333333" },
      { geo: cyl(0.025, 0.032, 0.38, 8), pos: [0, 0.26, 0], color: "#444444" },
      { geo: box(0.52, 0.07, 0.52), pos: [0, 0.44, 0], color },
      { geo: box(0.5, 0.48, 0.07), pos: [0, 0.69, -0.2], color },
    ];
    for (let i = 0; i < 5; i++) {
      const a = (i * 72 * Math.PI) / 180;
      const sx = Math.sin(a), cz = Math.cos(a);
      parts.push({ geo: box(0.04, 0.04, 0.32), pos: [sx * 0.16, 0.05, cz * 0.16], rot: [0, a, 0], color: "#333333" });
      parts.push({ geo: cyl(0.03, 0.03, 0.022, 8), pos: [sx * 0.32, 0.03, cz * 0.32], rot: [Math.PI / 2, a, 0], color: "#111111" });
    }
    for (const ax of [-0.3, 0.3]) {
      parts.push({ geo: box(0.035, 0.22, 0.035), pos: [ax, 0.52, -0.09], color: "#555555" });
      parts.push({ geo: box(0.06, 0.035, 0.22), pos: [ax, 0.62, 0], color });
    }
    return parts;
  }), [color]);
  return <mesh geometry={geo} material={mergedMaterial} position={[x, 0, z]} rotation={[0, rotation, 0]} castShadow />;
}

function DoorMesh({
  x, z, rotation = 0, roomCX, roomCZ, accent,
}: {
  x: number; z: number; rotation?: number; roomCX: number; roomCZ: number; accent: string;
}) {
  // Portão de vidro baixo (a parede da frente está em corte) que desliza
  // para os lados quando um agente se aproxima — mesma detecção da Fase 2.
  const leftRef   = useRef<THREE.Mesh>(null!);
  const rightRef  = useRef<THREE.Mesh>(null!);
  const lightRef  = useRef<THREE.MeshBasicMaterial>(null!);
  const agentPosR = useContext(AgentPosCtx);
  const openRef   = useRef(0);

  useFrame((_, delta) => {
    const wx = roomCX + x;
    const wz = roomCZ + z;
    let nearest = Infinity;
    for (const p of agentPosR.current) {
      if (!p) continue;
      const dx = p.x - wx, dz = p.z - wz;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < nearest) nearest = d;
    }
    const target = nearest < 2.2 ? 1 : 0;
    openRef.current += (target - openRef.current) * Math.min(1, delta * 6);
    const o = openRef.current;
    if (leftRef.current)  leftRef.current.position.x  = -0.45 - o * 0.8;
    if (rightRef.current) rightRef.current.position.x =  0.45 + o * 0.8;
    if (lightRef.current) lightRef.current.color.set(o > 0.5 ? "#22c55e" : accent);
  });
  return (
    <group position={[x, 0, z]} rotation={[0, rotation, 0]}>
      {/* Tapete de entrada */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, -0.55]}>
        <planeGeometry args={[1.6, 0.8]} />
        <meshStandardMaterial color="#6b6358" roughness={1} />
      </mesh>
      {([-0.95, 0.95] as number[]).map((px, i) => (
        <mesh key={i} position={[px, FRONT_WALL_H / 2 + 0.1, 0]}>
          <boxGeometry args={[0.1, FRONT_WALL_H + 0.2, 0.24]} />
          <meshStandardMaterial color="#9a9489" />
        </mesh>
      ))}
      <mesh ref={leftRef} position={[-0.45, FRONT_WALL_H / 2, 0]}>
        <boxGeometry args={[0.88, FRONT_WALL_H - 0.08, 0.04]} />
        <meshPhysicalMaterial color="#cfe8f5" transparent opacity={0.45} roughness={0.05} />
      </mesh>
      <mesh ref={rightRef} position={[0.45, FRONT_WALL_H / 2, 0]}>
        <boxGeometry args={[0.88, FRONT_WALL_H - 0.08, 0.04]} />
        <meshPhysicalMaterial color="#cfe8f5" transparent opacity={0.45} roughness={0.05} />
      </mesh>
      <mesh position={[0.95, FRONT_WALL_H + 0.26, 0]}>
        <sphereGeometry args={[0.06, 8, 8]} />
        <meshBasicMaterial ref={lightRef} color={accent} toneMapped={false} />
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
  // Vaso + terra + tronco + 3 bolas de folhagem, fundidos (1 draw call)
  const geo = useMemo(() => mergedGeometry(`plant:${tall}`, () => {
    const h = tall ? 1.6 : 1.0;
    return [
      { geo: cyl(0.14, 0.1, 0.35, 8), pos: [0, 0.18, 0], color: "#8b6552" },
      { geo: cyl(0.13, 0.13, 0.04, 8), pos: [0, 0.37, 0], color: "#3d2b1a" },
      { geo: cyl(0.03, 0.05, h * 0.6, 6), pos: [0, 0.37 + h * 0.3, 0], color: "#4a7c43" },
      { geo: sphere(tall ? 0.38 : 0.28, 8, 6), pos: [0, 0.37 + h * 0.75, 0], color: "#2d8a3e" },
      { geo: sphere(tall ? 0.26 : 0.2, 7, 5), pos: [0.14, 0.37 + h * 0.6, 0.08], color: "#38a84d" },
      { geo: sphere(tall ? 0.22 : 0.17, 7, 5), pos: [-0.12, 0.37 + h * 0.65, -0.06], color: "#27a33c" },
    ];
  }), [tall]);
  return <mesh geometry={geo} material={mergedMaterial} position={[x, 0, z]} castShadow />;
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

// ─── Trading desk com gráfico de candles 3D ──────────────────────────────────

function TradingDesk({ x, z, accent = "#22c55e" }: { x: number; z: number; accent?: string }) {
  const candleRef = useRef<THREE.Group>(null!);

  // Candles simulados: [open, high, low, close] normalizado 0-1
  const candles: [number, number, number, number][] = [
    [0.3, 0.5, 0.25, 0.45], [0.45, 0.6, 0.42, 0.55], [0.55, 0.62, 0.48, 0.5],
    [0.5, 0.55, 0.38, 0.4], [0.4, 0.52, 0.36, 0.5], [0.5, 0.7, 0.48, 0.68],
    [0.68, 0.75, 0.65, 0.72], [0.72, 0.78, 0.68, 0.74],
  ];

  useFrame(({ clock }) => {
    if (!candleRef.current) return;
    const t = clock.getElapsedTime();
    candleRef.current.children.forEach((child, i) => {
      if (child instanceof THREE.Mesh) {
        const mat = child.material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity = 0.25 + 0.15 * Math.sin(t * 1.2 + i * 0.5);
      }
    });
  });

  const SCREEN_W = 1.1;
  const SCREEN_H = 0.65;
  const candleW = SCREEN_W / (candles.length + 1);

  return (
    <group position={[x, 0, z]}>
      {/* Tampo da mesa */}
      <mesh position={[0, 0.76, 0]} castShadow>
        <boxGeometry args={[2.0, 0.07, 1.0]} />
        <meshStandardMaterial color="#1a2a1a" roughness={0.5} metalness={0.1} />
      </mesh>
      {/* Pernas */}
      {([[-0.88, -0.42], [0.88, -0.42], [-0.88, 0.42], [0.88, 0.42]] as [number,number][]).map(([px, pz], i) => (
        <mesh key={i} position={[px, 0.37, pz]}>
          <boxGeometry args={[0.06, 0.74, 0.06]} />
          <meshStandardMaterial color="#0d1a0d" metalness={0.6} />
        </mesh>
      ))}

      {/* Monitor principal — tela com gráfico */}
      <group position={[0, 1.55, -0.35]}>
        {/* Carcaça */}
        <mesh>
          <boxGeometry args={[1.18, 0.72, 0.07]} />
          <meshStandardMaterial color="#111" />
        </mesh>
        {/* Tela de fundo escuro */}
        <mesh position={[0, 0, 0.042]}>
          <boxGeometry args={[1.12, 0.66, 0.02]} />
          <meshStandardMaterial color="#030e05" emissive="#001a05" emissiveIntensity={0.5} />
        </mesh>

        {/* Grid lines na tela */}
        {[0.12, 0, -0.12].map((dy, i) => (
          <mesh key={i} position={[0, dy, 0.055]}>
            <boxGeometry args={[1.0, 0.004, 0.003]} />
            <meshStandardMaterial color="#1a3a1a" emissive="#1a3a1a" emissiveIntensity={0.4} />
          </mesh>
        ))}

        {/* Candles 3D na tela */}
        <group ref={candleRef} position={[-SCREEN_W / 2 + candleW, 0, 0.058]}>
          {candles.map(([o, h, l, c], i) => {
            const bull = c >= o;
            const color = bull ? "#22c55e" : "#ef4444";
            const bodyBot = Math.min(o, c);
            const bodyTop = Math.max(o, c);
            const bodyH = Math.max(0.008, (bodyTop - bodyBot) * SCREEN_H * 0.85);
            const bodyY = (bodyBot + (bodyTop - bodyBot) / 2 - 0.5) * SCREEN_H * 0.85;
            const wickH = (h - l) * SCREEN_H * 0.85;
            const wickY = (l + (h - l) / 2 - 0.5) * SCREEN_H * 0.85;
            return (
              <group key={i} position={[i * candleW, 0, 0]}>
                {/* Pavio */}
                <mesh position={[0, wickY, 0]}>
                  <boxGeometry args={[0.003, wickH, 0.003]} />
                  <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.25} />
                </mesh>
                {/* Corpo */}
                <mesh position={[0, bodyY, 0]}>
                  <boxGeometry args={[candleW * 0.55, bodyH, 0.003]} />
                  <meshStandardMaterial
                    color={bull ? color : "#0a0a0a"}
                    emissive={color}
                    emissiveIntensity={0.25}
                  />
                </mesh>
              </group>
            );
          })}
        </group>

        {/* Linha de preço em destaque (verde) */}
        <mesh position={[0.08, 0.14, 0.056]}>
          <boxGeometry args={[0.9, 0.003, 0.003]} />
          <meshStandardMaterial color="#22c55e" emissive="#22c55e" emissiveIntensity={0.8} />
        </mesh>

        {/* Haste + base do monitor */}
        <mesh position={[0, -0.42, -0.06]}>
          <cylinderGeometry args={[0.03, 0.03, 0.28, 6]} />
          <meshStandardMaterial color="#444" metalness={0.8} />
        </mesh>
        <mesh position={[0, -0.58, -0.06]}>
          <boxGeometry args={[0.32, 0.04, 0.24]} />
          <meshStandardMaterial color="#333" metalness={0.7} />
        </mesh>
      </group>

      {/* Monitor secundário — métricas */}
      <group position={[0.82, 1.52, -0.32]} rotation={[0, -0.3, 0]}>
        <mesh>
          <boxGeometry args={[0.72, 0.46, 0.05]} />
          <meshStandardMaterial color="#111" />
        </mesh>
        <mesh position={[0, 0, 0.03]}>
          <boxGeometry args={[0.68, 0.42, 0.02]} />
          <meshStandardMaterial color="#030e05" emissive="#003a10" emissiveIntensity={0.4} />
        </mesh>
        {/* Linhas de texto simuladas */}
        {[0.12, 0.04, -0.04, -0.12].map((dy, i) => (
          <mesh key={i} position={[i % 2 === 0 ? 0.05 : 0, dy, 0.04]}>
            <boxGeometry args={[0.45 + (i % 3) * 0.06, 0.018, 0.003]} />
            <meshStandardMaterial
              color={i === 0 ? "#22c55e" : i === 1 ? "#ef4444" : "#60a5fa"}
              emissive={i === 0 ? "#22c55e" : i === 1 ? "#ef4444" : "#60a5fa"}
              emissiveIntensity={0.5}
            />
          </mesh>
        ))}
        <mesh position={[0, -0.28, -0.04]}>
          <cylinderGeometry args={[0.022, 0.022, 0.2, 5]} />
          <meshStandardMaterial color="#444" metalness={0.8} />
        </mesh>
      </group>

      {/* Monitor esquerdo — order book */}
      <group position={[-0.82, 1.52, -0.32]} rotation={[0, 0.3, 0]}>
        <mesh>
          <boxGeometry args={[0.72, 0.46, 0.05]} />
          <meshStandardMaterial color="#111" />
        </mesh>
        <mesh position={[0, 0, 0.03]}>
          <boxGeometry args={[0.68, 0.42, 0.02]} />
          <meshStandardMaterial color="#030810" emissive="#00103a" emissiveIntensity={0.4} />
        </mesh>
        {[0.12, 0.04, -0.04, -0.12].map((dy, i) => (
          <mesh key={i} position={[0, dy, 0.04]}>
            <boxGeometry args={[0.5, 0.016, 0.003]} />
            <meshStandardMaterial
              color={i < 2 ? "#22c55e" : "#ef4444"}
              emissive={i < 2 ? "#22c55e" : "#ef4444"}
              emissiveIntensity={0.4}
            />
          </mesh>
        ))}
        <mesh position={[0, -0.28, -0.04]}>
          <cylinderGeometry args={[0.022, 0.022, 0.2, 5]} />
          <meshStandardMaterial color="#444" metalness={0.8} />
        </mesh>
      </group>

      {/* Teclado */}
      <mesh position={[0, 0.79, 0.18]}>
        <boxGeometry args={[0.72, 0.025, 0.24]} />
        <meshStandardMaterial color="#1a1a1a" />
      </mesh>
      {Array.from({ length: 30 }, (_, i) => (
        <mesh key={i} position={[-0.3 + (i % 10) * 0.067, 0.806, 0.1 + Math.floor(i / 10) * 0.076]}>
          <boxGeometry args={[0.055, 0.007, 0.06]} />
          <meshStandardMaterial color="#222" />
        </mesh>
      ))}

      {/* Mousepad verde */}
      <mesh position={[0.6, 0.782, 0.22]}>
        <boxGeometry args={[0.28, 0.004, 0.22]} />
        <meshStandardMaterial color="#0a2010" />
      </mesh>
      <mesh position={[0.6, 0.79, 0.22]}>
        <boxGeometry args={[0.09, 0.012, 0.14]} />
        <meshStandardMaterial color={accent} roughness={0.7} />
      </mesh>

      {/* Xícara de café */}
      <group position={[-0.72, 0.83, 0.24]}>
        <mesh>
          <cylinderGeometry args={[0.038, 0.03, 0.055, 8]} />
          <meshStandardMaterial color="#f0f0f0" />
        </mesh>
        <mesh position={[0.048, 0.005, 0]} rotation={[0, 0, Math.PI / 2]}>
          <torusGeometry args={[0.022, 0.007, 4, 8]} />
          <meshStandardMaterial color="#f0f0f0" />
        </mesh>
      </group>

      {/* LED strip na borda da mesa */}
      <mesh position={[0, 0.792, 0.49]}>
        <boxGeometry args={[1.94, 0.008, 0.01]} />
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.9} />
      </mesh>
    </group>
  );
}

// ─── Mesa oval de reunião ─────────────────────────────────────────────────────

function OvalMeetingTable() {
  return (
    <group>
      {/* Tampo oval — cylinder escalado no eixo X */}
      <group scale={[1.7, 1, 0.85]}>
        <mesh position={[0, 0.44, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[1.65, 1.65, 0.07, 40]} />
          <meshStandardMaterial color="#7a5c20" roughness={0.28} metalness={0.06} />
        </mesh>
      </group>
      {/* Suporte central em X */}
      {([[2.1, 0], [-2.1, 0], [0, 1.0], [0, -1.0]] as [number, number][]).map(([lx, lz], i) => (
        <mesh key={i} position={[lx * 0.45, 0.22, lz * 0.45]}>
          <cylinderGeometry args={[0.055, 0.07, 0.44, 6]} />
          <meshStandardMaterial color="#5a3a1a" metalness={0.35} roughness={0.4} />
        </mesh>
      ))}
      {/* Base horizontal */}
      <mesh position={[0, 0.03, 0]}>
        <boxGeometry args={[2.8, 0.05, 0.14]} />
        <meshStandardMaterial color="#5a3a1a" metalness={0.35} />
      </mesh>
      <mesh position={[0, 0.03, 0]} rotation={[0, Math.PI / 2, 0]}>
        <boxGeometry args={[1.4, 0.05, 0.14]} />
        <meshStandardMaterial color="#5a3a1a" metalness={0.35} />
      </mesh>
    </group>
  );
}

// ─── Texto 3D local (canvas) ───────────────────────────────────────────────────

function CanvasLabel({
  text, position, height, maxWidth, color = "#26231f",
}: {
  text: string; position: [number, number, number]; height: number; maxWidth: number; color?: string;
}) {
  const { tex, aspect } = useMemo(() => labelTexture(text, { color }), [text, color]);
  let w = height * aspect;
  let h = height;
  if (w > maxWidth) { h *= maxWidth / w; w = maxWidth; }
  return (
    <mesh position={position}>
      <planeGeometry args={[w, h]} />
      <meshBasicMaterial map={tex} transparent toneMapped={false} depthWrite={false} />
    </mesh>
  );
}

// ─── Placa de departamento (com nome, na parede do fundo) ───────────────────────

function WallSign({ name, accent, dark = false }: { name: string; accent: string; dark?: boolean }) {
  const halfD = ROOM_D / 2;
  const w = Math.min(ROOM_W - 3, 0.9 + name.length * 0.17);
  return (
    <group position={[0, WALL_H - 0.42, -halfD + WALL_T / 2 + 0.03]}>
      <mesh castShadow>
        <boxGeometry args={[w, 0.46, 0.04]} />
        <meshStandardMaterial color={dark ? "#1f2a22" : "#f8f6f1"} roughness={0.6} />
      </mesh>
      <mesh position={[-w / 2 + 0.1, 0, 0.025]}>
        <boxGeometry args={[0.06, 0.34, 0.01]} />
        <meshBasicMaterial color={accent} toneMapped={false} />
      </mesh>
      <CanvasLabel text={name} position={[0.05, 0, 0.026]} height={0.3} maxWidth={w - 0.3}
        color={dark ? "#e8f5e9" : "#2d2a26"} />
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

// ─── Sistema de movimento: rotas por pontos de passagem (office3d/navigation) ─
//
// O agente tem sempre um lugar "de verdade" (`where`): na cadeira, na faixa
// livre da frente da sala (à toa) ou numa cadeira da sala de reunião. Toda
// troca de lugar é uma rota montada por navigation.ts, que só usa trechos
// que existem na planta (corredor entre mesas → frente da sala → porta →
// passeio → corredor vertical → ...). Uma mudança de status durante uma
// caminhada espera o agente chegar ao destino atual — nunca "teleporta" nem
// corta caminho atravessando parede.

type Where = "seat" | "front" | "meeting";

interface AgentNav {
  seat: Seat;
  room: RoomNav;
}

/** Recado de mediador (SectorMessage respondida): rota porta a porta + o que ele carrega em cada trecho. */
interface Errand {
  key: string;
  route: Pt[];        // do lado de fora da porta do agente, porta a porta, de volta pra fora da porta dele
  stopAt: number[];   // índices em `route` onde ele entra na sala e espera
  /** O que carrega ANTES da 1ª parada, entre paradas e depois da última (length = stopAt.length + 1). */
  legs: Array<{ color: string; label: string } | null>;
}

interface MeetingRoute {
  key: string;        // muda quando a cadeira/sala muda
  toSeat: Pt[];       // do lado de fora da porta do agente até a cadeira da reunião
  fromSeat: Pt[];     // da cadeira da reunião até o lado de fora da porta do agente
}

type MovState = {
  pos: THREE.Vector3;
  waypoints: THREE.Vector3[];
  wpIdx: number;
  isMoving: boolean;
  walkPhase: number;
  facingAngle: number;
  idleTimer: number;
  where: Where;
  dest: Where;
  exitFromMeeting: Pt[] | null;
  // recado em andamento (índices já deslocados pro array de waypoints)
  errandKey: string | null;
  errandStops: number[];
  errandLegs: Errand["legs"];
  dwell: number;
};

const ERRAND_DWELL_S = 1.2;

const toVecs = (pts: Pt[]) => pts.map(([x, z]) => new THREE.Vector3(x, 0, z));

// ─── Avatar voxel ─────────────────────────────────────────────────────────────

function AgentAvatar3D({
  agent,
  nav,
  meeting,
  meetingCenter,
  errand,
  onErrandDone,
  pendingApprovals,
  onOpenApprovals,
  onSelect,
}: {
  agent: OfficeAgent;
  nav: AgentNav;
  meeting: MeetingRoute | null;
  meetingCenter: [number, number];
  errand: Errand | null;
  onErrandDone: (key: string) => void;
  /** Aprovações humanas pendentes deste agente (PendingApproval). */
  pendingApprovals: number;
  onOpenApprovals?: (agentId: number) => void;
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

  // Geometrias fundidas, cacheadas por combinação de cores (vários agentes
  // com a mesma roupa/pele/cabelo dividem a mesma geometria).
  const legGeo = useMemo(() => mergedGeometry("avatar-leg", () => [
    { geo: box(0.13, 0.46, 0.14), color: "#1e3a5f" },
    { geo: box(0.13, 0.09, 0.2), pos: [0, -0.27, 0.04], color: "#111111" },
  ]), []);
  const armGeo = useMemo(() => mergedGeometry(`avatar-arm:${shirt}:${skin}`, () => [
    { geo: box(0.12, 0.44, 0.18), color: shirt },
    { geo: box(0.1, 0.1, 0.1), pos: [0, -0.26, 0], color: skin },
  ]), [shirt, skin]);
  const bodyGeo = useMemo(() => mergedGeometry(`avatar-body:${shirt}:${skin}:${hair}`, () => [
    { geo: box(0.4, 0.5, 0.24), pos: [0, 0.74, 0], color: shirt },
    { geo: box(0.12, 0.12, 0.12), pos: [0, 1.06, 0], color: skin },
    { geo: box(0.36, 0.32, 0.32), pos: [0, 1.32, 0], color: skin },
    { geo: box(0.38, 0.1, 0.34), pos: [0, 1.5, 0], color: hair },
    { geo: box(0.38, 0.26, 0.06), pos: [0, 1.42, -0.17], color: hair },
    { geo: box(0.07, 0.06, 0.01), pos: [-0.1, 1.33, 0.165], color: "#1a1a2e" },
    { geo: box(0.07, 0.06, 0.01), pos: [0.1, 1.33, 0.165], color: "#1a1a2e" },
  ]), [shirt, skin, hair]);

  const movRef = useRef<MovState>({
    pos: new THREE.Vector3(nav.seat.pos[0], 0, nav.seat.pos[1]),
    waypoints: [],
    wpIdx: 0,
    isMoving: false,
    walkPhase: Math.random() * Math.PI * 2,
    facingAngle: Math.PI,
    idleTimer: 4 + Math.random() * 8,
    where: "seat",
    dest: "seat",
    exitFromMeeting: null,
    errandKey: null,
    errandStops: [],
    errandLegs: [],
    dwell: 0,
  });
  // O que está carregando agora (muda só na troca de trecho — setState raro)
  const [carry, setCarry] = useState<{ color: string; label: string } | null>(null);
  const carryRef = useRef<{ color: string; label: string } | null>(null);

  const go = (mv: MovState, pts: Pt[], dest: Where) => {
    mv.waypoints = toVecs(pts);
    mv.wpIdx = 0;
    mv.isMoving = mv.waypoints.length > 0;
    mv.dest = dest;
    if (!mv.isMoving) mv.where = dest;
  };

  useFrame((_, delta) => {
    const g = groupRef.current;
    const mv = movRef.current;
    if (!g) return;
    const status = agent.status;
    const { seat, room } = nav;

    // 0) Recado terminado (chegou de volta na mesa): libera o próximo da fila
    if (!mv.isMoving && mv.errandKey) {
      const done = mv.errandKey;
      mv.errandKey = null;
      mv.errandStops = [];
      onErrandDone(done);
    }

    // 1) Decide a próxima rota — só quando parado (termina a caminhada atual antes)
    if (!mv.isMoving) {
      const wantsMeeting = status === "meeting" && meeting !== null;
      if (errand && mv.where !== "meeting" && !wantsMeeting) {
        // Recado: sai da sala, vai porta a porta, volta pra mesa
        const out = mv.where === "seat"
          ? [...seatToFront(seat, room, room.cx), room.inside, room.outside]
          : frontToOutside(room);
        go(mv, [...out, ...errand.route, ...outsideToFront(room), ...frontToSeat(seat, room)], "seat");
        mv.errandKey = errand.key;
        mv.errandStops = errand.stopAt.map((i) => i + out.length);
        mv.errandLegs = errand.legs;
      } else if (wantsMeeting && mv.where !== "meeting") {
        const out = mv.where === "seat"
          ? [...seatToFront(seat, room, room.cx), room.inside, room.outside]
          : frontToOutside(room);
        mv.exitFromMeeting = meeting.fromSeat;
        go(mv, [...out, ...meeting.toSeat], "meeting");
      } else if (!wantsMeeting && mv.where === "meeting") {
        go(mv, [...(mv.exitFromMeeting ?? []), ...outsideToFront(room), ...frontToSeat(seat, room)], "seat");
      } else if (status !== "idle" && mv.where === "front") {
        // Recebeu trabalho (ou pausou) enquanto estava à toa: volta pra mesa
        go(mv, frontToSeat(seat, room), "seat");
      } else if (mv.where === "seat") {
        const dx = mv.pos.x - seat.pos[0], dz = mv.pos.z - seat.pos[1];
        if (dx * dx + dz * dz > 0.01) {
          // A mesa mudou de lugar (entrou/saiu agente no setor): vai pela faixa da frente
          go(mv, [[mv.pos.x, room.frontZ], ...frontToSeat(seat, room)], "seat");
        } else if (status === "idle") {
          mv.idleTimer -= delta;
          if (mv.idleTimer <= 0) {
            const x = room.cx + IDLE_X_RANGE[0] + Math.random() * (IDLE_X_RANGE[1] - IDLE_X_RANGE[0]);
            go(mv, seatToFront(seat, room, x), "front");
            mv.idleTimer = 3 + Math.random() * 5;
          }
        }
      } else if (mv.where === "front" && status === "idle") {
        mv.idleTimer -= delta;
        if (mv.idleTimer <= 0) {
          if (Math.random() < 0.45) {
            go(mv, frontToSeat(seat, room), "seat");
            mv.idleTimer = 6 + Math.random() * 10;
          } else {
            const x = room.cx + IDLE_X_RANGE[0] + Math.random() * (IDLE_X_RANGE[1] - IDLE_X_RANGE[0]);
            go(mv, [[x, room.frontZ]], "front");
            mv.idleTimer = 2 + Math.random() * 4;
          }
        }
      }
    }

    // Envelope carregado: qual trecho do recado ele está percorrendo
    // (uma parada só conta como "feita" depois da espera dentro da porta — é ali que ele entrega/recebe)
    const legIdx = mv.errandKey
      ? mv.errandStops.filter((i) => mv.wpIdx > i + 1 || (mv.wpIdx === i + 1 && mv.dwell <= 0)).length
      : -1;
    const nextCarry = mv.errandKey ? (mv.errandLegs[legIdx] ?? null) : null;
    if (nextCarry !== carryRef.current) {
      carryRef.current = nextCarry;
      setCarry(nextCarry);
    }

    // 2) Anda até o próximo ponto (esperando um instante dentro da porta de cada parada)
    if (mv.dwell > 0) {
      mv.dwell -= delta;
    } else if (mv.isMoving) {
      const wp = mv.waypoints[mv.wpIdx];
      if (!wp) {
        mv.isMoving = false;
        mv.where = mv.dest;
      } else {
        const dir = wp.clone().sub(mv.pos);
        dir.y = 0;
        const dist = dir.length();
        if (dist < ARRIVAL_THRESHOLD) {
          mv.pos.copy(wp);
          if (mv.errandStops.includes(mv.wpIdx)) mv.dwell = ERRAND_DWELL_S;
          mv.wpIdx++;
          if (mv.wpIdx >= mv.waypoints.length) {
            mv.isMoving = false;
            mv.walkPhase = 0;
            mv.where = mv.dest;
          }
        } else {
          const step = Math.min(WALK_SPEED * delta, dist);
          dir.normalize();
          mv.pos.addScaledVector(dir, step);
          mv.facingAngle = Math.atan2(dir.x, dir.z);
          mv.walkPhase += delta * 7;
        }
      }
    }

    // Publica posição mundial para animação de portas
    agentPosR.current[agent.id] = mv.pos;

    const sit = !mv.isMoving && (mv.where === "seat" || mv.where === "meeting");
    g.position.set(mv.pos.x, sit ? 0.04 : 0, mv.pos.z);
    if (mv.isMoving) {
      g.rotation.y = mv.facingAngle;
    } else {
      // Sentado: de frente pro monitor (parede do fundo) ou pro centro da mesa de reunião.
      // Na faixa da frente (à toa): de frente pra câmera, "olhando o escritório".
      const target = mv.where === "meeting"
        ? Math.atan2(meetingCenter[0] - mv.pos.x, meetingCenter[1] - mv.pos.z)
        : mv.where === "seat" ? Math.PI : 0.6;
      let diff = target - g.rotation.y;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      g.rotation.y += diff * Math.min(1, delta * 8);
    }

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
  const isLead = agent.isOrchestrator || agent.access_level === "ceo";

  return (
    <group
      ref={groupRef}
      position={[nav.seat.pos[0], 0, nav.seat.pos[1]]}
      onClick={(e) => { e.stopPropagation(); onSelect(agent); }}
    >
      {/* Sombra e anel de status ficam fora do grupo escalado */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <circleGeometry args={[0.16, 16]} />
        <meshBasicMaterial color="#000" transparent opacity={0.14} depthWrite={false} />
      </mesh>
      <StatusRing color={statusColor} isWorking={isWorking} />

      {/* Corpo do agente escalado a 0.65× para ficar proporcional aos móveis.
          Pernas e braços continuam grupos separados (são animados), mas cada
          um é 1 mesh fundido; tronco+pescoço+cabeça+cabelo+olhos viram 1. */}
      <group scale={[0.65, 0.65, 0.65]}>
        <group ref={leftLegRef} position={[-0.09, 0.38, 0]}>
          <mesh geometry={legGeo} material={mergedMaterial} />
        </group>
        <group ref={rightLegRef} position={[0.09, 0.38, 0]}>
          <mesh geometry={legGeo} material={mergedMaterial} />
        </group>
        <mesh geometry={bodyGeo} material={mergedMaterial} castShadow />
        <group ref={leftArmRef} position={[-0.27, 0.76, 0]}>
          <mesh geometry={armGeo} material={mergedMaterial} />
        </group>
        <group ref={rightArmRef} position={[0.27, 0.76, 0]}>
          <mesh geometry={armGeo} material={mergedMaterial} />
        </group>
      </group>

      {/* Ação bloqueada pela política esperando decisão humana */}
      {pendingApprovals > 0 && (
        <Html center distanceFactor={LABEL_DF} zIndexRange={[13, 12]} position={[0, 1.95, 0]} style={{ userSelect: "none" }}>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onOpenApprovals?.(agent.id); }}
            title="Ação bloqueada pela política de autonomia — clique para aprovar ou rejeitar"
            style={{
              display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap", cursor: "pointer",
              background: "#fff7ed", color: "#c2410c", border: "1.5px solid #fb923c", borderRadius: 999,
              padding: "2px 8px", fontSize: "10px", fontWeight: 700, boxShadow: "0 2px 8px rgba(251,146,60,0.35)",
            }}
          >
            ⚠ {pendingApprovals} {pendingApprovals === 1 ? "aprovação" : "aprovações"}
          </button>
        </Html>
      )}

      {/* Envelope carregado durante o recado de mediação */}
      {carry && (
        <group position={[0.32, 1.05, 0]} rotation={[0, 0.6, -0.25]} scale={0.42}>
          <EnvelopeMesh flap={carry.color} />
        </group>
      )}

      {/* Labels fora do grupo escalado, posições ajustadas para 0.65× */}
      <Html center distanceFactor={LABEL_DF} zIndexRange={[6, 0]} position={[0, 1.3, 0]} className="office-agent-label" style={{ pointerEvents: "none", userSelect: "none" }}>
        <div style={{ display: "flex", flexDirection: "column-reverse", alignItems: "center", gap: 3, transform: "translateY(-30%)" }}>
          <div style={{
            background: "rgba(255,255,255,0.96)", color: "#26231f", fontSize: "10px",
            fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase",
            padding: "2px 8px", borderRadius: "999px", whiteSpace: "nowrap",
            border: `1.5px solid ${statusColor}`, boxShadow: "0 2px 6px rgba(0,0,0,0.12)",
          }}>
            {isLead && <span style={{ color: "#d97706", marginRight: 4 }}>★</span>}
            {shortName}
          </div>
          {carry && (
            <div style={{
              background: "rgba(255,255,255,0.96)", color: carry.color, fontSize: "9px", fontWeight: 600,
              padding: "1px 6px", borderRadius: "999px", whiteSpace: "nowrap",
              border: `1px solid ${carry.color}`,
            }}>
              ✉ {carry.label}
            </div>
          )}
          {isWorking && agent.currentTask !== "Sem tarefa ativa" && (
            <div style={{
              background: "rgba(236,253,245,0.96)", color: "#047857", fontSize: "9px",
              padding: "1px 6px", borderRadius: "999px", whiteSpace: "nowrap",
              maxWidth: "130px", overflow: "hidden", textOverflow: "ellipsis",
              border: "1px solid rgba(16,185,129,0.45)",
            }}>
              {agent.currentTask.length > 24 ? agent.currentTask.slice(0, 24) + "…" : agent.currentTask}
            </div>
          )}
        </div>
      </Html>

      {agent.status === "thinking" && (
        <Html center distanceFactor={LABEL_DF} zIndexRange={[6, 0]} position={[0.28, 1.08, 0]} style={{ pointerEvents: "none" }}>
          <span style={{ fontSize: "13px" }}>💭</span>
        </Html>
      )}
    </group>
  );
}

// ─── Corredor visual ───────────────────────────────────────────────────────────

function WalkwaySlab({ x, z, w, d, color = "#e4ddd0" }: { x: number; z: number; w: number; d: number; color?: string }) {
  return (
    <group position={[x, 0, z]}>
      {/* Topo levemente abaixo das salas (degrau visual), sem deixar os agentes "flutuando" */}
      <mesh position={[0, -SLAB_H / 2 - 0.02, 0]} receiveShadow castShadow>
        <boxGeometry args={[w, SLAB_H - 0.04, d]} />
        <meshStandardMaterial color="#cbc3b4" roughness={0.9} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.035, 0]} receiveShadow>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial color={color} roughness={0.85} />
      </mesh>
    </group>
  );
}

function CorridorFloor({ corrZ, gridW }: { corrZ: number; gridW: number }) {
  return (
    <group>
      <WalkwaySlab x={gridW / 2 - ROOM_W / 2} z={corrZ} w={gridW + ROOM_GAP_X * 2} d={CORRIDOR_D} />
      {/* Faixa-guia central */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[gridW / 2 - ROOM_W / 2, -0.03, corrZ]}>
        <planeGeometry args={[gridW + ROOM_GAP_X * 2 - 1, 0.07]} />
        <meshBasicMaterial color="#b9ae9a" transparent opacity={0.7} />
      </mesh>
    </group>
  );
}

// ─── Mesas por agente ─────────────────────────────────────────────────────────

type DeskSpec = {
  agentId: number;
  name: string;
  x: number;       // local à sala
  z: number;
  active: boolean;
  lead: boolean;
};

function DeskNameplate({ name, lead, accent }: { name: string; lead: boolean; accent: string }) {
  const label = (lead ? "★ " : "") + name.toUpperCase();
  const w = Math.min(1.4, 0.35 + label.length * 0.07);
  // Plaquinha + faixa na cor do setor fundidas; o texto (canvas) fica à parte
  const geo = useMemo(() => mergedGeometry(`plate:${w.toFixed(2)}:${lead}:${accent}`, () => [
    { geo: box(w, 0.2, 0.02), color: lead ? "#fff7e0" : "#fbfaf7" },
    { geo: box(w, 0.02, 0.005), pos: [0, -0.1, 0.012], color: accent },
  ]), [w, lead, accent]);
  return (
    <group position={[0, 0.62, 0.47]}>
      <mesh geometry={geo} material={mergedMaterial} />
      <CanvasLabel text={label} position={[0, 0, 0.012]} height={0.13} maxWidth={1.3} />
    </group>
  );
}

// ─── Sala de setor (agentes renderizados à parte; mesas vêm por prop) ─────────

const FLOOR_PATTERN: Record<string, FloorPattern> = {
  tech: "tile", design: "carpet", payment: "carpet", control: "carpet",
  ceo: "wood", meeting: "wood", mercado: "tile", generic: "tile",
};

const SCREEN_KIND: Record<string, ScreenKind> = {
  tech: "code", design: "design", payment: "chart", control: "chart",
  ceo: "exec", meeting: "exec", mercado: "chart", generic: "code",
};

function Room({
  sector,
  index,
  cols,
  isMeetingRoom = false,
  desks,
  onRoomClick,
}: {
  sector: Sector;
  index: number;
  cols: number;
  isMeetingRoom?: boolean;
  desks: DeskSpec[];
  onRoomClick: (id: number, name: string) => void;
}) {
  const [cx, cz] = roomCenter(index, cols);
  const type = isMeetingRoom ? "meeting" : inferRoomType(sector.name);
  const palette = roomPalette(type, index);

  const halfW = ROOM_W / 2;
  const halfD = ROOM_D / 2;


  const floorColor = getRoomFloor(type);
  const floorTex = useMemo(
    () => floorTexture(floorColor, FLOOR_PATTERN[type] ?? "tile", [ROOM_W / 1.5, ROOM_D / 1.5]),
    [floorColor, type],
  );
  const { width: deskW } = deskLayout(desks.length);
  const screenKind = SCREEN_KIND[type] ?? "code";
  const frontSegW = halfW - DOOR_W / 2;
  const CAP = "#bdb5a6";

  return (
    <group position={[cx, 0, cz]}>
      {/* Laje elevada — dá o efeito de "maquete" da planta isométrica */}
      <mesh position={[0, -SLAB_H / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[ROOM_W, SLAB_H, ROOM_D]} />
        <meshStandardMaterial color="#d6cfc2" roughness={0.9} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]} receiveShadow
        onClick={(e) => { e.stopPropagation(); onRoomClick(sector.id, sector.name); }}
        onPointerOver={() => { document.body.style.cursor = "pointer"; }}
        onPointerOut={() => { document.body.style.cursor = ""; }}>
        <planeGeometry args={[ROOM_W, ROOM_D]} />
        <meshStandardMaterial map={floorTex} roughness={0.85} />
      </mesh>

      {/* Parede do fundo — altura cheia */}
      <mesh position={[0, WALL_H / 2, -halfD]} castShadow receiveShadow>
        <boxGeometry args={[ROOM_W, WALL_H, WALL_T]} />
        <meshStandardMaterial color={palette.wall} />
      </mesh>
      <mesh position={[0, WALL_H + 0.03, -halfD]}>
        <boxGeometry args={[ROOM_W + 0.02, 0.06, WALL_T + 0.04]} />
        <meshStandardMaterial color={CAP} />
      </mesh>

      {/* Parede esquerda — altura cheia (cada sala é um bloco; entre colunas há corredor) */}
      <mesh position={[-halfW, WALL_H / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[WALL_T, WALL_H, ROOM_D]} />
        <meshStandardMaterial color={palette.wall} />
      </mesh>
      <mesh position={[-halfW, WALL_H + 0.03, 0]}>
        <boxGeometry args={[WALL_T + 0.04, 0.06, ROOM_D + 0.02]} />
        <meshStandardMaterial color={CAP} />
      </mesh>

      {/* Parede direita em corte (baixa) — deixa ver dentro com a câmera isométrica */}
      <mesh position={[halfW, FRONT_WALL_H / 2, 0]} castShadow>
        <boxGeometry args={[WALL_T, FRONT_WALL_H, ROOM_D]} />
        <meshStandardMaterial color={palette.wall} />
      </mesh>

      {/* Parede da frente em corte, com vão da porta */}
      <mesh position={[-(halfW - frontSegW / 2), FRONT_WALL_H / 2, halfD]} castShadow>
        <boxGeometry args={[frontSegW, FRONT_WALL_H, WALL_T]} />
        <meshStandardMaterial color={palette.wall} />
      </mesh>
      <mesh position={[(halfW - frontSegW / 2), FRONT_WALL_H / 2, halfD]} castShadow>
        <boxGeometry args={[frontSegW, FRONT_WALL_H, WALL_T]} />
        <meshStandardMaterial color={palette.wall} />
      </mesh>

      {/* Faixa accent no topo da parede do fundo + rodapé */}
      <mesh position={[0, WALL_H - 0.08, -halfD + WALL_T / 2 + 0.01]}>
        <boxGeometry args={[ROOM_W - WALL_T, 0.1, 0.03]} />
        <meshStandardMaterial color={palette.accent} emissive={palette.accent} emissiveIntensity={0.2} />
      </mesh>
      <mesh position={[0, 0.06, -halfD + WALL_T / 2 + 0.01]}>
        <boxGeometry args={[ROOM_W - WALL_T, 0.12, 0.03]} />
        <meshStandardMaterial color={palette.trim} />
      </mesh>

      <WallSign name={sector.name} accent={palette.accent} dark={type === "ceo"} />

      {/* ─── Mesas: uma por agente ───────────────────────────────────────── */}
      {desks.map((d, i) => (
        <group key={d.agentId}>
          {type === "ceo" && i === 0 ? (
            <ExecutiveDesk x={d.x} z={d.z} />
          ) : type === "mercado" && deskW >= 1.6 ? (
            <TradingDesk x={d.x} z={d.z} accent={i % 3 === 2 ? "#ef4444" : "#22c55e"} />
          ) : (
            <Workstation x={d.x} z={d.z} color={palette.accent} active={d.active}
              kind={screenKind} variant={i} width={type === "ceo" ? 1.4 : deskW} />
          )}
          <PixelChair x={d.x} z={d.z + DESK_SEAT_Z + (type === "ceo" && i === 0 ? 0.5 : 0)}
            color={type === "ceo" ? "#3b2a20" : "#2f3440"} rotation={Math.PI} />
          <group position={[d.x, 0, d.z]}>
            <DeskNameplate name={d.name} lead={d.lead} accent={palette.accent} />
          </group>
        </group>
      ))}

      {/* ─── Decoração por tipo (faixa da frente e paredes) ──────────────── */}

      {type === "ceo" && (
        <>
          <Sofa x={-3.55} z={1.4} rotation={Math.PI / 2} color="#5a3b2e" />
          <CoffeeTable x={-2.4} z={1.4} />
          <Plant x={-3.7} z={-3.3} tall />
          <Plant x={3.8} z={3.3} />
          {/* Quadros na parede */}
          <mesh position={[-2.6, 1.55, -halfD + WALL_T + 0.02]}>
            <boxGeometry args={[1.2, 0.75, 0.03]} />
            <meshStandardMaterial color="#f4f1ea" />
          </mesh>
          <mesh position={[-2.6, 1.55, -halfD + WALL_T + 0.04]}>
            <planeGeometry args={[1.08, 0.63]} />
            <meshBasicMaterial map={screenTexture(palette.accent, "exec", 1)} toneMapped={false} />
          </mesh>
          {/* Capacete no canto da mesa */}
          <mesh position={[2.3, 0.9, -2.0]}>
            <sphereGeometry args={[0.14, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color="#f5c033" roughness={0.4} />
          </mesh>
        </>
      )}

      {type === "meeting" && (
        <>
          <OvalMeetingTable />
          {MEETING_SEATS.map((c, i) => (
            <PixelChair key={i} x={c.x} z={c.z} color="#2f3440" rotation={c.rot} />
          ))}
          {/* Tela de projeção na parede do fundo */}
          <mesh position={[0, 1.35, -halfD + WALL_T + 0.03]}>
            <boxGeometry args={[3.4, 1.1, 0.03]} />
            <meshStandardMaterial color="#1a1d24" />
          </mesh>
          <mesh position={[0, 1.35, -halfD + WALL_T + 0.05]}>
            <planeGeometry args={[3.3, 1.0]} />
            <meshBasicMaterial map={screenTexture(palette.accent, "exec", 2)} toneMapped={false} />
          </mesh>
          <Plant x={3.7} z={3.2} tall />
          <Plant x={-3.7} z={3.2} />
        </>
      )}

      {type === "tech" && (
        <>
          <CoffeeMachine x={-3.2} z={3.3} />
          <Plant x={3.8} z={3.3} tall />
          <ServerRack x={3.9} z={1.4} />
          {/* Quadro técnico na parede */}
          <mesh position={[-3.0, 1.75, -halfD + WALL_T + 0.02]}>
            <boxGeometry args={[1.8, 0.8, 0.03]} />
            <meshStandardMaterial color="#f8f6f1" />
          </mesh>
          <mesh position={[-3.0, 1.75, -halfD + WALL_T + 0.04]}>
            <planeGeometry args={[1.7, 0.7]} />
            <meshBasicMaterial map={screenTexture(palette.accent, "code", 3)} toneMapped={false} />
          </mesh>
        </>
      )}

      {type === "design" && (
        <>
          <DesignTable x={-2.6} z={3.25} color="#f0e8d8" />
          <Whiteboard x={3.0} z={-halfD + WALL_T + 0.1} />
          <Plant x={3.8} z={3.3} tall />
          <mesh position={[1.2, 0.62, 3.1]} castShadow>
            <boxGeometry args={[1.8, 0.06, 0.7]} />
            <meshStandardMaterial color="#e8d8b8" roughness={0.4} />
          </mesh>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <mesh key={i} position={[0.5 + i * 0.28, 0.66, 3.1]}>
              <boxGeometry args={[0.22, 0.02, 0.28]} />
              <meshStandardMaterial color={["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#8b5cf6", "#ec4899"][i]} />
            </mesh>
          ))}
        </>
      )}

      {type === "control" && (
        <>
          <ServerRack x={-3.9} z={2.2} />
          <ServerRack x={-3.9} z={3.0} />
          <ServerRack x={3.9} z={3.0} />
          <Plant x={3.8} z={1.8} />
          {/* Painel de luzes de status na parede */}
          <mesh position={[-2.6, 1.75, -halfD + WALL_T + 0.03]}>
            <boxGeometry args={[2.6, 0.55, 0.04]} />
            <meshStandardMaterial color="#0a0f1a" />
          </mesh>
          {Array.from({ length: 8 }, (_, i) => {
            const c = ["#22c55e", "#22c55e", "#f59e0b", "#22c55e", "#3b82f6", "#22c55e", "#f87171", "#22c55e"][i]!;
            return (
              <mesh key={i} position={[-3.6 + i * 0.28, 1.75, -halfD + WALL_T + 0.06]}>
                <circleGeometry args={[0.07, 10]} />
                <meshBasicMaterial color={c} toneMapped={false} />
              </mesh>
            );
          })}
        </>
      )}

      {type === "payment" && (
        <>
          <Plant x={3.8} z={3.3} />
          <Bookshelf x={2.8} z={3.4} color="#2d4060" />
          {/* Cofre */}
          <mesh position={[-3.6, 0.35, 3.2]} castShadow>
            <boxGeometry args={[0.7, 0.7, 0.6]} />
            <meshStandardMaterial color="#3a3f4a" metalness={0.7} roughness={0.35} />
          </mesh>
          <mesh position={[-3.6, 0.4, 3.51]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.1, 0.1, 0.04, 12]} />
            <meshStandardMaterial color="#c0c0c0" metalness={0.9} />
          </mesh>
        </>
      )}

      {type === "generic" && (
        <>
          <Plant x={3.8} z={3.3} />
          <CoffeeMachine x={-3.2} z={3.3} />
        </>
      )}

      {type === "mercado" && (
        <>
          {/* Telão de mercado na parede do fundo */}
          <mesh position={[-2.7, 1.75, -halfD + WALL_T + 0.03]}>
            <boxGeometry args={[2.6, 0.8, 0.04]} />
            <meshStandardMaterial color="#050e05" />
          </mesh>
          <mesh position={[-2.7, 1.75, -halfD + WALL_T + 0.06]}>
            <planeGeometry args={[2.5, 0.7]} />
            <meshBasicMaterial map={screenTexture("#22c55e", "chart", 3)} toneMapped={false} />
          </mesh>
          <Plant x={3.8} z={3.3} tall />
          <CoffeeMachine x={-3.2} z={3.3} />
        </>
      )}

      <DoorMesh x={0} z={halfD} roomCX={cx} roomCZ={cz} accent={palette.accent} />
    </group>
  );
}

function roomPalette(type: string, index: number) {
  return type === "meeting" ? MEETING_PALETTE
    : type === "ceo" ? CEO_PALETTE
    : ROOM_PALETTES[index % ROOM_PALETTES.length]!;
}

// ─── Piso entre fileiras ──────────────────────────────────────────────────────

function InterRowPassage({ rows, gridW }: { rows: number; gridW: number }) {
  const passages: JSX.Element[] = [];
  for (let r = 1; r < rows; r++) {
    const z = r * (ROOM_D + ROOM_GAP_Z) - ROOM_GAP_Z / 2 - ROOM_D / 2;
    passages.push(
      <WalkwaySlab key={r} x={gridW / 2 - ROOM_W / 2} z={z} w={gridW + ROOM_GAP_X * 2} d={ROOM_GAP_Z} color="#ebe5da" />,
    );
  }
  return <>{passages}</>;
}

/** Corredores verticais (entre colunas e nas bordas) — por onde se troca de fileira. */
function Aisles({ rows, cols, corrZ }: { rows: number; cols: number; corrZ: number }) {
  const top = -ROOM_D / 2;
  const bottom = corrZ - CORRIDOR_D / 2;
  const els: JSX.Element[] = [];
  for (let c = -1; c < cols; c++) {
    const x = c * (ROOM_W + ROOM_GAP_X) + ROOM_W / 2 + ROOM_GAP_X / 2;
    els.push(<WalkwaySlab key={c} x={x} z={(top + bottom) / 2} w={ROOM_GAP_X} d={bottom - top} color="#ebe5da" />);
  }
  return rows > 0 ? <>{els}</> : null;
}

// ─── Componente principal ─────────────────────────────────────────────────────

// Status de Task agrupados como no quadro de tarefas: fazendo / próximas / feitas.
const TASK_DOING: Task["status"][] = ["in_progress"];
const TASK_NEXT:  Task["status"][] = ["created", "adapted", "paused_ceo"];
const TASK_DONE:  Task["status"][] = ["approved"];

export default function CompanyOffice3D() {
  const [sectors,   setSectors]   = useState<Sector[]>([]);
  const [rawAgents, setRawAgents] = useState<Agent[]>([]);
  const [tasks,     setTasks]     = useState<Task[]>([]);
  const [messages,  setMessages]  = useState<SectorMessage[]>([]);
  const [flights,   setFlights]   = useState<Flight[]>([]);
  // Fila de recados por agente mediador (um de cada vez, na ordem em que chegaram)
  const [errands,   setErrands]   = useState<Map<number, Errand[]>>(new Map());
  const [error,   setError]     = useState<string | null>(null);
  const [loading, setLoading]   = useState(true);

  const [activityOpen,   setActivityOpen]   = useState(false);
  const [panelOpen,      setPanelOpen]      = useState(true);
  const [paused,         setPaused]         = useState(false);
  const [autonomySlider, setAutonomySlider] = useState(1); // 0=Baixo 1=Médio 2=Alto
  const [zoom,           setZoom]           = useState(1);
  const [camMode,        setCamMode]        = useState<CamMode>("overview");
  const [homeKey,        setHomeKey]        = useState(0);
  const [showCards,      setShowCards]      = useState(true);
  const [showWires,      setShowWires]      = useState(true);
  const [brainOpen,      setBrainOpen]      = useState(false);
  const [openMessageId,  setOpenMessageId]  = useState<number | null>(null);
  const [approvals,      setApprovals]      = useState<PendingApproval[]>([]);
  // null = fechado; "all" = todas; número = só as daquele agente
  const [approvalsFor,   setApprovalsFor]   = useState<number | "all" | null>(null);
  // Qual IA cada setor usa e se tem credencial (ai-status) + custo do mês
  const [aiStatus,       setAiStatus]       = useState<AIStatus | null>(null);
  const [sectorMetrics,  setSectorMetrics]  = useState<SectorMetric[]>([]);
  // Linha do tempo (replay do dia) — null = ao vivo
  const [replayOn,       setReplayOn]       = useState(false);
  const [timeline,       setTimeline]       = useState<Timeline | null>(null);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError,  setTimelineError]  = useState<string | null>(null);
  const [replayT,        setReplayT]        = useState(0);
  const [replayPlaying,  setReplayPlaying]  = useState(false);
  const [replaySpeed,    setReplaySpeed]    = useState<number>(REPLAY_SPEEDS[1]);
  const [summaryOpen,    setSummaryOpen]    = useState(false);
  // Configurar chave de IA: null = fechado; string = provedor que falta ("" = geral)
  const [aiConfigFor,    setAiConfigFor]    = useState<string | null>(null);

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
        // Tasks só alimentam os KPIs dos cartões — falha aqui não derruba o escritório
        const [t, m, pa, ai, sm] = await Promise.all([
          listTasks().catch(() => null),
          listSectorMessages().catch(() => null),
          listPendingApprovals("pending").catch(() => null),
          getAIStatus().catch(() => null),
          getSectorMetrics().catch(() => null),
        ]);
        if (!cancelled) {
          setSectors(s); setRawAgents(a); setError(null);
          if (t) setTasks(t);
          if (m) setMessages(m);
          if (pa) setApprovals(pa);
          if (ai) setAiStatus(ai);
          if (sm) setSectorMetrics(sm);
        }
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

  const { connected, lastAgentEvent, lastTaskEvent, lastSectorMessageEvent, lastPendingApprovalEvent } = useRealtime();

  // Aprovação criada/decidida em tempo real: só as pendentes ficam na lista
  const upsertApproval = useCallback((p: PendingApproval) => {
    setApprovals((prev) => {
      const rest = prev.filter((x) => x.id !== p.id);
      return p.status === "pending" ? [p, ...rest] : rest;
    });
  }, []);
  useEffect(() => {
    if (lastPendingApprovalEvent) upsertApproval(lastPendingApprovalEvent);
  }, [lastPendingApprovalEvent, upsertApproval]);

  // ─── Linha do tempo (replay) ──────────────────────────────────────────────
  // Em replay a planta mostra o estado calculado a partir dos eventos do dia
  // (office3d/replay.ts); o ao vivo continua chegando por baixo e volta ao
  // sair. Ações que mudam dado (mediar, aprovar) ficam desligadas no replay.
  const loadTimeline = useCallback(async () => {
    setTimelineLoading(true);
    setTimelineError(null);
    try {
      const tl = await getTimeline();
      setTimeline(tl);
      setReplayT(new Date(tl.since).getTime());
    } catch (e) {
      setTimelineError(e instanceof ApiError ? e.message : "Falha ao carregar a linha do tempo.");
    } finally {
      setTimelineLoading(false);
    }
  }, []);

  const replay = useMemo(
    () => (replayOn && timeline ? replayStateAt(timeline.events, replayT) : null),
    [replayOn, timeline, replayT],
  );

  useEffect(() => {
    if (!replayOn || !replayPlaying || !timeline) return;
    const end = new Date(timeline.until).getTime();
    const TICK = 250;
    const iv = setInterval(() => {
      setReplayT((cur) => {
        const next = cur + TICK * replaySpeed;
        if (next >= end) { setReplayPlaying(false); return end; }
        return next;
      });
    }, TICK);
    return () => clearInterval(iv);
  }, [replayOn, replayPlaying, replaySpeed, timeline]);

  const viewMessages = replay ? replay.messages : messages;
  const viewApprovals = replay ? replay.approvals : approvals;
  const viewAgents = useMemo<Agent[]>(
    () => (replay
      ? rawAgents.map((a) => ({
        ...a,
        work_status: replay.working.has(a.id) ? "working" : replay.paused.has(a.id) ? "paused" : "idle",
        current_task: replay.working.get(a.id) ?? "",
      }))
      : rawAgents),
    [rawAgents, replay],
  );

  const approvalsByAgent = useMemo(() => {
    const m = new Map<number, number>();
    for (const p of viewApprovals) m.set(p.agent, (m.get(p.agent) ?? 0) + 1);
    return m;
  }, [viewApprovals]);

  // Setor → status da IA e custo do mês (etiquetas, janela da sala, barra)
  const aiBySector = useMemo(
    () => new Map((aiStatus?.sectors ?? []).map((x) => [x.sector_id, x])),
    [aiStatus],
  );
  const metricBySector = useMemo(
    () => new Map(sectorMetrics.map((m) => [m.sector_id, m])),
    [sectorMetrics],
  );
  const aiProblems = (aiStatus?.sectors ?? []).filter((x) => !x.ready).length;
  const budgetAlerts = sectorMetrics.filter((m) => m.status === "warn" || m.status === "over").length;

  const upsertTask = useCallback((t: Task) => {
    setTasks((prev) => (prev.some((x) => x.id === t.id) ? prev.map((x) => (x.id === t.id ? t : x)) : [t, ...prev]));
  }, []);

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

  useEffect(() => {
    if (!lastSectorMessageEvent) return;
    setMessages((prev) =>
      prev.some((m) => m.id === lastSectorMessageEvent.id)
        ? prev.map((m) => (m.id === lastSectorMessageEvent.id ? lastSectorMessageEvent : m))
        : [lastSectorMessageEvent, ...prev],
    );
  }, [lastSectorMessageEvent]);

  useEffect(() => {
    if (!lastTaskEvent) return;
    setTasks((prev) =>
      prev.some((t) => t.id === lastTaskEvent.id)
        ? prev.map((t) => (t.id === lastTaskEvent.id ? lastTaskEvent : t))
        : [lastTaskEvent, ...prev],
    );
  }, [lastTaskEvent]);

  // Tarefa NOVA pro Desenvolvimento + "abrir automaticamente" ligado: abre o
  // Claude Code num terminal na máquina (devserver). Só tarefa criada agora
  // (evento ao vivo, status created) — nunca as antigas do carregamento — e
  // uma vez por tarefa, mesmo que o evento chegue de novo.
  const autoLaunchedRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    const t = lastTaskEvent;
    if (!t || t.status !== "created" || t.task_type === "generate_page" || autoLaunchedRef.current.has(t.id)) return;
    if (!isClaudeCodeSector(t.sector_name) || !getClaudeAutoOpen()) return;
    autoLaunchedRef.current.add(t.id);
    launchClaudeCode(t, "terminal")
      .then(({ task }) => setTasks((prev) => prev.map((x) => (x.id === task.id ? task : x))))
      .catch((err) => {
        const closed = (err as { task?: Task }).task;
        if (closed) setTasks((prev) => prev.map((x) => (x.id === closed.id ? closed : x)));
      });
  }, [lastTaskEvent]);

  // Quando uma reunião local está ativa, sobrescreve o status dos participantes
  // para "meeting" independentemente do que o backend retorna — sem isso o
  // AgentAvatar3D nunca recebe status=meeting e os agentes não se movem.
  const officeAgents = useMemo<OfficeAgent[]>(
    () => viewAgents.map((a, i) => {
      const agent = toOfficeAgent(a, sectors, i);
      if (meetingAgentIds.has(agent.id) && agent.status !== "meeting") {
        return { ...agent, status: "meeting" as const };
      }
      return agent;
    }),
    [viewAgents, sectors, meetingAgentIds],
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

  // ─── Geometria da cena ─────────────────────────────────────────────────────
  // Layout do grid:
  //   índice 0         → Sala CEO (sempre canto superior esquerdo — paredes verdes)
  //   índices 1..N     → setores reais (cada sector[i] ocupa slot i+1)
  //   índice N+1       → Sala de Reunião
  //   à frente         → corredor + praça do Cérebro
  const CEO_ROOM_INDEX     = 0;
  const totalRooms         = sectors.length + 2; // +1 CEO, +1 Reunião
  const cols               = roomColumns(totalRooms);
  const rows               = Math.ceil(Math.max(totalRooms, 1) / cols);
  const gridW              = cols * (ROOM_W + ROOM_GAP_X) - ROOM_GAP_X;
  const CORR_Z             = corridorZ(rows);

  const meetingRoomIndex   = sectors.length + 1;
  const [meetingCX, meetingCZ] = roomCenter(meetingRoomIndex, cols);

  // Grade de navegação (office3d/navigation.ts) — mesma geometria das salas
  const navGrid = useMemo<NavGrid>(() => ({
    cols, rows, roomW: ROOM_W, roomD: ROOM_D,
    gapX: ROOM_GAP_X, gapZ: ROOM_GAP_Z, corridorZ: CORR_Z, doorW: DOOR_W,
  }), [cols, rows, CORR_Z]);

  // Praça do Cérebro: logo à frente do corredor, centralizada na planta
  const sceneCX  = (cols - 1) * (ROOM_W + ROOM_GAP_X) / 2;
  const brainPos: [number, number] = [sceneCX, CORR_Z + CORRIDOR_D / 2 + 3.2];
  const minZ     = -ROOM_D / 2;
  const maxZ     = brainPos[1] + 2.6;
  const sceneCZ  = (minZ + maxZ) / 2;
  const extent: [number, number] = [gridW + ROOM_GAP_X * 2, maxZ - minZ];

  const meetingAgentList = useMemo(
    () => officeAgents.filter((a) => meetingAgentIds.has(a.id)),
    [officeAgents, meetingAgentIds],
  );

  // Mesas por sala (coordenada local) + casa de cada agente (coordenada mundial).
  // Ordem: CEO, depois orquestradores, depois operacionais — o líder fica na 1ª mesa.
  const { desksByRoom, seatById, roomIdxById } = useMemo(() => {
    const desksByRoom = new Map<number, DeskSpec[]>();
    const seatById = new Map<number, Seat>();
    const roomIdxById = new Map<number, number>();
    const byRoom = new Map<number, OfficeAgent[]>();
    for (const a of officeAgents) {
      const isCeoRoom = a.access_level === "ceo" || a.access_level === "general_orchestrator";
      const sIdx = isCeoRoom ? -1 : sectors.findIndex((s) => s.id === a.sectorId);
      const roomIdx = sIdx >= 0 ? sIdx + 1 : CEO_ROOM_INDEX;
      const list = byRoom.get(roomIdx) ?? [];
      list.push(a);
      byRoom.set(roomIdx, list);
    }
    const rank = (a: OfficeAgent) => (a.access_level === "ceo" ? 0 : a.isOrchestrator ? 1 : 2);
    for (const [roomIdx, list] of byRoom) {
      list.sort((a, b) => rank(a) - rank(b) || a.id - b.id);
      const isCeo = roomIdx === CEO_ROOM_INDEX;
      const layout = deskLayout(list.length);
      const slots = isCeo ? ceoDeskLayout(list.length) : layout.slots;
      const [rcx, rcz] = roomCenter(roomIdx, cols);
      desksByRoom.set(roomIdx, list.map((a, i) => {
        const [x, z] = slots[i] ?? [0, 0];
        const seatZ = DESK_SEAT_Z + (isCeo && i === 0 ? 0.5 : 0);
        const laneLocal = seatLaneLocal(isCeo, i, x, layout.spacingX);
        seatById.set(a.id, { pos: [rcx + x, rcz + z + seatZ], laneX: rcx + laneLocal });
        roomIdxById.set(a.id, roomIdx);
        return {
          agentId: a.id,
          name: a.name.split(" ").slice(0, 2).join(" "),
          x, z,
          active: a.status === "working",
          lead: a.isOrchestrator || a.access_level === "ceo",
        };
      }));
    }
    return { desksByRoom, seatById, roomIdxById };
  }, [officeAgents, sectors, cols]);

  // Rota até a sala de reunião (e de volta) para quem foi convocado
  const meetingRoutes = useMemo(() => {
    const map = new Map<number, MeetingRoute>();
    const mNav = roomNav(navGrid, meetingRoomIndex);
    meetingAgentList.forEach((a, mIdx) => {
      const own = roomNav(navGrid, roomIdxById.get(a.id) ?? CEO_ROOM_INDEX);
      map.set(a.id, {
        key: `${meetingRoomIndex}:${mIdx}`,
        toSeat: [...hallway(navGrid, own, mNav), ...meetingEntry(mNav, mIdx)],
        fromSeat: [...meetingExit(mNav, mIdx), ...hallway(navGrid, mNav, own)],
      });
    });
    return map;
  }, [meetingAgentList, navGrid, meetingRoomIndex, roomIdxById]);

  // ─── Envelopes entre setores (SectorMessage) ───────────────────────────────
  // "Caixa de correio" de cada sala: logo acima da porta, onde o envelope
  // espera / pousa. Sempre visível na câmera isométrica (parede da frente baixa).
  const mailbox = useCallback((roomIdx: number): V3 => {
    const [rcx, rcz] = roomCenter(roomIdx, cols);
    return [rcx, FRONT_WALL_H + 1.1, rcz + ROOM_D / 2 - 0.2];
  }, [cols]);
  const sectorRoomIdx = useCallback((sectorId: number) => {
    const i = sectors.findIndex((s) => s.id === sectorId);
    return i >= 0 ? i + 1 : null;
  }, [sectors]);

  const pendingEnvelopes = useMemo<PendingEnvelope[]>(() => {
    // Fila por porta de origem, mais antiga primeiro (embaixo da pilha)
    const byRoom = new Map<number, SectorMessage[]>();
    for (const m of viewMessages) {
      const from = roomIdxById.get(m.from_agent);
      if (m.status !== "pending" || from == null) continue;
      byRoom.set(from, [...(byRoom.get(from) ?? []), m]);
    }
    const out: PendingEnvelope[] = [];
    for (const [roomIdx, list] of byRoom) {
      list.sort((a, b) => a.created_at.localeCompare(b.created_at));
      list.slice(0, 3).forEach((m, k) => out.push({
        id: m.id,
        at: mailbox(roomIdx),
        label: `→ ${m.to_sector_name}${list.length > 1 ? ` · ${list.length} na fila` : ""}`,
        content: m.content,
        stackIndex: k,
      }));
    }
    return out;
  }, [viewMessages, roomIdxById, mailbox]);

  // Detecta transições pending → answered/rejected e dispara o voo
  const seenStatusRef = useRef<Map<number, string> | null>(null);
  useEffect(() => {
    const first = seenStatusRef.current === null;
    const seen = seenStatusRef.current ?? new Map<number, string>();
    const now = Date.now();
    const newFlights: Flight[] = [];
    const newErrands: Array<[number, Errand]> = [];
    for (const m of viewMessages) {
      const prev = seen.get(m.id);
      seen.set(m.id, m.status);
      const justChanged = prev === "pending" && m.status !== "pending";
      // no primeiro carregamento, só anima o que acabou de acontecer (≤ 20s)
      const fresh = first && m.answered_at != null && now - new Date(m.answered_at).getTime() < 20_000;
      if (!justChanged && !fresh) continue;
      const from = roomIdxById.get(m.from_agent);
      const to = sectorRoomIdx(m.to_sector);
      if (from == null) continue;
      const origin = mailbox(from);
      if (m.status === "rejected" || to == null) {
        const up: V3 = [origin[0], origin[1] + 1.2, origin[2]];
        newFlights.push({
          key: `${m.id}:rejected`, label: "✕ sem mediação", ending: "drop",
          legs: [{ from: origin, to: up, color: ENVELOPE_COLORS.rejected }],
        });
        continue;
      }
      // Quem mediou vai A PÉ: busca na origem, leva ao destino, espera a
      // resposta e traz de volta. Setor nunca fala direto com outro setor —
      // o envelope só se move carregado pelo mediador.
      const mediator = m.relayed_by != null ? officeAgents.find((a) => a.id === m.relayed_by) : undefined;
      const mediatorRoom = m.relayed_by != null ? roomIdxById.get(m.relayed_by) : undefined;
      if (mediator && mediatorRoom != null && mediator.status !== "meeting") {
        const own = roomNav(navGrid, mediatorRoom);
        const originNav = roomNav(navGrid, from);
        const destNav = roomNav(navGrid, to);
        const req = { color: ENVELOPE_COLORS.request, label: `→ ${m.to_sector_name}` };
        const rep = { color: ENVELOPE_COLORS.reply, label: `↩ resposta` };
        // Mediador que já está na sala de origem sai com o envelope na mão
        const startsAtOrigin = mediatorRoom === from;
        const stops = startsAtOrigin ? [destNav, originNav] : [originNav, destNav, originNav];
        const legs = startsAtOrigin ? [req, rep, null] : [null, req, rep, null];
        const { route, stopAt } = errandRoute(navGrid, own, stops);
        newErrands.push([mediator.id, { key: `${m.id}:errand`, route, stopAt, legs }]);
        continue;
      }
      // Mediador fora da planta (ou em reunião): o envelope voa, passando por ele
      const viaIdx = mediatorRoom;
      const stops: V3[] = [origin];
      if (viaIdx != null && viaIdx !== from && viaIdx !== to) stops.push(mailbox(viaIdx));
      stops.push(mailbox(to));
      const legs = stops.slice(1).map((p, i) => ({ from: stops[i]!, to: p, color: ENVELOPE_COLORS.request }));
      const back = [...stops].reverse();
      const replyLegs = back.slice(1).map((p, i) => ({ from: back[i]!, to: p, color: ENVELOPE_COLORS.reply }));
      newFlights.push({
        key: `${m.id}:answered`,
        label: m.relayed_by_name ? `via ${m.relayed_by_name.split(" ")[0]}` : m.to_sector_name,
        legs: [...legs, ...replyLegs],
      });
    }
    seenStatusRef.current = seen;
    if (newFlights.length) {
      setFlights((f) => [...f.filter((x) => !newFlights.some((n) => n.key === x.key)), ...newFlights]);
    }
    if (newErrands.length) {
      setErrands((prev) => {
        const next = new Map(prev);
        for (const [agentId, e] of newErrands) {
          const q = next.get(agentId) ?? [];
          if (!q.some((x) => x.key === e.key)) next.set(agentId, [...q, e]);
        }
        return next;
      });
    }
  // officeAgents/navGrid só são lidos no momento da transição — o `seen`
  // garante que cada mensagem gera um recado/voo uma única vez
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMessages, roomIdxById, sectorRoomIdx, mailbox]);

  const handleErrandDone = useCallback((key: string) => {
    setErrands((prev) => {
      const next = new Map(prev);
      for (const [id, q] of next) {
        if (q[0]?.key === key) {
          if (q.length > 1) next.set(id, q.slice(1)); else next.delete(id);
        }
      }
      return next;
    });
  }, []);

  const handleFlightDone = useCallback((key: string) => {
    setFlights((f) => f.filter((x) => x.key !== key));
  }, []);

  // KPIs reais por setor (agentes + tasks)
  const statsBySector = useMemo(() => {
    const agentSector = new Map<number, number | null>();
    for (const a of officeAgents) agentSector.set(a.id, a.sectorId);
    const map = new Map<number, SectorStats>();
    const get = (id: number) => {
      let st = map.get(id);
      if (!st) { st = { agents: 0, working: 0, paused: 0, doing: 0, next: 0, done: 0 }; map.set(id, st); }
      return st;
    };
    for (const a of officeAgents) {
      const key = a.access_level === "ceo" || a.access_level === "general_orchestrator" ? -2 : (a.sectorId ?? -2);
      const st = get(key);
      st.agents++;
      if (a.status === "working") st.working++;
      if (a.status === "paused") st.paused++;
    }
    for (const t of tasks) {
      const sec = agentSector.get(t.agent);
      const key = sec ?? -2;
      const st = get(key);
      if (TASK_DOING.includes(t.status)) st.doing++;
      else if (TASK_NEXT.includes(t.status)) st.next++;
      else if (TASK_DONE.includes(t.status)) st.done++;
    }
    return map;
  }, [officeAgents, tasks]);

  const brainLinks = useMemo<BrainLink[]>(() => {
    const links: BrainLink[] = [];
    const push = (id: number, idx: number, name: string, connected: boolean) => {
      const [rcx, rcz] = roomCenter(idx, cols);
      const type = inferRoomType(name);
      links.push({
        id,
        to: [rcx, WALL_H + 0.08, rcz - ROOM_D / 2],
        color: roomPalette(type, idx).accent,
        connected,
        working: statsBySector.get(id)?.working ?? 0,
      });
    };
    // Sala CEO = acesso ao cérebro principal inteiro (sem filtro de fonte)
    push(-2, CEO_ROOM_INDEX, "CEO", true);
    sectors.forEach((s, i) => push(s.id, i + 1, s.name, s.knowledge_source != null));
    return links;
  }, [sectors, statsBySector, cols]);

  const sourcesCount = useMemo(
    () => new Set(sectors.map((s) => s.knowledge_source).filter((k) => k != null)).size,
    [sectors],
  );

  const lastBrainActivity = useMemo(() => {
    const w = officeAgents.find((a) => a.status === "working");
    if (!w) return null;
    return `${w.name.split(" ")[0]} · ${w.sectorName}`;
  }, [officeAgents]);

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
    <div className="flex h-full items-center justify-center bg-[#f1eee8]">
      <p className="text-sm text-stone-500">Carregando escritório...</p>
    </div>
  );
  if (error) return (
    <div className="flex h-full items-center justify-center bg-[#f1eee8]">
      <p className="text-sm text-red-500">{error}</p>
    </div>
  );


  const roomEntries: Array<{ key: string | number; sector: Sector; idx: number; meeting?: boolean }> = [
    { key: "ceo", sector: ceoRoomSector, idx: CEO_ROOM_INDEX },
    ...sectors.map((sector, i) => ({ key: sector.id, sector, idx: i + 1 })),
    { key: "meeting", sector: meetingRoomSector, idx: meetingRoomIndex, meeting: true },
  ];

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-[#f1eee8]">
      <OfficeTopBar
        agents={officeAgents} connected={connected} paused={paused}
        autonomySlider={autonomySlider}
        activityOpen={activityOpen} panelOpen={panelOpen}
        onTogglePause={() => setPaused((v) => !v)}
        onAutonomyChange={handleAutonomyChange}
        onCallMeeting={() => setMeetingOpen(true)}
        onEndMeeting={() => setMeetingAgentIds(new Set())}
        onToggleActivity={() => setActivityOpen((v) => !v)}
        onTogglePanel={() => setPanelOpen((v) => !v)}
        onOpenConsole={() => setConsoleOpen(true)}
        pendingApprovals={viewApprovals.length}
        onOpenApprovals={replay ? undefined : () => setApprovalsFor("all")}
        budgetAlerts={budgetAlerts}
        aiProblems={aiProblems}
        replaying={replayOn}
        onOpenSummary={() => setSummaryOpen(true)}
        onOpenAIConfig={() => setAiConfigFor(aiStatus?.sectors.find((x) => !x.ready)?.provider ?? "")}
        onToggleReplay={() => {
          // Troca de modo não anima o que "mudou" entre ao vivo e replay
          seenStatusRef.current = null;
          if (replayOn) { setReplayOn(false); setReplayPlaying(false); return; }
          setReplayOn(true);
          loadTimeline();
        }}
      />

      <div className="relative flex min-h-0 flex-1">
        <ActivityPanel logs={activityLogs} open={activityOpen} onClose={() => setActivityOpen(false)} />

        {/* overflow-hidden: rótulos Html do drei são DOM posicionado — sem isso
            vazam por cima do painel lateral quando o zoom aproxima */}
        <div className="relative min-w-0 flex-1 overflow-hidden" style={{ height: "100%" }}>
          {/* Barra de vista — no TOPO da cena, sempre visível: no Studio o
              container tem altura calc(100vh - 56px) (só o header) e o rodapé
              do canvas pode ficar fora da tela em telas baixas. */}
          <div className="pointer-events-auto absolute left-1/2 top-2 z-20 flex -translate-x-1/2 items-center gap-0.5 rounded-full border border-stone-200 bg-white/95 p-0.5 shadow-sm">
            {(["overview", "topdown", "front"] as CamMode[]).map((m) => (
              <button
                key={m}
                onClick={() => { setCamMode(m); setZoom(1); setHomeKey((k) => k + 1); }}
                className={[
                  "rounded-full px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider transition-colors",
                  camMode === m ? "bg-stone-900 text-white" : "text-stone-500 hover:bg-stone-100 hover:text-stone-800",
                ].join(" ")}
              >
                {m === "overview" ? "Isométrica" : m === "topdown" ? "Planta" : "Frontal"}
              </button>
            ))}
            <span className="mx-1 h-4 w-px bg-stone-200" />
            <button
              onClick={() => setShowCards((v) => !v)}
              title="Etiquetas de KPI por setor"
              className={`rounded-full px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${showCards ? "bg-stone-200 text-stone-900" : "text-stone-500 hover:bg-stone-100"}`}
            >
              Cartões
            </button>
            <button
              onClick={() => setShowWires((v) => !v)}
              title="Fios do Cérebro até cada setor"
              className={`rounded-full px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${showWires ? "bg-emerald-100 text-emerald-800" : "text-stone-500 hover:bg-stone-100"}`}
            >
              Fios
            </button>
            <span className="mx-1 h-4 w-px bg-stone-200" />
            {[
              { label: "−", title: "Afastar", on: () => setZoom((v) => Math.max(v - 0.15, 0.3)) },
              { label: "+", title: "Aproximar", on: () => setZoom((v) => Math.min(v + 0.15, 3)) },
              { label: "⌂", title: "Enquadrar tudo", on: () => { setZoom(1); setHomeKey((k) => k + 1); } },
            ].map((b) => (
              <button
                key={b.label}
                title={b.title}
                onClick={b.on}
                className="flex h-6 w-6 items-center justify-center rounded-full text-sm text-stone-600 hover:bg-stone-100"
              >
                {b.label}
              </button>
            ))}
          </div>

          {/* Rótulos dos agentes somem com zoom afastado (ver ZoomLevelMarker) */}
          <style>{`[data-office-zoom="far"] .office-agent-label { display: none; }`}</style>
          <Canvas
            shadows
            orthographic
            // limita a resolução em telas de alta densidade: 2x–3x pixels
            // custa muito na GPU e quase não aparece numa cena isométrica
            dpr={[1, 1.75]}
            camera={{ position: [sceneCX + 60, 60, sceneCZ + 66], zoom: 20, near: 0.1, far: 1000 }}
            style={{ width: "100%", height: "100%" }}
            onPointerMissed={() => { document.body.style.cursor = ""; }}
          >
            <AgentPosCtx.Provider value={agentPosRef}>
            <color attach="background" args={["#f1eee8"]} />

            <ZoomLevelMarker />
            <IsoCamera mode={camMode} center={[sceneCX, sceneCZ]} extent={extent} zoom={zoom} homeKey={homeKey} />

            {/* Iluminação IBL gerada localmente (Lightformers) — o preset
                "warehouse" baixava um .hdr de CDN externa e, sem rede,
                derrubava o Canvas inteiro. Local-first (CLAUDE.md §1.3). */}
            <Environment resolution={64} background={false}>
              <Lightformer form="rect" intensity={2} position={[0, 10, 0]} rotation-x={Math.PI / 2} scale={[20, 20, 1]} />
              <Lightformer form="rect" intensity={0.8} position={[-10, 4, 6]} rotation-y={Math.PI / 2} scale={[12, 6, 1]} color="#fff4e0" />
              <Lightformer form="rect" intensity={0.6} position={[10, 4, -6]} rotation-y={-Math.PI / 2} scale={[12, 6, 1]} color="#e0ecff" />
            </Environment>

            <ambientLight intensity={0.75} />
            <hemisphereLight args={["#fffaf0", "#c8c0b4", 0.7]} />
            <directionalLight
              position={[sceneCX - 14, 30, sceneCZ + 18]}
              intensity={1.7} castShadow
              shadow-mapSize={[2048, 2048]}
              shadow-bias={-0.0004}
              shadow-camera-left={-extent[0]} shadow-camera-right={extent[0]}
              shadow-camera-top={extent[1]}  shadow-camera-bottom={-extent[1]}
              shadow-camera-near={1} shadow-camera-far={120}
            />
            <directionalLight position={[sceneCX + 12, 18, sceneCZ - 10]} intensity={0.45} />

            {/* Sombra suave da maquete no "papel" */}
            {/* Sombra de contato é da maquete (lajes/paredes), que não se mexe:
                renderiza só nos primeiros quadros e de novo quando a planta muda
                (key). Antes re-renderizava a cena inteira a cada quadro. */}
            <ContactShadows
              key={`${cols}x${rows}:${sectors.length}`}
              frames={3}
              position={[sceneCX, -SLAB_H - 0.01, sceneCZ]}
              opacity={0.35}
              scale={[extent[0] + 16, extent[1] + 16]}
              blur={2.6}
              far={4}
              color="#6b5d4a"
            />

            {/* Base: papel off-white */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[sceneCX, -SLAB_H - 0.02, sceneCZ]} receiveShadow>
              <planeGeometry args={[extent[0] + 200, extent[1] + 200]} />
              <meshStandardMaterial color="#f1eee8" roughness={1} />
            </mesh>

            {/* Passagens entre fileiras e corredor principal */}
            <InterRowPassage rows={rows} gridW={gridW} />
            <Aisles rows={rows} cols={cols} corrZ={CORR_Z} />
            <CorridorFloor corrZ={CORR_Z} gridW={gridW} />

            {/* Praça do Cérebro, ligada ao corredor */}
            <WalkwaySlab x={brainPos[0]} z={(CORR_Z + CORRIDOR_D / 2 + brainPos[1] + 2.6) / 2}
              w={7} d={brainPos[1] + 2.6 - (CORR_Z + CORRIDOR_D / 2)} color="#e9e3d6" />
            <BrainHub
              position={brainPos}
              links={showWires ? brainLinks : []}
              sourcesCount={sourcesCount}
              lastActivity={lastBrainActivity}
              onClick={() => setBrainOpen(true)}
            />

            {/* Salas */}
            {roomEntries.map(({ key, sector, idx, meeting }) => (
              <Room
                key={key}
                sector={sector}
                index={idx}
                cols={cols}
                isMeetingRoom={meeting}
                desks={meeting ? [] : desksByRoom.get(idx) ?? []}
                onRoomClick={handleRoomClick}
              />
            ))}

            {/* Cartões de KPI por setor */}
            {showCards && roomEntries.filter((r) => !r.meeting).map(({ key, sector, idx }) => {
              const [rcx, rcz] = roomCenter(idx, cols);
              const type = inferRoomType(sector.name);
              const stats = statsBySector.get(sector.id) ?? { agents: 0, working: 0, paused: 0, doing: 0, next: 0, done: 0 };
              return (
                <SectorCard
                  key={`card-${key}`}
                  position={[rcx, WALL_H + 0.55, rcz - ROOM_D / 2]}
                  name={sector.name}
                  color={roomPalette(type, idx).accent}
                  stats={stats}
                  brain={sector.id === -2 ? "Cérebro principal" : sector.knowledge_source_name}
                  aiProvider={sector.default_provider}
                  aiModel={sector.default_model}
                  aiProblem={(() => {
                    const st = aiBySector.get(sector.id);
                    return st && !st.ready ? { provider: st.provider, detail: st.detail } : null;
                  })()}
                  budget={(() => {
                    const m = metricBySector.get(sector.id);
                    return m ? { monthCost: m.month_cost_usd, budget: m.budget_usd, percent: m.usage_percent, status: m.status } : null;
                  })()}
                  onClick={() => handleRoomClick(sector.id, sector.name)}
                />
              );
            })}

            {/* Envelopes entre setores (SectorMessage) */}
            <Envelopes
              pending={pendingEnvelopes}
              flights={flights}
              onFlightDone={handleFlightDone}
              onOpenPending={replay ? undefined : setOpenMessageId}
            />

            {/* Agentes */}
            {officeAgents.map((agent) => {
              const seat = seatById.get(agent.id);
              if (!seat) return null;
              const room = roomNav(navGrid, roomIdxById.get(agent.id) ?? CEO_ROOM_INDEX);
              return (
                <AgentAvatar3D
                  key={agent.id}
                  agent={agent}
                  nav={{ seat, room }}
                  meeting={meetingRoutes.get(agent.id) ?? null}
                  meetingCenter={[meetingCX, meetingCZ]}
                  errand={errands.get(agent.id)?.[0] ?? null}
                  onErrandDone={handleErrandDone}
                  pendingApprovals={approvalsByAgent.get(agent.id) ?? 0}
                  onOpenApprovals={replay ? undefined : setApprovalsFor}
                  onSelect={handleAgentClick}
                />
              );
            })}

            {/* Sem prop `target`: o React reaplicaria o valor a cada re-render
                (polling/WebSocket) e desfaria o enquadramento do IsoCamera. */}
            <OrbitControls
              makeDefault
              enableDamping
              dampingFactor={0.08}
              minZoom={4}
              maxZoom={220}
              maxPolarAngle={Math.PI / 2.15}
            />
            </AgentPosCtx.Provider>
          </Canvas>

          {replayOn && (
            <ReplayBar
              timeline={timeline}
              loading={timelineLoading}
              error={timelineError}
              t={replayT}
              onSeek={(t) => {
                // Pulo manual não anima tudo o que "aconteceu" no meio
                seenStatusRef.current = null;
                setReplayT(t);
              }}
              playing={replayPlaying}
              onTogglePlay={() => {
                if (!timeline) return;
                if (!replayPlaying && replayT >= new Date(timeline.until).getTime()) {
                  seenStatusRef.current = null;
                  setReplayT(new Date(timeline.since).getTime());
                }
                setReplayPlaying((v) => !v);
              }}
              speed={replaySpeed}
              onSpeed={setReplaySpeed}
              recent={replay?.recent ?? []}
              agentName={(id) => rawAgents.find((a) => a.id === id)?.name ?? `agente #${id}`}
              onReload={() => { seenStatusRef.current = null; loadTimeline(); }}
              onExit={() => { seenStatusRef.current = null; setReplayOn(false); setReplayPlaying(false); }}
            />
          )}
        </div>

        <AgentInfoPanel agents={officeAgents} open={panelOpen} onClose={() => setPanelOpen(false)} onAgentClick={handleAgentClick} />
      </div>

      {/* Aprovações humanas pendentes (marcador ⚠ sobre o agente / barra superior) */}
      {approvalsFor !== null && (
        <ApprovalModal
          approvals={approvalsFor === "all" ? approvals : approvals.filter((p) => p.agent === approvalsFor)}
          title={approvalsFor === "all"
            ? `${approvals.length} ação(ões) esperando decisão`
            : `Ações de ${officeAgents.find((a) => a.id === approvalsFor)?.name ?? "agente"} esperando decisão`}
          onClose={() => setApprovalsFor(null)}
          onDecided={upsertApproval}
        />
      )}

      {/* Mediar uma mensagem pendente (clique no envelope) */}
      <MessageModal
        message={messages.find((m) => m.id === openMessageId) ?? null}
        agents={officeAgents}
        onClose={() => setOpenMessageId(null)}
        onRelayed={(updated) =>
          // Atualiza já (sem esperar poll/WebSocket): a transição pending →
          // answered dispara o mediador andando com o envelope.
          setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)))}
      />

      {/* Cérebro aberto: grafo das notas indexadas (Obsidian etc.) */}
      <BrainGraph open={brainOpen} onClose={() => setBrainOpen(false)} sectors={sectors} />

      <AgentModal
        agent={selectedAgent}
        open={agentModalOpen}
        onClose={() => setAgentModalOpen(false)}
        sectors={sectors}
        onMessageSent={replay ? undefined : (m) =>
          // Envelope nasce já na porta (sem esperar poll/WebSocket)
          setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [m, ...prev]))}
      />
      <RoomModal
        sector={sectors.find((s) => s.id === selectedRoom?.id) ?? null}
        sectorId={selectedRoom?.id ?? null}
        sectorName={selectedRoom?.name ?? ""}
        agents={officeAgents}
        open={roomModalOpen}
        onClose={() => setRoomModalOpen(false)}
        onAgentClick={(a) => { setRoomModalOpen(false); handleAgentClick(a); }}
        onSectorUpdated={(updated) => {
          setSectors((prev) => prev.map((s) => (s.id === updated.id ? { ...s, ...updated } : s)));
          // Trocou a IA do setor: o selo "sem credencial" precisa refletir já
          getAIStatus().then(setAiStatus).catch(() => {});
        }}
        tasks={tasks}
        onTaskUpdated={replay ? undefined : upsertTask}
        metric={selectedRoom ? metricBySector.get(selectedRoom.id) ?? null : null}
        aiStatus={selectedRoom ? aiBySector.get(selectedRoom.id) ?? null : null}
        onConfigureAI={(provider) => { setRoomModalOpen(false); setAiConfigFor(provider); }}
      />
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
      <DailySummaryModal open={summaryOpen} onClose={() => setSummaryOpen(false)} />
      <AIConfigModal
        open={aiConfigFor !== null}
        provider={(aiConfigFor || undefined) as AIProvider | undefined}
        onClose={() => {
          setAiConfigFor(null);
          // Chave nova: o selo ⚠ da planta precisa refletir já
          getAIStatus().then(setAiStatus).catch(() => {});
        }}
      />
    </div>
  );
}

// office3d/BrainHub.tsx — o "Cérebro principal" no centro da planta.
//
// Representa o mesmo conceito que CLAUDE.md §7 descreve em
// agency.services._rag_scope_for(): CEO/Orquestrador-Geral enxergam tudo
// (fio contínuo), cada setor só enxerga o próprio `knowledge_source`
// ("cérebro secundário"). Setor SEM knowledge_source configurado aparece com
// fio tracejado cinza — o backend devolve lista vazia pra ele, nunca "sem
// restrição", e a planta mostra exatamente isso em vez de fingir conexão.
//
// Os pulsos que correm pelo fio só existem enquanto algum agente daquele
// setor está com work_status == "working" (dado real do WebSocket/polling).
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Html, QuadraticBezierLine } from "@react-three/drei";
import * as THREE from "three";

export interface BrainLink {
  id: number;
  /** Ponto de chegada do fio (topo da parede do fundo da sala). */
  to: [number, number, number];
  color: string;
  /** Setor tem cérebro secundário (knowledge_source) configurado. */
  connected: boolean;
  /** Quantos agentes do setor estão trabalhando agora. */
  working: number;
}

const BRAIN_Y = 1.9;

function fibonacciSphere(n: number, r: number): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  const phi = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const rad = Math.sqrt(1 - y * y);
    const th = phi * i;
    pts.push(new THREE.Vector3(Math.cos(th) * rad * r, y * r * 0.82, Math.sin(th) * rad * r));
  }
  return pts;
}

function NeuralCore({ active }: { active: boolean }) {
  const groupRef = useRef<THREE.Group>(null!);
  const nodesMat = useRef<THREE.PointsMaterial>(null!);
  const linksMat = useRef<THREE.LineBasicMaterial>(null!);

  const { nodeGeo, linkGeo } = useMemo(() => {
    const pts = fibonacciSphere(46, 0.95);
    const nodeGeo = new THREE.BufferGeometry().setFromPoints(pts);
    const seg: THREE.Vector3[] = [];
    pts.forEach((p, i) => {
      // liga cada nó aos 2 vizinhos mais próximos — parece um grafo de notas
      const near = pts
        .map((q, j) => ({ j, d: p.distanceToSquared(q) }))
        .filter((o) => o.j > i)
        .sort((a, b) => a.d - b.d)
        .slice(0, 2);
      near.forEach(({ j }) => seg.push(p, pts[j]!));
    });
    const linkGeo = new THREE.BufferGeometry().setFromPoints(seg);
    return { nodeGeo, linkGeo };
  }, []);

  useFrame(({ clock }, delta) => {
    const g = groupRef.current;
    if (!g) return;
    g.rotation.y += delta * (active ? 0.45 : 0.12);
    const t = clock.getElapsedTime();
    if (nodesMat.current) nodesMat.current.size = active ? 0.13 + Math.sin(t * 4) * 0.03 : 0.1;
    if (linksMat.current) linksMat.current.opacity = active ? 0.55 + Math.sin(t * 3) * 0.2 : 0.3;
  });

  return (
    <group ref={groupRef} position={[0, BRAIN_Y, 0]}>
      <points geometry={nodeGeo}>
        <pointsMaterial ref={nodesMat} color="#10b981" size={0.1} sizeAttenuation />
      </points>
      <lineSegments geometry={linkGeo}>
        <lineBasicMaterial ref={linksMat} color="#34d399" transparent opacity={0.3} />
      </lineSegments>
      <mesh>
        <sphereGeometry args={[0.28, 16, 12]} />
        <meshStandardMaterial color="#6ee7b7" emissive="#10b981" emissiveIntensity={active ? 1.2 : 0.4} />
      </mesh>
    </group>
  );
}

function DataWire({ from, link }: { from: THREE.Vector3; link: BrainLink }) {
  const lineRef = useRef<{ material: { dashOffset: number } } | null>(null);
  const pulses = useRef<THREE.Mesh[]>([]);

  const to = useMemo(() => new THREE.Vector3(...link.to), [link.to]);
  const mid = useMemo(() => {
    const m = from.clone().lerp(to, 0.5);
    m.y += 2.2 + from.distanceTo(to) * 0.18;
    return m;
  }, [from, to]);
  const curve = useMemo(() => new THREE.QuadraticBezierCurve3(from, mid, to), [from, mid, to]);

  const active = link.working > 0;
  const nPulses = Math.min(3, link.working);

  useFrame(({ clock }, delta) => {
    if (lineRef.current && active) lineRef.current.material.dashOffset -= delta * 1.6;
    const t = clock.getElapsedTime();
    pulses.current.forEach((m, i) => {
      if (!m) return;
      // do cérebro para o setor: contexto RAG chegando no setor que está trabalhando
      const p = ((t * 0.35 + i / Math.max(nPulses, 1)) % 1);
      m.position.copy(curve.getPoint(p));
    });
  });

  const color = link.connected ? link.color : "#94a3b8";
  return (
    <group>
      <QuadraticBezierLine
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ref={lineRef as any}
        start={from}
        end={to}
        mid={mid}
        color={color}
        lineWidth={active ? 2.2 : 1.2}
        dashed={active || !link.connected}
        dashSize={active ? 0.5 : 0.25}
        gapSize={active ? 0.35 : 0.3}
        transparent
        opacity={active ? 0.95 : link.connected ? 0.45 : 0.35}
        depthWrite={false}
      />
      {Array.from({ length: nPulses }, (_, i) => (
        <mesh key={i} ref={(m) => { if (m) pulses.current[i] = m; }}>
          <sphereGeometry args={[0.13, 10, 8]} />
          <meshBasicMaterial color={link.color} toneMapped={false} />
        </mesh>
      ))}
      {/* Tomada na parede do setor */}
      <mesh position={to}>
        <sphereGeometry args={[0.1, 10, 8]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
    </group>
  );
}

export function BrainHub({
  position,
  links,
  sourcesCount,
  lastActivity,
  onClick,
}: {
  position: [number, number];
  links: BrainLink[];
  sourcesCount: number;
  lastActivity: string | null;
  onClick?: () => void;
}) {
  const [x, z] = position;
  const from = useMemo(() => new THREE.Vector3(x, BRAIN_Y + 0.9, z), [x, z]);
  const anyActive = links.some((l) => l.working > 0);

  return (
    <group>
      <group
        position={[x, 0, z]}
        onClick={(e) => { e.stopPropagation(); onClick?.(); }}
        onPointerOver={() => { document.body.style.cursor = "pointer"; }}
        onPointerOut={() => { document.body.style.cursor = ""; }}
      >
        {/* Pedestal hexagonal em degraus */}
        <mesh position={[0, 0.12, 0]} receiveShadow castShadow>
          <cylinderGeometry args={[1.9, 2.1, 0.24, 6]} />
          <meshStandardMaterial color="#e7e2d6" roughness={0.8} />
        </mesh>
        <mesh position={[0, 0.3, 0]} castShadow>
          <cylinderGeometry args={[1.35, 1.5, 0.14, 6]} />
          <meshStandardMaterial color="#d8d2c4" roughness={0.7} />
        </mesh>
        {/* Anel de luz no chão do pedestal */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.38, 0]}>
          <ringGeometry args={[1.05, 1.18, 6]} />
          <meshBasicMaterial color="#10b981" transparent opacity={anyActive ? 0.9 : 0.35} toneMapped={false} />
        </mesh>
        {/* Coluna de vidro */}
        <mesh position={[0, BRAIN_Y, 0]}>
          <sphereGeometry args={[1.25, 32, 24]} />
          <meshPhysicalMaterial
            color="#ecfdf5" transparent opacity={0.16} roughness={0.05}
            metalness={0} transmission={0.4} thickness={0.2} depthWrite={false}
          />
        </mesh>
        <NeuralCore active={anyActive} />
        <Html center zIndexRange={[10, 7]} position={[0, BRAIN_Y + 1.75, 0]} style={{ pointerEvents: "none", userSelect: "none" }}>
          <div className="flex flex-col items-center gap-1">
            <div className="flex items-center gap-2 whitespace-nowrap rounded-full border border-stone-200 bg-white/95 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-700 shadow-sm">
              <span className={`h-1.5 w-1.5 rounded-full ${anyActive ? "animate-pulse bg-emerald-500" : "bg-stone-400"}`} />
              Cérebro
              <span className="font-mono text-[11px] text-stone-900">{sourcesCount}</span>
              <span className="text-stone-400">{sourcesCount === 1 ? "fonte" : "fontes"}</span>
            </div>
            {lastActivity && (
              <div className="max-w-[220px] truncate rounded-full border border-emerald-300 bg-emerald-50/95 px-2.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-emerald-700">
                {lastActivity}
              </div>
            )}
          </div>
        </Html>
      </group>
      {links.map((l) => (
        <DataWire key={l.id} from={from} link={l} />
      ))}
    </group>
  );
}

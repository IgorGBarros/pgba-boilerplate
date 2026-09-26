// office3d/Envelopes.tsx — envelopes de SectorMessage (CLAUDE.md §7).
//
// Regra que a animação precisa respeitar: setor NUNCA fala direto com outro
// setor. Por isso o envelope nunca voa de A pra B em linha reta:
//
//   pendente  → fica parado em cima da porta do setor de origem, piscando
//               ("aguardando orquestrador") — é a fila real, não enfeite;
//   respondida → voa origem → sala de quem mediou (relayed_by) → destino,
//               e a resposta (envelope verde) faz o caminho de volta;
//   rejeitada → o envelope fica vermelho, sobe, "cai" e some na origem.
//
// Só anima transições vistas ao vivo (WebSocket/poll) ou muito recentes no
// carregamento — o histórico antigo não fica voando toda vez que abre a aba.
import { useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";

export type V3 = [number, number, number];

const PAPER = "#fbf7ee";
export const ENVELOPE_COLORS = {
  pending: "#f59e0b",
  request: "#6366f1",
  reply: "#10b981",
  rejected: "#ef4444",
} as const;

const ENVELOPE_SCALE = 1.9;

export function EnvelopeMesh({ flap }: { flap: string }) {
  const flapGeo = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(-0.28, 0.18);
    s.lineTo(0.28, 0.18);
    s.lineTo(0, -0.02);
    s.closePath();
    return new THREE.ShapeGeometry(s);
  }, []);
  return (
    <group scale={ENVELOPE_SCALE}>
      <mesh castShadow>
        <boxGeometry args={[0.56, 0.36, 0.03]} />
        <meshStandardMaterial color={PAPER} roughness={0.8} />
      </mesh>
      {[1, -1].map((side) => (
        <group key={side} rotation={[0, side === 1 ? 0 : Math.PI, 0]}>
          <mesh geometry={flapGeo} position={[0, 0, 0.017]}>
            <meshBasicMaterial color={flap} toneMapped={false} side={THREE.DoubleSide} />
          </mesh>
          <mesh position={[0, -0.02, 0.019]}>
            <circleGeometry args={[0.045, 14]} />
            <meshBasicMaterial color="#b91c1c" toneMapped={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

// ─── Envelope parado (pendente) ───────────────────────────────────────────────

export interface PendingEnvelope {
  id: number;
  at: V3;
  label: string;
  content: string;
  stackIndex: number;
}

function Parked({ env }: { env: PendingEnvelope }) {
  const ref = useRef<THREE.Group>(null!);
  const phase = useMemo(() => (env.id % 7) * 0.9, [env.id]);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.getElapsedTime() + phase;
    ref.current.position.y = env.at[1] + env.stackIndex * 0.8 + Math.sin(t * 2.2) * 0.08;
    ref.current.rotation.y = 0.74 + Math.sin(t * 0.9) * 0.3; // de frente pra câmera isométrica
  });
  return (
    <group ref={ref} position={env.at}>
      <EnvelopeMesh flap={ENVELOPE_COLORS.pending} />
      {env.stackIndex === 0 && (
        <Html center position={[0, 0.75, 0]} zIndexRange={[8, 7]} style={{ userSelect: "none" }}>
          <div
            title={env.content}
            className="flex items-center gap-1 whitespace-nowrap rounded-full border border-amber-300 bg-amber-50/95 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-800 shadow-sm"
          >
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
            {env.label}
          </div>
        </Html>
      )}
    </group>
  );
}

// ─── Envelope voando ─────────────────────────────────────────────────────────

export interface FlightLeg {
  from: V3;
  to: V3;
  color: string;
}

export interface Flight {
  key: string;
  legs: FlightLeg[];
  label: string;
  /** "drop": no fim do último trecho o envelope cai e some (rejeitada). */
  ending?: "fade" | "drop";
}

const LEG_BASE_S = 1.1;
const FADE_S = 0.5;

function legCurve(leg: FlightLeg) {
  const a = new THREE.Vector3(...leg.from);
  const b = new THREE.Vector3(...leg.to);
  const mid = a.clone().lerp(b, 0.5);
  mid.y = Math.max(a.y, b.y) + 1.6 + a.distanceTo(b) * 0.14;
  return { curve: new THREE.QuadraticBezierCurve3(a, mid, b), dur: LEG_BASE_S + a.distanceTo(b) * 0.035 };
}

function Flying({ flight, onDone }: { flight: Flight; onDone: (key: string) => void }) {
  const ref = useRef<THREE.Group>(null!);
  const legs = useMemo(() => flight.legs.map(legCurve), [flight.legs]);
  const state = useRef({ leg: 0, t: 0, fade: 0, done: false });
  const [legIdx, setLegIdx] = useState(0);
  const tmp = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, delta) => {
    const g = ref.current;
    const st = state.current;
    if (!g || st.done) return;
    const cur = legs[st.leg];
    if (cur) {
      st.t += delta / cur.dur;
      const e = st.t < 0.5 ? 2 * st.t * st.t : 1 - Math.pow(-2 * st.t + 2, 2) / 2; // ease in-out
      const p = Math.min(e, 1);
      cur.curve.getPoint(p, g.position);
      cur.curve.getTangent(Math.min(p, 0.999), tmp);
      g.rotation.y = Math.atan2(tmp.x, tmp.z) + Math.PI / 2;
      g.rotation.z = Math.sin(st.t * 18) * 0.12; // "bate asa"
      if (st.t >= 1) {
        st.leg++;
        st.t = 0;
        if (st.leg < legs.length) setLegIdx(st.leg);
      }
      return;
    }
    // fim: some (ou cai, se rejeitada)
    st.fade += delta / FADE_S;
    if (flight.ending === "drop") {
      g.position.y -= delta * 2.5;
      g.rotation.x += delta * 6;
    }
    g.scale.setScalar(Math.max(0.001, 1 - st.fade));
    if (st.fade >= 1) {
      st.done = true;
      onDone(flight.key);
    }
  });

  const color = flight.legs[Math.min(legIdx, flight.legs.length - 1)]?.color ?? ENVELOPE_COLORS.request;
  return (
    <group ref={ref} position={flight.legs[0]?.from}>
      <EnvelopeMesh flap={color} />
      <Html center position={[0, 0.75, 0]} zIndexRange={[8, 7]} style={{ pointerEvents: "none", userSelect: "none" }}>
        <div
          className="whitespace-nowrap rounded-full border bg-white/95 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider shadow-sm"
          style={{ borderColor: color, color }}
        >
          {flight.label}
        </div>
      </Html>
    </group>
  );
}

export function Envelopes({
  pending,
  flights,
  onFlightDone,
}: {
  pending: PendingEnvelope[];
  flights: Flight[];
  onFlightDone: (key: string) => void;
}) {
  return (
    <group>
      {pending.map((p) => <Parked key={p.id} env={p} />)}
      {flights.map((f) => <Flying key={f.key} flight={f} onDone={onFlightDone} />)}
    </group>
  );
}

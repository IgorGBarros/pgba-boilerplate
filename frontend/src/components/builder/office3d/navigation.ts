// office3d/navigation.ts — rotas dos agentes na planta (funções puras, sem React).
//
// Por que existe: na Fase 2 o caminho era "porta → corredor → porta" em
// linha reta a partir de onde o agente estivesse. Resultado: ele saía da
// mesa em diagonal atravessando a parede da frente (o primeiro ponto já era
// o lado DE FORA da porta), e quem estava numa fileira de cima descia em
// linha reta atravessando as salas de baixo até o corredor.
//
// Agora toda rota é montada só com trechos que existem de verdade na planta:
//
//   mesa ─► corredor interno da sala (entre colunas de mesas)
//        ─► faixa livre da frente da sala
//        ─► porta (lado de dentro) ─► porta (lado de fora, no passeio da fileira)
//        ─► passeio da fileira ─► corredor vertical entre colunas de salas
//        ─► passeio da fileira de destino ─► porta de destino (fora → dentro) ─► ...
//
// `routeCrossesWall()` é o verificador usado pra provar isso: nenhum trecho
// de nenhuma rota pode cruzar uma parede fora do vão da porta.

export type Pt = [number, number]; // [x, z] no mundo

export interface NavGrid {
  cols: number;
  rows: number;
  roomW: number;
  roomD: number;
  gapX: number;     // largura do corredor vertical entre colunas de salas
  gapZ: number;     // largura do passeio entre fileiras
  corridorZ: number; // z do corredor principal (à frente da última fileira)
  doorW: number;
}

/** Faixa livre da frente da sala (coordenada local) — sem mesas, só decoração encostada. */
export const FRONT_LANE_Z = 2.35;
/** Ponto logo dentro da porta (local). */
export const DOOR_INSIDE_OFFSET = 0.55;
/** Até onde o agente anda na faixa da frente quando está "à toa" (local, evita a decoração dos cantos). */
export const IDLE_X_RANGE: [number, number] = [-2.2, 2.6];

export function roomCenter(g: NavGrid, idx: number): Pt {
  const col = idx % g.cols;
  const row = Math.floor(idx / g.cols);
  return [col * (g.roomW + g.gapX), row * (g.roomD + g.gapZ)];
}

export function rowOf(g: NavGrid, idx: number): number {
  return Math.floor(idx / g.cols);
}

/** z do passeio à frente de uma fileira (a última fileira usa o corredor principal). */
export function passageZ(g: NavGrid, row: number): number {
  if (row >= g.rows - 1) return g.corridorZ;
  return row * (g.roomD + g.gapZ) + g.roomD / 2 + g.gapZ / 2;
}

/** x dos corredores verticais: um à esquerda de tudo, um entre cada par de colunas, um à direita. */
export function aisleXs(g: NavGrid): number[] {
  const xs: number[] = [];
  for (let c = -1; c < g.cols; c++) xs.push(c * (g.roomW + g.gapX) + g.roomW / 2 + g.gapX / 2);
  return xs;
}

export interface RoomNav {
  cx: number;
  cz: number;
  row: number;
  frontZ: number;   // mundo
  inside: Pt;       // logo dentro da porta
  outside: Pt;      // porta, no passeio da fileira
}

export function roomNav(g: NavGrid, idx: number): RoomNav {
  const [cx, cz] = roomCenter(g, idx);
  const row = rowOf(g, idx);
  return {
    cx, cz, row,
    frontZ: cz + FRONT_LANE_Z,
    inside: [cx, cz + g.roomD / 2 - DOOR_INSIDE_OFFSET],
    outside: [cx, passageZ(g, row)],
  };
}

/**
 * Do lado de fora de uma porta até o lado de fora de outra, só por
 * passeios e corredores verticais (nunca atravessando uma sala).
 * Não inclui o ponto de partida.
 */
export function hallway(g: NavGrid, from: RoomNav, to: RoomNav): Pt[] {
  if (from.row === to.row) return [to.outside];
  const [x1, z1] = from.outside;
  const [x2, z2] = to.outside;
  let best = 0;
  let bestCost = Infinity;
  for (const a of aisleXs(g)) {
    const cost = Math.abs(a - x1) + Math.abs(a - x2);
    if (cost < bestCost) { bestCost = cost; best = a; }
  }
  return [[best, z1], [best, z2], to.outside];
}

/** Assento do agente na sala + o "corredor interno" (x entre colunas de mesas) que ele usa pra sair. */
export interface Seat {
  pos: Pt;    // mundo
  laneX: number; // mundo
}

/** Da cadeira até a faixa da frente, no x pedido (não inclui a cadeira). */
export function seatToFront(seat: Seat, room: RoomNav, x: number): Pt[] {
  return [[seat.laneX, seat.pos[1]], [seat.laneX, room.frontZ], [x, room.frontZ]];
}

/** Da faixa da frente (em x qualquer) de volta à cadeira (não inclui o ponto de partida). */
export function frontToSeat(seat: Seat, room: RoomNav): Pt[] {
  return [[seat.laneX, room.frontZ], [seat.laneX, seat.pos[1]], seat.pos];
}

/** Da faixa da frente até o lado de fora da porta. */
export function frontToOutside(room: RoomNav): Pt[] {
  return [[room.cx, room.frontZ], room.inside, room.outside];
}

/** Do lado de fora da porta até a faixa da frente (na altura da porta). */
export function outsideToFront(room: RoomNav): Pt[] {
  return [room.inside, [room.cx, room.frontZ]];
}

// ─── Mesas (uma por agente) ───────────────────────────────────────────────────

/**
 * Posição das mesas dentro de uma sala (coordenada local). Cada agente ganha
 * a PRÓPRIA mesa, virada pra parede do fundo — o agente senta na cadeira em
 * (x, z + DESK_SEAT_Z). No máximo 3 fileiras: a faixa da frente
 * (z ≈ FRONT_LANE_Z) fica sempre livre pro caminho até a porta; setor com
 * muita gente ganha mais colunas, mais estreitas, em vez de uma 4ª fileira.
 */
export const DESK_SEAT_Z = 0.72;

export function deskLayout(total: number): { slots: Pt[]; width: number; spacingX: number } {
  const n = Math.max(total, 1);
  const cols = n <= 3 ? n : n <= 6 ? 3 : Math.ceil(n / 3);
  const rows = Math.ceil(n / cols);
  const spacingX = Math.min(2.6, 8.2 / cols);
  const width = Math.min(1.6, spacingX - 0.5);
  const spacingZ = rows <= 2 ? 2.3 : 1.8;
  const slots: Pt[] = [];
  for (let i = 0; i < n; i++) {
    // Fileira incompleta fica ALINHADA à grade de colunas (não centralizada):
    // o corredor entre colunas de mesas é o mesmo em todas as fileiras, então
    // a rota de saída de um agente nunca atravessa a mesa de outro.
    const c = i % cols;
    const r = Math.floor(i / cols);
    slots.push([(c - (cols - 1) / 2) * spacingX, -2.7 + r * spacingZ]);
  }
  return { slots, width, spacingX };
}

/** Sala CEO: mesa executiva pro primeiro, mesas laterais (x=3.3) pros demais. */
export function ceoDeskLayout(total: number): Pt[] {
  const slots: Pt[] = [[0.8, -2.2]];
  for (let i = 1; i < total; i++) slots.push([3.3, -2.6 + (i - 1) * 2.1]);
  return slots;
}

/**
 * x (local) do corredor interno que o agente da mesa `i` usa pra sair: meio
 * do caminho até a coluna vizinha, sempre na direção do centro (porta). Na
 * sala CEO a mesa executiva sai reto; as laterais usam o vão até a executiva.
 */
export function seatLaneLocal(isCeo: boolean, i: number, x: number, spacingX: number): number {
  if (isCeo) return i === 0 ? x : 2.3;
  return x + (x > 0.01 ? -spacingX / 2 : spacingX / 2);
}

// ─── Sala de reunião ──────────────────────────────────────────────────────────

/**
 * Cadeiras da mesa oval (local). Frente = z > 0 (lado da porta).
 * As mesmas posições são usadas pra desenhar as cadeiras e pra sentar os
 * agentes — na Fase 2 eram duas listas diferentes e ninguém sentava na cadeira.
 */
export const MEETING_SEATS: Array<{ x: number; z: number; rot: number }> = [
  { x: -2.4, z: 1.55, rot: Math.PI }, { x: -0.8, z: 1.55, rot: Math.PI },
  { x: 0.8, z: 1.55, rot: Math.PI }, { x: 2.4, z: 1.55, rot: Math.PI },
  { x: -3.3, z: 0, rot: Math.PI / 2 }, { x: 3.3, z: 0, rot: -Math.PI / 2 },
  { x: -2.4, z: -1.55, rot: 0 }, { x: -0.8, z: -1.55, rot: 0 },
  { x: 0.8, z: -1.55, rot: 0 }, { x: 2.4, z: -1.55, rot: 0 },
];

const MEETING_SIDE_X = 3.95; // contorna a mesa pelas laterais
const MEETING_BACK_Z = -2.45; // atrás das cadeiras do fundo

/** Do lado de fora da porta da sala de reunião até a cadeira `seatIdx` (inclui a cadeira). */
export function meetingEntry(room: RoomNav, seatIdx: number): Pt[] {
  const s = MEETING_SEATS[seatIdx % MEETING_SEATS.length]!;
  const { cx, cz } = room;
  const f = FRONT_LANE_Z + 0.25;
  const sign = s.x >= 0 ? 1 : -1;
  const seat: Pt = [cx + s.x, cz + s.z];
  const path: Pt[] = [room.inside];
  if (s.z > 0.5) {
    path.push([cx + s.x, cz + f], seat);
  } else if (Math.abs(s.z) <= 0.5) {
    path.push([cx + sign * MEETING_SIDE_X, cz + f], [cx + sign * MEETING_SIDE_X, cz + s.z], seat);
  } else {
    path.push(
      [cx + sign * MEETING_SIDE_X, cz + f],
      [cx + sign * MEETING_SIDE_X, cz + MEETING_BACK_Z],
      [cx + s.x, cz + MEETING_BACK_Z],
      seat,
    );
  }
  return path;
}

/** Da cadeira da reunião até o lado de fora da porta (não inclui a cadeira). */
export function meetingExit(room: RoomNav, seatIdx: number): Pt[] {
  const entry = meetingEntry(room, seatIdx);
  // entrada invertida, sem a própria cadeira, terminando fora da porta
  return [...entry.slice(0, -1).reverse(), room.outside];
}

// ─── Verificação: nenhum trecho atravessa parede fora da porta ────────────────

export interface WallSeg { a: Pt; b: Pt }

/** Paredes de uma sala (os 4 lados), já com o vão da porta aberto na frente. */
export function roomWalls(g: NavGrid, idx: number): WallSeg[] {
  const [cx, cz] = roomCenter(g, idx);
  const hw = g.roomW / 2, hd = g.roomD / 2, hd2 = g.doorW / 2;
  return [
    { a: [cx - hw, cz - hd], b: [cx + hw, cz - hd] },
    { a: [cx - hw, cz - hd], b: [cx - hw, cz + hd] },
    { a: [cx + hw, cz - hd], b: [cx + hw, cz + hd] },
    { a: [cx - hw, cz + hd], b: [cx - hd2, cz + hd] },
    { a: [cx + hd2, cz + hd], b: [cx + hw, cz + hd] },
  ];
}

function segIntersects(p1: Pt, p2: Pt, q1: Pt, q2: Pt): boolean {
  const d = (a: Pt, b: Pt, c: Pt) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d1 = d(q1, q2, p1), d2 = d(q1, q2, p2), d3 = d(p1, p2, q1), d4 = d(p1, p2, q2);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Primeiro trecho da rota que atravessa alguma parede, ou null se a rota é válida. */
export function routeCrossesWall(start: Pt, route: Pt[], walls: WallSeg[]): [Pt, Pt] | null {
  let prev = start;
  for (const p of route) {
    for (const w of walls) if (segIntersects(prev, p, w.a, w.b)) return [prev, p];
    prev = p;
  }
  return null;
}

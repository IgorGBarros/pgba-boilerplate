// office3d/BrainGraph.tsx — o "Cérebro" aberto: grafo das notas indexadas.
//
// Abre ao clicar no Cérebro do Escritório 3D. Nós = notas/documentos do
// tenant (GET /api/v1/ingestion/graph/), arestas = `[[wikilinks]]` do
// Obsidian resolvidos no backend. Mesmo espírito da "Graph view" do
// Obsidian: passar o mouse destaca os vizinhos, clicar abre a nota.
//
// O painel da nota mostra QUEM PODE LER aquela fonte — mesma regra de
// agency.services._rag_scope_for(): CEO/Orquestrador-Geral leem tudo
// (cérebro principal); setor só lê o próprio knowledge_source — e quem de
// fato CONSULTOU (AgentInteraction.source_document_ids).
//
// "Por uso" pinta o grafo como mapa de calor: quantas vezes cada nota foi
// usada como contexto de resposta (agency knowledge-usage/summary/). Os
// filtros "nunca usadas" e "links quebrados" ajudam a limpar/corrigir o
// vault — o Cérebro só lê, nunca escreve no vault.
//
// Layout de forças próprio (sem dependência nova): repulsão só entre nós
// da mesma célula/vizinhas de uma grade espacial — O(n) por passo em vez de
// O(n²) — molas nas arestas e leve atração por pasta.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, ExternalLink, Search, X } from "lucide-react";
import {
  ApiError,
  getKnowledgeGraph,
  getKnowledgeUsage,
  getKnowledgeUsageSummary,
  listKnowledgeSources,
  type KnowledgeGraph,
  type KnowledgeGraphNode,
  type KnowledgeUsage,
  type KnowledgeSource,
  type Sector,
  sectorSourceIds,
} from "@/lib/api";

const PALETTE = [
  "#10b981", "#6366f1", "#f59e0b", "#ec4899", "#0ea5e9",
  "#8b5cf6", "#ef4444", "#14b8a6", "#84cc16", "#f97316",
];
const NO_FOLDER = "(raiz)";
const UNUSED_COLOR = "#d6d3d1";

/** Cor do mapa de calor: amarelo (pouco usada) → vermelho (muito usada), escala log. */
function heatColor(count: number, max: number): string {
  if (count <= 0) return UNUSED_COLOR;
  const t = max <= 1 ? 1 : Math.log(1 + count) / Math.log(1 + max);
  const hue = 48 - 48 * t; // 48° amarelo → 0° vermelho
  const light = 58 - 14 * t;
  return `hsl(${hue.toFixed(0)} 90% ${light.toFixed(0)}%)`;
}

type ShowFilter = "all" | "unused" | "broken";

interface SimNode extends KnowledgeGraphNode {
  x: number; y: number; vx: number; vy: number;
  degree: number;
  group: string;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// ─── Simulação ────────────────────────────────────────────────────────────────

function initNodes(graph: KnowledgeGraph, groupOf: (n: KnowledgeGraphNode) => string): SimNode[] {
  const degree = new Map<number, number>();
  for (const [a, b] of graph.edges) {
    degree.set(a, (degree.get(a) ?? 0) + 1);
    degree.set(b, (degree.get(b) ?? 0) + 1);
  }
  const groups = [...new Set(graph.nodes.map(groupOf))].sort();
  return graph.nodes.map((n) => {
    // posição inicial determinística: cada grupo num setor do círculo
    const g = groupOf(n);
    const gi = groups.indexOf(g);
    const ang = (gi / Math.max(groups.length, 1)) * Math.PI * 2 + ((hash(n.path) % 1000) / 1000 - 0.5) * 0.9;
    const r = 120 + (hash(String(n.id)) % 180);
    return { ...n, x: Math.cos(ang) * r, y: Math.sin(ang) * r, vx: 0, vy: 0, degree: degree.get(n.id) ?? 0, group: g };
  });
}

function step(nodes: SimNode[], edges: Array<[SimNode, SimNode]>, alpha: number) {
  const CELL = 70;
  const grid = new Map<string, SimNode[]>();
  for (const n of nodes) {
    const k = `${Math.floor(n.x / CELL)}:${Math.floor(n.y / CELL)}`;
    const list = grid.get(k);
    if (list) list.push(n); else grid.set(k, [n]);
  }
  // repulsão (vizinhança da grade)
  for (const n of nodes) {
    const cx = Math.floor(n.x / CELL), cy = Math.floor(n.y / CELL);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const list = grid.get(`${cx + dx}:${cy + dy}`);
      if (!list) continue;
      for (const m of list) {
        if (m === n) continue;
        let ddx = n.x - m.x, ddy = n.y - m.y;
        let d2 = ddx * ddx + ddy * ddy;
        if (d2 < 0.01) { ddx = (hash(`${n.id}-${m.id}`) % 7) - 3; ddy = 1; d2 = ddx * ddx + 1; }
        if (d2 > CELL * CELL * 2.2) continue;
        const f = (900 / d2) * alpha;
        n.vx += ddx * f; n.vy += ddy * f;
      }
    }
  }
  // molas nas ligações
  for (const [a, b] of edges) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const f = ((d - 45) / d) * 0.12 * alpha;
    a.vx += dx * f; a.vy += dy * f;
    b.vx -= dx * f; b.vy -= dy * f;
  }
  // coesão por grupo (pasta/fonte): notas da mesma pasta formam um "lobo"
  const cent = new Map<string, { x: number; y: number; n: number }>();
  for (const n of nodes) {
    const c = cent.get(n.group) ?? { x: 0, y: 0, n: 0 };
    c.x += n.x; c.y += n.y; c.n++;
    cent.set(n.group, c);
  }
  for (const n of nodes) {
    const c = cent.get(n.group)!;
    n.vx += (c.x / c.n - n.x) * 0.02 * alpha;
    n.vy += (c.y / c.n - n.y) * 0.02 * alpha;
  }
  // gravidade para o centro (nós soltos não fogem da tela)
  for (const n of nodes) {
    n.vx -= n.x * 0.006 * alpha;
    n.vy -= n.y * 0.006 * alpha;
    n.vx *= 0.82; n.vy *= 0.82;
    n.x += n.vx; n.y += n.vy;
  }
}

// ─── Componente ───────────────────────────────────────────────────────────────

export function BrainGraph({
  open,
  onClose,
  sectors,
}: {
  open: boolean;
  onClose: () => void;
  sectors: Sector[];
}) {
  const [graph, setGraph] = useState<KnowledgeGraph | null>(null);
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<number | "all">("all");
  const [colorBy, setColorBy] = useState<"folder" | "source" | "usage">("folder");
  const [show, setShow] = useState<ShowFilter>("all");
  // Mapa de calor: id da nota → quantas vezes foi contexto de resposta
  const [usageMap, setUsageMap] = useState<Record<string, { count: number; last_at: string }>>({});
  const [usageError, setUsageError] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  // "Consultada por": agentes que usaram a nota selecionada como contexto
  const [usage, setUsage] = useState<KnowledgeUsage[] | null>(null);
  useEffect(() => {
    if (selectedId == null) { setUsage(null); return; }
    let cancelled = false;
    setUsage(null);
    getKnowledgeUsage(selectedId)
      .then((u) => { if (!cancelled) setUsage(u); })
      .catch(() => { if (!cancelled) setUsage([]); });
    return () => { cancelled = true; };
  }, [selectedId]);
  const [hoverId, setHoverId] = useState<number | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const view = useRef({ x: 0, y: 0, k: 1 });
  const simRef = useRef<{ nodes: SimNode[]; edges: Array<[SimNode, SimNode]>; alpha: number } | null>(null);
  const drawRef = useRef<() => void>(() => {});

  // Uso de todas as notas (mapa de calor) — falha aqui não derruba o grafo
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setUsageError(false);
    getKnowledgeUsageSummary()
      .then((u) => { if (!cancelled) setUsageMap(u); })
      .catch(() => { if (!cancelled) setUsageError(true); });
    return () => { cancelled = true; };
  }, [open]);

  // Carrega ao abrir
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      getKnowledgeGraph(sourceFilter === "all" ? undefined : sourceFilter),
      listKnowledgeSources().catch(() => [] as KnowledgeSource[]),
    ])
      .then(([g, s]) => { if (!cancelled) { setGraph(g); setSources(s); } })
      .catch((e) => { if (!cancelled) setError(e instanceof ApiError ? e.message : "Falha ao carregar o Cérebro."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, sourceFilter]);

  // Esc fecha
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const sourceById = useMemo(() => new Map(sources.map((s) => [s.id, s])), [sources]);
  // "Por uso" agrupa (layout/legenda) por pasta; só a cor muda
  const groupOf = useCallback(
    (n: KnowledgeGraphNode) => colorBy === "source" ? (sourceById.get(n.source)?.name ?? `Fonte ${n.source}`) : (n.folder || NO_FOLDER),
    [colorBy, sourceById],
  );
  const groups = useMemo(() => [...new Set((graph?.nodes ?? []).map(groupOf))].sort(), [graph, groupOf]);
  const colorOf = useCallback((g: string) => PALETTE[Math.max(0, groups.indexOf(g)) % PALETTE.length]!, [groups]);
  const usesOf = useCallback((id: number) => usageMap[String(id)]?.count ?? 0, [usageMap]);
  const maxUses = useMemo(
    () => (graph?.nodes ?? []).reduce((m, n) => Math.max(m, usesOf(n.id)), 0),
    [graph, usesOf],
  );
  const nodeColor = useCallback(
    (n: KnowledgeGraphNode & { group?: string }) => (colorBy === "usage" ? heatColor(usesOf(n.id), maxUses) : colorOf(n.group ?? groupOf(n))),
    [colorBy, usesOf, maxUses, colorOf, groupOf],
  );
  // Raio: ligações + (no modo uso) quantas vezes foi consultada
  const radiusOf = useCallback(
    (n: SimNode) => 3.2 + Math.sqrt(n.degree) * 1.7 + (colorBy === "usage" ? Math.sqrt(usesOf(n.id)) * 1.3 : 0),
    [colorBy, usesOf],
  );

  const unusedIds = useMemo(
    () => new Set((graph?.nodes ?? []).filter((n) => usesOf(n.id) === 0).map((n) => n.id)),
    [graph, usesOf],
  );
  const brokenIds = useMemo(
    () => new Set((graph?.nodes ?? []).filter((n) => (n.broken_links ?? []).length > 0).map((n) => n.id)),
    [graph],
  );

  const neighbors = useMemo(() => {
    const m = new Map<number, Set<number>>();
    for (const [a, b] of graph?.edges ?? []) {
      if (!m.has(a)) m.set(a, new Set());
      if (!m.has(b)) m.set(b, new Set());
      m.get(a)!.add(b);
      m.get(b)!.add(a);
    }
    return m;
  }, [graph]);

  const q = query.trim().toLowerCase();
  // Busca e filtro combinam: o que não passa fica apagado (não some do layout)
  const matches = useMemo(() => {
    if (!graph) return null;
    const filterSet = show === "unused" ? unusedIds : show === "broken" ? brokenIds : null;
    if (!q && !filterSet) return null;
    return new Set(graph.nodes.filter((n) =>
      (!filterSet || filterSet.has(n.id))
      && (!q || n.title.toLowerCase().includes(q) || n.path.toLowerCase().includes(q) || n.tags.some((t) => t.toLowerCase().includes(q))),
    ).map((n) => n.id));
  }, [q, graph, show, unusedIds, brokenIds]);

  // (Re)inicia a simulação quando o grafo muda
  useEffect(() => {
    if (!graph) { simRef.current = null; return; }
    const nodes = initNodes(graph, groupOf);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const edges = graph.edges
      .map(([a, b]) => [byId.get(a), byId.get(b)] as const)
      .filter((e): e is readonly [SimNode, SimNode] => !!e[0] && !!e[1]) as Array<[SimNode, SimNode]>;
    // Pré-aquece fora da tela: o grafo já abre "assentado", sem a
    // explosão inicial; o resto converge animado.
    let alpha = 1;
    const warm = Math.min(220, Math.max(60, Math.round(120000 / Math.max(nodes.length, 1))));
    for (let i = 0; i < warm; i++) { step(nodes, edges, alpha); alpha *= 0.985; }
    simRef.current = { nodes, edges, alpha };
    // Enquadra tudo no tamanho real do canvas (com folga pros rótulos)
    const c = canvasRef.current;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x);
      minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y);
    }
    const cw = c?.clientWidth || 800, ch = c?.clientHeight || 500;
    const k = nodes.length
      ? Math.min(1.6, Math.max(0.15, Math.min(cw / (maxX - minX + 120), ch / (maxY - minY + 120))))
      : 1;
    view.current = nodes.length
      ? { k, x: -((minX + maxX) / 2) * k, y: -((minY + maxY) / 2) * k }
      : { x: 0, y: 0, k: 1 };
    setSelectedId(null);
  // groupOf muda com colorBy — só recolore, não precisa reiniciar o layout
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  // Desenho
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const sim = simRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!sim) return;
    const { x: vx, y: vy, k } = view.current;
    ctx.translate(w / 2 + vx, h / 2 + vy);
    ctx.scale(k, k);

    const focus = hoverId ?? selectedId;
    const focusSet = focus != null ? new Set([focus, ...(neighbors.get(focus) ?? [])]) : null;
    const dimmed = (id: number) => (focusSet ? !focusSet.has(id) : matches ? !matches.has(id) : false);

    // arestas
    ctx.lineWidth = 1 / k;
    for (const [a, b] of sim.edges) {
      const hot = focus != null && (a.id === focus || b.id === focus);
      ctx.strokeStyle = hot ? "rgba(16,185,129,0.85)" : dimmed(a.id) || dimmed(b.id) ? "rgba(120,113,108,0.06)" : "rgba(120,113,108,0.28)";
      ctx.lineWidth = (hot ? 1.8 : 1) / k;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    // nós
    for (const n of sim.nodes) {
      const r = radiusOf(n);
      ctx.globalAlpha = dimmed(n.id) ? 0.15 : 1;
      ctx.fillStyle = nodeColor(n);
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fill();
      if (show === "broken" && brokenIds.has(n.id) && !dimmed(n.id)) {
        ctx.strokeStyle = "#ef4444";
        ctx.lineWidth = 1.5 / k;
        ctx.setLineDash([3 / k, 2 / k]);
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + 2.5 / k, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (n.id === selectedId) {
        ctx.strokeStyle = "#1c1917";
        ctx.lineWidth = 2 / k;
        ctx.stroke();
      }
    }
    // rótulos: nós importantes, os em foco, os da busca — ou todos com zoom
    ctx.font = `${11 / k}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = "center";
    for (const n of sim.nodes) {
      const label = (focusSet?.has(n.id)) || (matches?.has(n.id) && matches.size <= 60) || k > 1.6 || n.degree >= 6;
      if (!label || (dimmed(n.id) && !matches?.has(n.id))) continue;
      const r = radiusOf(n);
      ctx.globalAlpha = 1;
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      const tw = ctx.measureText(n.title).width;
      ctx.fillRect(n.x - tw / 2 - 2 / k, n.y + r + 2 / k, tw + 4 / k, 13 / k);
      ctx.fillStyle = "#292524";
      ctx.fillText(n.title, n.x, n.y + r + 12 / k);
    }
    ctx.globalAlpha = 1;
  }, [nodeColor, radiusOf, show, brokenIds, hoverId, selectedId, neighbors, matches]);
  drawRef.current = draw;

  // Loop: simula enquanto "esquenta", depois só redesenha quando algo muda
  useEffect(() => {
    if (!open) return;
    let raf = 0;
    const tick = () => {
      const sim = simRef.current;
      if (sim && sim.alpha > 0.02) {
        for (let i = 0; i < 2; i++) step(sim.nodes, sim.edges, sim.alpha);
        sim.alpha *= 0.985;
      }
      drawRef.current();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [open]);

  // Interação: pan, zoom, hover, clique
  const toWorld = (clientX: number, clientY: number) => {
    const c = canvasRef.current!;
    const rect = c.getBoundingClientRect();
    const { x, y, k } = view.current;
    return [(clientX - rect.left - rect.width / 2 - x) / k, (clientY - rect.top - rect.height / 2 - y) / k] as const;
  };
  const pick = (clientX: number, clientY: number): SimNode | null => {
    const sim = simRef.current;
    if (!sim) return null;
    const [wx, wy] = toWorld(clientX, clientY);
    let best: SimNode | null = null, bestD = Infinity;
    for (const n of sim.nodes) {
      const r = radiusOf(n) + 4 / view.current.k;
      const d = (n.x - wx) ** 2 + (n.y - wy) ** 2;
      if (d < r * r && d < bestD) { best = n; bestD = d; }
    }
    return best;
  };
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  const selected = useMemo(
    () => (selectedId != null ? graph?.nodes.find((n) => n.id === selectedId) ?? null : null),
    [selectedId, graph],
  );
  const links = useMemo(() => {
    if (!selected || !graph) return { out: [] as KnowledgeGraphNode[], inn: [] as KnowledgeGraphNode[] };
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    return {
      out: graph.edges.filter(([a]) => a === selected.id).map(([, b]) => byId.get(b)!).filter(Boolean),
      inn: graph.edges.filter(([, b]) => b === selected.id).map(([a]) => byId.get(a)!).filter(Boolean),
    };
  }, [selected, graph]);

  const focusOn = (id: number) => {
    const n = simRef.current?.nodes.find((x) => x.id === id);
    setSelectedId(id);
    if (n) view.current = { ...view.current, x: -n.x * view.current.k, y: -n.y * view.current.k };
  };

  if (!open) return null;

  const selSource = selected ? sourceById.get(selected.source) : undefined;
  const readers = selected ? sectors.filter((s) => sectorSourceIds(s).includes(selected.source)) : [];
  const vaultPath = typeof selSource?.config?.vault_path === "string" ? selSource.config.vault_path : "";
  const vaultName = vaultPath.split(/[\\/]/).filter(Boolean).pop() ?? "";
  const obsidianUrl = selected && selSource?.source_type === "obsidian" && vaultName
    ? `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(selected.path.replace(/\.md$/, ""))}`
    : null;

  return (
    <div className="absolute inset-0 z-40 flex items-stretch bg-stone-900/25 p-3 backdrop-blur-[2px]" onClick={onClose}>
      <div
        className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-stone-200 bg-[#faf8f4] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabeçalho */}
        <div className="flex flex-wrap items-center gap-3 border-b border-stone-200 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
              <BookOpen className="size-4" />
            </span>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-800">Cérebro</p>
              <p className="text-[10px] text-stone-500">
                {graph ? (
                  <>
                    {graph.nodes.length} notas · {graph.edges.length} ligações
                    {graph.unresolved > 0 && <> · {graph.unresolved} links sem nota</>}
                    {graph.truncated && <> · mostrando as mais recentes</>}
                  </>
                ) : loading ? "Carregando…" : "—"}
              </p>
            </div>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <label className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-stone-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar nota ou #tag"
                className="h-7 w-48 rounded-full border border-stone-200 bg-white pl-7 pr-3 text-xs text-stone-800 outline-none focus:border-emerald-400"
              />
            </label>
            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value === "all" ? "all" : Number(e.target.value))}
              className="h-7 rounded-full border border-stone-200 bg-white px-2.5 text-xs text-stone-700"
              title="Fonte de conhecimento"
            >
              <option value="all">Todas as fontes</option>
              {sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <div className="flex rounded-full border border-stone-200 bg-white p-0.5 text-[10px] font-medium uppercase tracking-wider">
              {(["folder", "source", "usage"] as const).map((c) => (
                <button
                  key={c}
                  onClick={() => setColorBy(c)}
                  title={c === "usage" ? "Mapa de calor: quantas vezes cada nota foi usada numa resposta" : undefined}
                  className={`rounded-full px-2.5 py-0.5 ${colorBy === c ? "bg-stone-900 text-white" : "text-stone-500 hover:text-stone-800"}`}
                >
                  {c === "folder" ? "Por pasta" : c === "source" ? "Por fonte" : "Por uso"}
                </button>
              ))}
            </div>
            <div className="flex rounded-full border border-stone-200 bg-white p-0.5 text-[10px] font-medium">
              {([
                ["all", "Todas", graph?.nodes.length ?? 0],
                ["unused", "Nunca usadas", unusedIds.size],
                ["broken", "Links quebrados", brokenIds.size],
              ] as const).map(([id, label, n]) => (
                <button
                  key={id}
                  onClick={() => setShow(id)}
                  disabled={id === "unused" && usageError}
                  title={id === "unused" ? "Nunca usadas como contexto de resposta (desde que o registro existe)" : id === "broken" ? "Notas com [[links]] para notas que não existem ou não foram indexadas" : undefined}
                  className={`rounded-full px-2.5 py-0.5 disabled:opacity-40 ${show === id ? (id === "broken" ? "bg-red-600 text-white" : "bg-stone-900 text-white") : "text-stone-500 hover:text-stone-800"}`}
                >
                  {label} <span className="font-mono opacity-70">{n}</span>
                </button>
              ))}
            </div>
            <button onClick={onClose} title="Fechar (Esc)" className="rounded-full p-1.5 text-stone-500 hover:bg-stone-200 hover:text-stone-900">
              <X className="size-4" />
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* Grafo */}
          <div ref={wrapRef} className="relative min-w-0 flex-1">
            <canvas
              ref={canvasRef}
              className="h-full w-full cursor-grab active:cursor-grabbing"
              onWheel={(e) => {
                const k0 = view.current.k;
                const k = Math.min(4, Math.max(0.15, k0 * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
                const rect = e.currentTarget.getBoundingClientRect();
                const mx = e.clientX - rect.left - rect.width / 2, my = e.clientY - rect.top - rect.height / 2;
                // zoom ancorado no cursor
                view.current = { k, x: mx - ((mx - view.current.x) * k) / k0, y: my - ((my - view.current.y) * k) / k0 };
              }}
              onMouseDown={(e) => { drag.current = { x: e.clientX, y: e.clientY, moved: false }; }}
              onMouseMove={(e) => {
                const d = drag.current;
                if (d) {
                  const dx = e.clientX - d.x, dy = e.clientY - d.y;
                  if (Math.abs(dx) + Math.abs(dy) > 2) d.moved = true;
                  view.current = { ...view.current, x: view.current.x + dx, y: view.current.y + dy };
                  d.x = e.clientX; d.y = e.clientY;
                  return;
                }
                const n = pick(e.clientX, e.clientY);
                setHoverId(n?.id ?? null);
                e.currentTarget.style.cursor = n ? "pointer" : "grab";
              }}
              onMouseUp={(e) => {
                const d = drag.current;
                drag.current = null;
                if (d && !d.moved) setSelectedId(pick(e.clientX, e.clientY)?.id ?? null);
              }}
              onMouseLeave={() => { drag.current = null; setHoverId(null); }}
            />

            {/* Legenda */}
            {colorBy === "usage" && graph && graph.nodes.length > 0 && (
              <div className="absolute bottom-3 left-3 rounded-xl border border-stone-200 bg-white/90 px-3 py-2 text-[10px] text-stone-600 shadow-sm">
                <p className="mb-1 font-semibold uppercase tracking-wider text-stone-500">Consultas por nota</p>
                <div className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full" style={{ background: UNUSED_COLOR }} /> nunca
                  <span
                    className="ml-2 h-2 w-20 rounded-full"
                    style={{ background: `linear-gradient(90deg, ${heatColor(1, 10)}, ${heatColor(10, 10)})` }}
                  />
                  <span>até {maxUses}×</span>
                </div>
                {usageError && <p className="mt-1 text-red-600">Não foi possível carregar o uso das notas.</p>}
                <p className="mt-1 text-stone-400">Conta a partir de quando o registro de fontes existe.</p>
              </div>
            )}
            {colorBy !== "usage" && groups.length > 0 && (
              <div className="absolute bottom-3 left-3 max-h-[40%] max-w-[240px] overflow-y-auto rounded-xl border border-stone-200 bg-white/90 px-3 py-2 text-[10px] text-stone-600 shadow-sm">
                <p className="mb-1 font-semibold uppercase tracking-wider text-stone-500">{colorBy === "folder" ? "Pastas" : "Fontes"}</p>
                {groups.map((g) => (
                  <div key={g} className="flex items-center gap-1.5">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: colorOf(g) }} />
                    <span className="truncate">{g}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Estados */}
            {loading && !graph && (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-stone-500">Carregando o Cérebro…</div>
            )}
            {error && (
              <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-red-600">{error}</div>
            )}
            {graph && graph.nodes.length === 0 && !error && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 p-6 text-center">
                <p className="text-sm font-medium text-stone-700">Nenhuma nota indexada ainda.</p>
                <p className="max-w-sm text-xs text-stone-500">
                  Cadastre um vault do Obsidian em Dados corporativos (fonte do tipo “Vault do Obsidian”) e sincronize.
                  Notas com <code>private: true</code> nunca entram no Cérebro.
                </p>
              </div>
            )}
          </div>

          {/* Painel da nota */}
          {selected && (
            <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-stone-200 bg-white px-4 py-3 text-xs text-stone-600">
              <div className="flex items-start gap-2">
                <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: nodeColor(selected) }} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold leading-snug text-stone-900">{selected.title}</p>
                  <p className="truncate font-mono text-[10px] text-stone-400" title={selected.path}>{selected.path}</p>
                </div>
                <button onClick={() => setSelectedId(null)} className="rounded p-0.5 text-stone-400 hover:text-stone-800"><X className="size-3.5" /></button>
              </div>

              <div className="mt-2 flex flex-wrap gap-1">
                <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px]">{selSource?.name ?? `Fonte ${selected.source}`}</span>
                {selected.folder && <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px]">{selected.folder}</span>}
                {selected.status !== "indexed" && (
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] text-amber-700">{selected.status}</span>
                )}
                {selected.tags.map((t) => (
                  <button key={t} onClick={() => setQuery(t)} className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700 hover:bg-emerald-100">
                    #{t.replace(/^#/, "")}
                  </button>
                ))}
              </div>

              {selected.excerpt && <p className="mt-3 leading-relaxed text-stone-700">{selected.excerpt}</p>}

              {obsidianUrl && (
                <a href={obsidianUrl} className="mt-3 inline-flex items-center gap-1 self-start rounded-full border border-stone-200 px-2.5 py-1 text-[11px] font-medium text-stone-700 hover:bg-stone-50">
                  <ExternalLink className="size-3" /> Abrir no Obsidian
                </a>
              )}

              <div className="mt-4">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-stone-500">Quem pode consultar</p>
                <p className="text-[11px]">★ CEO e Orquestrador-Geral <span className="text-stone-400">(cérebro principal)</span></p>
                {readers.length > 0
                  ? readers.map((s) => <p key={s.id} className="text-[11px]">◈ Setor {s.name}</p>)
                  : <p className="text-[11px] text-stone-400">Nenhum setor tem esta fonte como cérebro.</p>}
              </div>

              <div className="mt-4">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-stone-500">
                  Consultada por{usage ? ` · ${usage.length}` : ""}
                </p>
                {usage === null && <p className="text-[11px] text-stone-400">Carregando…</p>}
                {usage?.length === 0 && (
                  <p className="text-[11px] text-stone-400">Nenhum agente usou esta nota numa resposta ainda.</p>
                )}
                {usage?.map((u) => (
                  <p key={u.agent_id} className="flex items-baseline justify-between gap-2 text-[11px]">
                    <span className="truncate">
                      {u.agent_name}
                      {u.sector_name && <span className="text-stone-400"> · {u.sector_name}</span>}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-stone-500" title={`última vez: ${new Date(u.last_at).toLocaleString("pt-BR")}`}>
                      {u.count}×
                    </span>
                  </p>
                ))}
              </div>

              {(selected.broken_links ?? []).length > 0 && (
                <div className="mt-4">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-red-600">
                    Links quebrados · {selected.broken_links.length}
                  </p>
                  <p className="mb-1 text-[10px] text-stone-400">Apontam para nota inexistente, privada ou fora das tags indexadas.</p>
                  {selected.broken_links.map((l) => (
                    <p key={l} className="truncate font-mono text-[11px] text-red-700">[[{l}]]</p>
                  ))}
                </div>
              )}

              {([["Liga para", links.out], ["Citada por", links.inn]] as const).map(([label, list]) => (
                <div key={label} className="mt-4">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-stone-500">{label} · {list.length}</p>
                  {list.length === 0 && <p className="text-[11px] text-stone-400">—</p>}
                  {list.map((n) => (
                    <button key={n.id} onClick={() => focusOn(n.id)} className="block w-full truncate rounded px-1 py-0.5 text-left text-[11px] text-stone-700 hover:bg-stone-100">
                      {n.title}
                    </button>
                  ))}
                </div>
              ))}
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}

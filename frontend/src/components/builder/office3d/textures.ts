// office3d/textures.ts — texturas geradas em <canvas> (nada baixado da rede).
//
// Uma textura por combinação de parâmetros, cacheada no módulo: 30 monitores
// da mesma cor dividem a MESMA textura na GPU em vez de 30 × 5 meshes de
// "linhas de código" (o que a versão anterior fazia, um draw call por linha).
import * as THREE from "three";

const cache = new Map<string, THREE.CanvasTexture>();

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!];
}

function finish(key: string, c: HTMLCanvasElement, repeat?: [number, number]) {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  if (repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat[0], repeat[1]);
  }
  cache.set(key, tex);
  return tex;
}

// PRNG determinístico — a "tela" de cada variante é sempre a mesma entre
// recargas (mesma regra das cores de sala: nunca aleatório de verdade).
function rng(seed: number) {
  let s = seed || 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export type ScreenKind = "code" | "chart" | "design" | "exec";

/** Tela de monitor: editor de código, gráfico, paleta de design ou dashboard. */
export function screenTexture(accent: string, kind: ScreenKind = "code", variant = 0): THREE.CanvasTexture {
  const key = `screen:${accent}:${kind}:${variant % 4}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const [c, g] = makeCanvas(256, 160);
  const rand = rng(variant * 97 + accent.length * 13 + kind.length);
  g.fillStyle = "#0b1220";
  g.fillRect(0, 0, 256, 160);
  // Barra de título
  g.fillStyle = "#1c2536";
  g.fillRect(0, 0, 256, 14);
  ["#f87171", "#fbbf24", "#34d399"].forEach((col, i) => {
    g.fillStyle = col;
    g.beginPath();
    g.arc(9 + i * 10, 7, 3, 0, Math.PI * 2);
    g.fill();
  });

  if (kind === "code") {
    const palette = [accent, "#93c5fd", "#e2e8f0", "#fca5a5", "#86efac"];
    for (let line = 0; line < 12; line++) {
      const y = 22 + line * 11;
      let x = 10 + (line % 4 === 0 ? 0 : 12 * Math.floor(rand() * 3));
      const tokens = 1 + Math.floor(rand() * 4);
      for (let t = 0; t < tokens; t++) {
        const w = 12 + rand() * 46;
        g.fillStyle = palette[Math.floor(rand() * palette.length)]!;
        g.globalAlpha = 0.85;
        g.fillRect(x, y, w, 5);
        x += w + 6;
      }
    }
    g.globalAlpha = 1;
  } else if (kind === "chart") {
    g.strokeStyle = "rgba(148,163,184,0.25)";
    for (let i = 0; i < 5; i++) {
      g.beginPath();
      g.moveTo(10, 30 + i * 26);
      g.lineTo(246, 30 + i * 26);
      g.stroke();
    }
    g.strokeStyle = accent;
    g.lineWidth = 3;
    g.beginPath();
    let y = 110;
    for (let x = 10; x <= 246; x += 12) {
      y = Math.max(28, Math.min(140, y + (rand() - 0.55) * 22));
      if (x === 10) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 3 === 0 ? "#f87171" : "#34d399";
      const h = 10 + rand() * 30;
      g.fillRect(16 + i * 29, 150 - h, 14, h);
    }
  } else if (kind === "design") {
    const sw = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#8b5cf6", "#ec4899", accent];
    sw.forEach((col, i) => {
      g.fillStyle = col;
      g.fillRect(12 + i * 33, 24, 26, 26);
    });
    g.fillStyle = "#e2e8f0";
    g.fillRect(12, 62, 140, 86);
    g.fillStyle = accent;
    g.beginPath();
    g.arc(82, 105, 26, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#334155";
    for (let i = 0; i < 5; i++) g.fillRect(164, 66 + i * 16, 80 - rand() * 30, 6);
  } else {
    // exec: KPIs grandes + pizza
    g.fillStyle = accent;
    g.font = "bold 30px sans-serif";
    g.fillText("98%", 14, 60);
    g.fillStyle = "#94a3b8";
    g.fillRect(14, 70, 90, 5);
    const slices = [0.4, 0.25, 0.2, 0.15];
    const cols = [accent, "#60a5fa", "#fbbf24", "#f472b6"];
    let a0 = -Math.PI / 2;
    slices.forEach((s, i) => {
      g.fillStyle = cols[i]!;
      g.beginPath();
      g.moveTo(190, 85);
      g.arc(190, 85, 48, a0, a0 + s * Math.PI * 2);
      g.fill();
      a0 += s * Math.PI * 2;
    });
    for (let i = 0; i < 4; i++) {
      g.fillStyle = cols[i]!;
      g.fillRect(14, 92 + i * 14, 20 + rand() * 70, 7);
    }
  }
  return finish(key, c);
}

export type FloorPattern = "tile" | "carpet" | "wood" | "plain";

/** Piso de sala com padrão sutil (lajota, carpete, madeira). */
export function floorTexture(base: string, pattern: FloorPattern, repeat: [number, number]): THREE.CanvasTexture {
  const key = `floor:${base}:${pattern}:${repeat.join("x")}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const [c, g] = makeCanvas(128, 128);
  g.fillStyle = base;
  g.fillRect(0, 0, 128, 128);
  const rand = rng(base.length * 31 + pattern.length);

  if (pattern === "tile") {
    g.strokeStyle = "rgba(0,0,0,0.07)";
    g.lineWidth = 2;
    g.strokeRect(1, 1, 126, 126);
    g.beginPath();
    g.moveTo(64, 0); g.lineTo(64, 128);
    g.moveTo(0, 64); g.lineTo(128, 64);
    g.stroke();
  } else if (pattern === "carpet") {
    for (let i = 0; i < 900; i++) {
      g.fillStyle = rand() > 0.5 ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)";
      g.fillRect(rand() * 128, rand() * 128, 2, 2);
    }
  } else if (pattern === "wood") {
    for (let row = 0; row < 8; row++) {
      g.fillStyle = row % 2 ? "rgba(0,0,0,0.05)" : "rgba(255,255,255,0.05)";
      g.fillRect(0, row * 16, 128, 16);
      g.strokeStyle = "rgba(0,0,0,0.08)";
      g.beginPath();
      g.moveTo(0, row * 16); g.lineTo(128, row * 16);
      const off = (row * 37) % 128;
      g.moveTo(off, row * 16); g.lineTo(off, row * 16 + 16);
      g.stroke();
    }
  }
  return finish(key, c, repeat);
}

/**
 * Texto rasterizado num canvas — substitui o <Text> do drei (troika), que
 * baixa a fonte de uma CDN em tempo de execução: sem rede, a cena inteira
 * ficava em branco. Usa a fonte do sistema, nenhuma requisição.
 * Retorna a textura e a proporção largura/altura para dimensionar o plano.
 */
export function labelTexture(
  text: string,
  opts: { color?: string; bg?: string; weight?: number; font?: string } = {},
): { tex: THREE.CanvasTexture; aspect: number } {
  const { color = "#26231f", bg = "transparent", weight = 600, font = "system-ui, -apple-system, 'Segoe UI', sans-serif" } = opts;
  const key = `label:${text}:${color}:${bg}:${weight}:${font}`;
  const hit = cache.get(key);
  const H = 64;
  const fontStr = `${weight} ${H * 0.56}px ${font}`;
  if (hit) return { tex: hit, aspect: (hit.image as HTMLCanvasElement).width / H };

  const [probe, pg] = makeCanvas(8, 8);
  void probe;
  pg.font = fontStr;
  const w = Math.ceil(pg.measureText(text).width + H * 0.5);
  const [c, g] = makeCanvas(w, H);
  if (bg !== "transparent") {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, H);
  }
  g.font = fontStr;
  g.fillStyle = color;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, w / 2, H / 2 + 2);
  const tex = finish(key, c);
  return { tex, aspect: w / H };
}

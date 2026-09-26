// office3d/merge.ts — funde peças estáticas num único mesh (1 draw call).
//
// Móveis eram montados com várias <mesh> soltas (uma cadeira = 18, uma
// mesa ≈ 10, um boneco ≈ 16). Com 60 agentes isso dava ~12 mil draw calls
// por quadro, contando a passada de sombra. Aqui cada peça vira parte de
// UMA geometria, com a cor gravada por vértice — mesma aparência, uma
// chamada de desenho. A geometria fundida é cacheada por chave (ex: cor da
// cadeira), então 60 cadeiras iguais dividem a mesma geometria na GPU.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export interface Part {
  geo: THREE.BufferGeometry;
  pos?: [number, number, number];
  rot?: [number, number, number];
  scale?: [number, number, number];
  color: string;
}

const cache = new Map<string, THREE.BufferGeometry>();
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();

/** Geometria fundida (cacheada por `key`) com atributo `color` por vértice. */
export function mergedGeometry(key: string, build: () => Part[]): THREE.BufferGeometry {
  const hit = cache.get(key);
  if (hit) return hit;
  const geos = build().map((p) => {
    // toNonIndexed: todas as partes precisam do mesmo formato pra fundir
    const g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
    tmpE.set(...(p.rot ?? [0, 0, 0]));
    tmpQ.setFromEuler(tmpE);
    tmpM.compose(
      new THREE.Vector3(...(p.pos ?? [0, 0, 0])),
      tmpQ,
      new THREE.Vector3(...(p.scale ?? [1, 1, 1])),
    );
    g.applyMatrix4(tmpM);
    // Color converte de sRGB pro espaço linear de trabalho — igual ao que
    // o `color` de um material faria; vertexColors usa o valor como está.
    const c = new THREE.Color(p.color);
    const n = g.attributes.position!.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
    g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
    for (const name of Object.keys(g.attributes)) {
      if (!["position", "normal", "color"].includes(name)) g.deleteAttribute(name);
    }
    return g;
  });
  const merged = mergeGeometries(geos, false);
  if (!merged) throw new Error(`mergedGeometry(${key}): partes incompatíveis`);
  merged.computeBoundingSphere();
  geos.forEach((g) => g.dispose());
  cache.set(key, merged);
  return merged;
}

/** Material compartilhado pra todos os meshes fundidos (cor vem do vértice). */
export const mergedMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65, metalness: 0.05 });

// Primitivas compartilhadas (evita recriar a mesma BoxGeometry mil vezes)
const prim = new Map<string, THREE.BufferGeometry>();
export function box(w: number, h: number, d: number) {
  const k = `b${w},${h},${d}`;
  let g = prim.get(k);
  if (!g) { g = new THREE.BoxGeometry(w, h, d); prim.set(k, g); }
  return g;
}
export function cyl(rt: number, rb: number, h: number, seg = 8) {
  const k = `c${rt},${rb},${h},${seg}`;
  let g = prim.get(k);
  if (!g) { g = new THREE.CylinderGeometry(rt, rb, h, seg); prim.set(k, g); }
  return g;
}
export function sphere(r: number, ws = 8, hs = 6) {
  const k = `s${r},${ws},${hs}`;
  let g = prim.get(k);
  if (!g) { g = new THREE.SphereGeometry(r, ws, hs); prim.set(k, g); }
  return g;
}

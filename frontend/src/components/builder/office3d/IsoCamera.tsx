// office3d/IsoCamera.tsx — câmera ortográfica isométrica ("planta 3D").
//
// Projeção ortográfica = sem distorção de perspectiva: salas do fundo têm o
// mesmo tamanho das da frente, como numa planta de arquiteto. Zoom é
// `camera.zoom` (pixels por unidade), então o enquadramento inicial é
// calculado a partir do tamanho real do canvas e da área ocupada pelas salas.
import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";

export type CamMode = "overview" | "topdown" | "front";

const DIRS: Record<CamMode, [number, number, number]> = {
  overview: [1, 0.95, 1.1],
  topdown: [0, 1, 0.0001],
  front: [0, 0.6, 1],
};

export function IsoCamera({
  mode,
  center,
  extent,
  zoom,
  homeKey,
}: {
  mode: CamMode;
  center: [number, number];
  /** Largura (x) e profundidade (z) da área ocupada. */
  extent: [number, number];
  /** Multiplicador vindo dos botões +/− (1 = enquadramento automático). */
  zoom: number;
  /** Muda para forçar "voltar ao início". */
  homeKey: number;
}) {
  const { camera, size, controls } = useThree();
  const [cx, cz] = center;
  const [w, d] = extent;

  useEffect(() => {
    const dir = new THREE.Vector3(...DIRS[mode]).normalize();
    camera.position.set(cx + dir.x * 120, dir.y * 120, cz + dir.z * 120);
    camera.up.set(0, 1, 0);
    camera.lookAt(cx, 0, cz);

    // Enquadramento: projeta os 8 cantos da caixa ocupada (salas + altura das
    // paredes/cartões) no espaço da câmera e ajusta o zoom pra caber tudo.
    camera.updateMatrixWorld();
    const inv = camera.matrixWorldInverse;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const px of [cx - w / 2, cx + w / 2])
      for (const py of [-0.4, 7.5])
        for (const pz of [cz - d / 2, cz + d / 2]) {
          const v = new THREE.Vector3(px, py, pz).applyMatrix4(inv);
          minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
          minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
        }
    const fit = Math.min(size.width / Math.max(maxX - minX, 1), size.height / Math.max(maxY - minY, 1)) * 0.9;
    if (camera instanceof THREE.OrthographicCamera) {
      camera.zoom = Math.max(4, fit * zoom);
      camera.updateProjectionMatrix();
    }
    const ctl = controls as unknown as { target?: THREE.Vector3; update?: () => void } | null;
    if (ctl?.target) {
      ctl.target.set(cx, 0, cz);
      ctl.update?.();
    }
    // tamanho do canvas entra só no primeiro enquadramento/mudança explícita —
    // redimensionar a janela não deve "roubar" o zoom que o usuário escolheu
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, cx, cz, w, d, zoom, homeKey, controls]);

  return null;
}

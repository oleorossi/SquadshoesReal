/**
 * Geometria do CAD de moldes: converte pixels do scan → área real.
 *
 * O molde é traçado em PIXELS sobre a imagem escaneada. Com o DPI do scanner
 * (pontos por polegada), 1 polegada = 25,4 mm, então a escala é fixa e a área
 * sai em dm² (1 dm² = 10000 mm²). A unidade é o ponto onde o projeto já errou
 * 100× — aqui ela é explícita e testada.
 */

export interface Pt {
  x: number;
  y: number;
}

/** Área do polígono (fórmula do shoelace) na MESMA unidade dos vértices, ao quadrado. */
export function shoelaceArea(pts: Pt[]): number {
  const n = pts?.length ?? 0;
  if (n < 3) return 0;
  let a = 0;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

/** mm por pixel dado o DPI (25,4 mm por polegada). DPI ≤ 0 → 0. */
export function mmPerPixel(dpi: number): number {
  return dpi > 0 ? 25.4 / dpi : 0;
}

/** Converte um ponto em pixels (imagem) → mm. Y opcionalmente invertido (CAD = Y pra cima). */
export function pxToMm(pt: Pt, dpi: number, flipYHeightPx?: number): Pt {
  const k = mmPerPixel(dpi);
  const y = flipYHeightPx != null ? (flipYHeightPx - pt.y) : pt.y;
  return { x: pt.x * k, y: y * k };
}

/** Área de um polígono (em pixels) convertida pra dm², dado o DPI. */
export function polygonAreaDm2(ptsPx: Pt[], dpi: number): number {
  const mmpp = mmPerPixel(dpi);
  if (mmpp <= 0) return 0;
  const areaPx2 = shoelaceArea(ptsPx);
  const areaMm2 = areaPx2 * mmpp * mmpp;
  return areaMm2 / 10000; // mm² → dm²
}

/** Soma das áreas (dm²) de várias peças. */
export function totalAreaDm2(polygonsPx: Pt[][], dpi: number): number {
  return (polygonsPx ?? []).reduce((s, poly) => s + polygonAreaDm2(poly, dpi), 0);
}

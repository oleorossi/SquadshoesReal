/**
 * Geometria de bobina napa-base para rendimento de tira.
 *
 * Decisão do dono (grill Hub 19/10/2026): rendimento é por
 * (medida de tira × geometria da bobina). 1000×1370 ≡ 1370×1000.
 * Famílias com a mesma geometria recebem o mesmo m/m.
 */

export interface StrapNapaSheetDims {
  /** Largura da ficha de componente (mm). */
  widthMm: number;
  /** Comprimento da ficha de componente (mm); 0 = não cadastrado. */
  lengthMm: number;
}

export interface StrapNapaGeometryKey {
  /** Menor dimensão positiva (0 se só uma dimensão cadastrada). */
  minMm: number;
  /** Maior dimensão positiva (largura útil da bobina na prática). */
  maxMm: number;
}

/** Normaliza o par (w,l) — orientação não importa. */
export function normalizeStrapNapaGeometry(
  widthMm: number | null | undefined,
  lengthMm: number | null | undefined,
): StrapNapaGeometryKey | null {
  const w = Number(widthMm) || 0;
  const l = Number(lengthMm) || 0;
  const positives = [w, l].filter((v) => v > 0);
  if (positives.length === 0) return null;
  if (positives.length === 1) {
    return { minMm: 0, maxMm: positives[0] };
  }
  return {
    minMm: Math.min(positives[0], positives[1]),
    maxMm: Math.max(positives[0], positives[1]),
  };
}

/**
 * Duas fichas casam quando o maior lado é igual e o menor ou coincide
 * ou está ausente (0) em pelo menos um dos lados — cobre ficha só com
 * largura 1370 ao lado de Soft 1000×1370.
 */
export function strapNapaGeometriesMatch(
  a: StrapNapaGeometryKey | null | undefined,
  b: StrapNapaGeometryKey | null | undefined,
): boolean {
  if (!a || !b) return false;
  if (!(a.maxMm > 0) || !(b.maxMm > 0)) return false;
  if (a.maxMm !== b.maxMm) return false;
  if (a.minMm > 0 && b.minMm > 0) return a.minMm === b.minMm;
  return true;
}

/** Chave estável para agrupar na UI / RPC (`1000x1370` ou `0x1370`). */
export function strapNapaGeometryKeyLabel(geom: StrapNapaGeometryKey | null | undefined): string | null {
  if (!geom || !(geom.maxMm > 0)) return null;
  return `${geom.minMm}x${geom.maxMm}`;
}

/** Rótulo humano: "1370 × 1000 mm" (maior primeiro, como o dono fala). */
export function formatStrapNapaGeometryLabel(geom: StrapNapaGeometryKey | null | undefined): string {
  if (!geom || !(geom.maxMm > 0)) return 'Geometria ausente';
  if (!(geom.minMm > 0)) return `${geom.maxMm.toLocaleString('pt-BR')} mm (só um lado)`;
  return `${geom.maxMm.toLocaleString('pt-BR')} × ${geom.minMm.toLocaleString('pt-BR')} mm`;
}

/**
 * Teto teórico = floor(maior lado ÷ banda).
 * Espelha o CHECK legado e o prefill da Configuração (Q6).
 */
export function strapGeometryYieldCeiling(
  geom: StrapNapaGeometryKey | null | undefined,
  cutBandWidthMm: number | null | undefined,
): number {
  const band = Number(cutBandWidthMm) || 0;
  if (!geom || !(geom.maxMm > 0) || !(band > 0)) return 0;
  return Math.floor(geom.maxMm / band);
}

export function dimsFromSheet(sheet: StrapNapaSheetDims | null | undefined): StrapNapaGeometryKey | null {
  if (!sheet) return null;
  return normalizeStrapNapaGeometry(sheet.widthMm, sheet.lengthMm);
}

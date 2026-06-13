/**
 * Escalonamento de consumo por numeração (cabedal / tiras).
 *
 * Dado o consumo no TAMANHO BASE (ex.: medido do DXF no 37), gera o consumo em
 * TODAS as numerações da faixa do solado. O fator por número segue, em ordem:
 *
 *   1. RAZÃO REAL DO SOLADO — quando `soleMetricPerSize` (ex.: insole_dm2 por
 *      número de `sole_technical_specs`) tem progressão NÃO chapada:
 *      `fator(s) = metric(s) / metric(base)`. Reflete a grade real da fábrica.
 *   2. GRADE PADRÃO (fallback) — sistema de ponto francês: o comprimento da forma
 *      é ~proporcional ao número (1 número ≈ 6,67 mm), então
 *      `fator_linear(s) = s / base`. Cabedal (área 2D) usa `fator²`; tira
 *      (linear, comprimento) usa o fator linear.
 *
 * Saída: `{ "34": v, "35": v, ... }` na MESMA unidade do `base` (o caller
 * converte dm²→m/cm conforme a coluna de destino — ver convertDm2ToLinearMeters).
 *
 * Hoje os specs do solado costumam estar CHAPADOS (mesmo valor em todo número)
 * porque nunca houve ferramenta de escalonamento — por isso o caminho (2) é o
 * default efetivo até o solado ter progressão real cadastrada.
 */

export type ScaleMode = 'area' | 'linear';

export interface ScaleConsumptionInput {
  /** Consumo no tamanho base (na unidade que será gravada). */
  base: number;
  /** Numeração base (ex.: 37). */
  baseSize: number;
  /** Faixa completa de numerações a preencher (ex.: [34,35,...,41]). */
  sizes: number[];
  /** 'area' (cabedal, escala ~²) | 'linear' (tira, comprimento). Default 'area'. */
  mode?: ScaleMode;
  /** Métrica do solado por número (ex.: insole_dm2). Usada como razão se não-chapada. */
  soleMetricPerSize?: Record<string | number, number> | null;
  /** Casas decimais do resultado. Default 4 (ex.: 4,6800). */
  decimals?: number;
}

const roundTo = (v: number, d: number): number => {
  const p = Math.pow(10, d);
  return Math.round(v * p) / p;
};

const metricAt = (m: Record<string | number, number>, size: number): number =>
  Number(m?.[size] ?? m?.[String(size)] ?? 0) || 0;

/**
 * Há progressão REAL (não chapada) na métrica do solado? True se houver ≥2
 * valores positivos e a amplitude relativa passar de 0,1%.
 */
export function isNonFlatProgression(
  metric: Record<string | number, number> | null | undefined,
  sizes: number[],
): boolean {
  if (!metric) return false;
  const vals = sizes.map((s) => metricAt(metric, s)).filter((v) => v > 0);
  if (vals.length < 2) return false;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  return min > 0 && (max - min) / min > 0.001;
}

/** Fator da grade padrão (ponto francês: comprimento ∝ número). */
export function standardScaleFactor(size: number, baseSize: number, mode: ScaleMode): number {
  if (!baseSize) return 1;
  const lin = size / baseSize;
  return mode === 'area' ? lin * lin : lin;
}

/** Gera o consumo por número a partir do base. Base ≤ 0 ou faixa vazia → {}. */
export function scaleConsumptionBySize(input: ScaleConsumptionInput): Record<string, number> {
  const { base, baseSize, sizes, mode = 'area', soleMetricPerSize = null, decimals = 4 } = input;
  const out: Record<string, number> = {};
  if (!(base > 0) || !Array.isArray(sizes) || sizes.length === 0) return out;

  const soleUsable =
    !!soleMetricPerSize &&
    isNonFlatProgression(soleMetricPerSize, sizes) &&
    metricAt(soleMetricPerSize, baseSize) > 0;
  const mb = soleUsable ? metricAt(soleMetricPerSize!, baseSize) : 0;

  for (const s of sizes) {
    let factor: number;
    if (soleUsable) {
      const ms = metricAt(soleMetricPerSize!, s);
      factor = ms > 0 ? ms / mb : standardScaleFactor(s, baseSize, mode);
    } else {
      factor = standardScaleFactor(s, baseSize, mode);
    }
    out[String(s)] = roundTo(base * factor, decimals);
  }
  return out;
}

/** Expande "34-41" ou "34-41,43" em [34,...,41,43]. Aceita também já-array. */
export function expandSizeRange(range: string | number[] | null | undefined): number[] {
  if (Array.isArray(range)) return range.map(Number).filter((n) => Number.isFinite(n));
  if (!range) return [];
  const out: number[] = [];
  for (const part of String(range).split(',')) {
    const m = part.trim().match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      const a = parseInt(m[1], 10);
      const b = parseInt(m[2], 10);
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.push(i);
    } else {
      const n = parseInt(part.trim(), 10);
      if (Number.isFinite(n)) out.push(n);
    }
  }
  return out;
}

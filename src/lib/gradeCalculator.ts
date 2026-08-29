export type GradePresetKey = 'infantil' | 'adulto';

export interface GradePreset {
  label: string;
  from: number;
  to: number;
}

export type GradeQuantityMap = Record<string, number>;

export interface GradeCalculationRow {
  size: number;
  needPerSheet: number;
  need: number;
  ready: number;
  used: number;
  final: number;
  surplus: number;
}

export interface GradeCalculationTotals {
  needPerSheet: number;
  need: number;
  ready: number;
  used: number;
  final: number;
  surplus: number;
}

export interface GradeCalculation {
  rows: GradeCalculationRow[];
  totals: GradeCalculationTotals;
  sheetCount: number;
}

export const GRADE_MIN_SIZE = 15;
export const GRADE_MAX_SIZE = 50;
export const GRADE_MAX_LENGTH = 24;
export const GRADE_MAX_SHEET_COUNT = 999;

export const GRADE_PRESETS: Record<GradePresetKey, GradePreset> = {
  infantil: { label: 'Infantil', from: 23, to: 36 },
  adulto: { label: 'Adulto', from: 33, to: 40 },
};

export function nonNegativeInteger(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor(parsed));
}

export function normalizeSheetCount(value: unknown, fallback = 1): number {
  const parsed = nonNegativeInteger(value);
  if (parsed < 1) return fallback;
  return Math.min(parsed, GRADE_MAX_SHEET_COUNT);
}

export function validateGradeRange(from: number, to: number): string {
  if (from < GRADE_MIN_SIZE || to > GRADE_MAX_SIZE) {
    return `Use numerações entre ${GRADE_MIN_SIZE} e ${GRADE_MAX_SIZE}.`;
  }
  if (from > to) return 'A numeração inicial precisa ser menor ou igual à final.';
  if (to - from + 1 > GRADE_MAX_LENGTH) {
    return `A faixa pode ter no máximo ${GRADE_MAX_LENGTH} numerações.`;
  }
  return '';
}

export function buildGradeSizes(from: number, to: number): number[] {
  if (validateGradeRange(from, to)) return [];
  return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}

export function sanitizeQuantityMap(value: unknown): GradeQuantityMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const output: GradeQuantityMap = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!/^\d{1,2}$/.test(key)) continue;
    const quantity = nonNegativeInteger(raw);
    if (quantity > 0) output[key] = quantity;
  }
  return output;
}

export function calculateGrade(
  sizes: number[],
  sheetCountValue: unknown,
  needBySize: GradeQuantityMap,
  readyBySize: GradeQuantityMap,
): GradeCalculation {
  const sheetCount = normalizeSheetCount(sheetCountValue);
  const rows = sizes.map((size) => {
    const key = String(size);
    const needPerSheet = nonNegativeInteger(needBySize[key]);
    const need = needPerSheet * sheetCount;
    const ready = nonNegativeInteger(readyBySize[key]);
    return {
      size,
      needPerSheet,
      need,
      ready,
      used: Math.min(need, ready),
      final: Math.max(0, need - ready),
      surplus: Math.max(0, ready - need),
    };
  });

  const totals = rows.reduce<GradeCalculationTotals>((sum, row) => ({
    needPerSheet: sum.needPerSheet + row.needPerSheet,
    need: sum.need + row.need,
    ready: sum.ready + row.ready,
    used: sum.used + row.used,
    final: sum.final + row.final,
    surplus: sum.surplus + row.surplus,
  }), {
    needPerSheet: 0,
    need: 0,
    ready: 0,
    used: 0,
    final: 0,
    surplus: 0,
  });

  return { rows, totals, sheetCount };
}

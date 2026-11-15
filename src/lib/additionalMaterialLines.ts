import { pickConsumptionForSize } from '@/lib/materialConsumption';

/**
 * Consumo das linhas de materiais adicionais da ficha (sheet_materials).
 *
 * Espelha public.sheet_material_lines_required (mig 20270101045900):
 * linha inativa ou fora do consumo não entra; 'per_size' soma tamanho a
 * tamanho (sheet_material_grading > consumption_per_size > média da linha);
 * wastage_percentage multiplica; linhas do mesmo produto são somadas.
 *
 * A Lista de Separação recebe orders.quantity e uma grade que pode ser a
 * ficha-base (Σ menor que a quantidade). Com scaleGradeToQuantity, o total
 * da grade é escalado por quantidade ÷ Σgrade — o mesmo fator de
 * check_stock_availability. Grade real (Σ = quantidade) não muda.
 */

const GRADE_KEY = /^[0-9]+(\/[0-9]+)?$/;
const GRADE_VALUE = /^\s*[0-9]+(\.[0-9]+)?\s*$/;

export interface AdditionalMaterialLineInput {
  id?: string | null;
  productId: string | null | undefined;
  quantityPerUnit?: number | null;
  consumptionType?: string | null;
  consumptionPerSize?: Record<string, unknown> | null;
  wastagePercentage?: number | null;
  isActive?: boolean | null;
  includeInConsumption?: boolean | null;
  createdAt?: string | null;
}

export interface SheetMaterialGradingInput {
  sheetMaterialId: string;
  sizeNumber: number;
  specificConsumption: number | null;
  createdAt?: string | null;
}

export interface AdditionalMaterialRequirement {
  productId: string;
  requiredRaw: number;
  lineCount: number;
  fallbackSizes: string[];
  firstCreatedAt: string | null;
}

interface GradeBucket {
  sizeKey: string;
  sizeNum: number;
  pairs: number;
}

function gradeBuckets(grade: Record<string, unknown> | null | undefined): GradeBucket[] {
  if (!grade || typeof grade !== 'object' || Array.isArray(grade)) return [];
  const buckets: GradeBucket[] = [];
  for (const [key, raw] of Object.entries(grade)) {
    if (!GRADE_KEY.test(key)) continue;
    const text = typeof raw === 'number' ? String(raw) : String(raw ?? '');
    if (!GRADE_VALUE.test(text)) continue;
    const pairs = Number(text);
    if (!(pairs > 0)) continue;
    const sizeNum = Number(key.split('/')[0]);
    if (!Number.isInteger(sizeNum)) continue;
    buckets.push({ sizeKey: key, sizeNum, pairs });
  }
  return buckets;
}

function gradingConsumption(
  lineId: string | null | undefined,
  sizeNum: number,
  grading: readonly SheetMaterialGradingInput[],
): number | null {
  if (!lineId) return null;
  const matches = grading.filter((row) =>
    row.sheetMaterialId === lineId
    && row.sizeNumber === sizeNum
    && row.specificConsumption != null
    && Number.isFinite(Number(row.specificConsumption)),
  );
  if (matches.length === 0) return null;
  matches.sort((a, b) => {
    const at = a.createdAt ?? '';
    const bt = b.createdAt ?? '';
    if (at === bt) return 0;
    if (!at) return 1;
    if (!bt) return -1;
    return bt.localeCompare(at);
  });
  return Number(matches[0].specificConsumption);
}

export function additionalMaterialLinesRequired(args: {
  lines: readonly AdditionalMaterialLineInput[];
  grade?: Record<string, unknown> | null;
  quantity?: number | null;
  grading?: readonly SheetMaterialGradingInput[];
  scaleGradeToQuantity?: boolean;
}): AdditionalMaterialRequirement[] {
  const buckets = gradeBuckets(args.grade);
  const hasGrade = buckets.length > 0;
  const quantity = Number(args.quantity) || 0;
  const grading = args.grading ?? [];
  const gradeSum = buckets.reduce((sum, bucket) => sum + bucket.pairs, 0);
  const scale = args.scaleGradeToQuantity && hasGrade && gradeSum > 0
    ? quantity / gradeSum
    : 1;

  const byProduct = new Map<string, {
    requiredRaw: number;
    lineCount: number;
    fallback: Set<string>;
    firstCreatedAt: string | null;
  }>();

  for (const line of args.lines) {
    if (!line.productId) continue;
    if (line.isActive === false) continue;
    if (line.includeInConsumption === false) continue;

    const qpu = Number(line.quantityPerUnit) || 0;
    const wastePct = Math.max(Number(line.wastagePercentage) || 0, 0);
    const isPerSize = (line.consumptionType || 'fixed') === 'per_size';
    const fallback = new Set<string>();
    let raw = 0;

    if (hasGrade) {
      for (const bucket of buckets) {
        let sizeCons: number | null = null;
        if (isPerSize) {
          const fromGrading = gradingConsumption(line.id, bucket.sizeNum, grading);
          if (fromGrading != null) {
            sizeCons = fromGrading;
          } else {
            const picked = pickConsumptionForSize(line.consumptionPerSize, bucket.sizeKey);
            if (picked.found) sizeCons = picked.value;
          }
          if (sizeCons == null) fallback.add(bucket.sizeKey);
        }
        raw += bucket.pairs * (sizeCons == null ? qpu : sizeCons);
      }
      raw *= scale;
    } else {
      raw = qpu * quantity;
    }
    raw *= 1 + wastePct / 100;

    const existing = byProduct.get(line.productId);
    if (existing) {
      existing.requiredRaw += raw;
      existing.lineCount += 1;
      for (const size of fallback) existing.fallback.add(size);
      if (
        line.createdAt
        && (!existing.firstCreatedAt || line.createdAt < existing.firstCreatedAt)
      ) {
        existing.firstCreatedAt = line.createdAt;
      }
      continue;
    }
    byProduct.set(line.productId, {
      requiredRaw: raw,
      lineCount: 1,
      fallback,
      firstCreatedAt: line.createdAt ?? null,
    });
  }

  return [...byProduct.entries()]
    .map(([productId, row]) => ({
      productId,
      requiredRaw: row.requiredRaw,
      lineCount: row.lineCount,
      fallbackSizes: [...row.fallback].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
      firstCreatedAt: row.firstCreatedAt,
    }))
    .sort((a, b) => {
      const at = a.firstCreatedAt ?? '';
      const bt = b.firstCreatedAt ?? '';
      if (at !== bt) return at.localeCompare(bt);
      return a.productId.localeCompare(b.productId);
    });
}

export function soleStandardDuplicateWarning(requiredRaw: number): string {
  const rounded = Math.round((Number(requiredRaw) || 0) * 1e6) / 1e6;
  return `A ficha também lista este material nas linhas de materiais adicionais (${rounded} no total); ela foi IGNORADA porque o item padrão do solado já é a fonte oficial deste consumo.`;
}

export function perSizeFallbackWarning(sizes: readonly string[]): string | null {
  if (sizes.length === 0) return null;
  return `Linha de material adicional por numeração sem consumo nos tamanhos ${sizes.join(', ')} — usada a média da linha nesses tamanhos.`;
}

/**
 * Consumo POR PAR de uma ficha técnica, agrupado por material — o resumo
 * somente-leitura do card "Dados Principais" (spec `consumo-por-par-na-ficha`).
 *
 * Função PURA: recebe as fontes de consumo já resolvidas pela página (cabedal,
 * materiais extras, BOM, palmilha, tiras, solado) e devolve uma linha por
 * material, na UNIDADE DE ESTOQUE do produto:
 *  - área (dm²/par) de bobina/placa → ÷ `areaToStockDivisor` (largura/área da
 *    ficha de componente — regra canônica do CLAUDE.md). Sem largura: fica em
 *    dm² e marca `widthMissing`, nunca rotula dm² como metro.
 *  - tiras: gravadas em cm/PAR (o input da tela é cm/pé) → `scale 0.01` → m/par.
 *  - item direto (un, kg, m nativo): unidade nativa, sem conversão.
 *  - SEM perda de corte (decisão do dono, 03/08/2026).
 *
 * Média = média simples entre as numerações da GRADE da ficha (não de todo
 * valor cadastrado — evita spec copiada do adulto puxar a média infantil).
 */
import {
  areaToStockDivisor,
  normalizeText,
  pickConsumptionForSize,
  LINEAR_UNITS,
  PLATE_UNITS,
  type ComponentSheetCandidate,
} from '@/lib/materialConsumption';

export type PerPairSource = {
  /** Componente de origem (Cabedal, Material extra, BOM, Palmilha, Tiras, Solado…). */
  component: string;
  /** Nome do material (grupo ou produto). Mesmo nome + mesma unidade = 1 linha. */
  material: string;
  /** Setor do produto (`products.category`). Usado nas exclusões. */
  category?: string | null;
  /** Unidade de estoque do produto (`products.unit`). */
  stockUnit: string;
  /** 'dm2' = valor cadastrado em dm²/par (material de área); 'stock' = já na unidade de estoque. */
  inputUnit: 'dm2' | 'stock';
  componentSheet?: ComponentSheetCandidate | null;
  scalar: number;
  perSize?: Record<string, unknown> | null;
  /** Multiplicador aplicado ao valor nativo (tira: cm → m = 0.01). */
  scale?: number;
};

export type PerPairRow = {
  key: string;
  material: string;
  components: string[];
  unit: string;
  average: number;
  perSize: Record<string, number>;
  widthMissing: boolean;
};

/** Setores fora do resumo (decisão do dono, 10/10/2026). */
const EXCLUDED_CATEGORIES = new Set(['forração da palmilha', 'cola / químico', 'embalagem']);
const EXCLUDED_COMPONENTS = new Set(['forração', 'forração palmilha', 'fachete', 'químicos', 'embalagem']);

const stripAccents = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Forração (cabedal, palmilha, fachete), químicos, embalagem e qualquer grupo FIBRA saem. */
export function isExcludedFromPerPair(source: Pick<PerPairSource, 'component' | 'material' | 'category'>): boolean {
  if (EXCLUDED_COMPONENTS.has(normalizeText(source.component))) return true;
  if (EXCLUDED_CATEGORIES.has(normalizeText(source.category))) return true;
  return stripAccents(source.material || '').toUpperCase().includes('FIBRA');
}

/** Rótulo canônico de unidade (metro/metros/mt → m; dm2 → dm²). */
export function canonicalPerPairUnit(unit: string | null | undefined): string {
  const u = normalizeText(unit);
  if (!u) return 'un';
  if (['m', 'metro', 'metros', 'meters', 'mt', 'mts', 'm linear'].includes(u)) return 'm';
  if (u === 'dm2' || u === 'dm²') return 'dm²';
  if (u === 'm2' || u === 'm²') return 'm²';
  if (u === 'cm2' || u === 'cm²') return 'cm²';
  if (['unid', 'unidade', 'und'].includes(u)) return 'un';
  if (u === 'chapa' || u === 'placas') return 'placa';
  return u;
}

type Converter = { unit: string; factor: (dm2: number) => number; widthMissing: boolean };

function resolveConverter(source: PerPairSource): Converter {
  const stockUnit = canonicalPerPairUnit(source.stockUnit);
  const scale = source.scale ?? 1;
  if (source.inputUnit === 'stock') {
    return { unit: stockUnit, factor: (v) => v * scale, widthMissing: false };
  }
  // Área: só converte quando o estoque é físico (linear/placa).
  const raw = normalizeText(source.stockUnit);
  if (LINEAR_UNITS.has(raw) || PLATE_UNITS.has(raw)) {
    if (stockUnit === 'dm²') return { unit: 'dm²', factor: (v) => v, widthMissing: false };
    const divisor = areaToStockDivisor(source.stockUnit, source.componentSheet ?? null);
    if (divisor && divisor > 0) return { unit: stockUnit, factor: (v) => v / divisor, widthMissing: false };
    return { unit: 'dm²', factor: (v) => v, widthMissing: true };
  }
  return { unit: 'dm²', factor: (v) => v, widthMissing: false };
}

const valueForSize = (source: PerPairSource, size: string): number => {
  const picked = pickConsumptionForSize(source.perSize ?? null, size);
  const value = picked.found ? picked.value : Number(source.scalar);
  return Number.isFinite(value) && value > 0 ? value : 0;
};

export function computePerPairConsumption(
  sources: PerPairSource[],
  sizes: Array<string | number>,
): PerPairRow[] {
  const sizeKeys = sizes.map(String).filter((s) => s && !s.startsWith('_'));
  const rows = new Map<string, PerPairRow>();

  for (const source of sources) {
    if (!source.material?.trim() || isExcludedFromPerPair(source)) continue;
    const conv = resolveConverter(source);
    const perSize: Record<string, number> = {};
    for (const size of sizeKeys) perSize[size] = conv.factor(valueForSize(source, size));
    const scalarValue = conv.factor(Math.max(0, Number(source.scalar) || 0));
    const total = sizeKeys.length > 0 ? Object.values(perSize).reduce((a, b) => a + b, 0) : scalarValue;
    if (total <= 0) continue;

    const material = source.material.trim();
    const key = `${stripAccents(material).toUpperCase()}|${conv.unit}`;
    let row = rows.get(key);
    if (!row) {
      row = { key, material, components: [], unit: conv.unit, average: 0, perSize: {}, widthMissing: false };
      rows.set(key, row);
    }
    if (!row.components.includes(source.component)) row.components.push(source.component);
    row.widthMissing = row.widthMissing || conv.widthMissing;
    if (sizeKeys.length > 0) {
      for (const size of sizeKeys) row.perSize[size] = (row.perSize[size] || 0) + perSize[size];
    } else {
      row.average += scalarValue;
    }
  }

  return [...rows.values()]
    .map((row) => {
      if (sizeKeys.length > 0) {
        row.average = sizeKeys.reduce((sum, size) => sum + (row.perSize[size] || 0), 0) / sizeKeys.length;
      }
      return row;
    })
    .sort((a, b) => a.material.localeCompare(b.material, 'pt-BR'));
}

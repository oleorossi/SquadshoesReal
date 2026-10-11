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
 *
 * Revisão 2 (dono, 11/10/2026): só o que é EXCLUSIVO do modelo (saem solado,
 * palmilha, cola, linha e embalagem) e CUSTO por par = média × preço. A ficha
 * não tem cor: o preço é a MEDIANA do `unit_price` das cores candidatas, com a
 * faixa por par quando divergem. Sem preço nas cores do modelo → mediana do
 * grupo inteiro, marcada `estimated`.
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
  /** De onde sai o preço desta linha. Ausente = sem preço. */
  price?: PerPairPriceSource | null;
};

/** Um SKU candidato (uma "cor") com o custo unitário de estoque. */
export type PerPairPriceCandidate = { unit: string | null | undefined; unitPrice: number | null | undefined };

export type PerPairPriceSource = {
  /** SKUs que valem para ESTA ficha (cores do grupo, napa-base do modelo…). */
  candidates: PerPairPriceCandidate[];
  /** SKUs do grupo inteiro, usados só quando nenhum candidato tem preço → `estimated`. */
  fallbackCandidates?: PerPairPriceCandidate[];
  /** O que ficou sem preço, para explicar o estimado (ex.: "NAPA SOFT"). */
  missingScope?: string | null;
};

export type PerPairCostStatus = 'ok' | 'estimated' | 'missing' | 'no_width';

export type PerPairCost = {
  status: PerPairCostStatus;
  /** Mediana usada no cálculo (R$ por unidade da linha). */
  unitPrice: number | null;
  /** Custo médio por par (média × preço). */
  perPair: number | null;
  /** Faixa por par entre as cores — só quando os preços divergem e o status é `ok`. */
  perPairMin: number | null;
  perPairMax: number | null;
  missingScope: string | null;
};

export type PerPairRow = {
  key: string;
  material: string;
  components: string[];
  unit: string;
  average: number;
  perSize: Record<string, number>;
  widthMissing: boolean;
  /** Preço da primeira fonte que trouxe um (mesmo material = mesmo grupo). */
  price: PerPairPriceSource | null;
  cost: PerPairCost;
};

/**
 * Setores fora do resumo. 10/10/2026: forração, químicos, embalagem.
 * 11/10/2026: também os básicos comuns a todo modelo — solado e palmilha.
 */
const EXCLUDED_CATEGORIES = new Set([
  'forração da palmilha', 'cola / químico', 'embalagem', 'solado', 'palmilha',
]);
const EXCLUDED_COMPONENTS = new Set([
  'forração', 'forração palmilha', 'fachete', 'químicos', 'embalagem', 'solado', 'palmilha',
]);
/**
 * Básicos pelo NOME, por palavra inteira: COLA FORTE, COLA PVC, LINHANYL e
 * EMBALAGEM estão cadastrados como setor `Componente` em 14–18 fichas e
 * escapavam do filtro por setor. Palavra inteira de propósito — `CHOCOLATE`
 * (cor) contém "COLA".
 */
const EXCLUDED_NAME_PATTERNS = [/\bCOLA\b/, /\bLINHA/, /\bEMBALAGE/];
/**
 * Componentes cujo PAPEL vem do campo da ficha, não do setor de estoque. A
 * mesma napa é estocada como `Forração da Palmilha` e usada como cabedal
 * (NAPA SOFT / NAPA SUDANI — 10 fichas): filtrar pelo setor sumia com o
 * cabedal. Para estes, o setor do produto não exclui; o nome ainda exclui.
 */
const ROLE_FROM_SHEET_COMPONENTS = new Set(['cabedal', 'material extra', 'tiras']);

const stripAccents = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Saem: forração (cabedal, palmilha, fachete), químicos, embalagem, solado,
 * palmilha, cola, linha e qualquer grupo FIBRA.
 */
export function isExcludedFromPerPair(source: Pick<PerPairSource, 'component' | 'material' | 'category'>): boolean {
  const component = normalizeText(source.component);
  if (EXCLUDED_COMPONENTS.has(component)) return true;
  if (!ROLE_FROM_SHEET_COMPONENTS.has(component) && EXCLUDED_CATEGORIES.has(normalizeText(source.category))) {
    return true;
  }
  const name = stripAccents(source.material || '').toUpperCase();
  if (name.includes('FIBRA')) return true;
  return EXCLUDED_NAME_PATTERNS.some((pattern) => pattern.test(name));
}

/** Preços válidos (> 0) dos candidatos na unidade da linha. */
const pricesInUnit = (candidates: PerPairPriceCandidate[] | null | undefined, unit: string): number[] =>
  (candidates || [])
    .filter((c) => canonicalPerPairUnit(c.unit) === unit)
    .map((c) => Number(c.unitPrice))
    .filter((v) => Number.isFinite(v) && v > 0);

/** Mediana — robusta a um SKU com custo absurdo (ex.: overlock COBRE a R$ 20,50/m). */
export function medianPrice(values: number[]): number | null {
  const sorted = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const emptyCost = (status: PerPairCostStatus, missingScope: string | null = null): PerPairCost => ({
  status, unitPrice: null, perPair: null, perPairMin: null, perPairMax: null, missingScope,
});

/**
 * Custo por par de uma linha já consolidada. Preço na UNIDADE da linha — dm²
 * de material sem largura não casa com preço por metro e fica `no_width`.
 */
export function resolvePerPairCost(
  row: Pick<PerPairRow, 'unit' | 'average' | 'widthMissing'>,
  price: PerPairPriceSource | null | undefined,
): PerPairCost {
  if (row.widthMissing) return emptyCost('no_width');
  if (!price) return emptyCost('missing');
  const exact = pricesInUnit(price.candidates, row.unit);
  const exactMedian = medianPrice(exact);
  if (exactMedian != null) {
    const min = Math.min(...exact);
    const max = Math.max(...exact);
    // Faixa só quando aparece em centavos — senão sairia "R$ 0,54–0,54".
    const varies = Math.round(row.average * min * 100) !== Math.round(row.average * max * 100);
    return {
      status: 'ok',
      unitPrice: exactMedian,
      perPair: row.average * exactMedian,
      perPairMin: varies ? row.average * min : null,
      perPairMax: varies ? row.average * max : null,
      missingScope: null,
    };
  }
  const fallbackMedian = medianPrice(pricesInUnit(price.fallbackCandidates, row.unit));
  if (fallbackMedian != null) {
    return {
      status: 'estimated',
      unitPrice: fallbackMedian,
      perPair: row.average * fallbackMedian,
      perPairMin: null,
      perPairMax: null,
      missingScope: price.missingScope ?? null,
    };
  }
  return emptyCost('missing', price.missingScope ?? null);
}

export type PerPairCostSummary = {
  /** Soma do custo/par das linhas com preço (ok + estimado). */
  total: number;
  pricedCount: number;
  estimatedCount: number;
  /** Linhas sem preço ou sem largura — o total está incompleto quando > 0. */
  missingCount: number;
};

export function summarizePerPairCost(rows: Array<Pick<PerPairRow, 'cost'>>): PerPairCostSummary {
  let total = 0;
  let pricedCount = 0;
  let estimatedCount = 0;
  let missingCount = 0;
  for (const row of rows) {
    if (row.cost.perPair != null && (row.cost.status === 'ok' || row.cost.status === 'estimated')) {
      total += row.cost.perPair;
      pricedCount += 1;
      if (row.cost.status === 'estimated') estimatedCount += 1;
    } else {
      missingCount += 1;
    }
  }
  return { total, pricedCount, estimatedCount, missingCount };
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
      row = {
        key, material, components: [], unit: conv.unit, average: 0, perSize: {}, widthMissing: false,
        price: null, cost: emptyCost('missing'),
      };
      rows.set(key, row);
    }
    if (!row.components.includes(source.component)) row.components.push(source.component);
    if (!row.price && source.price) row.price = source.price;
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
      row.cost = resolvePerPairCost(row, row.price);
      return row;
    })
    .sort((a, b) => a.material.localeCompare(b.material, 'pt-BR'));
}

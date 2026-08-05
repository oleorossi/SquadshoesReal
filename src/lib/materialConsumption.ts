import { DEFAULT_SIZE_MULTIPLIERS } from './inventoryIntelligence';

type ComponentSheetProduct = {
  color?: string | null;
  name?: string | null;
  unit?: string | null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NumericRecordLike = any;

export type ComponentSheetCandidate = {
  dimensions_length?: number | null;
  dimensions_unit?: string | null;
  dimensions_width?: number | null;
  yield_per_size?: NumericRecordLike;
  yield_per_sole?: NumericRecordLike;
  products?: ComponentSheetProduct | null;
};

type GradeItem = {
  fichas?: number | null;
  grade?: NumericRecordLike;
  quantity?: number | null;
};

type SelectionMode = 'any' | 'linear' | 'plate';

// Set CANÔNICO de unidades lineares. DEVE espelhar o branch v_is_linear de
// get_material_conversion_info no SQL ('m','meters','metros','mt','cm','m linear')
// — senão um produto nessas unidades converte dm²→física no SQL mas NÃO no TS
// (areaToStockDivisor devolveria null → PurchasePlanningWizard infla ~100×).
// 'metro' (singular) é sinônimo aceito em UNIT_SYNONYMS; mantido por segurança.
// 'm linear' é o alvo canônico de toCanonical() em nfUnitConversion.ts pra
// mtl/m lin/ml (linear) — faltava aqui (achado na revisão de bugs 2026-07-01).
// Exportados (auditoria 2026-07-19, UNIT-1): orderConsumption/bomConsumption
// mantinham listas inline SEM 'm linear' — item nessa unidade não convertia no
// caminho BOM. Fonte única aqui; não recriar listas locais.
export const LINEAR_UNITS = new Set(['cm', 'm', 'metro', 'metros', 'meters', 'mt', 'm linear']);
// 'un' é CONTAGEM, não placa — removido (auditoria 2026-06-11). Mantê-lo aqui
// fazia um item de contagem com ficha dimensionada passar por convertDm2ToPlates.
// 'm2' (grafia sem acento, sinônimo proibido mas ainda visto em cadastro legado)
// aceito como leitura defensiva de 'm²'.
export const PLATE_UNITS = new Set(['dm2', 'dm²', 'm²', 'm2', 'placa', 'placas']);

const asNumericRecord = (value: NumericRecordLike): Record<string, number> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

   return Object.entries(value).reduce<Record<string, number>>((acc, [key, entryValue]) => {
     const numericValue = Number(entryValue);
     if (Number.isFinite(numericValue)) acc[key] = numericValue;
     return acc;
   }, {});
 };
 
 /**
  * Computes required quantity respecting per-size consumption.
  * Matches the PostgreSQL logic in calc_required_for_grade().
  */
 export const calcRequiredForGrade = (
   consumptionPerSize: Record<string, number> | null | undefined,
   grade: Record<string, number> | null | undefined,
   quantityPerUnit: number,
   totalQuantity: number
 ): number => {
   if (
     consumptionPerSize && 
     grade && 
     Object.keys(consumptionPerSize).length > 0 && 
     Object.keys(grade).length > 0
   ) {
     const total = Object.entries(grade).reduce((sum, [size, pairs]) => {
       const vPairs = Number(pairs) || 0;
       if (vPairs <= 0) return sum;
 
       const vCons = (consumptionPerSize[size] && consumptionPerSize[size] !== 0)
         ? Number(consumptionPerSize[size])
         : Number(quantityPerUnit);
 
       return sum + (vPairs * vCons);
     }, 0);
 
     if (total > 0) return total;
   }
 
   return (Number(quantityPerUnit) || 0) * (Number(totalQuantity) || 0);
 };
 
 export const normalizeText = (value?: string | null) => value?.trim().toLowerCase() || '';

/** Normaliza cor para chave de mapa de solado: minúsculo, SEM acento (NFD) e
 *  trim. Casa cor do pedido com product_color de forma robusta a grafia
 *  (Café=Cafe, CARAMELO=Caramelo). Tema T3 da auditoria 2026-06-11 — build e
 *  lookup do soleColorMap DEVEM usar este mesmo normalizador. */
export const normalizeColorKey = (value?: string | null): string =>
  (value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

const convertDimensionToMm = (value?: number | null, unit?: string | null) => {
  const numericValue = Number(value) || 0;
  const normalizedUnit = normalizeText(unit);

  if (normalizedUnit === 'cm') return numericValue * 10;
  if (normalizedUnit === 'dm') return numericValue * 100;
  if (normalizedUnit === 'm' || normalizedUnit === 'metro' || normalizedUnit === 'mt') return numericValue * 1000;

  return numericValue;
};

const getSheetUnit = (componentSheet: ComponentSheetCandidate | null) => normalizeText(componentSheet?.products?.unit);

const hasUsefulYield = (componentSheet: ComponentSheetCandidate | null) => {
  const yieldMap = asNumericRecord(componentSheet?.yield_per_size);
  return Object.entries(yieldMap).some(([key, value]) => key !== 'unit' && Number(value) > 0);
};

const getLinearWidthMm = (componentSheet: ComponentSheetCandidate | null) => {
  const widthMm = convertDimensionToMm(componentSheet?.dimensions_width, componentSheet?.dimensions_unit);
  const lengthMm = convertDimensionToMm(componentSheet?.dimensions_length, componentSheet?.dimensions_unit);
  return Math.max(widthMm, lengthMm);
};

const getPlateAreaDm2 = (componentSheet: ComponentSheetCandidate | null) => {
  const widthMm = convertDimensionToMm(componentSheet?.dimensions_width, componentSheet?.dimensions_unit);
  const lengthMm = convertDimensionToMm(componentSheet?.dimensions_length, componentSheet?.dimensions_unit);
  if (widthMm <= 0 || lengthMm <= 0) return 0;
  return (widthMm * lengthMm) / 10000;
};

export const sheetMatchesColor = (componentSheet: ComponentSheetCandidate | null, color?: string | null) => {
  const normalizedColor = normalizeText(color);
  if (!normalizedColor) return false;

  const explicitColor = normalizeText(componentSheet?.products?.color);
  const productName = normalizeText(componentSheet?.products?.name);
  
  return (
    explicitColor === normalizedColor ||
    productName === normalizedColor ||
    (productName.length > 2 && normalizedColor.includes(productName)) ||
    (explicitColor.length > 2 && normalizedColor.includes(explicitColor)) ||
    productName.includes(normalizedColor) ||
    explicitColor.includes(normalizedColor)
  );
};

const filterCandidatesByMode = (candidates: ComponentSheetCandidate[], mode: SelectionMode) => {
  if (mode === 'any') return candidates;

  const filtered = candidates.filter((candidate) => {
    const unit = getSheetUnit(candidate);
    if (mode === 'linear') return LINEAR_UNITS.has(unit);
    return PLATE_UNITS.has(unit);
  });

  return filtered.length > 0 ? filtered : candidates;
};

export const getPreferredComponentSheet = (
  candidates: ComponentSheetCandidate[],
  {
    color,
    mode = 'any',
    preferYield = false,
  }: { color?: string | null; mode?: SelectionMode; preferYield?: boolean } = {},
) => {
  if (candidates.length === 0) return null;

  const pool = filterCandidatesByMode(candidates, mode);
  const colorMatch = color ? pool.find((candidate) => sheetMatchesColor(candidate, color)) : null;
  if (colorMatch) return colorMatch;

  if (preferYield) {
    const withYield = pool.find((candidate) => hasUsefulYield(candidate));
    if (withYield) return withYield;
  }

  if (mode === 'linear') {
    return [...pool].sort((a, b) => getLinearWidthMm(b) - getLinearWidthMm(a))[0] || pool[0];
  }

  if (mode === 'plate') {
    return [...pool].sort((a, b) => getPlateAreaDm2(b) - getPlateAreaDm2(a))[0] || pool[0];
  }

  return pool[0];
};

/**
 * Resolves the best yield map for a component sheet, considering sole-specific yields.
 * Priority: overridePerSize > yield_per_sole[soleProductId] > yield_per_size (default)
 */
export const resolveYieldMap = (
  componentSheet: ComponentSheetCandidate | null,
  soleProductId?: string | null,
): Record<string, number> => {
  // 1. Check sole-specific yield
  if (soleProductId && componentSheet?.yield_per_sole) {
    const soleYield = componentSheet.yield_per_sole[soleProductId];
    if (soleYield && Object.values(soleYield).some(v => Number(v) > 0)) {
      return asNumericRecord(soleYield);
    }
  }
  // 2. Fallback to default yield_per_size
  return asNumericRecord(componentSheet?.yield_per_size);
};

export const calculateGradeBasedDm2 = (
  item: GradeItem,
  fallbackConsumption: number,
  componentSheet: ComponentSheetCandidate | null,
  overridePerSize?: Record<string, number> | null,
  soleProductId?: string | null,
  useGradeMultipliers?: boolean,
) => {
  const yieldMap = resolveYieldMap(componentSheet, soleProductId);
  const grade = asNumericRecord(item.grade);
  const gradeEntries = Object.entries(grade).filter(([, value]) => Number(value) > 0);
  const hasOverride = overridePerSize && Object.keys(overridePerSize).length > 0;
  const hasYield = Object.entries(yieldMap).some(([key, value]) => key !== 'unit' && Number(value) > 0);

  if (!hasYield && !hasOverride && !useGradeMultipliers || gradeEntries.length === 0) {
    return fallbackConsumption * (Number(item.quantity) || 0);
  }

  const gradePairsPerFicha = gradeEntries.reduce((sum, [, value]) => sum + Number(value), 0);
  const fichas = Number(item.fichas) || (gradePairsPerFicha > 0 ? (Number(item.quantity) || 0) / gradePairsPerFicha : 1);

  // fichas=0 would zero out all consumption; fall back to item quantity-based fallback
  if (fichas <= 0) return fallbackConsumption * (Number(item.quantity) || 0);

  return gradeEntries.reduce((sum, [size, value]) => {
    const pairs = Number(value) * fichas;
    let consumptionPerPair = (hasOverride && overridePerSize[size] > 0)
      ? Number(overridePerSize[size])
      : (Number(yieldMap[size]) || 0);

    if (consumptionPerPair <= 0) {
      const multiplier = useGradeMultipliers ? (DEFAULT_SIZE_MULTIPLIERS[size] || 1) : 1;
      consumptionPerPair = fallbackConsumption * multiplier;
    }

    return sum + (pairs * consumptionPerPair);
  }, 0);
};

/**
 * Espelho TS de `public.convert_to_product_unit(qty, src, tgt)` (SQL vivo).
 * Converte a quantidade do item-padrão do solado (sole_standard_items_consumption,
 * ex.: g/par) pra unidade de ESTOQUE do produto (ex.: kg) — mesma tabela de
 * conversões do SQL. Retorna:
 *   - qty convertida quando há regra (g→kg, ml→L, cm→m, dm²→m², mil→un, …);
 *   - qty INTACTA quando src==tgt, alguma unidade é vazia/desconhecida ou as
 *     duas são do mesmo "tipo" sem fator cadastrado (ex.: par→un);
 *   - null quando os tipos são CONHECIDOS e INCOMPATÍVEIS (ex.: g→m) — o caller
 *     deve manter a qty crua e sinalizar aviso, igual ao SQL.
 */
export function convertToProductUnit(
  qty: number,
  sourceUnit: string | null | undefined,
  targetUnit: string | null | undefined,
): number | null {
  const src = (sourceUnit || '').toLowerCase().trim();
  const tgt = (targetUnit || '').toLowerCase().trim();
  const q = Number(qty) || 0;
  if (src === tgt || src === '' || tgt === '') return q;

  const FACTORS: Record<string, number> = {
    'g>kg': 1 / 1000, 'mg>kg': 1 / 1000000, 'mg>g': 1 / 1000,
    'kg>g': 1000, 'kg>mg': 1000000, 'g>mg': 1000,
    'ml>l': 1 / 1000, 'l>ml': 1000,
    'cm>m': 1 / 100, 'm>cm': 100, 'mm>m': 1 / 1000, 'm>mm': 1000,
    'mm>cm': 1 / 10, 'cm>mm': 10,
    'dm²>m²': 1 / 100, 'm²>dm²': 100, 'cm²>dm²': 1 / 100, 'dm²>cm²': 100,
    'cm²>m²': 1 / 10000, 'm²>cm²': 10000, 'mm²>cm²': 1 / 100, 'cm²>mm²': 100,
    'mm²>dm²': 1 / 10000, 'mm²>m²': 1 / 1000000,
    'mil>un': 1000, 'un>mil': 1 / 1000, 'cento>un': 100, 'un>cento': 1 / 100,
    'dz>un': 12, 'un>dz': 1 / 12, 'cento>mil': 1 / 10, 'mil>cento': 10,
  };
  const factor = FACTORS[`${src}>${tgt}`];
  if (factor != null) return q * factor;

  const kindOf = (u: string): string => {
    if (['g', 'mg', 'kg'].includes(u)) return 'mass';
    if (['ml', 'l'].includes(u)) return 'volume';
    if (['mm', 'cm', 'm'].includes(u)) return 'length';
    if (['mm²', 'cm²', 'dm²', 'm²'].includes(u)) return 'area';
    if (['un', 'mil', 'cento', 'dz', 'par'].includes(u)) return 'count';
    return 'unknown';
  };
  const srcKind = kindOf(src);
  const tgtKind = kindOf(tgt);
  if (srcKind !== tgtKind && srcKind !== 'unknown' && tgtKind !== 'unknown') return null;
  return q;
}

export const convertDm2ToLinearMeters = (totalDm2: number, componentSheet: ComponentSheetCandidate | null) => {
  const linearWidthMm = getLinearWidthMm(componentSheet);
  if (linearWidthMm <= 0) return totalDm2;

  const dm2PerMeter = linearWidthMm / 10;
  return totalDm2 / dm2PerMeter;
};

/**
 * True quando o material é linear (vendido em metro/cm) mas não tem
 * `dimensions_width` cadastrada na ficha de componente. Sem largura, o
 * conversor de dm² → metro retorna dm² cru — o consumo aparece inflado
 * ~100× no PV. Use pra renderizar alerta na UI antes de o cliente ver
 * número errado.
 */
export const isLinearWidthMissing = (componentSheet: ComponentSheetCandidate | null, productUnit?: string | null): boolean => {
  const sheetUnit = getSheetUnit(componentSheet);
  const unit = normalizeText(productUnit);
  // LINEAR_UNITS já cobre m/metro/metros/meters/mt/cm (paridade SQL) — sem lista inline.
  const isLinear = LINEAR_UNITS.has(sheetUnit) || LINEAR_UNITS.has(unit);
  if (!isLinear) return false;
  return getLinearWidthMm(componentSheet) <= 0;
};

export const convertDm2ToPlates = (totalDm2: number, componentSheet: ComponentSheetCandidate | null) => {
  const plateAreaDm2 = getPlateAreaDm2(componentSheet);
  if (plateAreaDm2 <= 0) return totalDm2;

  return totalDm2 / plateAreaDm2;
};

/**
 * Custo de UM material do BOM por par, aplicando a REGRA CANÔNICA de consumo
 * (CLAUDE.md / este arquivo): material de ÁREA (consumo em dm²/par) cujo produto é
 * vendido em unidade FÍSICA (linear m/cm ou placa) precisa ser convertido pela
 * largura/área da ficha de componente ANTES de multiplicar pelo preço — senão
 * `quantity_per_unit(dm²) × unit_price(R$/m)` infla o custo ~100× (largura em dm).
 *
 * Itens DIRETOS (cola em kg, caixa em un, tira/elástico em m SEM ficha de largura)
 * já têm quantity_per_unit na mesma unidade do preço → custo = qty × preço.
 *
 * ⚠ NENHUM ramo aplica perda de corte. Regra do dono (03/08/2026, commit
 * 9a0ea69): o consumo cadastrado JÁ embute o rendimento real do material, então
 * o sistema não acrescenta nada. `waste_pct` ainda existe em fichas antigas e é
 * deliberadamente inerte — travado por `units.edge-cases.test.ts` e
 * `materialConsumption.units.test.ts`.
 *
 * Quando a unidade é física mas a ficha não tem largura/área cadastrada, mantém
 * o cálculo direto e marca `widthMissing` pra UI avisar (custo pode estar
 * inflado) — igual ao modal de Consumo de Materiais.
 */
export function bomMaterialCostPerPair(
  quantityPerUnit: number | null | undefined,
  unitPrice: number | null | undefined,
  productUnit: string | null | undefined,
  componentSheet: ComponentSheetCandidate | null,
): { cost: number; converted: boolean; widthMissing: boolean } {
  const qty = Number(quantityPerUnit) || 0;
  const price = Number(unitPrice) || 0;
  const unit = normalizeText(productUnit);
  const direct = () => ({ cost: qty * price, converted: false, widthMissing: false });

  if (qty <= 0 || price <= 0) return direct();

  if (LINEAR_UNITS.has(unit)) {
    const widthMm = getLinearWidthMm(componentSheet);
    if (widthMm > 0) {
      // dm²/par → metros/par (já com perda) → × R$/m
      return { cost: convertDm2ToLinearMeters(qty, componentSheet) * price, converted: true, widthMissing: false };
    }
    // unidade linear sem largura na ficha: pode ser item direto (tira) OU área sem
    // largura cadastrada. Mantém o valor atual e só sinaliza quando HÁ ficha (= é
    // material de área mal cadastrado); tira normalmente nem tem ficha → não avisa.
    return { ...direct(), widthMissing: componentSheet != null };
  }

  if (PLATE_UNITS.has(unit)) {
    const plateAreaDm2 = getPlateAreaDm2(componentSheet);
    if (plateAreaDm2 > 0) {
      return { cost: convertDm2ToPlates(qty, componentSheet) * price, converted: true, widthMissing: false };
    }
    return { ...direct(), widthMissing: componentSheet != null };
  }

  // contagem (un/par), massa (kg/g), volume (L/ml) — qty já na unidade do preço.
  return direct();
}

/**
 * Divisor pra converter QUANTIDADE de material de área (dm²/par) → unidade física de
 * ESTOQUE do produto (metro linear ou placa), usando a largura/área da ficha de
 * componente. PURO geométrico (NÃO aplica perda — o caller controla a perda dele).
 *
 *   need_em_estoque = total_dm2 / areaToStockDivisor(stockUnit, ficha)
 *
 * - linear em METRO (m/metro/mt): divisor = largura_mm / 10  (= dm² por metro)
 * - linear em CENTÍMETRO (cm): divisor = largura_mm / 10 / 100 (= dm² por cm);
 *   sem isso o need sairia em metros tratado como cm → ~100× errado. ESPELHA o
 *   branch `cm` de get_material_conversion_info (dm2_per_unit / 100).
 * - placa: divisor = área_da_placa_dm²
 * - retorna null quando NÃO se aplica (unidade não é linear/placa) OU quando falta a
 *   largura/área na ficha (caller deve sinalizar widthMissing e NÃO inflar ~100×).
 *
 * Usado no planejamento de compras (PurchasePlanningWizard) — a conversão dm²→físico
 * NÃO mora em products.conversion_rate (mora aqui, na ficha). Ver CLAUDE.md.
 */
export function areaToStockDivisor(
  stockUnit: string | null | undefined,
  componentSheet: ComponentSheetCandidate | null,
): number | null {
  const unit = normalizeText(stockUnit);
  if (LINEAR_UNITS.has(unit)) {
    const w = getLinearWidthMm(componentSheet);
    if (w <= 0) return null;
    const dm2PerMeter = w / 10;
    // estoque em cm: divisor é dm² POR CM (= dm²/m ÷ 100). Paridade com SQL.
    return unit === 'cm' ? dm2PerMeter / 100 : dm2PerMeter;
  }
  if (PLATE_UNITS.has(unit)) {
    const a = getPlateAreaDm2(componentSheet);
    return a > 0 ? a : null;
  }
  return null;
}

/**
 * Unit-aware consumption calculation.
 * If the component sheet's product unit is linear (metro, cm, m),
 * the yield_per_size values are already in that unit — emitted as-is.
 * If the unit is dm2/plate, calculate in dm2 then convert.
 * Returns { total, unit } where unit is the final output unit.
 *
 * Perda de corte NÃO é aplicada em nenhum caminho — ver o bloco de custo acima.
 */
/**
 * Converts a fallback consumption value from dm²/par to linear meters/par
 * using the component sheet width. This ensures that when yield_per_size
 * values are in meters, the fallback for missing sizes is also in meters.
 */
const convertFallbackToLinear = (fallbackDm2: number, componentSheet: ComponentSheetCandidate | null): number => {
  const linearWidthMm = getLinearWidthMm(componentSheet);
  if (linearWidthMm <= 0) return fallbackDm2; // can't convert, return as-is
  // linearWidthMm is in mm (e.g. 1400mm for 1.4m width).
  // dm2PerMeter = (widthInMm / 100) * 10 = widthInMm / 10
  const dm2PerMeter = linearWidthMm / 10;
  return fallbackDm2 / dm2PerMeter;
};

export const calculateConsumptionWithUnit = (
  item: GradeItem,
  fallbackConsumption: number,
  componentSheet: ComponentSheetCandidate | null,
  targetUnit: 'metro' | 'dm2' | 'placa' | 'auto' = 'auto',
  overridePerSize?: Record<string, number> | null,
  soleProductId?: string | null,
  useGradeMultipliers?: boolean,
): { total: number; unit: string } => {
  const sheetUnit = getSheetUnit(componentSheet);
  const isLinear = LINEAR_UNITS.has(sheetUnit);
  const resolvedYield = resolveYieldMap(componentSheet, soleProductId);
  const yieldHasData = Object.entries(resolvedYield).some(([key, value]) => key !== 'unit' && Number(value) > 0);

  if (isLinear && yieldHasData) {
    // yield_per_size values are in the sheet's linear unit (cm or meters).
    // CRITICAL: fallbackConsumption is in dm²/par — convert it to match the
    // sheet's unit so sizes missing from yield_per_size use the same unit.
    // convertFallbackToLinear always returns meters; multiply by 100 for cm sheets.
    let linearFallback: number;
    if (getLinearWidthMm(componentSheet) <= 0) {
      // Ficha linear SEM largura: não dá pra converter o fallback dm²→linear.
      // Antes ele entrava como dm² tratado como metros (~100× errado nos tamanhos
      // ausentes do yield). Como os yields JÁ estão em unidade linear, usa a média
      // deles como fallback (mesma unidade) p/ tamanhos sem yield.
      const ys = Object.entries(resolvedYield)
        .filter(([k, v]) => k !== 'unit' && Number(v) > 0)
        .map(([, v]) => Number(v));
      linearFallback = ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : 0;
    } else {
      const linearFallbackMeters = convertFallbackToLinear(fallbackConsumption, componentSheet);
      linearFallback = sheetUnit === 'cm' ? linearFallbackMeters * 100 : linearFallbackMeters;
    }
    const rawTotal = calculateGradeBasedDm2(item, linearFallback, componentSheet, overridePerSize, soleProductId, useGradeMultipliers);

    // Convert cm to meters if unit is cm
    const inMeters = sheetUnit === 'cm' ? rawTotal / 100 : rawTotal;
    return { total: inMeters, unit: 'metro' };
  }

  // Calculate raw total in dm² (fallback is already in dm²/par)
  const rawTotal = calculateGradeBasedDm2(item, fallbackConsumption, componentSheet, overridePerSize, soleProductId, useGradeMultipliers);

  // When yield_per_size is empty, rawTotal = fallbackConsumption (dm²/par) × qty
  // For linear sheets without yield data, convert dm² → meters using sheet width.
  if (isLinear && !yieldHasData) {
    return { total: convertDm2ToLinearMeters(rawTotal, componentSheet), unit: 'metro' };
  }

  // dm2/plate path: rawTotal is in dm2
  if (targetUnit === 'placa' || PLATE_UNITS.has(sheetUnit)) {
    return { total: convertDm2ToPlates(rawTotal, componentSheet), unit: 'placa' };
  }

  if (targetUnit === 'metro') {
    return { total: convertDm2ToLinearMeters(rawTotal, componentSheet), unit: 'metro' };
  }

  // auto: if sheet is plate, return plates; otherwise meters
  if (PLATE_UNITS.has(sheetUnit)) {
    return { total: convertDm2ToPlates(rawTotal, componentSheet), unit: 'placa' };
  }

  return { total: convertDm2ToLinearMeters(rawTotal, componentSheet), unit: 'metro' };
};
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
  waste_pct?: number | null;
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

const LINEAR_UNITS = new Set(['cm', 'm', 'metro', 'mt']);
const PLATE_UNITS = new Set(['dm2', 'dm²', 'm²', 'placa', 'placas', 'un']);

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

const convertDimensionToMm = (value?: number | null, unit?: string | null) => {
  const numericValue = Number(value) || 0;
  const normalizedUnit = normalizeText(unit);

  if (normalizedUnit === 'cm') return numericValue * 10;
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

export const convertDm2ToLinearMeters = (totalDm2: number, componentSheet: ComponentSheetCandidate | null) => {
  const linearWidthMm = getLinearWidthMm(componentSheet);
  if (linearWidthMm <= 0) return totalDm2;

  const dm2PerMeter = linearWidthMm / 10;
  const wastePct = Number(componentSheet?.waste_pct) || 0;
  return (totalDm2 / dm2PerMeter) * (1 + wastePct / 100);
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
  const unit = (productUnit || '').toLowerCase();
  const isLinear = LINEAR_UNITS.has(sheetUnit) || ['m','metros','mt','meters','cm'].includes(unit);
  if (!isLinear) return false;
  return getLinearWidthMm(componentSheet) <= 0;
};

export const convertDm2ToPlates = (totalDm2: number, componentSheet: ComponentSheetCandidate | null) => {
  const plateAreaDm2 = getPlateAreaDm2(componentSheet);
  if (plateAreaDm2 <= 0) return totalDm2;

  const wastePct = Number(componentSheet?.waste_pct) || 0;
  return (totalDm2 / plateAreaDm2) * (1 + wastePct / 100);
};

/**
 * Unit-aware consumption calculation.
 * If the component sheet's product unit is linear (metro, cm, m),
 * the yield_per_size values are already in that unit — only apply waste%.
 * If the unit is dm2/plate, calculate in dm2 then convert.
 * Returns { total, unit } where unit is the final output unit.
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

    const wastePct = Number(componentSheet?.waste_pct) || 0;
    const withWaste = rawTotal * (1 + wastePct / 100);
    // Convert cm to meters if unit is cm
    const inMeters = sheetUnit === 'cm' ? withWaste / 100 : withWaste;
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
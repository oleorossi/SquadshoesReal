import { pickConsumptionForSize } from '@/lib/materialConsumption';

type StrapDefinition = {
  id?: string | number | null;
  label?: string | null;
  color?: string | null;
  group_id?: string | null;
  group_name?: string | null;
  consumption?: number | null;
  consumption_per_size?: Record<string, number> | null;
};

type StrapContext = {
  grade?: Record<string, number> | null;
  quantity?: number | null;
  fichas?: number | null;
};

const getStrapKey = (strap: StrapDefinition) => {
  const idPart = strap.id == null ? '' : String(strap.id);
  const labelPart = strap.label?.trim().toLowerCase() || '';
  return `${idPart}::${labelPart}`;
};

const hasPerSizeConsumption = (perSize?: Record<string, number> | null) => {
  if (!perSize) return false;
  return Object.values(perSize).some((value) => Number(value) > 0);
};

export const resolveOrderStraps = (
  itemStraps: StrapDefinition[] = [],
  sheetStraps: StrapDefinition[] = [],
): StrapDefinition[] => {
  const itemMap = new Map(itemStraps.map((strap) => [getStrapKey(strap), strap]));
  const usedKeys = new Set<string>();
  const merged: StrapDefinition[] = [];

  for (const sheetStrap of sheetStraps) {
    const key = getStrapKey(sheetStrap);
    const itemStrap = itemMap.get(key);
    if (itemStrap) usedKeys.add(key);

    merged.push({
      ...sheetStrap,
      ...itemStrap,
      color: itemStrap?.color || sheetStrap.color || '',
      group_name: itemStrap?.group_name || sheetStrap.group_name || sheetStrap.label || itemStrap?.label || '',
      consumption: Number(itemStrap?.consumption) > 0 ? itemStrap?.consumption : sheetStrap.consumption,
      consumption_per_size: hasPerSizeConsumption(itemStrap?.consumption_per_size)
        ? itemStrap?.consumption_per_size
        : sheetStrap.consumption_per_size,
    });
  }

  for (const itemStrap of itemStraps) {
    const key = getStrapKey(itemStrap);
    if (usedKeys.has(key)) continue;
    merged.push(itemStrap);
  }

  return merged;
};

export const calculateStrapConsumptionCm = (strap: StrapDefinition, context: StrapContext) => {
  const quantity = Number(context.quantity) || 0;
  if (quantity <= 0) return 0;

  const grade = context.grade || {};
  const gradeEntries = Object.entries(grade).filter(([, pairs]) => Number(pairs) > 0);
  const perSize = strap.consumption_per_size || {};
  const defaultConsumption = Number(strap.consumption) || 0;

  if (hasPerSizeConsumption(perSize) && gradeEntries.length > 0) {
    const totalPerFicha = gradeEntries.reduce((sum, [size, pairs]) => {
      const pairsNum = Number(pairs) || 0;
      const picked = pickConsumptionForSize(perSize, size);
      const cmPerPair = picked.found ? picked.value : defaultConsumption;
      return sum + pairsNum * cmPerPair;
    }, 0);

    const gradeTotal = gradeEntries.reduce((sum, [, pairs]) => sum + (Number(pairs) || 0), 0);
    // EXATO POR QUANTIDADE (2026-07-01): consumo proporcional à quantidade real,
    // SEM arredondar pra ficha cheia. Idêntico ao calculateGradeBasedDm2
    // (cabedal/forro/palmilha) e ao SQL debit_strap_stock/check_stock_availability
    // após a mesma mudança: v_fichas = quantity / grade_total (fração exata).
    // Antes usava ceil → em ficha parcial contava a ficha cheia inteira.
    const fichas = Number(context.fichas) || (gradeTotal > 0 ? quantity / gradeTotal : 0);
    return totalPerFicha * fichas;
  }

  return defaultConsumption * quantity;
};
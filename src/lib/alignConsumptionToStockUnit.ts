/**
 * Alinha linhas do Consumo de Materiais à unidade de consumo cadastrada.
 *
 * Fonte de verdade da unidade de EXIBIÇÃO/comparação:
 *   1. `product_groups.consumption_unit` quando conversível a partir de `products.unit`
 *   2. senão `products.unit` (estoque = consumo no item)
 *
 * O motor SQL já tenta emitir em `products.unit`. Este passo fecha gaps
 * (ex.: elástico em cm na ficha com grupo em m) e escala o preço unitário
 * para a mesma unidade — senão "Preço unitário" parece preço por peça.
 */
import { convertToProductUnit } from '@/lib/materialConsumption';
import { normalizeUnit } from '@/lib/unitConversion';
import type { ConsumptionRow } from '@/lib/consumptionRows';

export type StockUnitProduct = {
  id: string;
  unit?: string | null;
  product_groups?: { consumption_unit?: string | null } | { consumption_unit?: string | null }[] | null;
};

function groupConsumptionUnit(product: StockUnitProduct): string | null {
  const g = product.product_groups;
  if (!g) return null;
  const row = Array.isArray(g) ? g[0] : g;
  const u = (row?.consumption_unit || '').trim();
  return u || null;
}

/** Unidade em que a linha deve aparecer no Consumo de Materiais. */
export function resolveConsumptionDisplayUnit(product: StockUnitProduct): string {
  const stock = normalizeUnit(product.unit || 'un');
  const preferred = groupConsumptionUnit(product);
  if (!preferred) return stock;
  const pref = normalizeUnit(preferred);
  if (pref === stock) return stock;
  // Só promove quando há conversão metrológica conhecida (cm↔m, g↔kg…).
  const factor = convertToProductUnit(1, stock, pref);
  if (factor == null || !Number.isFinite(factor) || factor <= 0) return stock;
  // convertToProductUnit devolve qty intacta quando tipos iguais sem fator —
  // nesse caso factor === 1 e unidades diferentes (ex.: par→un): não promover.
  if (factor === 1 && stock !== pref) {
    const probe = convertToProductUnit(100, stock, pref);
    if (probe === 100) return stock;
  }
  return pref;
}

/**
 * Converte qty da unidade atual para a alvo. Retorna null se incompatível.
 * Escala preço (R$/unidade_origem → R$/unidade_alvo) pelo inverso do fator.
 */
export function convertQtyAndUnitPrice(
  qty: number,
  unitPrice: number | null | undefined,
  fromUnit: string,
  toUnit: string,
): { qty: number; unitPrice: number | null; unit: string } | null {
  const from = normalizeUnit(fromUnit);
  const to = normalizeUnit(toUnit);
  if (from === to) {
    return {
      qty,
      unitPrice: unitPrice != null && Number.isFinite(unitPrice) ? unitPrice : null,
      unit: to,
    };
  }
  const convertedQty = convertToProductUnit(qty, from, to);
  if (convertedQty == null || !Number.isFinite(convertedQty)) return null;
  // Incompatível ou no-op falso: convertToProductUnit devolve qty crua.
  if (convertedQty === qty) {
    const probe = convertToProductUnit(100, from, to);
    if (probe === 100) return null;
  }
  const factor = convertToProductUnit(1, from, to);
  if (factor == null || !Number.isFinite(factor) || factor <= 0) return null;
  const nextPrice = unitPrice != null && Number.isFinite(unitPrice)
    ? unitPrice / factor
    : null;
  return {
    qty: convertedQty,
    unitPrice: nextPrice,
    unit: to,
  };
}

/**
 * Alinha cada linha (necessidade, estoque disponível e preço) à unidade de
 * consumo resolvida. Sem productIds, a linha permanece como veio do motor.
 */
export function alignConsumptionRowsToDisplayUnit(
  rows: ConsumptionRow[],
  products: StockUnitProduct[],
): ConsumptionRow[] {
  if (!rows.length || !products.length) return rows;
  const byId = new Map(products.map((p) => [p.id, p]));

  return rows.map((row) => {
    const product = (row.productIds || [])
      .map((id) => byId.get(id))
      .find(Boolean);
    if (!product) return row;

    const target = resolveConsumptionDisplayUnit(product);
    const current = normalizeUnit(row.productUnit || product.unit || 'un');
    if (current === target) {
      if (row.productUnit === target) return row;
      return { ...row, productUnit: target };
    }

    const converted = convertQtyAndUnitPrice(
      row.totalQuantity,
      row.unitPrice,
      current,
      target,
    );
    if (!converted) return row;

    const next: ConsumptionRow = {
      ...row,
      totalQuantity: converted.qty,
      productUnit: converted.unit,
      unitPrice: converted.unitPrice,
    };

    if (row.available != null && Number.isFinite(row.available)) {
      const av = convertToProductUnit(row.available, current, target);
      if (av != null) next.available = av;
    }
    if (row.previewQuantity != null && Number.isFinite(row.previewQuantity)) {
      const pq = convertToProductUnit(row.previewQuantity, current, target);
      if (pq != null) next.previewQuantity = pq;
    }
    if (row.artisanal?.baseQty != null && Number.isFinite(row.artisanal.baseQty)) {
      const bq = convertToProductUnit(row.artisanal.baseQty, current, target);
      if (bq != null) {
        next.artisanal = { ...row.artisanal, baseQty: bq };
      }
    }

    return next;
  });
}

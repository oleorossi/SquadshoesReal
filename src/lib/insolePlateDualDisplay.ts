/**
 * Equivalência dm² ↔ placas para fibra/palmilha.
 * Comparação com estoque continua em dm²; placas são a medida física do produto.
 */

import { effectiveConversionFactor } from '@/lib/purchaseConversion';
import { isInsoleFiberColorAgnostic } from '@/lib/saleOrderReadinessCorrections';

export type PlateDualProduct = {
  id?: string;
  unit?: string | null;
  purchase_unit?: string | null;
  conversion_rate?: number | null;
  dimensions_width?: number | null;
  dimensions_length?: number | null;
  dimensions_unit?: string | null;
  category?: string | null;
  name?: string | null;
  group_id?: string | null;
  product_groups?: { name?: string | null; sector?: string | null; dimensions_width?: number | null; dimensions_length?: number | null; dimensions_unit?: string | null } | null;
};

const AREA_UNITS = new Set(['dm2', 'dm²', 'm2', 'm²', 'cm2', 'cm²']);

function toMm(value: number, unit: string | null | undefined): number {
  if (!(value > 0)) return 0;
  const u = (unit || 'mm').toLowerCase().trim();
  if (u === 'mm') return value;
  if (u === 'cm') return value * 10;
  if (u === 'dm') return value * 100;
  if (u === 'm') return value * 1000;
  return 0;
}

/** Área de uma placa em dm² a partir das dimensões (grupo ou produto). */
export function plateAreaDm2FromDims(
  width: number | null | undefined,
  length: number | null | undefined,
  unit: string | null | undefined,
): number {
  const w = toMm(Number(width) || 0, unit);
  const l = toMm(Number(length) || 0, unit);
  if (w <= 0 || l <= 0) return 0;
  return (w * l) / 10000;
}

export function isFiberStockProduct(product: PlateDualProduct | null | undefined): boolean {
  if (!product) return false;
  const unit = String(product.unit || '').toLowerCase().trim();
  if (!AREA_UNITS.has(unit) && unit !== 'placa' && unit !== 'placas') return false;
  const groupName = product.product_groups?.name || '';
  const sector = product.product_groups?.sector || product.category || '';
  if (isInsoleFiberColorAgnostic(sector, { name: groupName, is_color_agnostic: null })) return true;
  const purchase = String(product.purchase_unit || '').toLowerCase().trim();
  return purchase === 'placa' || purchase === 'placas';
}

/**
 * dm² de estoque/consumo → placas.
 * Prefere conversion_rate (compra); senão área geométrica do grupo/produto.
 */
export function dm2ToPlates(dm2: number, product: PlateDualProduct | null | undefined): number | null {
  if (!(dm2 > 0) || !product) return null;
  const purchase = String(product.purchase_unit || '').toLowerCase().trim();
  if (purchase === 'placa' || purchase === 'placas') {
    const factor = effectiveConversionFactor({
      unit: product.unit || 'dm²',
      purchase_unit: product.purchase_unit,
      conversion_rate: product.conversion_rate,
      dimensions_width: product.dimensions_width,
      dimensions_unit: product.dimensions_unit,
    });
    if (factor != null && factor > 0 && factor !== 1) return dm2 / factor;
  }
  const group = product.product_groups;
  const area = plateAreaDm2FromDims(
    group?.dimensions_width ?? product.dimensions_width,
    group?.dimensions_length ?? product.dimensions_length,
    group?.dimensions_unit ?? product.dimensions_unit,
  );
  if (area > 0) return dm2 / area;
  return null;
}

/** Estoque em dm² → { dm2, placas } quando o produto é fibra. */
export function fiberStockDualDisplay(
  qtyDm2: number,
  product: PlateDualProduct | null | undefined,
): { dm2: number; plates: number } | null {
  if (!isFiberStockProduct(product)) return null;
  const plates = dm2ToPlates(qtyDm2, product);
  if (plates == null || !(plates > 0)) return null;
  return { dm2: qtyDm2, plates };
}

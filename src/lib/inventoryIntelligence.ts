/**
 * Inventory Intelligence - ATP (Available To Promise) calculations
 * and material availability validation for production orders.
 */

export interface StockStatus {
  physical: number;
  reserved: number;
  safety: number;
}

/**
 * Calculates Available-To-Promise stock:
 * ATP = Physical - Reserved - Safety
 */
export function getAvailableToPromise(status: StockStatus): number {
  return Math.max(0, status.physical - status.reserved - status.safety);
}

import { resolveConversionFactors } from '@/lib/unitConversion';

export interface ProductStock {
  quantity: number;         // physical stock
  reserved_stock: number;
  safety_stock: number;
  lead_time_days: number;
  conversion_rate: number;
  purchase_unit: string;
  production_unit: string;
  purchase_order_unit: string;
  min_order_quantity: number;
  unit_price: number;
}

export interface MaterialAvailability {
  hasStock: boolean;
  available: number;
  needed: number;
  missing: number;
  suggestedOrderDate: Date;
  suggestedPurchaseQty: number;
  suggestedPurchaseUnit: string;
  estimatedCost: number;
}

/**
 * Validates if there's enough material for a production order
 * and provides purchase suggestions if not.
 *
 * IMPORTANT: `needed` MUST be in the product's stock/production unit (same unit as `product.quantity`).
 * `product.quantity`, `reserved_stock`, `safety_stock` are stored in the stock unit (product.unit).
 * `conversion_rate` is: 1 purchase_order_unit = conversion_rate stock_units  (e.g. 1 metro = 137 dm²).
 * This function compares stock and need in the SAME unit, then converts only the
 * purchase suggestion to purchase_order_unit.
 */
export function validateMaterialAvailability(
  needed: number,
  product: ProductStock
): MaterialAvailability {
  // Determine conversion factors based on unit relationships
  const { stockToPurchaseDivisor } = resolveConversionFactors(
    product.production_unit,   // consumption unit
    product.production_unit,   // needed is already in stock/production unit per contract
    product.purchase_order_unit,
    product.conversion_rate,
  );

  // Stock is already in stock unit — compare directly with needed (also in stock unit)
  const atp = getAvailableToPromise({
    physical: product.quantity,
    reserved: product.reserved_stock,
    safety: product.safety_stock,
  });

  const missing = Math.max(0, needed - atp);
  const moq = product.min_order_quantity || 1;

  // Convert missing (stock unit) → purchase_order_unit and apply MOQ
  let purchaseQty = missing / stockToPurchaseDivisor;
  if (purchaseQty > 0 && purchaseQty < moq) {
    purchaseQty = moq;
  }
  // Round up for discrete units
  const discreteUnits = ['chapa', 'rolo', 'un', 'par', 'cx', 'pc'];
  if (discreteUnits.includes(product.purchase_order_unit)) {
    purchaseQty = Math.ceil(purchaseQty);
  }

  // unit_price is per stock unit; multiply by divisor to get price per purchase_order_unit
  const pricePerPurchaseUnit = (product.unit_price || 0) * stockToPurchaseDivisor;

  return {
    hasStock: atp >= needed,
    available: atp,
    needed,
    missing,
    suggestedOrderDate: new Date(Date.now() + product.lead_time_days * 86400000),
    suggestedPurchaseQty: purchaseQty,
    suggestedPurchaseUnit: product.purchase_order_unit || product.purchase_unit || 'un',
    estimatedCost: purchaseQty * pricePerPurchaseUnit,
  };
}

/**
 * Default size multipliers for shoe production.
 * Base size is typically 35/36 (multiplier = 1.00).
 */
export const DEFAULT_SIZE_MULTIPLIERS: Record<string, number> = {
  '21': 0.82, '22': 0.84, '23': 0.86, '24': 0.88,
  '25': 0.90, '26': 0.92, '27': 0.94, '28': 0.96,
  '29': 0.88, '30': 0.90, '31': 0.92, '32': 0.94,
  '33': 0.94, '34': 0.96, '35': 0.98, '36': 1.00,
  '37': 1.02, '38': 1.04, '39': 1.06, '40': 1.08,
};

/**
 * Calculate total material needed for a graded order using size multipliers.
 * @param baseConsumption - consumption per pair at base size (dm²/par)
 * @param pairsBySizes - grade: { "34": 100, "37": 250, ... }
 * @param sizeMultipliers - optional overrides per size
 * @param wastePct - waste multiplier (default 1.0 = 0%)
 */
export function calculateGradedConsumption(
  baseConsumption: number,
  pairsBySizes: Record<string, number>,
  sizeMultipliers?: Record<string, number>,
  wastePct = 1.0
): { totalNeeded: number; breakdown: Record<string, number> } {
  const multipliers = sizeMultipliers || DEFAULT_SIZE_MULTIPLIERS;
  const breakdown: Record<string, number> = {};
  let totalNeeded = 0;

  for (const [size, pairs] of Object.entries(pairsBySizes)) {
    if (!pairs || pairs <= 0) continue;
    const mult = multipliers[size] ?? 1.0;
    const consumption = baseConsumption * mult * pairs * wastePct;
    breakdown[size] = consumption;
    totalNeeded += consumption;
  }

  return { totalNeeded, breakdown };
}

/**
 * Unified unit conversion utility for the purchase planning / MRP / BOM system.
 *
 * The `conversion_rate` field on products is overloaded with two meanings:
 *
 * 1. **Area→Linear** (e.g. leather): conversion_rate = dm² per meter of stock.
 *    consumption unit (dm²) ≠ stock unit (m), stock unit ≈ purchase unit (metro).
 *    Usage: need_in_stock = consumption_dm² / conversion_rate
 *
 * 2. **Stock→Package** (e.g. chemicals): conversion_rate = stock units per package.
 *    consumption unit (kg) = stock unit (kg), stock unit ≠ purchase unit (un).
 *    Usage: purchase_qty = deficit_kg / conversion_rate
 *
 * This utility detects the correct interpretation by comparing unit groups
 * and returns the proper divisors for each conversion step.
 */

const UNIT_SYNONYMS: Record<string, string> = {
  metro: 'm',
  metros: 'm',
  'metros (m linear)': 'm',
  'm linear': 'm',
  'ml (linear)': 'm',
  'm lin': 'm',
  mt: 'm',
  mtl: 'm',
  un: 'un',
  und: 'un',
  unid: 'un',
  unidade: 'un',
  pares: 'par',
  caixa: 'cx',
  pacote: 'pc',
  pct: 'pc',
  'pç': 'pc',
  saco: 'pc',
  sc: 'pc',
  rolo: 'rl',
  folha: 'fh',
  jogo: 'jg',
  kilo: 'kg',
  kilos: 'kg',
  quilograma: 'kg',
  quilogramas: 'kg',
  grama: 'g',
  gramas: 'g',
  gr: 'g',
  litro: 'l',
  litros: 'l',
  lt: 'l',
  m2: 'm²',
  dm2: 'dm²',
  cm2: 'cm²',
  m3: 'm³',
  chapa: 'chapa',
};

/** Normalizes a unit string to its canonical form for comparison. */
export function normalizeUnit(u: string | null | undefined): string {
  if (!u) return 'un';
  const n = u.trim().toLowerCase();
  return UNIT_SYNONYMS[n] ?? n;
}

/** Returns true if two unit strings refer to the same physical unit. */
export function areSameUnit(a: string | null | undefined, b: string | null | undefined): boolean {
  return normalizeUnit(a) === normalizeUnit(b);
}

/**
 * Unidades de COMPRA discretas (não dá pra comprar fração): contagem, caixa,
 * rolo, chapa/placa, par, etc. Quantidade de compra nessas unidades sempre
 * arredonda pra cima (CEIL). Lista CANÔNICA — antes cada motor tinha a sua
 * (inventoryIntelligence/purchaseCalculation faltavam 'placa'). Auditoria 2026-06-14.
 */
const DISCRETE_PURCHASE_UNITS = new Set([
  'un', 'und', 'unid', 'unidade', 'par', 'pares', 'cx', 'caixa',
  'pc', 'pct', 'pacote', 'pç', 'peca', 'peça', 'rolo', 'rl',
  'chapa', 'placa', 'placas', 'folha', 'fh', 'jogo', 'jg', 'saco', 'sc',
]);
export function isDiscretePurchaseUnit(unit?: string | null): boolean {
  return DISCRETE_PURCHASE_UNITS.has(String(unit || '').trim().toLowerCase());
}

const AREA_UNITS = new Set(['dm²', 'cm²', 'm²']);
const LINEAR_UNITS = new Set(['m', 'cm', 'mm']);
const WEIGHT_UNITS = new Set(['kg', 'g', 'mg']);
const VOLUME_UNITS = new Set(['l', 'ml', 'm³']);
const COUNT_UNITS = new Set(['un', 'par', 'cx', 'pc', 'rl', 'fh', 'jg', 'chapa']);

function getUnitGroup(unit: string): string {
  const n = normalizeUnit(unit);
  if (AREA_UNITS.has(n)) return 'area';
  if (LINEAR_UNITS.has(n)) return 'linear';
  if (WEIGHT_UNITS.has(n)) return 'weight';
  if (VOLUME_UNITS.has(n)) return 'volume';
  if (COUNT_UNITS.has(n)) return 'count';
  return 'unknown';
}

export interface ConversionFactors {
  /**
   * Divisor to convert from consumption unit to stock unit.
   * need_in_stock = consumption_total / needToStockDivisor
   */
  needToStockDivisor: number;
  /**
   * Divisor to convert from stock unit to purchase unit.
   * purchase_qty = deficit_in_stock / stockToPurchaseDivisor
   */
  stockToPurchaseDivisor: number;
}

/**
 * Determines how to apply the product's `conversion_rate` based on
 * the relationship between consumption, stock, and purchase units.
 *
 * @param consumptionUnit - Unit from BOM (e.g. 'dm²', 'kg', 'par')
 * @param stockUnit - product.unit (e.g. 'm', 'kg', 'par')
 * @param purchaseUnit - product.purchase_order_unit (e.g. 'metro', 'un', 'par')
 * @param conversionRate - product.conversion_rate
 */
export function resolveConversionFactors(
  consumptionUnit: string | null | undefined,
  stockUnit: string | null | undefined,
  purchaseUnit: string | null | undefined,
  conversionRate: number | null | undefined,
): ConversionFactors {
  const consumptionMatchesStock = areSameUnit(consumptionUnit, stockUnit);
  const stockMatchesPurchase = areSameUnit(stockUnit, purchaseUnit);
  const cr = Number(conversionRate);
  const hasValidFactor = Number.isFinite(cr) && cr > 0;

  // Uma conversão só é dispensável quando todas as unidades são iguais. Não
  // transformar taxa 0/nula em 1:1: isso já gerou pedidos 100×/150× errados.
  if ((!consumptionMatchesStock || !stockMatchesPurchase) && !hasValidFactor) {
    throw new Error(
      `Conversão inválida entre "${consumptionUnit || '—'}", "${stockUnit || '—'}" e "${purchaseUnit || '—'}": informe uma taxa de conversão maior que zero.`,
    );
  }

  if (consumptionMatchesStock && stockMatchesPurchase) {
    return { needToStockDivisor: 1, stockToPurchaseDivisor: 1 };
  }

  if (!consumptionMatchesStock && stockMatchesPurchase) {
    // Case 1: Leather — dm²→m→metro
    // conversion_rate converts consumption→stock (e.g. 137 dm²/m)
    return { needToStockDivisor: cr, stockToPurchaseDivisor: 1 };
  }

  if (consumptionMatchesStock && !stockMatchesPurchase) {
    // Case 2: Chemicals — kg→kg→un
    // conversion_rate converts stock→purchase (e.g. 14 kg/un)
    return { needToStockDivisor: 1, stockToPurchaseDivisor: cr };
  }

  if (!consumptionMatchesStock && !stockMatchesPurchase) {
    // Both differ — use conversion for the bigger gap (consumption→stock)
    // and let purchase conversion be 1:1 (best-effort)
    return { needToStockDivisor: cr, stockToPurchaseDivisor: 1 };
  }

  return { needToStockDivisor: 1, stockToPurchaseDivisor: 1 };
}

/**
 * Convenience: converts a raw consumption total and current stock
 * into a unified purchase-unit comparison.
 *
 * Returns quantities all in the same unit (purchase_unit) for
 * direct comparison and deficit calculation.
 */
export function convertForPurchasePlanning(params: {
  totalConsumption: number;
  consumptionUnit: string | null | undefined;
  currentStock: number;
  stockUnit: string | null | undefined;
  purchaseUnit: string | null | undefined;
  conversionRate: number | null | undefined;
}): {
  needInPurchaseUnit: number;
  stockInPurchaseUnit: number;
  deficit: number;
} {
  const { needToStockDivisor, stockToPurchaseDivisor } = resolveConversionFactors(
    params.consumptionUnit,
    params.stockUnit,
    params.purchaseUnit,
    params.conversionRate,
  );

  const needInStock = params.totalConsumption / needToStockDivisor;
  const needInPurchaseUnit = needInStock / stockToPurchaseDivisor;
  const stockInPurchaseUnit = params.currentStock / stockToPurchaseDivisor;
  const deficit = Math.max(0, needInPurchaseUnit - stockInPurchaseUnit);

  return { needInPurchaseUnit, stockInPurchaseUnit, deficit };
}

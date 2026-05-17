import { CONVERSOES } from '@/types/unidades';

function normUnit(u?: string | null): string {
  return (u || '').trim().toLowerCase();
}

/**
 * Map common NF-e unit abbreviations to canonical UnidadeMedida string values.
 * NF-e uses UPPERCASE by spec (KG, L, UN, etc.) so normUnit() is applied first.
 */
function toCanonical(u: string): string {
  switch (u) {
    // Volume
    case 'l': case 'lt': case 'litro': case 'litros': return 'l';
    case 'ml': return 'ml';
    case 'm3': case 'm³': return 'm³';
    // Weight
    case 'kg': case 'kilo': case 'kilos': case 'quilograma': case 'quilogramas': return 'kg';
    case 'g': case 'gr': case 'grama': case 'gramas': return 'g';
    case 'mg': return 'mg';
    // Length
    case 'm': case 'mt': case 'mts': case 'metro': case 'metros': return 'm';
    // 'MTL' é a sigla oficial SEFAZ pra metro linear na NF-e (NÃO confundir
    // com 'ml' que é mililitro, mapeado acima). 'ml (linear)' é variante
    // legacy de alguns ERPs. Todos viram 'm linear' (CONVERSOES tem entry
    // m linear → m com fator 1, então metragem casa direto com produto em m).
    case 'mtl': case 'm linear': case 'm lin': case 'ml (linear)': return 'm linear';
    case 'cm': case 'cent': case 'centimetro': case 'centimetros': return 'cm';
    case 'mm': case 'milimetro': case 'milimetros': return 'mm';
    // Area
    case 'm2': case 'm²': return 'm²';
    case 'dm2': case 'dm²': return 'dm²';
    case 'cm2': case 'cm²': return 'cm²';
    // Count
    case 'un': case 'unid': case 'unidade': case 'und': return 'un';
    case 'par': return 'par';
    case 'cx': case 'caixa': return 'cx';
    case 'pc': case 'pct': case 'pacote': case 'pç': return 'pc';
    case 'sc': case 'saco': return 'pc'; // saco treated same as pc for conversion purposes
    case 'rl': case 'rolo': return 'rl';
    case 'fh': case 'folha': return 'fh';
    case 'jg': case 'jogo': return 'jg';
    default: return u;
  }
}

export type NfConversionResult = {
  qty: number;
  unitPrice: number;
  converted: boolean;
  needsConfig?: boolean;
  reason?: string;
};

/**
 * Convert NF-e quantity and unit price to the product's stock unit.
 *
 * Priority:
 * 1. Identical unit (or synonym) → no conversion
 * 2. NF unit matches purchase_unit AND stock unit differs → use conversion_rate
 *    (primary path for "purchased in UN, tracked in g")
 * 3. Any pkg-like NF unit with a configured conversion_rate → apply it
 * 4. Metric conversion via CONVERSOES table (g↔kg, ml↔l, cm↔m, etc.)
 * 5. Package unit → measured unit → needs package_weight_kg on product group
 * 6. Unknown difference → pass through unchanged
 */
export function convertNfToStockUnit(
  nfQty: number,
  nfUnit: string,
  nfUnitPrice: number,
  product: {
    unit?: string | null;
    package_weight_kg?: number | null;
    name?: string;
    conversion_rate?: number | null;
    purchase_unit?: string | null;
    purchase_order_unit?: string | null;
  },
): NfConversionResult {
  const nfU = normUnit(nfUnit);
  const prodU = normUnit(product.unit);

  // No product unit configured or identical strings
  if (!prodU || nfU === prodU) return { qty: nfQty, unitPrice: nfUnitPrice, converted: false };

  const nfCan = toCanonical(nfU);
  const prodCan = toCanonical(prodU);

  const pkgLike = new Set(['un', 'pc', 'cx', 'rl', 'fh', 'jg', 'par']);
  const measuredLike = new Set(['kg', 'g', 'mg', 'l', 'ml', 'm³', 'm', 'cm', 'mm', 'm²', 'dm²', 'cm²']);

  // Resolve the product's purchase unit (prefer purchase_unit, fall back to purchase_order_unit)
  const purchaseUnitRaw = product.purchase_unit || product.purchase_order_unit;
  const purchaseCan = purchaseUnitRaw ? toCanonical(normUnit(purchaseUnitRaw)) : null;

  // Priority 2 — NF unit matches purchase_unit and stock unit is different.
  // This is the canonical path for "purchased in UN/RL/CX, tracked in g/kg/m".
  if (purchaseCan && nfCan === purchaseCan && prodCan !== purchaseCan) {
    const rate = Number(product.conversion_rate ?? 1);
    if (rate > 0 && rate !== 1) {
      return {
        qty: nfQty * rate,
        unitPrice: nfUnitPrice / rate,
        converted: true,
        reason: `1 ${nfUnit} = ${rate} ${product.unit}`,
      };
    }
    // conversion_rate is 1 or unconfigured — units differ → the user needs to configure it
    if (measuredLike.has(prodCan)) {
      return {
        qty: nfQty,
        unitPrice: nfUnitPrice,
        converted: false,
        needsConfig: true,
        reason: `Produto comprado em "${nfUnit}" mas estoque em "${product.unit}". Configure a "Taxa de conversão" no cadastro de "${product.name || ''}" (ex: 1 ${nfUnit} = 500 ${product.unit}).`,
      };
    }
  }

  // Priority 3 — Any pkg-like NF unit with a non-trivial conversion_rate
  if (pkgLike.has(nfCan) && product.conversion_rate && product.conversion_rate !== 1) {
    const factor = Number(product.conversion_rate);
    return {
      qty: nfQty * factor,
      unitPrice: nfUnitPrice / factor,
      converted: true,
    };
  }

  // Priority 4 — Metric conversion using the CONVERSOES table
  const entry = CONVERSOES.find(c => c.de === nfCan && c.para === prodCan);
  if (entry) {
    const fator = entry.fator;
    return {
      qty: nfQty * fator,
      unitPrice: fator > 0 ? nfUnitPrice / fator : nfUnitPrice,
      converted: true,
    };
  }

  // Priority 5 — Package unit → measured unit via package_weight_kg.
  // package_weight_kg is always in kg; convert to the product's actual stock unit.
  if (pkgLike.has(nfCan) && measuredLike.has(prodCan)) {
    if (!product.package_weight_kg || product.package_weight_kg <= 0) {
      return {
        qty: nfQty,
        unitPrice: nfUnitPrice,
        converted: false,
        needsConfig: true,
        reason: `Conversão necessária: NF em "${nfUnit}" mas estoque em "${product.unit}". Configure "Peso por embalagem" no grupo do produto "${product.name || ''}".`,
      };
    }
    // Convert kg → target stock unit
    let factor = product.package_weight_kg;
    if (prodCan === 'g') factor = product.package_weight_kg * 1000;
    else if (prodCan === 'mg') factor = product.package_weight_kg * 1000000;
    return {
      qty: nfQty * factor,
      unitPrice: nfUnitPrice / factor,
      converted: true,
    };
  }

  // Unknown unit difference — flag for user configuration so the caller doesn't
  // silently insert wrong quantities into stock. Units differ here AND no rule applied.
  return {
    qty: nfQty,
    unitPrice: nfUnitPrice,
    converted: false,
    needsConfig: true,
    reason: `NF em "${nfUnit}" não pôde ser convertida para "${product.unit}". Configure conversão no cadastro de "${product.name || ''}" antes de lançar no estoque.`,
  };
}

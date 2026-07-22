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
    case 'placa': case 'chapa': case 'ch': case 'plc': return 'placa';
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
 * Campos de `products` que `convertNfToStockUnit` LÊ (F5-03, auditoria
 * 2026-07). Os 3 caminhos de NF (auto-import do XmlImportDialog, revisão/
 * manual do AddToStockDialog e lote do Suppliers) montavam o objeto `product`
 * com selects DIFERENTES: o auto-import não trazia purchase_unit (Prioridade 2
 * morta) e o manual não trazia package_weight_kg (Prioridade 5 morta) — mesmo
 * padrão do bug TECHNICAL_SHEET_CONSUMPTION_COLUMNS no consumo. TODO caminho
 * que chama o conversor tem que buscar este fragmento e passar o objeto por
 * `toNfConversionProduct`.
 *
 * `package_weight_kg` mora em product_groups — o fragmento inclui o join;
 * `toNfConversionProduct` achata (aceita também o valor já achatado).
 */
export const NF_CONVERSION_PRODUCT_SELECT =
  'unit, purchase_unit, purchase_order_unit, conversion_rate, product_groups!products_group_id_fkey(package_weight_kg)';

type NfConversionProduct = {
  unit?: string | null;
  name?: string;
  conversion_rate?: number | null;
  purchase_unit?: string | null;
  purchase_order_unit?: string | null;
  package_weight_kg?: number | null;
};

/** Normaliza uma row de `products` (com ou sem join de grupo) pro conjunto
 *  EXATO de campos que o conversor lê — fonte única dos 3 caminhos de NF. */
export function toNfConversionProduct(p: any): NfConversionProduct {
  const group = Array.isArray(p?.product_groups) ? p.product_groups[0] : p?.product_groups;
  return {
    unit: p?.unit ?? null,
    name: p?.name ?? undefined,
    conversion_rate: p?.conversion_rate ?? null,
    purchase_unit: p?.purchase_unit ?? null,
    purchase_order_unit: p?.purchase_order_unit ?? null,
    package_weight_kg: p?.package_weight_kg ?? group?.package_weight_kg ?? null,
  };
}

/**
 * Convert NF-e quantity and unit price to the product's stock unit.
 *
 * Priority:
 * 1. Identical unit (or synonym) → no conversion
 * 2. NF unit matches purchase_unit AND stock unit differs → use conversion_rate
 *    (primary path for "purchased in UN, tracked in g")
 * 3. Pkg-like NF unit with a configured conversion_rate → apply it, only when
 *    the NF unit matches the registered purchase_unit (or none is set, or the
 *    NF bills generic 'UN' for a packaged purchase_unit)
 * 4. Metric conversion via CONVERSOES table (g↔kg, ml↔l, cm↔m, etc.)
 * 5. Package unit → MASS unit (kg/g/mg) via package_weight_kg on product group
 * 6. Package → comprimento/área/volume sem rate → BLOQUEIA (needsConfig)
 * 7. Unknown difference → BLOQUEIA (needsConfig) — nunca grava qtd errada
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

  // Mesma unidade CANÔNICA (ex.: NF 'MT'/'METRO'/'MTS' vs produto 'm'; 'KG' vs 'kg';
  // 'CHAPA'/'PLACA' vs 'placa') → a quantidade entra como está, sem conversão.
  // Sem isto, uma napa faturada em "MT" caía em "precisa configurar" mesmo sendo
  // a mesma unidade do estoque. (Pedido user 2026-05-30: ler a unidade da NF certa.)
  if (nfCan === prodCan) return { qty: nfQty, unitPrice: nfUnitPrice, converted: false };

  const pkgLike = new Set(['un', 'pc', 'cx', 'rl', 'fh', 'jg', 'par', 'placa']);
  const measuredLike = new Set(['kg', 'g', 'mg', 'l', 'ml', 'm³', 'm', 'cm', 'mm', 'm²', 'dm²', 'cm²']);
  // package_weight_kg só é dimensionalmente válido pra produto em MASSA — é um
  // peso (kg). Usá-lo pra converter pacote→comprimento/área/volume infla o
  // estoque com um número de kg fingindo ser metro/dm²/litro (ex.: rolo de napa
  // em "m" com package_weight_kg=12 creditaria 12 m por rolo usando o PESO, não
  // o comprimento). Esses casos têm que ir por conversion_rate (Prioridade 2/3)
  // ou BLOQUEAR. Ver regra dm²→física no CLAUDE.md.
  const massLike = new Set(['kg', 'g', 'mg']);

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

  // Priority 3 — pkg-like NF unit with a non-trivial conversion_rate, SÓ quando
  // a unidade da NF casa com a purchase_unit cadastrada (F5-07). Antes aplicava
  // o rate a QUALQUER pkg-like: NF em 'CX' num produto purchase_unit='rolo'
  // (rate=500 m/rolo) tratava caixa como rolo em silêncio. Casos aceitos:
  //  - produto SEM purchase_unit (fallback legado — o rate é a única pista);
  //  - nfCan === purchaseCan (mesma embalagem — P2 pode ter caído aqui quando
  //    prodCan === purchaseCan não, mas rate=1);
  //  - NF em 'UN' genérico com purchase_unit de embalagem (fornecedores faturam
  //    'UN' pra placa/rolo/caixa — ex.: PLACA EVA faturada como '2 UN').
  const p3PurchaseMatches =
    !purchaseCan || nfCan === purchaseCan || (nfCan === 'un' && pkgLike.has(purchaseCan));
  if (pkgLike.has(nfCan) && product.conversion_rate && product.conversion_rate !== 1 && p3PurchaseMatches) {
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

  // Priority 5 — Package unit → MASS unit via package_weight_kg.
  // package_weight_kg is always in kg, so it only converts cleanly to a mass
  // stock unit (kg/g/mg). For package → comprimento/área/volume o fator certo é
  // conversion_rate (Prioridade 2/3) — usar o peso aqui inflaria o estoque.
  if (pkgLike.has(nfCan) && massLike.has(prodCan)) {
    if (!product.package_weight_kg || product.package_weight_kg <= 0) {
      return {
        qty: nfQty,
        unitPrice: nfUnitPrice,
        converted: false,
        needsConfig: true,
        reason: `Conversão necessária: NF em "${nfUnit}" mas estoque em "${product.unit}". Configure "Peso por embalagem" no grupo do produto "${product.name || ''}".`,
      };
    }
    // Convert kg → target mass unit
    let factor = product.package_weight_kg;
    if (prodCan === 'g') factor = product.package_weight_kg * 1000;
    else if (prodCan === 'mg') factor = product.package_weight_kg * 1000000;
    return {
      qty: nfQty * factor,
      unitPrice: nfUnitPrice / factor,
      converted: true,
    };
  }

  // Package → comprimento/área/volume (NÃO-massa) sem conversion_rate: não há
  // fator seguro (package_weight_kg é peso, não comprimento/área). BLOQUEIA em
  // vez de gravar qtd errada — o operador configura a Taxa de conversão.
  if (pkgLike.has(nfCan) && measuredLike.has(prodCan)) {
    return {
      qty: nfQty,
      unitPrice: nfUnitPrice,
      converted: false,
      needsConfig: true,
      reason: `NF em "${nfUnit}" mas estoque em "${product.unit}". Configure a "Taxa de conversão" no cadastro de "${product.name || ''}" (ex: 1 ${nfUnit} = 50 ${product.unit}) — o "Peso por embalagem" só converte para produtos em kg/g.`,
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

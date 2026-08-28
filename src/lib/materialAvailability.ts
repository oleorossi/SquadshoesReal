import { supabase } from '@/integrations/supabase/client';
import { isDiscretePurchaseUnit, normalizeUnit } from '@/lib/unitConversion';

export interface MaterialShortage {
  product_id: string;
  product_name: string;
  product_sku: string | null;
  required: number;
  available: number;
  shortage: number;
  unit: string;
  unit_price: number;
  supplier_id: string | null;
  supplier_name: string;
  lead_time_days: number;
  moq: number;
   /** Quantity that should be ordered or produced (max of shortage and MOQ).
    * Em UNIDADE DE CONSUMO interna (metros, kg, un). Para gerar OC, multiplicar
    * por conversion_rate e arredondar pra cima → suggested_purchase_qty. */
   suggested_qty: number;
   /** Quantidade já convertida pra unidade de compra do fornecedor (rolos, sacos)
    *  com CEIL aplicado. Vai pro INSERT em purchase_orders.items.quantity. */
   suggested_purchase_qty: number;
   /** Unidade interna de consumo (m, kg, un). */
   consumption_unit: string;
   /** Unidade de compra do fornecedor (rolo, saco, un); fallback = consumption_unit. */
   purchase_unit: string;
   /** Quantos consumption_unit por purchase_unit. Ex: 1 rolo = 50 m → 50. Default 1. */
   conversion_rate: number;
   is_artisanal: boolean;
  /** Minimum stock target — used to calculate artisanal forStock buffer. */
  min_stock: number;
  /** Teto de estoque cadastrado no produto. Vai pro item da OC — antes o
   *  MaterialPurchaseConfirmDialog gravava `max_stock: 0` hardcoded, o que
   *  fazia toda OC gerada por PV nascer com política de estoque zerada. */
  max_stock: number;
  /** Preço unitário na UNIDADE DE COMPRA (= unit_price × conversion_rate).
   *  Pareia com `suggested_purchase_qty`/`purchase_unit`; usar `unit_price`
   *  junto de `suggested_purchase_qty` subfatura a OC pelo conversion_rate
   *  (PLACA EVA: R$ 0,11/dm² em vez de R$ 16,50/placa). */
  purchase_unit_price: number;
  /** References on the order that consume this material. */
  reference_labels: string[];
  /** Cor solicitada — preenchida quando o material varia por cor (típico SOLADOS).
   *  Quando preenchida, esse shortage é UMA LINHA SEPARADA por (product_id, color).
   *  null pra materiais sem variação de cor (forros, tiras agregados, etc.). */
  color: string | null;
  /** Quantidade por numeração (grade) consolidada — soma das grades dos itens
   *  do PV que demandam esse (product_id, color). Usado pra preencher a grade
   *  da OC de solado pra que o fornecedor saiba quantos pares de cada tamanho. */
  grade: Record<string, number> | null;
}

export interface MaterialAvailabilityResult {
  shortages: MaterialShortage[];
  /** Maximum lead time across all material shortages (in days). */
  maxLeadTimeDays: number;
  /** Min purchase-driven date if user proceeds without buffer. */
  minPurchaseDateISO: string | null;
}

export interface RawMaterialAvailability {
  product_id: string | null;
  product_name: string;
  required: number;
  available: number;
  referenceLabel: string;
  /** Todas as referências que compartilham o mesmo estoque. `referenceLabel`
   *  segue aceito para chamadas unitárias. */
  referenceLabels?: string[];
  /** Cor solicitada — propagar do item do PV pra que solados sejam comprados
   *  com a cor correta. Materiais agregados (forro genérico, etc.) deixam null. */
  color?: string | null;
  /** Grade do item do PV (quantidade por tamanho). Quando enviado, é somado
   *  por (product_id, color) na agregação. Solados precisam disso pra OC. */
  grade?: Record<string, number> | null;
}

export interface AggregatedMaterialAvailability {
  product_id: string;
  product_name: string;
  color: string | null;
  required: number;
  available: number;
  referenceLabels: string[];
  grade: Record<string, number> | null;
}

interface AggregatedMaterialAvailabilityInternal {
  product_id: string;
  product_name: string;
  required: number;
  available: number;
  color: string | null;
  referenceLabels: Set<string>;
  grade: Record<string, number> | null;
}

/**
 * Soma as respostas por balde físico de estoque antes de decidir se há falta.
 * Solados preservam (produto, cor, grade); materiais comuns compartilham o
 * estoque do produto entre todas as cores do PV e descartam a grade.
 *
 * O RPC recebe um item por chamada e compara cada um contra o MESMO saldo.
 * Portanto, o disponível entra uma única vez (menor snapshot em caso de
 * respostas concorrentes), enquanto todo o consumo é somado.
 */
export function aggregateMaterialAvailability(
  availability: RawMaterialAvailability[],
  categoryByProductId: ReadonlyMap<string, string | null | undefined>,
): AggregatedMaterialAvailability[] {
  const byProductAndColor = new Map<string, AggregatedMaterialAvailabilityInternal>();

  for (const row of availability) {
    if (!row.product_id) continue;
    const color = row.color ?? null;
    const key = `${row.product_id}::${color || ''}`;
    const parsedRequired = Number(row.required);
    const parsedAvailable = Number(row.available);
    const required = Number.isFinite(parsedRequired) ? parsedRequired : 0;
    const available = Number.isFinite(parsedAvailable) ? parsedAvailable : 0;
    const references = row.referenceLabels?.length
      ? row.referenceLabels
      : [row.referenceLabel];
    const existing = byProductAndColor.get(key);

    if (existing) {
      existing.required += required;
      existing.available = Math.min(existing.available, available);
      references.filter(Boolean).forEach((label) => existing.referenceLabels.add(label));
      if (row.grade) {
        existing.grade = existing.grade || {};
        for (const [size, qty] of Object.entries(row.grade)) {
          existing.grade[size] = (existing.grade[size] || 0) + Number(qty || 0);
        }
      }
      continue;
    }

    byProductAndColor.set(key, {
      product_id: row.product_id,
      product_name: row.product_name,
      required,
      available,
      referenceLabels: new Set(references.filter(Boolean)),
      color,
      grade: row.grade ? { ...row.grade } : null,
    });
  }

  const final = new Map<string, AggregatedMaterialAvailabilityInternal>();
  for (const need of byProductAndColor.values()) {
    const isSole = (categoryByProductId.get(need.product_id) || '')
      .toLowerCase()
      .includes('solado');
    const key = isSole
      ? `${need.product_id}::${need.color || ''}`
      : need.product_id;
    const existing = final.get(key);
    if (existing) {
      existing.required += need.required;
      existing.available = Math.min(existing.available, need.available);
      need.referenceLabels.forEach((label) => existing.referenceLabels.add(label));
      if (isSole && need.grade) {
        existing.grade = existing.grade || {};
        for (const [size, qty] of Object.entries(need.grade)) {
          existing.grade[size] = (existing.grade[size] || 0) + Number(qty || 0);
        }
      }
      continue;
    }
    final.set(key, {
      ...need,
      color: isSole ? need.color : null,
      referenceLabels: new Set(need.referenceLabels),
      grade: isSole && need.grade ? { ...need.grade } : null,
    });
  }

  return [...final.values()].map((need) => ({
    ...need,
    referenceLabels: [...need.referenceLabels],
  }));
}

type ProductRow = {
  id: string;
  name: string | null;
  sku: string | null;
  unit: string | null;
  quantity: number | null;
  reserved_stock: number | null;
  unit_price: number | null;
  supplier_id: string | null;
  supplier_lead_time_days: number | null;
  lead_time_days: number | null;
  sole_moq: number | null;
  min_stock: number | null;
  max_stock: number | null;
  is_artisanal: boolean | null;
  purchase_unit: string | null;
  purchase_order_unit: string | null;
  conversion_rate: number | null;
  category: string | null;
};

type SupplierRow = { id: string; name: string | null; lead_time_days: number | null };

/**
 * Escala uma grade {tamanho: qty} pra que a soma bata exatamente em `target`,
 * mantendo a proporção original. Usa largest-remainder pra distribuir resto
 * (igual ao scaleGradeWithLargestRemainder de OperatorWorkSheet) — assim a OC
 * de 20 pares de um PV de 420 sai com a grade proporcional certa.
 */
function scaleGradeToTotal(
  grade: Record<string, number>,
  target: number,
): Record<string, number> {
  const sum = Object.values(grade).reduce((s, v) => s + Number(v || 0), 0);
  if (sum <= 0 || target <= 0) return {};
  const multiplier = target / sum;
  const floored: Record<string, number> = {};
  const remainders: Array<{ size: string; r: number }> = [];
  let total = 0;
  for (const [size, qty] of Object.entries(grade)) {
    const raw = Number(qty) * multiplier;
    const fl = Math.floor(raw);
    floored[size] = fl;
    remainders.push({ size, r: raw - fl });
    total += fl;
  }
  let leftover = Math.round(target) - total;
  remainders.sort((a, b) => b.r - a.r);
  let i = 0;
  while (leftover > 0 && remainders.length > 0) {
    floored[remainders[i % remainders.length].size] += 1;
    leftover -= 1;
    i += 1;
  }
  return floored;
}

/**
 * Enrich raw stock shortages with supplier, lead time, MOQ and unit info, mirroring
 * the sole-availability logic so the same UX can be reused for general materials.
 */
export async function enrichMaterialShortages(rawAvailability: RawMaterialAvailability[]): Promise<MaterialAvailabilityResult> {
  if (rawAvailability.length === 0) {
    return { shortages: [], maxLeadTimeDays: 0, minPurchaseDateISO: null };
  }

  const productIds = [...new Set(
    rawAvailability.map((row) => row.product_id).filter(Boolean),
  )] as string[];
  if (productIds.length === 0) {
    return { shortages: [], maxLeadTimeDays: 0, minPurchaseDateISO: null };
  }
  const { data: products, error: productsError } = await supabase
    .from('products')
    .select('id, name, sku, unit, quantity, reserved_stock, unit_price, supplier_id, supplier_lead_time_days, lead_time_days, sole_moq, min_stock, max_stock, is_artisanal, purchase_unit, purchase_order_unit, conversion_rate, category')
    .in('id', productIds);
  if (productsError) throw productsError;

  const rows = (products || []) as unknown as ProductRow[];
  const supplierIds = [...new Set(rows.map(p => p.supplier_id).filter(Boolean))] as string[];
  const { data: suppliers, error: suppliersError } = supplierIds.length > 0
    ? await supabase.from('suppliers').select('id, name, lead_time_days').in('id', supplierIds)
    : { data: [] as SupplierRow[], error: null };
  if (suppliersError) throw suppliersError;
  const supplierMap = new Map((suppliers || []).map(s => [s.id, s as SupplierRow]));

  let maxLeadTime = 0;
  const shortages: MaterialShortage[] = [];
  const productById = new Map(rows.map(p => [p.id, p]));
  const categoryByProductId = new Map(rows.map((product) => [product.id, product.category]));
  const aggregated = aggregateMaterialAvailability(rawAvailability, categoryByProductId);

  // Agora itera por (product_id, color) — pode ter múltiplos shortages do mesmo
  // produto se cores diferentes foram solicitadas (solados, principalmente).
  for (const need of aggregated) {
    const product = productById.get(need.product_id);
    if (!product) continue;

    const supplier = product.supplier_id ? supplierMap.get(product.supplier_id) : null;
    const leadTime = Number(supplier?.lead_time_days) > 0
      ? Number(supplier?.lead_time_days)
      : Number(product.supplier_lead_time_days) > 0
        ? Number(product.supplier_lead_time_days)
        : 10;

    const moq = Number(product.sole_moq ?? product.min_stock ?? 0);
    const minStock = Number(product.min_stock ?? 0);
    const shortageQty = Math.max(0, need.required - need.available);
    if (shortageQty <= 0) continue;

    // Artesanais: sugestão = shortage + buffer de estoque mínimo (forStock).
    // Materiais comuns: max(shortage, MOQ).
    const suggested = product.is_artisanal
      ? shortageQty + Math.max(0, minStock - need.available)
      : Math.max(shortageQty, moq);

    // O3: aplica conversion_rate quando o fornecedor vende em unidade diferente
    // (ex: m → rolo, kg → saco). CEIL pra não pedir fração de rolo.
    const consumptionUnit = product.unit || 'un';
    const purchaseUnit = product.purchase_order_unit || product.purchase_unit || consumptionUnit;
    const conversionRate = Number(product.conversion_rate);
    const hasDifferentUnits = normalizeUnit(purchaseUnit) !== normalizeUnit(consumptionUnit);
    if (hasDifferentUnits && (!Number.isFinite(conversionRate) || conversionRate <= 0)) {
      throw new Error(
        `${product.name || need.product_name}: taxa de conversão inválida para ${purchaseUnit} → ${consumptionUnit}. Cadastre um fator maior que zero antes de gerar a compra.`,
      );
    }
    const rawPurchaseQty = conversionRate > 1 ? suggested / conversionRate : suggested;
    // CEIL sempre que a unidade de compra é DISCRETA (placa/un/par/cx/rolo…) —
    // antes só arredondava quando conversion_rate>1, então rate=1 deixava
    // fração de placa/un/par. Unidades contínuas (m/kg/L) seguem fracionárias.
    // Auditoria 2026-06-14, Área 6 (🟠).
    const suggestedPurchaseQty = isDiscretePurchaseUnit(purchaseUnit)
      ? Math.ceil(rawPurchaseQty)
      : rawPurchaseQty;

    // Escala a grade pra refletir a QUANTIDADE comprada (pode ser < required quando
    // tem estoque parcial). Mantém a proporção original do PV. Usa largest-remainder
    // simples pra somar exatamente suggested.
    const scaledGrade = need.grade ? scaleGradeToTotal(need.grade, suggested) : null;

    shortages.push({
      product_id: product.id,
      product_name: product.name || need.product_name,
      product_sku: product.sku ?? null,
      required: need.required,
      available: need.available,
      shortage: shortageQty,
      unit: consumptionUnit,
      unit_price: Number(product.unit_price ?? 0),
      supplier_id: product.supplier_id ?? null,
      supplier_name: supplier?.name || (product.is_artisanal ? 'Terceirizado (OS)' : 'Fornecedor não definido'),
      lead_time_days: leadTime,
      moq,
      suggested_qty: suggested,
      suggested_purchase_qty: suggestedPurchaseQty,
      consumption_unit: consumptionUnit,
      purchase_unit: purchaseUnit,
      conversion_rate: conversionRate,
      is_artisanal: !!product.is_artisanal,
      min_stock: minStock,
      max_stock: Number(product.max_stock ?? 0),
      // R$/estoque × (estoque por unidade de compra) = R$/compra. Mantém
      // `quantity × unit_price` invariante entre as duas unidades.
      // ⚠ Multiplica SÓ quando a quantidade foi de fato dividida (mesma
      // condição de `rawPurchaseQty`): com um conversion_rate cadastrado entre
      // 0 e 1 a quantidade sai inteira e multiplicar o preço mesmo assim
      // faturaria a OC por um fator solto.
      purchase_unit_price: Number(product.unit_price ?? 0) * (conversionRate > 1 ? conversionRate : 1),
      reference_labels: need.referenceLabels,
      color: need.color,
      grade: scaledGrade,
    });
    if (leadTime > maxLeadTime) maxLeadTime = leadTime;
  }

  if (shortages.length === 0) {
    return { shortages: [], maxLeadTimeDays: 0, minPurchaseDateISO: null };
  }

  const minDate = new Date();
  minDate.setDate(minDate.getDate() + maxLeadTime);

  return {
    shortages,
    maxLeadTimeDays: maxLeadTime,
    minPurchaseDateISO: minDate.toISOString().slice(0, 10),
  };
}

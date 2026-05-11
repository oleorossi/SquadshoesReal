import { supabase } from '@/integrations/supabase/client';

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
  /** References on the order that consume this material. */
  reference_labels: string[];
}

export interface MaterialAvailabilityResult {
  shortages: MaterialShortage[];
  /** Maximum lead time across all material shortages (in days). */
  maxLeadTimeDays: number;
  /** Min purchase-driven date if user proceeds without buffer. */
  minPurchaseDateISO: string | null;
}

interface RawShortage {
  product_id: string;
  product_name: string;
  required: number;
  available: number;
  referenceLabel: string;
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
  is_artisanal: boolean | null;
  purchase_unit: string | null;
  purchase_order_unit: string | null;
  conversion_rate: number | null;
};

type SupplierRow = { id: string; name: string | null; lead_time_days: number | null };

/**
 * Enrich raw stock shortages with supplier, lead time, MOQ and unit info, mirroring
 * the sole-availability logic so the same UX can be reused for general materials.
 */
export async function enrichMaterialShortages(rawShortages: RawShortage[]): Promise<MaterialAvailabilityResult> {
  if (rawShortages.length === 0) {
    return { shortages: [], maxLeadTimeDays: 0, minPurchaseDateISO: null };
  }

  // Aggregate by product_id (a material can be needed by multiple references)
  const aggregated = new Map<string, { product_id: string; product_name: string; required: number; available: number; references: Set<string> }>();
  for (const s of rawShortages) {
    const existing = aggregated.get(s.product_id);
    if (existing) {
      existing.required += s.required;
      // available is the same snapshot; keep min
      existing.available = Math.min(existing.available, s.available);
      existing.references.add(s.referenceLabel);
    } else {
      aggregated.set(s.product_id, {
        product_id: s.product_id,
        product_name: s.product_name,
        required: s.required,
        available: s.available,
        references: new Set([s.referenceLabel]),
      });
    }
  }

  const productIds = [...aggregated.keys()];
  const { data: products } = await supabase
    .from('products')
    .select('id, name, sku, unit, quantity, reserved_stock, unit_price, supplier_id, supplier_lead_time_days, lead_time_days, sole_moq, min_stock, is_artisanal, purchase_unit, purchase_order_unit, conversion_rate')
    .in('id', productIds);

  const rows = (products || []) as unknown as ProductRow[];
  const supplierIds = [...new Set(rows.map(p => p.supplier_id).filter(Boolean))] as string[];
  const { data: suppliers } = supplierIds.length > 0
    ? await supabase.from('suppliers').select('id, name, lead_time_days').in('id', supplierIds)
    : { data: [] as SupplierRow[] };
  const supplierMap = new Map((suppliers || []).map(s => [s.id, s as SupplierRow]));

  let maxLeadTime = 0;
  const shortages: MaterialShortage[] = [];

  for (const product of rows) {
    const need = aggregated.get(product.id);
    if (!need) continue;

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
    const conversionRate = Number(product.conversion_rate) > 0 ? Number(product.conversion_rate) : 1;
    const suggestedPurchaseQty = conversionRate > 1
      ? Math.ceil(suggested / conversionRate)
      : suggested;

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
      reference_labels: [...need.references],
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

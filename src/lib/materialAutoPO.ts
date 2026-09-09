import { supabase } from '@/integrations/supabase/client';

import { roundUpToPurchaseMultiple, effectivePurchaseMultiple } from '@/lib/purchaseMultiple';
import { resolveGroupSupplier } from '@/lib/groupSupplierResolution';
import {
  executePurchaseOrderCommand,
  purchaseOrderLogicalKey,
} from '@/services/purchaseOrderCommandService';

export interface MaterialAutoPOResult {
  poNumber: string;
  supplierName: string;
  accumulated: boolean;
  purchaseByDate?: string | null;
  etaDays?: number | null;
}

/**
 * Compra no prazo da onda: purchase_by_date = início de prep − buffer − lead
 * do fornecedor (compute_po_purchase_by_date → compute_wave_timeline).
 * eta_days = lead efetivo (OC aberta > grupo > produto > 10).
 * promised_date = comprar-até + lead → chega perto do início, não meses antes.
 */
async function computePoLeadTiming(params: {
  saleOrderId: string | null;
  productId: string;
  existingPurchaseBy?: string | null;
}): Promise<{ purchaseByDate: string | null; etaDays: number; promisedDate: string | null }> {
  let purchaseBy: string | null = params.existingPurchaseBy ?? null;
  if (params.saleOrderId) {
    const { data } = await supabase.rpc('compute_po_purchase_by_date' as never, {
      p_sale_order_ids: [params.saleOrderId],
    } as never);
    const rawComputed = data as unknown;
    const computed = typeof rawComputed === 'string' ? rawComputed : null;
    if (computed && (!purchaseBy || computed < purchaseBy)) purchaseBy = computed;
  }
  const { data: leadRaw } = await supabase.rpc('get_effective_supplier_lead_days' as never, {
    p_product_id: params.productId,
    p_prod_deadline_days: null,
  } as never);
  const etaDays = Math.max(0, Number(leadRaw) || 10);
  let promisedDate: string | null = null;
  if (purchaseBy) {
    const d = new Date(`${purchaseBy}T12:00:00`);
    d.setDate(d.getDate() + etaDays);
    promisedDate = d.toISOString().slice(0, 10);
  }
  return { purchaseByDate: purchaseBy, etaDays, promisedDate };
}

/** Erro de domínio: material artesanal é produzido por OS, nunca comprado. */
export class ArtisanalMaterialPurchaseBlockedError extends Error {
  constructor(productName: string) {
    super(`"${productName}" é material artesanal e não pode gerar OC automática. Gere ou revise a OS de produção artesanal.`);
    this.name = 'ArtisanalMaterialPurchaseBlockedError';
  }
}

/**
 * When a material is insufficient for an order (detected by check_stock_availability),
 * finds the product's supplier and auto-creates (or accumulates into) a purchase order.
 *
 * Accumulation rule: if an open (pending/approved) PO already exists for this supplier,
 * the new demand is merged into it — so one PO per supplier stays open until finalised.
 */
export async function autoCreateMaterialPO(params: {
  productId: string;
  productName: string;
  shortageQty: number;
  orderRef: string;
  unit?: string;
}): Promise<MaterialAutoPOResult | null> {
  const { productId, productName, shortageQty, orderRef } = params;
  if (shortageQty <= 0) return null;

  const { data: product } = await (supabase.from('products') as any)
    .select('id, name, quantity, min_stock, unit_price, unit, purchase_order_unit, conversion_rate, group_id, supplier_id, color, is_artisanal, purchase_multiple, product_groups:product_groups!products_group_id_fkey(purchase_multiple)')
    .eq('id', productId)
    .maybeSingle();

  if (!product) return null;
  if (product.is_artisanal) throw new ArtisanalMaterialPurchaseBlockedError(product.name || productName);

  const currentStock = Number(product.quantity) || 0;
  const minStock = Number(product.min_stock) || 0;

  const convRate = Number((product as any).conversion_rate) || 1;
  const purchaseUnit = (params.unit && params.unit === product.unit)
    ? (((product as any).purchase_order_unit as string) || product.unit || 'un')
    : (((product as any).purchase_order_unit as string) || params.unit || product.unit || 'un');
  const unit = purchaseUnit;
  const unitPrice = (Number(product.unit_price) || 0) * convRate;
  const DISCRETE_PURCHASE_UNITS = ['un', 'cx', 'rolo', 'chapa', 'placa', 'placas', 'unidade', 'par'];
  let orderQty = shortageQty / (convRate || 1);
  if (DISCRETE_PURCHASE_UNITS.includes(String(purchaseUnit).toLowerCase())) {
    orderQty = Math.ceil(orderQty);
  }
  orderQty = roundUpToPurchaseMultiple(
    orderQty,
    effectivePurchaseMultiple((product as any).purchase_multiple, (product as any).product_groups?.purchase_multiple),
  );

  let supplierName = 'A definir';
  let supplierId: string | null = null;

  if (product.supplier_id) {
    const { data: sup } = await supabase
      .from('suppliers')
      .select('id, name')
      .eq('id', product.supplier_id)
      .maybeSingle();
    if (sup?.name) {
      supplierName = sup.name;
      supplierId = sup.id;
    }
  }

  if (supplierName === 'A definir' && product.group_id) {
    const gs = await resolveGroupSupplier(product.group_id);
    if (gs?.supplier_name) {
      supplierName = gs.supplier_name;
      supplierId = gs.supplier_id;
    }
  }

  let openPO: { id: string; order_number: string; total_value: number; notes: string; purchase_by_date?: string | null } | null = null;
  {
    let q = (supabase as any)
      .from('purchase_orders')
      .select('id, order_number, total_value, notes, purchase_by_date')
      .in('status', ['pending', 'approved'])
      .order('created_at', { ascending: false })
      .limit(1);
    q = supplierId ? q.eq('supplier_id', supplierId) : q.eq('supplier_name', supplierName).is('supplier_id', null);
    const { data } = await q.maybeSingle();
    openPO = data ?? null;
  }

  let linkedPvId: string | null = null;
  try {
    const { data: so } = await (supabase.from('sale_orders') as any).select('id').eq('order_number', orderRef).maybeSingle();
    linkedPvId = so?.id ?? null;
  } catch { /* sem PV vinculado */ }

  const appendNote = `\nFalta de "${productName}" para PV ${orderRef} — pedir ${orderQty} ${unit}`;

  const itemBase = {
    product_id: productId,
    quantity: orderQty,
    suggested_quantity: orderQty,
    unit_price: unitPrice,
    unit,
    current_stock: currentStock,
    min_stock: minStock,
    max_stock: minStock + shortageQty,
    color: product.color || null,
  };

  if (openPO) {
    const timing = await computePoLeadTiming({
      saleOrderId: linkedPvId,
      productId,
      existingPurchaseBy: openPO.purchase_by_date ?? null,
    });
    await executePurchaseOrderCommand({
      command: 'append',
      purchaseOrderId: openPO.id,
      payload: {
        header_patch: {
          notes_append: appendNote,
          purchase_by_date_min: timing.purchaseByDate,
          promised_date: timing.promisedDate,
          eta_days: timing.etaDays,
          linked_sale_order_ids_add: linkedPvId ? [linkedPvId] : [],
          source_pv_ids_add: linkedPvId ? [linkedPvId] : [],
        },
        items: [itemBase],
      },
      logicalKey: purchaseOrderLogicalKey('material-append', orderRef, productId),
    });
    return {
      poNumber: openPO.order_number,
      supplierName,
      accumulated: true,
      purchaseByDate: timing.purchaseByDate,
      etaDays: timing.etaDays,
    };
  }

  const idempotencyKey = linkedPvId ? `auto:${linkedPvId}:${productId}` : null;
  const timing = await computePoLeadTiming({
    saleOrderId: linkedPvId,
    productId,
  });
  const result = await executePurchaseOrderCommand({
    command: 'create',
    payload: {
      header: {
        supplier_name: supplierName,
        supplier_id: supplierId,
        auto_generated: true,
        source_type: linkedPvId ? 'auto_pv' : 'manual',
        idempotency_key: idempotencyKey,
        notes: `Gerada automaticamente — Falta de "${productName}" para PV ${orderRef}. Pedir ${orderQty} ${unit}.`,
        linked_sale_order_ids: linkedPvId ? [linkedPvId] : [],
        source_pv_ids: linkedPvId ? [linkedPvId] : [],
        purchase_by_date: timing.purchaseByDate,
        promised_date: timing.promisedDate,
        eta_days: timing.etaDays,
      },
      items: [itemBase],
      return_existing_on_idempotency: Boolean(idempotencyKey),
    },
    logicalKey: purchaseOrderLogicalKey('material-create', orderRef, productId),
  });
  const po = result.purchase_order as { order_number?: string } | undefined;
  if (!po?.order_number) return null;
  return {
    poNumber: po.order_number,
    supplierName,
    accumulated: Boolean(result.deduplicated),
    purchaseByDate: timing.purchaseByDate,
    etaDays: timing.etaDays,
  };
}

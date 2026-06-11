import { supabase } from '@/integrations/supabase/client';

export interface MaterialAutoPOResult {
  poNumber: string;
  supplierName: string;
  accumulated: boolean;
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

  // ── Step 1: Fetch product details ────────────────────────────────────────
  const { data: product } = await supabase
    .from('products')
    .select('id, name, quantity, min_stock, unit_price, unit, purchase_order_unit, conversion_rate, group_id, supplier_id, color')
    .eq('id', productId)
    .maybeSingle();

  if (!product) return null;

  const currentStock = Number(product.quantity) || 0;
  const minStock = Number(product.min_stock) || 0;

  // ── Conversão estoque→compra (espelha generate_purchase_orders_from_mrp) ──
  // shortageQty vem na unidade de ESTOQUE; a OC deve sair na unidade de COMPRA.
  // Sem isto, PLACA EVA (estoque dm², compra 'placa', rate 150) saía com
  // quantidade/unidade/preço errados e a acumulação não casava com itens do RPC.
  const convRate = Number((product as any).conversion_rate) || 1;
  const purchaseUnit = (params.unit && params.unit === product.unit)
    ? (((product as any).purchase_order_unit as string) || product.unit || 'un')
    : (((product as any).purchase_order_unit as string) || params.unit || product.unit || 'un');
  const unit = purchaseUnit;
  // R$/estoque × (estoque/compra) = R$/compra. total_value fica invariante.
  const unitPrice = (Number(product.unit_price) || 0) * convRate;
  const DISCRETE_PURCHASE_UNITS = ['un', 'cx', 'rolo', 'chapa', 'placa', 'placas', 'unidade', 'par'];
  let orderQty = shortageQty / (convRate || 1);
  if (DISCRETE_PURCHASE_UNITS.includes(String(purchaseUnit).toLowerCase())) {
    orderQty = Math.ceil(orderQty);
  }

  // ── Step 2: Resolve supplier ─────────────────────────────────────────────
  let supplierName = 'A definir';
  let supplierId: string | null = null;

  // Priority 1: product.supplier_id (saved from last received PO)
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

  // Priority 2: group_suppliers (most recent supplier for the product's group)
  if (supplierName === 'A definir' && product.group_id) {
    const { data: gs } = await (supabase as any)
      .from('group_suppliers')
      .select('supplier_name, supplier_id')
      .eq('group_id', product.group_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (gs?.supplier_name) {
      supplierName = gs.supplier_name;
      supplierId = gs.supplier_id || null;
    }
  }

  // ── Step 3: Check for existing open PO to accumulate into ────────────────
  let openPO: { id: string; order_number: string; total_value: number; notes: string } | null = null;
  if (supplierName !== 'A definir') {
    const { data } = await (supabase as any)
      .from('purchase_orders')
      .select('id, order_number, total_value, notes')
      .eq('supplier_name', supplierName)
      .in('status', ['pending', 'approved'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    openPO = data ?? null;
  }

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
    // ── Accumulate into existing open PO (atomic — closes lost-update race) ─
    const { error: upsertErr } = await (supabase as any).rpc('upsert_po_item_atomic', {
      p_po_id: openPO.id,
      p_product_id: productId,
      p_qty_delta: orderQty,
      p_unit_price: unitPrice,
      p_unit: unit,
      p_current_stock: currentStock,
      p_min_stock: minStock,
      p_max_stock: minStock + shortageQty,
    });
    if (upsertErr) throw new Error(`Falha ao acumular item na OC ${openPO.order_number}: ${upsertErr.message}`);

    // upsert_po_item_atomic already updates purchase_orders.total_value in
    // the same transaction (audit-2 fix), so no separate increment needed.
    await (supabase as any)
      .from('purchase_orders')
      .update({ notes: (openPO.notes || '') + appendNote })
      .eq('id', openPO.id);

    return { poNumber: openPO.order_number, supplierName, accumulated: true };
  }

  // ── Step 4: No open PO — create a new one ────────────────────────────────
  const { data: po, error: poErr } = await (supabase as any)
    .from('purchase_orders')
    .insert({
      supplier_name: supplierName,
      supplier_id: supplierId,
      auto_generated: true,
      total_value: orderQty * unitPrice,
      notes: `Gerada automaticamente — Falta de "${productName}" para PV ${orderRef}. Pedir ${orderQty} ${unit}.`,
    })
    .select('id, order_number')
    .single();

  if (poErr || !po) return null;

  const { error: itemErr } = await (supabase as any).from('purchase_order_items').insert({
    purchase_order_id: po.id,
    ...itemBase,
  });
  if (itemErr) {
    const { error: cleanupErr } = await (supabase as any).from('purchase_orders').delete().eq('id', po.id);
    if (cleanupErr) {
      throw new Error(`Falha ao inserir item (${itemErr.message}) e ao limpar OC órfã (${cleanupErr.message}). Verifique a OC ${po.order_number} manualmente.`);
    }
    throw new Error(`Falha ao inserir item na OC ${po.order_number}: ${itemErr.message}`);
  }

  return { poNumber: po.order_number, supplierName, accumulated: false };
}

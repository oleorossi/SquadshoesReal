import { supabase } from '@/integrations/supabase/client';

export interface SoleAutoPOResult {
  poNumber: string;
  supplierName: string;
  accumulated: boolean; // true if added to an existing open OC
}

/**
 * When sole stock is insufficient for an order, resolves the sole product,
 * finds a supplier via group_suppliers, and auto-creates (or accumulates into)
 * a purchase order.
 *
 * Accumulation rule: if an open (pending/approved) OC already exists for this
 * supplier the new demand is merged into it — quantities are summed per size and
 * the PO total is updated. This ensures one OC per supplier stays open until
 * it is finalised.
 */
export async function autoCreateSolePO(params: {
  referenceId: string;
  orderId: string;
  color: string;
  grade: Record<string, number>;
  orderRef: string;
}): Promise<SoleAutoPOResult | null> {
  const { referenceId, color, grade, orderRef, orderId } = params;

  // ── Step 1: Resolve the sole product ──────────────────────────────────────
  let soleProductId: string | null = null;
  let soleProductName = 'Solado';
  let soleProductColor = '';
  let soleProductGroupId: string | null = null;
  let currentStock = 0;
  let minStock = 0;
  let unitPrice = 0;
  let unit = 'par';

  let stockGrade: Record<string, number> = {};
  const setFromProduct = (p: any) => {
    soleProductId = p.id;
    soleProductName = p.name;
    soleProductColor = p.color || '';
    soleProductGroupId = p.group_id;
    // For grade-managed soles, use the sum of stock_grade per-size buckets as
    // the authoritative stock figure — debit_sole_stock_by_grade consumes from
    // those buckets, not from products.quantity, so using quantity here would
    // produce wrong shortage calculations.
    const sg = (p.stock_grade || {}) as Record<string, any>;
    stockGrade = Object.fromEntries(
      Object.entries(sg)
        .filter(([k]) => !k.startsWith('_'))
        .map(([k, v]) => [k, Number(v) || 0])
    );
    const gradeSum = Object.values(stockGrade).reduce((s, v) => s + v, 0);
    currentStock = gradeSum > 0 ? gradeSum : (Number(p.quantity) || 0);
    minStock = Number(p.min_stock) || 0;
    unitPrice = Number(p.unit_price) || 0;
    unit = p.unit || 'par';
  };

  // Priority 1: technical_sheet_sole_colors mapping
  const colorTrimmed = color.trim();
  const { data: colorMap } = colorTrimmed
    ? await (supabase as any)
        .from('technical_sheet_sole_colors')
        .select('sole_product_id, sole_group_id')
        .eq('sheet_id', referenceId)
        .ilike('product_color', colorTrimmed)
        .maybeSingle()
    : { data: null };

  if (colorMap?.sole_product_id) {
    const { data: p } = await supabase
      .from('products')
      .select('id, name, color, quantity, stock_grade, min_stock, unit_price, unit, group_id')
      .eq('id', colorMap.sole_product_id)
      .eq('active', true)
      .maybeSingle();
    if (p) setFromProduct(p);
  }

  // Priority 2: sole_group_id from technical_sheets
  if (!soleProductId) {
    const { data: sheet } = await (supabase as any)
      .from('technical_sheets')
      .select('sole_group_id')
      .eq('id', referenceId)
      .maybeSingle();

    const groupId = sheet?.sole_group_id || colorMap?.sole_group_id;

    if (groupId) {
      let found = false;

      if (color.trim()) {
        const { data: cp } = await supabase
          .from('products')
          .select('id, name, color, quantity, stock_grade, min_stock, unit_price, unit, group_id')
          .eq('active', true)
          .eq('group_id', groupId)
          .ilike('color', color.trim())
          .maybeSingle();
        if (cp) { setFromProduct(cp); found = true; }
      }

      if (!found) {
        const { data: ap } = await supabase
          .from('products')
          .select('id, name, color, quantity, stock_grade, min_stock, unit_price, unit, group_id')
          .eq('active', true)
          .eq('group_id', groupId)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (ap) setFromProduct(ap);
      }
    }
  }

  if (!soleProductId) return null;

  // ── Step 2: Calculate shortage per-size ──────────────────────────────────
  const totalRequired = Object.values(grade).reduce((s, v) => s + Number(v), 0);
  if (totalRequired <= 0) return null;

  // Per-size shortage: aggregate totals can mask deficits where one size is
  // out of stock while another has surplus — debit_sole_stock_by_grade debits
  // per-size bucket, so the PO must cover each size individually.
  const perSizeShortage: Record<string, number> = {};
  for (const [size, needed] of Object.entries(grade)) {
    const available = stockGrade[size] ?? 0;
    const deficit = Math.max(0, Number(needed) - available);
    if (deficit > 0) perSizeShortage[size] = deficit;
  }
  const shortage = Object.values(perSizeShortage).reduce((s, v) => s + v, 0);
  if (shortage <= 0) return null; // estoque cobre todos os tamanhos, nada a pedir

  const orderQty = shortage;

  const gradeDesc = Object.entries(perSizeShortage)
    .filter(([, q]) => q > 0)
    .map(([sz, q]) => `Nº${sz}: ${q}par`)
    .join(', ');

  // ── Step 3: Find supplier via group_suppliers ─────────────────────────────
  let supplierName = 'A definir';
  let supplierId: string | null = null;

  if (soleProductGroupId) {
    const { data: gs } = await (supabase as any)
      .from('group_suppliers')
      .select('supplier_name, supplier_id')
      .eq('group_id', soleProductGroupId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (gs?.supplier_name) {
      supplierName = gs.supplier_name;
      supplierId = gs.supplier_id || null;
    }
  }

  // ── Step 4: Check for existing open OC to accumulate into ─────────────────
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

  const itemBase = {
    product_id: soleProductId,
    quantity: orderQty,
    suggested_quantity: orderQty,
    unit_price: unitPrice,
    unit,
    current_stock: currentStock,
    min_stock: minStock,
    max_stock: minStock + orderQty,
    grade,
    color: soleProductColor || color || null,
  };

  const appendNote = `\nSolado insuficiente para OP ${orderRef}. Grade: ${gradeDesc}`;

  if (openPO) {
    // ── Accumulate into existing open OC (atomic — closes lost-update race) ─
    const { error: upsertErr } = await (supabase as any).rpc('upsert_po_item_atomic', {
      p_po_id: openPO.id,
      p_product_id: soleProductId,
      p_qty_delta: orderQty,
      p_unit_price: unitPrice,
      p_unit: unit,
      p_current_stock: currentStock,
      p_min_stock: minStock,
      p_max_stock: minStock + orderQty,
      p_grade_delta: grade,
      p_color: soleProductColor || color || null,
    });
    // upsert_po_item_atomic already updates purchase_orders.total_value in
    // the same transaction (audit-2 fix), so no separate increment needed.
    if (upsertErr) throw new Error(`Falha ao acumular solado na OC ${openPO.order_number}: ${upsertErr.message}`);
    await (supabase as any)
      .from('purchase_orders')
      .update({ notes: (openPO.notes || '') + appendNote })
      .eq('id', openPO.id);

    return { poNumber: openPO.order_number, supplierName, accumulated: true };
  }

  // ── Step 5: No open OC — create a new one ─────────────────────────────────
  // Vincula o PV da OP pra herdar o purchase_by_date (backward do faturamento) via trigger.
  let linkedPvId: string | null = null;
  try {
    const { data: op } = await (supabase.from('orders') as any).select('sale_order_id').eq('id', orderId).maybeSingle();
    linkedPvId = op?.sale_order_id ?? null;
  } catch { /* sem PV vinculado — segue sem purchase_by_date */ }
  const { data: po, error: poErr } = await (supabase as any)
    .from('purchase_orders')
    .insert({
      supplier_name: supplierName,
      supplier_id: supplierId,
      auto_generated: true,
      total_value: orderQty * unitPrice,
      notes: `Gerada automaticamente — Solado insuficiente para OP ${orderRef}. Grade necessária: ${gradeDesc}`,
      ...(linkedPvId ? { linked_sale_order_ids: [linkedPvId] } : {}),
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
    throw new Error(`Falha ao inserir item de solado na OC ${po.order_number}: ${itemErr.message}`);
  }

  return { poNumber: po.order_number, supplierName, accumulated: false };
}

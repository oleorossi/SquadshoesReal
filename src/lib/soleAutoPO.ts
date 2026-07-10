import { supabase } from '@/integrations/supabase/client';

export interface SoleAutoPOResult {
  poNumber: string;
  supplierName: string;
  accumulated: boolean; // true if added to an existing open OC
}

/** Contexto resolvido do produto de solado + déficit, pronto pra virar OC. */
interface SolePOContext {
  orderId: string;
  orderRef: string;
  /** Cor do cabedal do pedido (fallback de cor no item da OC). */
  color: string;
  soleProductId: string;
  soleProductColor: string;
  soleProductGroupId: string | null;
  currentStock: number;
  minStock: number;
  unitPrice: number;
  unit: string;
  /** Déficit por numeração (chaves já no formato do stock_grade, ex. "33/34"). */
  perSizeShortage: Record<string, number>;
  /** Grade gravada no item da OC (o que pedir por numeração). */
  poItemGrade: Record<string, number>;
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

  // ── Step 1: Resolve the sole product (resolução CANÔNICA do servidor) ────
  // resolve_sole_color é a MESMA cascata que o débito usa (unificada na
  // migration 20260902140000): P0 conjugação de cor do grupo → P1/P2
  // technical_sheet_sole_colors → P3 primary_sole_id — e SEM fallback de
  // "qualquer produto do grupo". A cascata legada que vivia aqui tinha esse
  // fallback (por updated_at DESC) e em 05/07/2026 pôs solado INFANTIL de
  // cor/grade erradas na OC-00094 (3 OPs do PV-00146, cada chamada resolveu
  // um produto diferente do grupo). Se o canônico não resolver, retornamos
  // null SEM criar OC — nunca pedir produto de cor/modelo errado.
  const { data: resolved, error: resolveErr } = await supabase.rpc('resolve_sole_color', {
    p_sheet_id: referenceId,
    p_product_color: color,
  });
  if (resolveErr) {
    console.error('autoCreateSolePO: resolve_sole_color falhou:', resolveErr.message);
    return null;
  }
  const soleProductId = (Array.isArray(resolved) ? resolved[0] : resolved)?.sole_product_id ?? null;
  if (!soleProductId) return null;

  const { data: p } = await supabase
    .from('products')
    .select('id, name, color, quantity, stock_grade, min_stock, unit_price, unit, group_id')
    .eq('id', soleProductId)
    .eq('active', true)
    .maybeSingle();
  if (!p) return null;

  const soleProductColor = p.color || '';
  const soleProductGroupId = p.group_id;
  // For grade-managed soles, use the sum of stock_grade per-size buckets as
  // the authoritative stock figure — debit_sole_stock_by_grade consumes from
  // those buckets, not from products.quantity, so using quantity here would
  // produce wrong shortage calculations.
  const sg = ((p as any).stock_grade || {}) as Record<string, any>;
  const stockGrade: Record<string, number> = Object.fromEntries(
    Object.entries(sg)
      .filter(([k]) => !k.startsWith('_'))
      .map(([k, v]) => [k, Number(v) || 0])
  );
  const gradeSum = Object.values(stockGrade).reduce((s, v) => s + v, 0);
  const currentStock = gradeSum > 0 ? gradeSum : (Number(p.quantity) || 0);
  const minStock = Number(p.min_stock) || 0;
  const unitPrice = Number(p.unit_price) || 0;
  const unit = p.unit || 'par';

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

  // Comportamento legado preservado: o item da OC grava a grade COMPLETA
  // pedida (quantity = só o déficit). A variante por shortfall grava o déficit.
  return criarOuAcumularOCDeSolado({
    orderId,
    orderRef,
    color,
    soleProductId,
    soleProductColor,
    soleProductGroupId,
    currentStock,
    minStock,
    unitPrice,
    unit,
    perSizeShortage,
    poItemGrade: grade,
  });
}

/**
 * Achado C (auditoria 2026-07-01): com `p_force_soft=true` o
 * `debit_sole_stock_by_grade` NUNCA erra por falta de estoque (vira reserva
 * soft / débito parcial) — então os callers que só chamavam `autoCreateSolePO`
 * dentro de `if (soleErr)` estavam com a OC automática efetivamente MORTA.
 *
 * Esta variante dispara a partir do RESULTADO do débito: o RPC retorna void,
 * mas persiste em `material_reservations` (kind='sole_grade') o PRODUTO que a
 * cascata canônica resolveu (conjugações de cor incluídas) e a
 * `effective_grade` já remapeada pras chaves conjugadas do `stock_grade`
 * (ex. "33/34"). Comparamos essa necessidade com o `stock_grade` BRUTO atual
 * (mesma base que o débito hard usa — solado não tem reserva por numeração)
 * e criamos/acumulamos OC só pro déficit por numeração.
 *
 * Retorna null quando não há reserva de solado, não há déficit ou não foi
 * possível criar a OC. O caminho antigo por erro (`autoCreateSolePO`) segue
 * como fallback nos callers.
 */
export async function autoCreateSolePOFromShortfall(params: {
  orderId: string;
  orderRef: string;
}): Promise<SoleAutoPOResult | null> {
  const { orderId, orderRef } = params;

  // ── Step 1: lê o resultado do débito (reserva sole_grade da OP) ───────────
  const { data: reservations, error: rsvErr } = await (supabase as any)
    .from('material_reservations')
    .select('product_id, quantity_reserved, metadata')
    .eq('order_id', orderId)
    .eq('status', 'reserved')
    .eq('metadata->>kind', 'sole_grade');
  if (rsvErr || !reservations || reservations.length === 0) return null;

  for (const rsv of reservations as Array<{ product_id: string; quantity_reserved: number; metadata: any }>) {
    const effectiveGrade = (rsv.metadata?.effective_grade || {}) as Record<string, number>;
    const needEntries = Object.entries(effectiveGrade)
      .map(([k, v]) => [k, Number(v) || 0] as const)
      .filter(([, v]) => v > 0);
    if (needEntries.length === 0) continue;

    // ── Step 2: produto que o DÉBITO resolveu (não re-resolve a cascata) ────
    const { data: p } = await supabase
      .from('products')
      .select('id, name, color, group_id, quantity, stock_grade, min_stock, unit_price, unit')
      .eq('id', rsv.product_id)
      .maybeSingle();
    if (!p) continue;

    const sg = ((p as any).stock_grade || {}) as Record<string, any>;
    const stockGrade: Record<string, number> = Object.fromEntries(
      Object.entries(sg)
        .filter(([k]) => !k.startsWith('_'))
        .map(([k, v]) => [k, Number(v) || 0])
    );

    // ── Step 3: déficit por numeração (mesma conta LEAST do débito hard) ────
    // Se a reserva já é um saldo de baixa parcial (partial_pending), o déficit
    // É a própria effective_grade — o débito hard já subtraiu o disponível.
    const isPartialPending = rsv.metadata?.partial_pending === true;
    const perSizeShortage: Record<string, number> = {};
    for (const [sizeKey, needed] of needEntries) {
      const available = isPartialPending ? 0 : (stockGrade[sizeKey] ?? 0);
      const deficit = Math.max(0, needed - available);
      if (deficit > 0) perSizeShortage[sizeKey] = deficit;
    }
    if (Object.values(perSizeShortage).reduce((s, v) => s + v, 0) <= 0) continue;

    const gradeSum = Object.values(stockGrade).reduce((s, v) => s + v, 0);
    const cabedalColor = String(rsv.metadata?.color || '');

    return criarOuAcumularOCDeSolado({
      orderId,
      orderRef,
      color: cabedalColor,
      soleProductId: (p as any).id,
      soleProductColor: (p as any).color || '',
      soleProductGroupId: (p as any).group_id || null,
      currentStock: gradeSum > 0 ? gradeSum : (Number((p as any).quantity) || 0),
      minStock: Number((p as any).min_stock) || 0,
      unitPrice: Number((p as any).unit_price) || 0,
      unit: (p as any).unit || 'par',
      perSizeShortage,
      poItemGrade: perSizeShortage,
    });
  }

  return null;
}

/** Passos 3–5 compartilhados: fornecedor → OC aberta (acumula) → OC nova. */
async function criarOuAcumularOCDeSolado(ctx: SolePOContext): Promise<SoleAutoPOResult | null> {
  const {
    orderId, orderRef, color, soleProductId, soleProductColor, soleProductGroupId,
    currentStock, minStock, unitPrice, unit, perSizeShortage, poItemGrade,
  } = ctx;

  const orderQty = Object.values(perSizeShortage).reduce((s, v) => s + v, 0);
  if (orderQty <= 0) return null;

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
    grade: poItemGrade,
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
      p_grade_delta: poItemGrade,
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

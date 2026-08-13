import { supabase } from '@/integrations/supabase/client';

import { roundUpToPurchaseMultiple, effectivePurchaseMultiple } from '@/lib/purchaseMultiple';
import { resolveGroupSupplier } from '@/lib/groupSupplierResolution';

export interface MaterialAutoPOResult {
  poNumber: string;
  supplierName: string;
  accumulated: boolean;
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

  // ── Step 1: Fetch product details ────────────────────────────────────────
  // Cast: a coluna purchase_multiple ainda não está nos tipos gerados do Supabase
  // (aplicada via MCP nesta sessão). product fica `any` — ok, o arquivo já usa casts.
  const { data: product } = await (supabase.from('products') as any)
    .select('id, name, quantity, min_stock, unit_price, unit, purchase_order_unit, conversion_rate, group_id, supplier_id, color, is_artisanal, purchase_multiple, product_groups:product_groups!products_group_id_fkey(purchase_multiple)')
    .eq('id', productId)
    .maybeSingle();

  if (!product) return null;
  if (product.is_artisanal) throw new ArtisanalMaterialPurchaseBlockedError(product.name || productName);

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
  // Múltiplo de compra (embalagem): arredonda pra cima (ex.: 187 → 200 c/ 50).
  orderQty = roundUpToPurchaseMultiple(
    orderQty,
    effectivePurchaseMultiple((product as any).purchase_multiple, (product as any).product_groups?.purchase_multiple),
  );

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

  // Priority 2: group_suppliers (most recent supplier for the product's group).
  // ⚠ `group_suppliers` não tem `supplier_id` — antes esse SELECT pedia a coluna
  // inexistente e, sem capturar o erro, o 42703 virava `data: null`: esta
  // prioridade nunca valia e a OC nascia "A definir". Ver groupSupplierResolution.
  if (supplierName === 'A definir' && product.group_id) {
    const gs = await resolveGroupSupplier(product.group_id);
    if (gs?.supplier_name) {
      supplierName = gs.supplier_name;
      supplierId = gs.supplier_id;
    }
  }

  // ── Step 3: Check for existing open PO to accumulate into ────────────────
  let openPO: { id: string; order_number: string; total_value: number; notes: string } | null = null;
  {
    // Acumula por supplier_id (robusto) quando houver — antes casava só por
    // supplier_name (texto): fornecedores homônimos colidiam e o MESMO
    // fornecedor com grafia ligeiramente diferente não acumulava (gerava OC
    // duplicada). Fallback p/ nome quando não há id. Auditoria 2026-06-14, Área 5.
    //
    // Auditoria 2026-09-25: o balde 'A definir' também acumula agora. Antes ele
    // era pulado, então cada disparo criava uma OC nova — mesmo padrão que
    // produziu as 6 OCs de solado do PV-00146.
    let q = (supabase as any)
      .from('purchase_orders')
      .select('id, order_number, total_value, notes')
      .in('status', ['pending', 'approved'])
      .order('created_at', { ascending: false })
      .limit(1);
    q = supplierId ? q.eq('supplier_id', supplierId) : q.eq('supplier_name', supplierName).is('supplier_id', null);
    const { data } = await q.maybeSingle();
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
  // Vincula o PV (orderRef = nº do PV) pra herdar o purchase_by_date via trigger.
  let linkedPvId: string | null = null;
  try {
    const { data: so } = await (supabase.from('sale_orders') as any).select('id').eq('order_number', orderRef).maybeSingle();
    linkedPvId = so?.id ?? null;
  } catch { /* sem PV vinculado — segue sem purchase_by_date */ }
  // Key determinística no padrão 'auto:<sale_order_id>:<product_id>' — protegida
  // por UNIQUE INDEX parcial permanente (migration 20260925132000). Sem PV
  // vinculado não há chave estável, então segue sem key (só o trigger de 30s).
  const idempotencyKey = linkedPvId ? `auto:${linkedPvId}:${productId}` : null;
  const { data: po, error: poErr } = await (supabase as any)
    .from('purchase_orders')
    .insert({
      supplier_name: supplierName,
      supplier_id: supplierId,
      auto_generated: true,
      total_value: orderQty * unitPrice,
      notes: `Gerada automaticamente — Falta de "${productName}" para PV ${orderRef}. Pedir ${orderQty} ${unit}.`,
      ...(linkedPvId
        ? { linked_sale_order_ids: [linkedPvId], source_pv_ids: [linkedPvId], source_type: 'auto_pv', idempotency_key: idempotencyKey }
        : {}),
    })
    .select('id, order_number')
    .single();

  if (poErr || !po) {
    // 23505 = o mesmo (PV, produto) já tem OC ABERTA — disparo duplicado.
    // Filtro alinhado ao índice ux_purchase_orders_idem_auto: OC
    // cancelled/received/receiving não conta como "acumulada".
    if (poErr?.code === '23505' && idempotencyKey) {
      const { data: existing } = await (supabase as any)
        .from('purchase_orders')
        .select('order_number')
        .eq('idempotency_key', idempotencyKey)
        .not('status', 'in', '(cancelled,received,receiving)')
        .maybeSingle();
      if (existing?.order_number) {
        return { poNumber: existing.order_number, supplierName, accumulated: true };
      }
    }
    return null;
  }

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

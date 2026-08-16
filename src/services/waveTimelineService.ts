import { supabase } from '@/integrations/supabase/client';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WaveTimeline {
  earliest_deadline: string;             // YYYY-MM-DD
  corte_palmilha_start_date: string;
  corte_forracao_start_date: string;
  costura_start_date?: string;
  mesa_start_date?: string;
  silk_start_date: string;
  colagem_start_date: string;
  solagem_start_date: string;
  montagem_start_date: string;
  acabamento_start_date: string;
  acabamento_end_date?: string;
  pickup_tuesday_date?: string;
  pickup_friday_date?: string;
  material_ready_date: string;
  purchase_deadline: string;
}

export interface WaveMaterialNeed {
  product_id: string;
  product_name: string;
  unit: string;
  color: string;
  needed_qty: number;
  stock_qty: number;
  shortage: number;
  supplier_id: string | null;
  supplier_name: string | null;
  supplier_lead_time_days: number;
  is_artisanal: boolean;
  artisanal_recipe_id: string | null;
  artisanal_recipe_name: string | null;
  base_product_id: string | null;
  base_product_name: string | null;
  base_needed_qty: number | null;
  base_stock_qty: number | null;
  base_shortage: number | null;
  os_send_date: string | null;    // YYYY-MM-DD
  purchase_deadline: string | null; // derived from wave timeline, not from DB function
}

export interface ArtisanalOsNeed {
  product_name: string;
  color: string;
  needed_meters: number;
  base_product_id: string | null;
  base_product_name: string | null;
  base_needed_qty: number | null;
  base_shortage: number | null;
  os_send_date: string | null;
  artisanal_recipe_id: string | null;
}

function earliestDate(...dates: Array<string | null | undefined>): string | null {
  return dates.filter((date): date is string => Boolean(date)).sort()[0] ?? null;
}

function mergeSaleOrderIds(existingIds: string[] | null | undefined, waveSaleOrderIds: string[]): string[] {
  return Array.from(new Set([...(existingIds ?? []), ...waveSaleOrderIds]));
}

export interface WaveCreateResult {
  waveId: string;
  posCreated: number;
  artisanalOsNeeds: ArtisanalOsNeed[];
}

// ─── Timeline ─────────────────────────────────────────────────────────────────

export async function computeWaveTimeline(saleOrderIds: string[]): Promise<WaveTimeline | null> {
  if (!saleOrderIds.length) return null;
  const { data, error } = await supabase
    .rpc('compute_wave_timeline' as any, { p_sale_order_ids: saleOrderIds });
  if (error) throw error;
  const row = (data as any[])?.[0];
  return row ?? null;
}

// ─── Material needs ───────────────────────────────────────────────────────────

export async function getWaveMaterialNeeds(saleOrderIds: string[]): Promise<WaveMaterialNeed[]> {
  if (!saleOrderIds.length) return [];
  const { data, error } = await supabase
    .rpc('get_wave_material_needs' as any, { p_sale_order_ids: saleOrderIds });
  if (error) throw error;
  return ((data as any[]) || []).map(r => ({
    ...r,
    needed_qty: Number(r.needed_qty ?? 0),
    stock_qty: Number(r.stock_qty ?? 0),
    shortage: Number(r.shortage ?? 0),
    base_needed_qty: r.base_needed_qty != null ? Number(r.base_needed_qty) : null,
    base_stock_qty: r.base_stock_qty != null ? Number(r.base_stock_qty) : null,
    base_shortage: r.base_shortage != null ? Number(r.base_shortage) : null,
  })) as WaveMaterialNeed[];
}

// ─── Create wave + auto-generate POs for shortages ───────────────────────────

export async function createWaveWithMaterialOrders(params: {
  weekStart: string;
  saleOrderIds: string[];
  waveId: string;
  generatePOs: boolean;
}): Promise<WaveCreateResult> {
  const { waveId, saleOrderIds, generatePOs } = params;

  // Persist timeline dates
  const { error: timelineErr } = await supabase.rpc('update_wave_timeline' as any, { p_wave_id: waveId });
  if (timelineErr) throw timelineErr;

  const artisanalOsNeeds: ArtisanalOsNeed[] = [];
  let posCreated = 0;

  // ALWAYS collect material needs to populate artisanal OS info (regardless of generatePOs)
  const needs = await getWaveMaterialNeeds(saleOrderIds);
  const shortages = needs.filter(n => n.shortage > 0 && !n.is_artisanal);
  const artisanalMaterials = needs.filter(n => n.is_artisanal);

  for (const an of artisanalMaterials) {
    artisanalOsNeeds.push({
      product_name: an.product_name,
      color: an.color,
      needed_meters: an.needed_qty,
      base_product_id: an.base_product_id,
      base_product_name: an.base_product_name,
      base_needed_qty: an.base_needed_qty,
      base_shortage: an.base_shortage,
      os_send_date: an.os_send_date,
      artisanal_recipe_id: an.artisanal_recipe_id,
    });

    // A falta da napa-base NÃO entra na OC geral da onda. Netting, contribuição
    // por PV e eventual compra pertencem exclusivamente ao motor canônico de tiras.
  }

  if (!generatePOs || shortages.length === 0) {
    return { waveId, posCreated, artisanalOsNeeds };
  }

  // A OC precisa nascer com a mesma data-limite que foi calculada para a onda.
  // Quando a necessidade ainda não a trouxe no payload, o motor canônico a
  // recalcula pelos PVs antes de permitir criar uma OC sem prazo.
  const wavePurchaseDeadline = earliestDate(...needs.map((need) => need.purchase_deadline))
    ?? (await computeWaveTimeline(saleOrderIds))?.purchase_deadline
    ?? null;
  if (!wavePurchaseDeadline) {
    throw new Error('Não foi possível calcular o prazo de compra da onda. Revise os prazos dos PVs antes de gerar a OC.');
  }
  const waveSaleOrderIds = Array.from(new Set(saleOrderIds));

  // Group shortages by supplier (null supplier → one PO)
  const bySupplier = new Map<string, { supplier_id: string | null; supplier_name: string; items: WaveMaterialNeed[] }>();
  for (const s of shortages) {
    const key = s.supplier_id ?? '__sem_fornecedor';
    if (!bySupplier.has(key)) {
      bySupplier.set(key, {
        supplier_id: s.supplier_id,
        supplier_name: s.supplier_name ?? 'Sem Fornecedor',
        items: [],
      });
    }
    bySupplier.get(key)!.items.push(s);
  }

  // Fetch existing auto-generated pending POs keyed by supplier_id
  const { data: existingPOs, error: existingPOsErr } = await supabase
    .from('purchase_orders')
    .select('id, supplier_id, total_value, linked_sale_order_ids, source_pv_ids, purchase_by_date')
    .eq('status', 'pending')
    .eq('auto_generated', true);
  if (existingPOsErr) throw existingPOsErr;

  const pendingPOMap = new Map<string, any>(); // supplier_id → PO
  for (const po of (existingPOs || []) as any[]) {
    if (po.supplier_id) pendingPOMap.set(po.supplier_id, po);
  }

  const today = new Date().toISOString().slice(0, 10);
  const waveRef = `Onda de produção criada em ${today}`;

  for (const [supplierKey, group] of bySupplier) {
    const poItems = group.items.map(s => ({
      product_id: s.product_id,
      quantity: Math.ceil(s.shortage),
      suggested_quantity: Math.ceil(s.shortage),
      unit_price: 0,
      unit: s.unit,
      current_stock: s.stock_qty,
      min_stock: 0,
      max_stock: 0,
    }));

    if (!poItems.length) continue;

    const groupPurchaseDeadline = earliestDate(
      ...group.items.map((item) => item.purchase_deadline),
      wavePurchaseDeadline,
    );
    const existingPo = group.supplier_id ? pendingPOMap.get(group.supplier_id) : null;

    if (existingPo) {
      // Pass item.quantity as p_qty_delta (additive). A stale pre-read delta would
      // race against concurrent wave creations for the same supplier: the pre-lock
      // read is not inside the RPC's FOR UPDATE, so two concurrent callers would
      // each compute delta = target − stale_qty and over/under-order. Passing the
      // wave's absolute requirement as the delta is safe for the common case (new
      // item in PO) and slightly over-orders on retry; operators can adjust in OC.
      for (const item of poItems) {
        const { error: rpcErr } = await supabase.rpc('upsert_po_item_atomic' as any, {
          p_po_id:         existingPo.id,
          p_product_id:    item.product_id,
          p_qty_delta:     item.quantity,
          p_unit_price:    item.unit_price,
          p_unit:          item.unit,
          p_current_stock: item.current_stock,
          p_min_stock:     item.min_stock,
          p_max_stock:     item.max_stock,
        });
        if (rpcErr) throw rpcErr;
      }

      // Keep notes in sync (total_value updated by RPC above)
      const { error: updPoErr } = await supabase.from('purchase_orders')
        .update({
          notes: waveRef,
          linked_sale_order_ids: mergeSaleOrderIds(existingPo.linked_sale_order_ids, waveSaleOrderIds),
          source_pv_ids: mergeSaleOrderIds(existingPo.source_pv_ids, waveSaleOrderIds),
          purchase_by_date: earliestDate(existingPo.purchase_by_date, groupPurchaseDeadline),
        })
        .eq('id', existingPo.id);
      if (updPoErr) throw updPoErr;
    } else {
      // order_number is generated by the DB trigger (oc_number_seq) — omit from insert.
      // total_value starts at 0; upsert_po_item_atomic accumulates it atomically per item.
      const { data: newPO, error: poErr } = await supabase
        .from('purchase_orders')
        .insert({
          supplier_id: group.supplier_id || null,
          supplier_name: group.supplier_name,
          status: 'pending',
          total_value: 0,
          notes: waveRef,
          auto_generated: true,
          linked_sale_order_ids: waveSaleOrderIds,
          source_pv_ids: waveSaleOrderIds,
          purchase_by_date: groupPurchaseDeadline,
        })
        .select('id').single();

      if (poErr) throw poErr;
      if (!newPO) throw new Error(`Não foi possível criar a OC para ${group.supplier_name}.`);

      // Use upsert_po_item_atomic for each item so total_value is correctly
      // accumulated and concurrent wave creations for the same supplier don't race.
      // Wrap with compensating DELETE so a mid-loop failure doesn't leave an
      // orphan PO with partial items and a stale total_value.
      try {
        for (const item of poItems) {
          const { error: rpcErr } = await supabase.rpc('upsert_po_item_atomic' as any, {
            p_po_id:         (newPO as any).id,
            p_product_id:    item.product_id,
            p_qty_delta:     item.quantity,
            p_unit_price:    item.unit_price,
            p_unit:          item.unit,
            p_current_stock: item.current_stock,
            p_min_stock:     item.min_stock,
            p_max_stock:     item.max_stock,
          });
          if (rpcErr) throw rpcErr;
        }
        posCreated++;
      } catch (itemErr) {
        await supabase.from('purchase_orders').delete().eq('id', (newPO as any).id);
        throw itemErr;
      }
    }
  }

  return { waveId, posCreated, artisanalOsNeeds };
}

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
  base_product_name: string | null;
  base_needed_qty: number | null;
  base_shortage: number | null;
  os_send_date: string | null;
  artisanal_recipe_id: string | null;
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
      base_product_name: an.base_product_name,
      base_needed_qty: an.base_needed_qty,
      base_shortage: an.base_shortage,
      os_send_date: an.os_send_date,
      artisanal_recipe_id: an.artisanal_recipe_id,
    });

    // If base material is also in shortage → add to PO list regardless of generatePOs flag
    if ((an.base_shortage ?? 0) > 0 && an.base_product_id) {
      shortages.push({
        product_id: an.base_product_id,
        product_name: an.base_product_name ?? '',
        unit: 'm',
        color: an.color,
        needed_qty: an.base_needed_qty ?? 0,
        stock_qty: an.base_stock_qty ?? 0,
        shortage: an.base_shortage ?? 0,
        supplier_id: null,
        supplier_name: null,
        supplier_lead_time_days: 10,
        is_artisanal: false,
        artisanal_recipe_id: null,
        artisanal_recipe_name: null,
        base_product_id: null,
        base_product_name: null,
        base_needed_qty: null,
        base_stock_qty: null,
        base_shortage: null,
        os_send_date: null,
        purchase_deadline: null,
      });
    }
  }

  if (!generatePOs || shortages.length === 0) {
    return { waveId, posCreated, artisanalOsNeeds };
  }

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
  const { data: existingPOs } = await supabase
    .from('purchase_orders')
    .select('id, supplier_id, total_value')
    .eq('status', 'pending')
    .eq('auto_generated', true);

  const pendingPOMap = new Map<string, string>(); // supplier_id → PO id
  for (const po of (existingPOs || []) as any[]) {
    if (po.supplier_id) pendingPOMap.set(po.supplier_id, po.id);
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

    const existingPoId = group.supplier_id ? pendingPOMap.get(group.supplier_id) : null;

    if (existingPoId) {
      // Pass item.quantity as p_qty_delta (additive). A stale pre-read delta would
      // race against concurrent wave creations for the same supplier: the pre-lock
      // read is not inside the RPC's FOR UPDATE, so two concurrent callers would
      // each compute delta = target − stale_qty and over/under-order. Passing the
      // wave's absolute requirement as the delta is safe for the common case (new
      // item in PO) and slightly over-orders on retry; operators can adjust in OC.
      for (const item of poItems) {
        const { error: rpcErr } = await supabase.rpc('upsert_po_item_atomic' as any, {
          p_po_id:         existingPoId,
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
        .update({ notes: waveRef }).eq('id', existingPoId);
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
        })
        .select('id').single();

      if (poErr || !newPO) continue;

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

// ─── Auto-create artisanal service orders when wave is created ────────────────
// Always assigns to contractor "nego" (matched by ILIKE).
// Creates one OS per artisanal material need with all artisanal fields populated.
export async function autoCreateArtisanalServiceOrders(
  artisanalNeeds: ArtisanalOsNeed[],
): Promise<number> {
  if (!artisanalNeeds.length) return 0;

  // Find contractor "nego"
  const { data: contractors } = await (supabase as any)
    .from('contractors')
    .select('id, name')
    .ilike('name', '%nego%')
    .eq('active', true)
    .limit(1);

  const negoId: string | null = (contractors as any[])?.[0]?.id ?? null;
  if (!negoId) {
    // Wave is already committed; missing contractor means artisanal production
    // will never be scheduled. Throw so the caller can surface this to the operator.
    throw new Error('Terceiro "nego" não encontrado ou inativo — cadastre o terceiro antes de criar ondas com necessidades artesanais.');
  }

  let created = 0;
  const insertedOsIds: string[] = [];
  try {
    for (const need of artisanalNeeds) {
      if (!need.artisanal_recipe_id) continue;

      const osDate = need.os_send_date ?? new Date().toISOString().slice(0, 10);
      const colorSuffix = need.color ? ` (${need.color})` : '';
      const description = `OS artesanal automática — ${need.product_name}${colorSuffix}`;

      const materialsSent = (need.base_product_name && (need.base_needed_qty ?? 0) > 0)
        ? [{ material: need.base_product_name, color: need.color || '', meters: need.base_needed_qty, completed: false }]
        : null;

      const { data: osRow, error } = await (supabase as any)
        .from('service_orders')
        .insert({
          contractor_id: negoId,
          description,
          service_date: osDate,
          quantity: 1,
          unit_price: 0,
          total_value: 0,
          status: 'Pendente',
          artisanal_recipe_id: need.artisanal_recipe_id,
          artisanal_output_name: need.product_name,
          artisanal_output_color: need.color || '',
          artisanal_output_meters: need.needed_meters,
          artisanal_for_order_meters: need.needed_meters,
          artisanal_for_stock_meters: 0,
          artisanal_base_color: need.color || '',
          artisanal_stock_entry_done: false,
          ...(materialsSent ? { materials_sent: materialsSent } : {}),
        })
        .select('id')
        .single();

      if (error) {
        console.error(`autoCreateArtisanalServiceOrders: falha ao criar OS para ${need.product_name}:`, error.message);
        throw new Error(`Falha ao criar OS artesanal para "${need.product_name}": ${error.message}`);
      }
      if (osRow?.id) insertedOsIds.push(osRow.id);
      created++;
    }
  } catch (err: any) {
    // Compensating delete: remove OSs already created in this batch so the wave
    // doesn't end up with partial artisanal coverage and no signal to the operator.
    // CRITICAL: surface delete failures so the operator knows OSs are stranded.
    // Silently ignoring the delete error left orphan Pending OSs invisible to
    // the wave-creation flow.
    if (insertedOsIds.length > 0) {
      const { error: delErr } = await (supabase as any)
        .from('service_orders')
        .delete()
        .in('id', insertedOsIds);
      if (delErr) {
        const cause = err?.message ?? String(err);
        throw new Error(
          `${cause}. ATENÇÃO: ${insertedOsIds.length} OS(s) artesanal(is) já criada(s) ` +
          `não puderam ser removidas (${delErr.message}). Remover manualmente: ${insertedOsIds.join(', ')}.`
        );
      }
    }
    throw err;
  }

  return created;
}

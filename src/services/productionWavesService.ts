import { supabase } from '@/integrations/supabase/client';
import type {
  ProductionWave, WaveDetail, SectorBoardRow, FinishingPackage,
  ProductionStage, WavePickupSummary,
} from '@/types/production-waves';

export async function listWaves(): Promise<ProductionWave[]> {
  const { data, error } = await supabase
    .from('production_waves' as any)
    .select('*')
    .order('week_start', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as ProductionWave[];
}

export async function getWaveDetail(waveId: string): Promise<WaveDetail | null> {
  const { data, error } = await supabase
    .from('v_wave_detail' as any)
    .select('*')
    .eq('wave_id', waveId)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as WaveDetail) ?? null;
}

export async function getSectorBoard(): Promise<SectorBoardRow[]> {
  const { data, error } = await supabase
    .from('v_sector_board' as any)
    .select('*')
    .order('ord');
  if (error) throw error;
  return (data ?? []) as unknown as SectorBoardRow[];
}

export async function createWave(params: {
  weekStart: string;         // YYYY-MM-DD (segunda-feira)
  saleOrderIds: string[];
}): Promise<string> {
  // Validação 1: bloqueia PVs já em ondas ativas.
  const conflicts = await findActiveWaveConflicts(params.saleOrderIds);
  if (conflicts.length > 0) {
    const codes = conflicts.map((c) => c.order_number ?? c.sale_order_id).join(', ');
    throw new Error(
      `Os seguintes pedidos já estão em uma onda de produção ativa e não podem ser atribuídos novamente: ${codes}`,
    );
  }

  // Validação 2: bloqueia PVs com status Rascunho (espelha trigger do banco).
  const draftOrders = await findDraftSaleOrders(params.saleOrderIds);
  if (draftOrders.length > 0) {
    const codes = draftOrders.map((d) => d.order_number ?? d.id).join(', ');
    throw new Error(
      `Os seguintes pedidos estão em Rascunho e não podem entrar em produção. Aprove-os primeiro: ${codes}`,
    );
  }

  const { data, error } = await supabase.rpc('create_production_wave' as any, {
    p_week_start: params.weekStart,
    p_sale_order_ids: params.saleOrderIds,
  });
  if (error) throw translateWaveError(error);
  return data as string;
}

/**
 * Verifica quais sale_order_ids têm status 'Rascunho'.
 * Usado como barreira client-side antes de tentar criar a onda.
 */
async function findDraftSaleOrders(
  saleOrderIds: string[],
): Promise<Array<{ id: string; order_number: string | null }>> {
  if (!saleOrderIds.length) return [];
  const { data, error } = await supabase
    .from('sale_orders')
    .select('id, order_number')
    .in('id', saleOrderIds)
    .eq('status', 'Rascunho');
  if (error) throw error;
  return (data ?? []).map((r: any) => ({ id: r.id, order_number: r.order_number ?? null }));
}

/**
 * Detecta PVs que estão simultaneamente em uma onda ativa E com status 'Rascunho'.
 * Esta é uma inconsistência que pode ocorrer se o status de um PV foi regredido
 * após a criação da onda. Usado para exibir alertas no painel de ondas.
 */
export async function findDraftInWaveInconsistencies(): Promise<
  Array<{ sale_order_id: string; order_number: string | null; wave_code: string }>
> {
  const { data, error } = await supabase
    .from('production_wave_item_sources' as any)
    .select(
      'sale_order_id, sale_orders!inner(id, order_number, status), production_wave_items!inner(wave_id, production_waves!inner(id, code, status))',
    )
    .eq('sale_orders.status', 'Rascunho')
    .in('production_wave_items.production_waves.status', ['planning', 'running']);

  if (error) throw error;

  const seen = new Set<string>();
  const result: Array<{ sale_order_id: string; order_number: string | null; wave_code: string }> = [];
  for (const row of (data ?? []) as any[]) {
    if (!row?.sale_order_id || seen.has(row.sale_order_id)) continue;
    seen.add(row.sale_order_id);
    result.push({
      sale_order_id: row.sale_order_id,
      order_number: row.sale_orders?.order_number ?? null,
      wave_code: row.production_wave_items?.production_waves?.code ?? '—',
    });
  }
  return result;
}

/**
 * Verifica quais sale_order_ids já estão atribuídos a uma onda ativa
 * (status diferente de 'finished' / 'cancelled'). Retorna a lista de conflitos
 * com o código do pedido para mensagens amigáveis.
 */
export async function findActiveWaveConflicts(
  saleOrderIds: string[],
): Promise<Array<{ sale_order_id: string; order_number: string | null; wave_id: string }>> {
  if (!saleOrderIds.length) return [];

  const { data, error } = await supabase
    .from('production_wave_item_sources' as any)
    .select(
      'sale_order_id, production_wave_items!inner(wave_id, production_waves!inner(id, status)), sale_orders(order_number)',
    )
    .in('sale_order_id', saleOrderIds)
    .in('production_wave_items.production_waves.status', ['planning', 'running']);

  if (error) throw error;

  const seen = new Set<string>();
  const conflicts: Array<{ sale_order_id: string; order_number: string | null; wave_id: string }> = [];
  for (const row of (data ?? []) as any[]) {
    if (!row?.sale_order_id || seen.has(row.sale_order_id)) continue;
    seen.add(row.sale_order_id);
    conflicts.push({
      sale_order_id: row.sale_order_id,
      order_number: row.sale_orders?.order_number ?? null,
      wave_id: row.production_wave_items?.wave_id ?? '',
    });
  }
  return conflicts;
}

/**
 * Traduz a mensagem crua do trigger trg_check_sale_order_single_active_wave
 * (em inglês) para uma mensagem amigável em português exibida ao usuário.
 */
function translateWaveError(error: { message?: string } | null | undefined): Error {
  const raw = error?.message ?? '';

  // Formato novo (PT-BR, vindo direto do trigger atualizado).
  if (/já está atribuído a uma onda de produção ativa/i.test(raw)) {
    return new Error(raw);
  }

  // Formato legado (inglês) — caso uma instância antiga do trigger ainda esteja ativa.
  const legacy = raw.match(
    /sale_order ([0-9a-zA-Z-]+) is already assigned to an active production wave/i,
  );
  if (legacy) {
    return new Error(
      `O pedido ${legacy[1]} já está atribuído a uma onda de produção ativa. ` +
      `Finalize ou cancele a onda atual antes de incluí-lo em outra.`,
    );
  }

  return new Error(raw || 'Erro desconhecido ao criar onda de produção.');
}

export async function startWave(waveId: string): Promise<void> {
  const { error } = await supabase.rpc('start_wave' as any, { p_wave_id: waveId });
  if (error) throw translateWaveError(error);
}

export async function autoStartDueWaves(): Promise<number> {
  const { data, error } = await supabase.rpc('auto_start_due_waves' as any);
  if (error) throw error;
  return (data as number) ?? 0;
}

export async function advanceWaveStage(waveId: string, stage: ProductionStage): Promise<ProductionStage | null> {
  const { data, error } = await supabase.rpc('advance_wave_stage' as any, { p_wave_id: waveId, p_stage: stage });
  if (error) throw error;
  return (data as ProductionStage) ?? null;
}

export async function getFinishingPackages(waveId: string): Promise<FinishingPackage[]> {
  const { data, error } = await supabase
    .from('production_finishing_packages' as any)
    .select('*')
    .eq('wave_id', waveId)
    .order('store_name');
  if (error) throw error;
  return (data ?? []) as unknown as FinishingPackage[];
}

export async function updateMesaCapacity(waveId: string, capacityPerDay: number): Promise<void> {
  if (!Number.isFinite(capacityPerDay) || capacityPerDay <= 0) {
    throw new Error('Capacidade deve ser um número positivo.');
  }
  // Only allow capacity edits on active waves — finished/cancelled waves are historical.
  const { data: wave, error: waveErr } = await supabase
    .from('production_waves' as any)
    .select('status')
    .eq('id', waveId)
    .single();
  if (waveErr) throw new Error(`Falha ao carregar onda de produção: ${waveErr.message}`);
  if (wave && !['planning', 'running'].includes((wave as any).status)) {
    throw new Error('Capacidade não pode ser alterada em ondas finalizadas ou canceladas.');
  }
  const { error } = await supabase
    .from('production_wave_stages' as any)
    .update({ capacity_per_day: capacityPerDay })
    .eq('wave_id', waveId)
    .eq('stage', 'mesa');
  if (error) throw error;
}

export async function updatePackageStatus(
  packageId: string,
  status: 'pending' | 'packed' | 'shipped',
): Promise<void> {
  const PREDECESSOR: Record<string, string> = { packed: 'pending', shipped: 'packed' };
  const patch: Record<string, unknown> = { status };
  if (status === 'packed') patch.packed_at = new Date().toISOString();
  if (status === 'shipped') patch.shipped_at = new Date().toISOString();
  let q = supabase.from('production_finishing_packages' as any).update(patch).eq('id', packageId);
  if (PREDECESSOR[status]) q = (q as any).eq('status', PREDECESSOR[status]);
  const { data: rows, error } = await (q as any).select('id');
  if (error) throw error;
  if (!rows || rows.length === 0) throw new Error('Status do pacote já alterado por outro usuário — recarregue.');
}

export async function listPendingSaleOrdersForWeek(weekStart: string): Promise<
  Array<{
    id: string; code: string | null; client_name: string | null; cnpj: string | null;
    total_pairs: number; delivery_deadline: string | null; op_numbers: string[];
  }>
> {
  const weekEnd = new Date(new Date(weekStart).getTime() + 6 * 86400000)
    .toISOString().slice(0, 10);

  const { data: assignedData } = await supabase
    .from('production_wave_item_sources' as any)
    .select('sale_order_id, production_wave_items!inner(wave_id, production_waves!inner(id, status))')
    .in('production_wave_items.production_waves.status', ['planning', 'running']);

  const assignedIds = new Set<string>(
    (assignedData ?? []).map((r: any) => r.sale_order_id).filter(Boolean)
  );

  const { data, error } = await supabase
    .from('sale_orders')
    .select('id, order_number, client_cnpj, delivery_deadline, clients(razao_social), sale_order_items(quantity), orders!sale_order_id(order_number)')
    .in('status', ['Aprovado', 'Em Produção'])
    .lte('delivery_deadline', weekEnd);

  if (error) throw error;
  return (data ?? [])
    .filter((so: any) => !assignedIds.has(so.id))
    .map((so: any) => ({
      id: so.id,
      code: so.order_number ?? null,
      client_name: so.clients?.razao_social ?? null,
      cnpj: so.client_cnpj ?? null,
      delivery_deadline: so.delivery_deadline ?? null,
      total_pairs: (so.sale_order_items ?? []).reduce(
        (s: number, i: any) => s + Number(i.quantity || 0), 0),
      op_numbers: (so.orders ?? []).map((op: any) => op.order_number).filter(Boolean),
    }));
}

export type WaveSaleOrder = {
  sale_order_id: string;
  order_number: string | null;
  client_name: string | null;
  total_pairs: number;
  delivery_deadline: string | null;
  status: string | null;
};

export async function syncWaveFromKanban(waveId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('sync_wave_from_kanban' as any, { p_wave_id: waveId });
  if (error) throw error;
  return (data as string) ?? null;
}

export async function cancelWave(waveId: string, reason?: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_wave' as any, {
    p_wave_id: waveId,
    p_reason: reason ?? null,
  });
  if (error) throw error;
}

export async function getWavePickupSummary(waveId: string): Promise<WavePickupSummary[]> {
  const { data, error } = await supabase.rpc('get_wave_pickup_summary' as any, {
    p_wave_id: waveId,
  });
  if (error) throw error;
  return ((data as any[]) ?? []).map((r) => ({
    pickup_window: r.pickup_window,
    pickup_date: r.pickup_date ?? null,
    total_items: Number(r.total_items ?? 0),
    total_pairs: Number(r.total_pairs ?? 0),
    block_count: Number(r.block_count ?? 0),
    sale_order_count: Number(r.sale_order_count ?? 0),
  })) as WavePickupSummary[];
}

export async function getWaveSaleOrders(waveId: string): Promise<WaveSaleOrder[]> {
  const { data: waveItems, error: wiError } = await supabase
    .from('production_wave_items' as any)
    .select('id')
    .eq('wave_id', waveId);
  if (wiError) throw wiError;
  const waveItemIds = (waveItems ?? []).map((wi: any) => wi.id);
  if (!waveItemIds.length) return [];

  const { data: sources, error: srcError } = await supabase
    .from('production_wave_item_sources' as any)
    .select('sale_order_id, quantity')
    .in('wave_item_id', waveItemIds)
    .not('sale_order_id', 'is', null);
  if (srcError) throw srcError;

  const qtyMap = new Map<string, number>();
  for (const src of (sources ?? []) as any[]) {
    if (!src.sale_order_id) continue;
    qtyMap.set(src.sale_order_id, (qtyMap.get(src.sale_order_id) ?? 0) + Number(src.quantity || 0));
  }
  if (!qtyMap.size) return [];

  const { data: orders, error: soError } = await supabase
    .from('sale_orders')
    .select('id, order_number, client_name, delivery_deadline, status')
    .in('id', Array.from(qtyMap.keys()));
  if (soError) throw soError;

  return ((orders ?? []) as any[]).map((so: any) => ({
    sale_order_id: so.id,
    order_number: so.order_number ?? null,
    client_name: so.client_name ?? null,
    total_pairs: qtyMap.get(so.id) ?? 0,
    delivery_deadline: so.delivery_deadline ?? null,
    status: so.status ?? null,
  }));
}

export const listWaveOrders = getWaveSaleOrders;

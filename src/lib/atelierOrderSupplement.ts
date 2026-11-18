/**
 * A fila pinta o que `list_atelier_lots` agrega por lote.
 * Se esse JSON não trouxer o job do PV da URL, a leitura direta
 * em cabedal_prep_jobs (pelo sale_order_id) entra no mesmo lote.
 * Não grava. Não corta, não envia, não recebe.
 */

export interface AtelierOrderJobHit {
  id: string;
  sector: string;
  pipeline_status: string;
  pairs: number;
  color?: string | null;
  reference_code?: string | null;
  execution_mode?: string | null;
  contractor_id?: string | null;
  sale_order_id: string;
  sale_order_item_id?: string | null;
  lot_id?: string | null;
  target_end?: string | null;
  atelier_service_number?: string | null;
  received_pairs?: number | null;
  service_order_id?: string | null;
  order_number: string;
}

interface LotLike {
  id: string;
  jobs: {
    id: string;
    order_number?: string | null;
    sale_order_id?: string | null;
  }[];
  orders: {
    order_number?: string | null;
    sale_order_id?: string | null;
    pairs?: number;
    client_name?: string | null;
    billing_week?: string | null;
    delivery_deadline?: string | null;
  }[];
  color?: string | null;
  reference_code?: string | null;
}

function jobFromHit(hit: AtelierOrderJobHit) {
  return {
    id: hit.id,
    sector: hit.sector,
    pipeline_status: hit.pipeline_status,
    pairs: Number(hit.pairs) || 0,
    sale_order_item_id: hit.sale_order_item_id ?? null,
    sale_order_id: hit.sale_order_id,
    order_number: hit.order_number,
    contractor_id: hit.contractor_id ?? null,
    contractor_name: null,
    atelier_service_number: hit.atelier_service_number ?? null,
    target_end: hit.target_end ?? null,
    execution_mode: hit.execution_mode ?? null,
    received_pairs: hit.received_pairs ?? null,
    service_order_id: hit.service_order_id ?? null,
  };
}

export function supplementAtelierLotsWithOrderJobs<T extends LotLike>(
  lots: readonly T[],
  hits: readonly AtelierOrderJobHit[],
): T[] {
  if (hits.length === 0) return lots as T[];
  const next = lots.map((lot) => ({
    ...lot,
    jobs: (lot.jobs ?? []).map((job) => ({ ...job })),
    orders: (lot.orders ?? []).map((order) => ({ ...order })),
  })) as T[];
  const byLot = new Map(next.map((lot) => [lot.id, lot]));

  for (const hit of hits) {
    if (!hit.id || hit.pipeline_status === 'cancelled') continue;
    const number = (hit.order_number ?? '').trim();
    const lotId = hit.lot_id || `pv-${hit.sale_order_id}`;
    let lot = byLot.get(lotId);
    if (!lot) {
      lot = {
        id: lotId,
        lot_number: '',
        status: 'open',
        reference_id: '',
        reference_code: hit.reference_code ?? null,
        reference_name: null,
        color: hit.color ?? null,
        cut_at: null,
        pairs: Number(hit.pairs) || 0,
        min_ready_date: null,
        min_delivery_deadline: null,
        grade: {},
        orders: [] as LotLike['orders'],
        jobs: [] as LotLike['jobs'],
        debits: [] as unknown[],
      } as unknown as T;
      next.push(lot);
      byLot.set(lotId, lot);
    }
    const existing = lot.jobs.find((job) => job.id === hit.id);
    if (existing) {
      if (number) existing.order_number = number;
      if (hit.sale_order_id) existing.sale_order_id = hit.sale_order_id;
    } else {
      lot.jobs.push(jobFromHit({ ...hit, order_number: number || hit.order_number }));
    }
    const known = lot.orders.some((order) =>
      order.sale_order_id === hit.sale_order_id
      || (number && (order.order_number ?? '').trim() === number));
    if (!known && number) {
      lot.orders.push({
        sale_order_id: hit.sale_order_id,
        order_number: number,
        client_name: null,
        billing_week: null,
        delivery_deadline: null,
        pairs: Number(hit.pairs) || 0,
      });
    }
  }
  return next;
}

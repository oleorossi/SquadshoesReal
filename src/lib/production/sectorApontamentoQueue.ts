/**
 * Fila canônica de OPs por setor no Apontamento
 * (spec `montagem-solagem-produtividade` Fase A — casca comum M=S).
 *
 * Montagem e Solagem usam a MESMA regra de elegibilidade + ordenação por prazo
 * do PV. Filtros extras da Solagem (período, linha) ficam no caller.
 */
import { sameStage } from '@/lib/production/stageFlow';
import { searchMatchesAllTerms } from '@/lib/searchUtils';

export interface SectorQueueOrder {
  id: string;
  status?: string | null;
  sale_order_id?: string | null;
  order_number?: string | null;
  reference_id?: string | null;
  planned_delivery?: string | null;
  quantity?: number | null;
  color?: string | null;
  grade?: unknown;
}

export interface SectorQueueSaleOrder {
  id: string;
  status?: string | null;
  order_number?: string | null;
  client_order_number?: string | null;
  client_name?: string | null;
  delivery_deadline?: string | null;
}

export interface SectorQueueStage {
  order_id: string;
  stage_name: string;
  status: string;
}

export interface SectorQueueReference {
  id: string;
  name?: string | null;
  code?: string | null;
}

export interface FilterSectorQueueInput {
  orders: SectorQueueOrder[];
  stages: SectorQueueStage[];
  saleOrders: SectorQueueSaleOrder[];
  references?: SectorQueueReference[];
  stageName: string;
  filterStatus: string;
  searchQuery: string;
}

/** OP terminal ou PV faturado/cancelado não entram na fila do setor. */
export function isOrderEligibleForSectorQueue(
  order: SectorQueueOrder,
  saleOrders: SectorQueueSaleOrder[],
): boolean {
  const status = (order.status || '').toLowerCase().normalize('NFC');
  if (status === 'finalizado' || status === 'cancelada') return false;
  if (order.sale_order_id) {
    const so = saleOrders.find((s) => s.id === order.sale_order_id);
    if (so && (so.status === 'Faturado' || so.status === 'Finalizado s/ NF' || so.status === 'Cancelado')) {
      return false;
    }
  }
  return true;
}

export function filterSectorQueueOrders(input: FilterSectorQueueInput): SectorQueueOrder[] {
  const {
    orders,
    stages,
    saleOrders,
    references = [],
    stageName,
    filterStatus,
    searchQuery,
  } = input;

  const filtered = orders.filter((order) => {
    if (!isOrderEligibleForSectorQueue(order, saleOrders)) return false;

    const status = (order.status || '').toLowerCase().normalize('NFC');
    if (filterStatus === 'active' && status !== 'em produção') return false;

    const stage = stages.find(
      (s) => s.order_id === order.id && sameStage(s.stage_name, stageName),
    );
    if (!stage) return filterStatus === 'all';
    if (filterStatus === 'active' && stage.status !== 'pendente' && stage.status !== 'em_andamento') {
      return false;
    }

    if (searchQuery.trim()) {
      const so = saleOrders.find((s) => s.id === order.sale_order_id);
      const ref = references.find((r) => r.id === order.reference_id);
      if (!searchMatchesAllTerms(
        searchQuery,
        so?.order_number,
        so?.client_order_number,
        order.order_number,
        so?.client_name,
        ref?.name,
        ref?.code,
      )) return false;
    }

    return true;
  });

  return filtered.sort((a, b) => {
    const dl = (o: SectorQueueOrder) =>
      saleOrders.find((s) => s.id === o.sale_order_id)?.delivery_deadline || '';
    const da = dl(a);
    const db = dl(b);
    if (da !== db) {
      if (!da) return 1;
      if (!db) return -1;
      return da.localeCompare(db);
    }
    const sa = String(a.sale_order_id || '');
    const sb = String(b.sale_order_id || '');
    if (sa !== sb) return sa.localeCompare(sb);
    const pa = a.planned_delivery || '';
    const pb = b.planned_delivery || '';
    if (!pa && !pb) return 0;
    if (!pa) return 1;
    if (!pb) return -1;
    return pa.localeCompare(pb);
  });
}

export function toggleIdInSet(prev: Set<string>, id: string): Set<string> {
  const next = new Set(prev);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export function toggleSelectAllIds(prev: Set<string>, ids: string[]): Set<string> {
  if (prev.size === ids.length && ids.length > 0) return new Set();
  return new Set(ids);
}

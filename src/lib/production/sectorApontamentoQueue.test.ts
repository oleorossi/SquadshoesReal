import { describe, expect, it } from 'vitest';
import {
  filterSectorQueueOrders,
  isOrderEligibleForSectorQueue,
  toggleIdInSet,
  toggleSelectAllIds,
} from './sectorApontamentoQueue';

const stages = [
  { order_id: 'a', stage_name: 'Montagem', status: 'pendente' },
  { order_id: 'b', stage_name: 'Montagem', status: 'em_andamento' },
  { order_id: 'c', stage_name: 'Montagem', status: 'concluido' },
];

const saleOrders = [
  { id: 'pv1', status: 'Em Produção', client_name: 'Alcineu', delivery_deadline: '2026-09-20', order_number: 'PV-1' },
  { id: 'pv2', status: 'Faturado', client_name: 'Outro', delivery_deadline: '2026-09-10', order_number: 'PV-2' },
];

const orders = [
  { id: 'a', status: 'Em Produção', sale_order_id: 'pv1', order_number: 'OP-A', planned_delivery: '2026-09-18' },
  { id: 'b', status: 'Em Produção', sale_order_id: 'pv1', order_number: 'OP-B', planned_delivery: '2026-09-19' },
  { id: 'c', status: 'Em Produção', sale_order_id: 'pv1', order_number: 'OP-C' },
  { id: 'd', status: 'Finalizado', sale_order_id: 'pv1', order_number: 'OP-D' },
  { id: 'e', status: 'Em Produção', sale_order_id: 'pv2', order_number: 'OP-E' },
];

describe('sectorApontamentoQueue', () => {
  it('exclui OP finalizada e PV faturado', () => {
    expect(isOrderEligibleForSectorQueue(orders[3], saleOrders)).toBe(false);
    expect(isOrderEligibleForSectorQueue(orders[4], saleOrders)).toBe(false);
    expect(isOrderEligibleForSectorQueue(orders[0], saleOrders)).toBe(true);
  });

  it('em active só pendente/em_andamento do setor, ordenado por prazo do PV', () => {
    const result = filterSectorQueueOrders({
      orders,
      stages,
      saleOrders,
      stageName: 'Montagem',
      filterStatus: 'active',
      searchQuery: '',
    });
    expect(result.map((o) => o.id)).toEqual(['a', 'b']);
  });

  it('busca refina por cliente (AND com /)', () => {
    const result = filterSectorQueueOrders({
      orders,
      stages,
      saleOrders,
      stageName: 'Montagem',
      filterStatus: 'active',
      searchQuery: 'alcineu',
    });
    expect(result.map((o) => o.id)).toEqual(['a', 'b']);
  });

  it('toggle de seleção é simétrico', () => {
    const one = toggleIdInSet(new Set(), 'a');
    expect([...one]).toEqual(['a']);
    expect([...toggleIdInSet(one, 'a')]).toEqual([]);
    expect([...toggleSelectAllIds(new Set(), ['a', 'b'])].sort()).toEqual(['a', 'b']);
    expect([...toggleSelectAllIds(new Set(['a', 'b']), ['a', 'b'])]).toEqual([]);
  });
});

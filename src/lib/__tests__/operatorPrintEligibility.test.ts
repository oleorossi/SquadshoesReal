import { describe, expect, it } from 'vitest';

import {
  filterOperationalOperatorItems,
  filterOperationalOperatorOrders,
} from '@/lib/operatorPrintEligibility';

describe('emissão operacional de fichas', () => {
  it('remove OP cancelada e OP ligada a item retirado, preservando OP ativa e manual', () => {
    const rows = [
      {
        id: 'ativa',
        status: 'Em Produção',
        sale_order_item_id: 'item-ativo',
        sale_order_items: { production_excluded_at: null },
      },
      {
        id: 'cancelada',
        status: 'Cancelada',
        sale_order_item_id: 'item-ativo',
        sale_order_items: { production_excluded_at: null },
      },
      {
        id: 'retirada',
        status: 'Em Produção',
        sale_order_item_id: 'item-retirado',
        sale_order_items: { production_excluded_at: '2026-08-30T12:00:00Z' },
      },
      {
        id: 'manual',
        status: 'Reservado',
        sale_order_item_id: null,
        sale_order_items: null,
      },
    ];

    expect(filterOperationalOperatorOrders(rows).map(row => row.id)).toEqual(['ativa', 'manual']);
    expect(rows).toHaveLength(4);
  });

  it('falha fechada quando uma OP vinculada perdeu a linha de origem', () => {
    const rows = [{
      id: 'sem-origem',
      status: 'Em Produção',
      sale_order_item_id: 'item-ausente',
      sale_order_items: null,
    }];

    expect(filterOperationalOperatorOrders(rows)).toEqual([]);
  });

  it('produz estado sem itens produtivos quando todos os itens comerciais foram retirados', () => {
    const commercialItems = [
      { id: 'item-1', production_excluded_at: '2026-08-30T12:00:00Z' },
      { id: 'item-2', production_excluded_at: '2026-08-30T12:01:00Z' },
    ];

    expect(filterOperationalOperatorItems(commercialItems)).toEqual([]);
    expect(commercialItems).toHaveLength(2);
  });
});

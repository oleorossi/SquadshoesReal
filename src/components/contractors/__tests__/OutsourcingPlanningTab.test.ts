import { describe, expect, it } from 'vitest';

import {
  buildOutsourcingServiceOrderProvenance,
  filterOperationalOutsourcingItems,
} from '@/components/contractors/OutsourcingPlanningTab';

describe('filterOperationalOutsourcingItems', () => {
  it('mantém o item no domínio comercial, mas não o transforma em demanda terceirizada', () => {
    const items = [
      { id: 'ativo', quantity: 40, production_excluded_at: null },
      { id: 'retirado', quantity: 80, production_excluded_at: '2027-01-01T00:00:00Z' },
    ];

    expect(filterOperationalOutsourcingItems(items)).toEqual([items[0]]);
    expect(items).toHaveLength(2);
  });

  it('persiste os itens exatos que originaram a OS para fechar corrida com aposentadoria', () => {
    expect(buildOutsourcingServiceOrderProvenance({
      pvIds: ['pv-1'],
      saleOrderItemIds: ['item-1', 'item-2'],
    })).toEqual({
      linked_sale_order_ids: ['pv-1'],
      selected_sale_order_item_ids: ['item-1', 'item-2'],
    });
  });
});

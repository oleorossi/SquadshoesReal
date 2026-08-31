import { describe, expect, it } from 'vitest';
import { dehydrateSuccessfulQueries, shouldPersistQueryKey } from './queryPersistence';

describe('queryPersistence', () => {
  it('pula busca global (ephemeral) e queries sem sucesso', () => {
    expect(shouldPersistQueryKey(['global-search-clients', 'abc'])).toBe(false);
    expect(shouldPersistQueryKey(['sale_orders'])).toBe(true);
    expect(shouldPersistQueryKey(['clients'])).toBe(true);

    const entries = dehydrateSuccessfulQueries([
      {
        queryKey: ['sale_orders'],
        state: { status: 'success', data: [{ id: '1' }], dataUpdatedAt: Date.now() } as any,
      },
      {
        queryKey: ['global-search-orders', 'op'],
        state: { status: 'success', data: [{ id: 'x' }], dataUpdatedAt: Date.now() } as any,
      },
      {
        queryKey: ['products'],
        state: { status: 'pending', data: undefined, dataUpdatedAt: 0 } as any,
      },
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0].queryKey).toEqual(['sale_orders']);
  });

  it('descarta entradas mais velhas que 24h', () => {
    const entries = dehydrateSuccessfulQueries(
      [{
        queryKey: ['clients'],
        state: {
          status: 'success',
          data: [],
          dataUpdatedAt: Date.now() - 25 * 60 * 60 * 1000,
        } as any,
      }],
    );
    expect(entries).toHaveLength(0);
  });
});

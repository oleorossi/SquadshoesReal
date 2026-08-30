import { describe, expect, it } from 'vitest';

import {
  getCanonicalReferenceIdMap,
  getCanonicalSaleOrderReferences,
} from '@/lib/saleOrderReferences';

describe('referências canônicas do Pedido de Venda', () => {
  const active = {
    id: 'active',
    code: 'S039',
    name: 'S-039',
    updated_at: '2026-08-01T12:00:00Z',
    retired_at: null,
  };
  const retired = {
    id: 'retired',
    code: 'S039',
    name: 'S-039',
    updated_at: '2026-08-30T12:00:00Z',
    retired_at: '2026-08-30T12:00:00Z',
  };

  it('mantém a versão ativa como escolha mesmo quando a aposentada é mais recente', () => {
    const result = getCanonicalSaleOrderReferences([retired, active]);

    expect(result[0]).toEqual(active);
    expect(result).toContainEqual(retired);
  });

  it('preserva o UUID aposentado no item histórico e deduplica somente versões ativas', () => {
    const olderActive = {
      ...active,
      id: 'older-active',
      updated_at: '2026-07-01T12:00:00Z',
    };
    const idMap = getCanonicalReferenceIdMap([retired, olderActive, active]);

    expect(idMap.get('retired')).toBe('retired');
    expect(idMap.get('older-active')).toBe('active');
    expect(idMap.get('active')).toBe('active');
  });
});

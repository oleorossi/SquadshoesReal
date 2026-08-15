import { describe, expect, it } from 'vitest';
import { shouldLoadOrderStages, shouldRetryProductionQueue } from '@/lib/productionLoading';

describe('carregamento do Modo Gestão', () => {
  it('não busca todos os estágios enquanto a fila ainda não forneceu IDs', () => {
    expect(shouldLoadOrderStages([])).toBe(false);
    expect(shouldLoadOrderStages(['op-1'])).toBe(true);
    expect(shouldLoadOrderStages(undefined)).toBe(true);
  });

  it('falha rápido em timeout determinístico e mantém um retry transitório', () => {
    expect(shouldRetryProductionQueue(0, new Error('canceling statement due to statement timeout'))).toBe(false);
    expect(shouldRetryProductionQueue(0, { status: 401, message: 'JWT expired' })).toBe(false);
    expect(shouldRetryProductionQueue(0, new Error('fetch failed'))).toBe(true);
    expect(shouldRetryProductionQueue(1, new Error('fetch failed'))).toBe(false);
  });
});

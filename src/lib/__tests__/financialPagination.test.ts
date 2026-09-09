import { describe, expect, it, vi } from 'vitest';
import { fetchFinancialRows } from '@/lib/financialPagination';

const rows = (from: number, count: number) => Array.from({ length: count }, (_, i) => ({ id: `${from + i}` }));

describe('consulta financeira paginada', () => {
  it('continua até o total mesmo quando o servidor limita páginas a 500', async () => {
    const page = vi.fn((from: number) => Promise.resolve({ data: rows(from, Math.min(500, 1053 - from)), count: 1053, error: null }));
    expect(await fetchFinancialRows(page)).toHaveLength(1053);
    expect(page.mock.calls).toEqual([[0, 999], [500, 1499], [1000, 1999]]);
  });

  it.each([1499, 1501])('recusa mudança simultânea da quantidade para %s', async count => {
    const page = vi.fn().mockResolvedValueOnce({ data: rows(0, 1000), count: 1500, error: null })
      .mockResolvedValueOnce({ data: rows(1000, count - 1000), count, error: null });
    await expect(fetchFinancialRows(page)).rejects.toThrow('mudaram durante');
  });

  it('não duplica uma linha repetida entre páginas', async () => {
    const page = vi.fn().mockResolvedValueOnce({ data: rows(0, 1000), count: 1001, error: null })
      .mockResolvedValueOnce({ data: rows(999, 1), count: 1001, error: null });
    await expect(fetchFinancialRows(page)).rejects.toThrow('inconsistentes');
  });

  it.each([undefined, null, -1, 1.5])('recusa contagem não confirmada: %s', async count => {
    await expect(fetchFinancialRows(vi.fn().mockResolvedValue({ data: [], count, error: null }))).rejects.toThrow('confirmar');
  });

  it('recusa página vazia antes de atingir o total', async () => {
    await expect(fetchFinancialRows(vi.fn().mockResolvedValue({ data: [], count: 1, error: null }))).rejects.toThrow('incompleta');
  });

  it('diferencia total realmente vazio', async () => {
    expect(await fetchFinancialRows(vi.fn().mockResolvedValue({ data: [], count: 0, error: null }))).toEqual([]);
  });
});

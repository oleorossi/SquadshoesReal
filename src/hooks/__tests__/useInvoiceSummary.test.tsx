import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readCompleteInvoiceSummaryRows, useInvoiceSummary } from '@/hooks/useInvoiceSummary';

const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: mocks.from } }));

describe('leitura completa do resumo de notas', () => {
  beforeEach(() => mocks.from.mockReset());

  it('consulta além da primeira página e propaga erro, sem total parcial', async () => {
    const rows = Array.from({ length: 1000 }, (_, id) => ({ id: `${id}` }));
    const page = vi.fn().mockResolvedValueOnce({ data: rows, error: null, count: 1001 })
      .mockResolvedValueOnce({ data: [{ id: 'b' }], error: null, count: 1001 });
    expect(await readCompleteInvoiceSummaryRows(page)).toHaveLength(1001);
    expect(page.mock.calls).toEqual([[0, 999], [1000, 1999]]);
    page.mockReset().mockResolvedValueOnce({ data: rows, error: null, count: 1001 })
      .mockResolvedValueOnce({ data: null, error: new Error('segunda página indisponível') });
    await expect(readCompleteInvoiceSummaryRows(page)).rejects.toThrow('segunda página');
  });

  it('bloqueia o subtotal quando atinge o limite de segurança', async () => {
    const page = vi.fn().mockResolvedValue({ data: [], error: null, count: 100_000 });
    await expect(readCompleteInvoiceSummaryRows(page)).rejects.toThrow('não foi calculado parcialmente');
    expect(page).toHaveBeenCalledTimes(1);
  });

  it('filtra emissão no servidor, ordena por id e invalida junto das notas', async () => {
    const queries = new Map<string, Record<string, ReturnType<typeof vi.fn>>>();
    mocks.from.mockImplementation((table: string) => {
      const query = {
        select: vi.fn().mockReturnThis(), gte: vi.fn().mockReturnThis(), lt: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(), range: vi.fn().mockResolvedValue({ data: [], error: null, count: 0 }),
      };
      queries.set(table, query);
      return query;
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useInvoiceSummary('2026-09'), {
      wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });
    await waitFor(() => expect(result.current.incoming.isSuccess && result.current.outgoing.isSuccess).toBe(true));
    expect(queries.get('invoices')!.select).toHaveBeenCalledWith('id,status,total_value', { count: 'exact' });
    expect(queries.get('invoices')!.gte).toHaveBeenCalledWith('issue_date', '2026-09-01');
    expect(queries.get('invoices')!.lt).toHaveBeenCalledWith('issue_date', '2026-10-01');
    expect(queries.get('nfe_emitidas')!.select).toHaveBeenCalledWith('id,status,valor_total,tp_amb_sefaz', { count: 'exact' });
    expect(queries.get('nfe_emitidas')!.gte).toHaveBeenCalledWith('data_emissao', new Date('2026-09-01T00:00:00').toISOString());
    expect(queries.get('nfe_emitidas')!.lt).toHaveBeenCalledWith('data_emissao', new Date('2026-10-01T00:00:00').toISOString());
    for (const query of queries.values()) expect(query.order).toHaveBeenCalledWith('id');
    await client.invalidateQueries({ queryKey: ['invoices'] });
    expect(mocks.from.mock.calls.filter(([table]) => table === 'invoices')).toHaveLength(2);
    await client.invalidateQueries({ queryKey: ['nfe_emitidas'] });
    expect(mocks.from.mock.calls.filter(([table]) => table === 'nfe_emitidas')).toHaveLength(2);
    client.clear();
  });
});

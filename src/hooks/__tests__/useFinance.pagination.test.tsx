import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAccountsPayable, useAccountsReceivable } from '@/hooks/useFinance';

const mocks = vi.hoisted(() => ({ from: vi.fn(), page: vi.fn(), order: vi.fn(), select: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: mocks.from } }));

const clients: QueryClient[] = [];
function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.from.mockImplementation(() => ({
    select: mocks.select.mockReturnThis(), order: mocks.order.mockReturnThis(), range: mocks.page,
  }));
});
afterEach(() => clients.splice(0).forEach(client => client.clear()));

describe.each([
  ['contas a pagar', 'accounts_payable', useAccountsPayable],
  ['contas a receber', 'accounts_receivable', useAccountsReceivable],
] as const)('%s — leitura financeira completa', (_, table, hook) => {
  it('carrega mais de duas mil contas com ordem estável para vencimentos iguais', async () => {
    mocks.page.mockImplementation((from: number) => Promise.resolve({
      data: Array.from({ length: from < 2000 ? 1000 : 1 }, (_, index) => ({ id: `${from + index}`, amount: 1, due_date: index % 2 ? '2026-09-01' : '2026-09-02' })), error: null, count: 2001,
    }));
    const { result } = renderHook(() => hook(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(2001);
    expect(mocks.from).toHaveBeenCalledWith(table);
    expect(mocks.page.mock.calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
    expect(mocks.order).not.toHaveBeenCalledWith('due_date', expect.anything());
    expect(mocks.order).toHaveBeenCalledWith('id', { ascending: true });
    expect(mocks.select).toHaveBeenCalledWith(expect.any(String), { count: 'exact' });
    expect(result.current.data![0].due_date).toBe('2026-09-01');
    expect(result.current.data!.at(-1)!.due_date).toBe('2026-09-02');
  });

  it('falha a consulta inteira quando a segunda página falha', async () => {
    mocks.page.mockResolvedValueOnce({ data: Array.from({ length: 1000 }, (_, id) => ({ id: `${id}` })), error: null, count: 1001 })
      .mockResolvedValueOnce({ data: null, error: new Error('página indisponível') });
    const { result } = renderHook(() => hook(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect(result.current.error?.message).toBe('página indisponível');
  });

  it('preserva carregamento sob demanda, sem consulta em aba desabilitada', () => {
    renderHook(() => hook(false), { wrapper: wrapper() });
    expect(mocks.from).not.toHaveBeenCalled();
  });
});

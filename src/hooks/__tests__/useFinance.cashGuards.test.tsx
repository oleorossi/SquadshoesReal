import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useCreateAccountPayable, useCreateAccountReceivable, useDeleteAccountPayable, useDeleteAccountReceivable,
  useUpdateAccountPayable, useUpdateAccountReceivable, type AccountPayable, type AccountReceivable,
} from '@/hooks/useFinance';

const mocks = vi.hoisted(() => ({ from: vi.fn(), update: vi.fn(), insert: vi.fn(), delete: vi.fn(), eq: vi.fn(), neq: vi.fn(), not: vi.fn(), select: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: mocks.from } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const clients: QueryClient[] = [];
function wrapper() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  clients.push(client);
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
beforeEach(() => {
  vi.clearAllMocks();
  const chain = {
    update: mocks.update.mockReturnThis(), insert: mocks.insert, delete: mocks.delete.mockReturnThis(),
    eq: mocks.eq.mockReturnThis(), neq: mocks.neq.mockReturnThis(), not: mocks.not.mockReturnThis(), select: mocks.select,
  };
  mocks.from.mockReturnValue(chain);
  mocks.select.mockResolvedValue({ data: [{ id: 'titulo' }], error: null });
  mocks.insert.mockResolvedValue({ data: null, error: null });
});
afterEach(() => clients.splice(0).forEach(client => client.clear()));

describe.each([
  ['AP', useUpdateAccountPayable, 'amount_paid'],
  ['AR', useUpdateAccountReceivable, 'amount_received'],
] as const)('edição de %s não é baixa', (_, hook, amountField) => {
  it.each(['amount_paid', 'amount_received', 'payment_date', 'status'])('bloqueia escrita direta de %s antes da rede', async field => {
    const { result } = renderHook(() => hook(), { wrapper: wrapper() });
    await act(async () => {
      await expect(result.current.mutateAsync({ id: 'titulo', [field]: field.startsWith('amount') ? 10 : '2026-09-01' })).rejects.toThrow();
    });
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('edita metadado e delega invariantes transacionais ao servidor', async () => {
    const { result } = renderHook(() => hook(), { wrapper: wrapper() });
    await act(async () => { await result.current.mutateAsync({ id: 'titulo', description: 'Descrição corrigida' }); });
    expect(mocks.update).toHaveBeenCalledWith({ description: 'Descrição corrigida' });
    expect(mocks.eq).toHaveBeenCalledWith('id', 'titulo');
    expect(mocks.select).toHaveBeenCalledWith('id');
  });
  it('não anuncia sucesso se o banco bloquear ou não devolver o título', async () => {
    mocks.select.mockResolvedValue({ data: [], error: null });
    const { result } = renderHook(() => hook(), { wrapper: wrapper() });
    await act(async () => { await expect(result.current.mutateAsync({ id: 'titulo', description: 'X' })).rejects.toThrow('não encontrada'); });
    mocks.select.mockResolvedValue({ data: null, error: new Error(`Histórico ${amountField} protegido`) });
    await act(async () => { await expect(result.current.mutateAsync({ id: 'titulo', amount: 1 })).rejects.toThrow('Histórico'); });
  });
});

describe.each([
  ['AP', useDeleteAccountPayable, 'amount_paid'],
  ['AR', useDeleteAccountReceivable, 'amount_received'],
] as const)('exclusão de %s preserva caixa', (_, hook, amountField) => {
  it('exige acumulado zero e não sugere apagar após estorno', async () => {
    mocks.select.mockResolvedValue({ data: [], error: null });
    const { result } = renderHook(() => hook(), { wrapper: wrapper() });
    await act(async () => { await expect(result.current.mutateAsync('titulo')).rejects.toThrow('histórico'); });
    expect(mocks.eq).toHaveBeenCalledWith(amountField, 0);
  });
  it('propaga trava histórica do servidor mesmo com saldo atual zero', async () => {
    mocks.select.mockResolvedValue({ data: null, error: new Error('Título possui evento estornado e não pode ser excluído') });
    const { result } = renderHook(() => hook(), { wrapper: wrapper() });
    await act(async () => { await expect(result.current.mutateAsync('titulo')).rejects.toThrow('evento estornado'); });
  });
});

describe('criação de título não fabrica pagamento', () => {
  it('recusa AP e AR já liquidadas antes da rede', async () => {
    const payable = renderHook(useCreateAccountPayable, { wrapper: wrapper() });
    const receivable = renderHook(useCreateAccountReceivable, { wrapper: wrapper() });
    await act(async () => {
      await expect(payable.result.current.mutateAsync({ amount: 100, amount_paid: 20, status: 'pending' } as AccountPayable)).rejects.toThrow('comando de baixa');
      await expect(receivable.result.current.mutateAsync({ amount: 100, amount_received: 0, status: 'received' } as AccountReceivable)).rejects.toThrow('situação');
    });
    expect(mocks.from).not.toHaveBeenCalled();
  });
});

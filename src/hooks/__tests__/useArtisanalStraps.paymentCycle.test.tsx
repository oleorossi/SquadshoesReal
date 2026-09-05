import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useCloseArtisanalStrapContractorPaymentCycle,
  useMarkArtisanalStrapContractorPaymentCyclePaid,
} from '@/hooks/useArtisanalStraps';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock('sonner', () => ({ toast: { success: mocks.success, error: mocks.error } }));

const financeKeys = [
  ['accounts_payable'],
  ['finance-kpis'],
  ['finance-alerts'],
  ['cash-flow-projection', 90],
  ['dre-auto-cash', 12],
  ['notifications_aggregated'],
];
const settlementKeys = [
  ['financial-settlement-history', 'payable', 'ap-fixture'],
  ['financial-cash-events'],
  ['bank-reconciliation', 'sessions'],
];
const clients: QueryClient[] = [];

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  });
  clients.push(client);
  for (const key of [...financeKeys, ...settlementKeys]) client.setQueryData(key, ['cache anterior']);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockResolvedValue({ data: { cycle_id: 'cycle-fixture', status: 'paid', replayed: false }, error: null });
});
afterEach(() => {
  vi.restoreAllMocks();
  clients.splice(0).forEach(client => client.clear());
});

describe('baixa de ciclo terceirizado — atualização das leituras financeiras', () => {
  it.each([false, true])('invalida as chaves canônicas após confirmação (replay=%s)', async replayed => {
    mocks.rpc.mockResolvedValue({ data: { cycle_id: 'cycle-fixture', replayed }, error: null });
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useMarkArtisanalStrapContractorPaymentCyclePaid(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ cycleId: 'cycle-fixture', paymentDate: '2026-08-20', paymentMethod: 'pix' });
    });
    expect(mocks.rpc).toHaveBeenCalledWith('mark_contractor_payment_cycle_paid', {
      p_cycle_id: 'cycle-fixture', p_payment_date: '2026-08-20', p_payment_method: 'pix',
    });
    for (const key of [...financeKeys, ...settlementKeys]) {
      expect(client.getQueryState(key)?.isInvalidated, key.join('/')).toBe(true);
    }
    expect(mocks.success).toHaveBeenCalledTimes(1);
  });

  it('preserva o contrato de método opcional sem inventar valor no hook', async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useMarkArtisanalStrapContractorPaymentCyclePaid(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ cycleId: 'cycle-fixture', paymentDate: '2026-08-20' });
    });
    expect(mocks.rpc).toHaveBeenCalledWith('mark_contractor_payment_cycle_paid', {
      p_cycle_id: 'cycle-fixture', p_payment_date: '2026-08-20', p_payment_method: null,
    });
  });

  it('não considera erro RPC uma baixa confirmada nem invalida saldo como sucesso', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: new Error('Ciclo precisa estar fechado') });
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useMarkArtisanalStrapContractorPaymentCyclePaid(), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync({
        cycleId: 'cycle-fixture', paymentDate: '2026-08-20', paymentMethod: 'pix',
      })).rejects.toThrow('Ciclo precisa estar fechado');
    });
    for (const key of [...financeKeys, ...settlementKeys]) {
      expect(client.getQueryState(key)?.isInvalidated, key.join('/')).toBe(false);
    }
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledTimes(1);
  });

  it('não prende a confirmação em consultas posteriores penduradas', async () => {
    const { client, wrapper } = setup();
    vi.spyOn(client, 'invalidateQueries').mockImplementation(() => new Promise<void>(() => {}));
    const { result } = renderHook(() => useMarkArtisanalStrapContractorPaymentCyclePaid(), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync({
        cycleId: 'cycle-fixture', paymentDate: '2026-08-20', paymentMethod: 'pix',
      })).resolves.toMatchObject({ status: 'paid' });
    });
    expect(mocks.success).toHaveBeenCalledTimes(1);
  });

  it('fechar ciclo também atualiza AP e projeções, pois cria um novo título', async () => {
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useCloseArtisanalStrapContractorPaymentCycle(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ cycleId: 'cycle-fixture', idempotencyKey: 'close-fixture' });
    });
    expect(mocks.rpc).toHaveBeenCalledWith('close_contractor_payment_cycle', {
      p_cycle_id: 'cycle-fixture', p_idempotency_key: 'close-fixture',
    });
    for (const key of financeKeys) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    for (const key of settlementKeys) expect(client.getQueryState(key)?.isInvalidated).toBe(false);
  });
});

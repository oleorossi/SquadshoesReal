import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDismissTimeImportQuarantine, useResolveTimeImportQuarantine } from '../useTimeImportLogs';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: mocks.rpc,
  },
}));

vi.mock('sonner', () => ({
  toast: {
    success: mocks.success,
    error: mocks.error,
  },
}));

describe('useResolveTimeImportQuarantine', () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
    mocks.success.mockReset();
    mocks.error.mockReset();
  });

  it('resolve somente pela RPC canônica e invalida ponto, cobertura e folha', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        resolved: true,
        idempotent: false,
        quarantine_id: 'quarantine-1',
        time_record_id: 'record-1',
      },
      error: null,
    });
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useResolveTimeImportQuarantine(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync('quarantine-1');
    });

    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith('resolve_time_import_quarantine', {
      p_quarantine_id: 'quarantine-1',
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['time_import_quarantine'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['time_import_logs'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['time_records'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['timesheet_coverage'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['payroll-comp-records'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['payroll_runs'] });
    expect(mocks.success).toHaveBeenCalledWith(
      'Pendência resolvida. O ponto e os cálculos da folha serão atualizados.',
    );
  });

  it('mantém a pendência e apresenta o erro devolvido pela RPC', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: 'A matrícula ainda não possui ficha vigente.' },
    });
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useResolveTimeImportQuarantine(), { wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync('quarantine-1')).rejects.toThrow(
        'A matrícula ainda não possui ficha vigente.',
      );
    });

    expect(mocks.error).toHaveBeenCalledWith(
      'Não foi possível resolver a pendência: A matrícula ainda não possui ficha vigente.',
    );
  });

  it('classifica ruído somente pela RPC auditada e atualiza a folha', async () => {
    mocks.rpc.mockResolvedValue({
      data: { dismissed: true, idempotent: false, quarantine_id: 'quarantine-1' },
      error: null,
    });
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useDismissTimeImportQuarantine(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        quarantineId: 'quarantine-1',
        reason: '  Crachá de teste  ',
      });
    });

    expect(mocks.rpc).toHaveBeenCalledWith('dismiss_time_import_quarantine', {
      p_quarantine_id: 'quarantine-1',
      p_reason: 'Crachá de teste',
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['time_import_quarantine'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['payroll_runs'] });
    expect(mocks.success).toHaveBeenCalledWith(
      'Linha classificada como externa ao quadro. A evidência e a justificativa foram preservadas.',
    );
  });
});

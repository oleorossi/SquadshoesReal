import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ImportHistoryPanel from './ImportHistoryPanel';

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  resolvePending: false,
  resolveVariables: undefined as string | undefined,
  dismiss: vi.fn(),
  dismissPending: false,
  dismissVariables: undefined as { quarantineId: string; reason: string } | undefined,
}));

vi.mock('@/hooks/useTimeImportLogs', () => ({
  downloadImportFile: vi.fn(),
  useTimeImportLogs: () => ({
    data: [],
    isLoading: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
  useTimeImportQuarantine: () => ({
    data: [{
      id: 'quarantine-1',
      import_log_id: 'log-1',
      batch_id: 'batch-1',
      employee_external_id: 'MAT-404',
      employee_name: 'Maria Sem Vínculo',
      department: 'Costura',
      record_date: '2026-08-20',
      punches: ['08:00', '18:00'],
      reason: 'Matrícula não vinculada a uma ficha vigente.',
      created_at: '2026-08-21T12:00:00Z',
      resolution_status: 'pending',
      resolution_reason: null,
      resolved_at: null,
      resolved_by: null,
      time_record_id: null,
    }],
    error: null,
    isLoading: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
  useTimeImportQuarantineHistory: () => ({
    data: [{
      id: 'quarantine-history-1',
      import_log_id: 'log-0',
      batch_id: 'batch-0',
      employee_external_id: 'TESTE-01',
      employee_name: 'Crachá de Teste',
      department: '',
      record_date: '2026-08-19',
      punches: ['08:00', '08:01'],
      reason: 'Matrícula sem vínculo.',
      created_at: '2026-08-20T12:00:00Z',
      resolution_status: 'dismissed',
      resolution_reason: 'Crachá de teste do relógio',
      resolved_at: '2026-08-21T12:00:00Z',
      resolved_by: 'user-1',
      time_record_id: null,
    }],
    error: null,
    isLoading: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
  useResolveTimeImportQuarantine: () => ({
    mutate: mocks.resolve,
    isPending: mocks.resolvePending,
    variables: mocks.resolveVariables,
  }),
  useDismissTimeImportQuarantine: () => ({
    mutate: mocks.dismiss,
    isPending: mocks.dismissPending,
    variables: mocks.dismissVariables,
  }),
}));

describe('ImportHistoryPanel — quarentena de importação', () => {
  beforeEach(() => {
    mocks.resolve.mockReset();
    mocks.resolvePending = false;
    mocks.resolveVariables = undefined;
    mocks.dismiss.mockReset();
    mocks.dismissPending = false;
    mocks.dismissVariables = undefined;
  });

  it('preserva e classifica uma linha externa somente com justificativa', () => {
    render(<ImportHistoryPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Não pertence ao quadro' }));
    const confirmation = screen.getByRole('alertdialog');
    expect(within(confirmation).getByText('Classificar como linha externa ao quadro?')).toBeInTheDocument();
    const confirm = within(confirmation).getByRole('button', { name: 'Preservar e classificar' });
    expect(confirm).toBeDisabled();

    fireEvent.change(within(confirmation).getByLabelText('Justificativa obrigatória'), {
      target: { value: 'Crachá de teste do relógio' },
    });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    expect(mocks.dismiss).toHaveBeenCalledWith(
      { quarantineId: 'quarantine-1', reason: 'Crachá de teste do relógio' },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it('lista matrícula, nome, data e motivo e exige confirmação para resolver', () => {
    render(<ImportHistoryPanel />);

    expect(screen.getByText('Pendências de vínculo da importação')).toBeInTheDocument();
    expect(screen.getByText('MAT-404')).toBeInTheDocument();
    expect(screen.getByText('Maria Sem Vínculo')).toBeInTheDocument();
    expect(screen.getByText('20/08/2026')).toBeInTheDocument();
    expect(screen.getByText('Matrícula não vinculada a uma ficha vigente.')).toBeInTheDocument();
    expect(screen.getByText('Histórico de vínculos e classificações')).toBeInTheDocument();
    expect(screen.getByText('Crachá de teste do relógio')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Tentar resolver' }));
    const confirmation = screen.getByRole('alertdialog');
    expect(within(confirmation).getByText('Tentar resolver esta pendência?')).toBeInTheDocument();
    expect(within(confirmation).getByText(/Se o vínculo ainda não existir, nada será alterado/)).toBeInTheDocument();

    fireEvent.click(within(confirmation).getByRole('button', { name: 'Confirmar tentativa' }));

    expect(mocks.resolve).toHaveBeenCalledWith(
      'quarantine-1',
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it('mostra carregamento somente na linha em resolução e bloqueia nova tentativa', () => {
    mocks.resolvePending = true;
    mocks.resolveVariables = 'quarantine-1';

    render(<ImportHistoryPanel />);

    const resolving = screen.getByRole('button', { name: 'Resolvendo…' });
    expect(resolving).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Tentar resolver' })).not.toBeInTheDocument();
  });
});

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdvancesPanel from './AdvancesPanel';

const mocks = vi.hoisted(() => ({
  cancel: vi.fn(),
}));

vi.mock('@/hooks/useEmployees', () => ({
  useEmployees: () => ({ data: [{ id: 'employee-1', name: 'Funcionário Teste' }] }),
  useEmployeeAdvances: () => {
    const date = new Date();
    const period = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    return {
      isLoading: false,
      data: [{
        id: 'advance-active',
        employee_id: 'employee-1',
        amount: 40,
        advance_date: `${period}-10`,
        description: 'Vale alimentação',
        status: 'pending',
        payroll_run_id: null,
        cancellation_reason: null,
      }, {
        id: 'advance-cancelled',
        employee_id: 'employee-1',
        amount: 60,
        advance_date: `${period}-11`,
        description: 'Lançamento duplicado',
        status: 'cancelado',
        payroll_run_id: null,
        cancellation_reason: 'Registro criado duas vezes',
      }],
    };
  },
  useAddAdvance: () => ({ mutate: vi.fn(), isPending: false }),
  useCancelAdvance: () => ({ mutate: mocks.cancel, isPending: false }),
  useMarkAdvanceExternallySettled: () => ({ mutate: vi.fn(), isPending: false }),
  useSettleEmployeeAdvancesExternally: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/components/hr/EmployeeCombobox', () => ({
  EmployeeCombobox: () => <div data-testid="employee-combobox" />,
}));

vi.mock('@/lib/employeeAdvances', () => ({
  createEmployeeAdvanceIdempotencyKey: () => '00000000-0000-4000-8000-000000000001',
  isOpenEmployeeAdvance: (status: string) => status === 'pending' || status === 'paid',
  canManageOpenEmployeeAdvance: (advance: { status: string; payroll_run_id?: string | null }) =>
    (advance.status === 'pending' || advance.status === 'paid') && !advance.payroll_run_id,
  matchesEmployeeAdvanceStatusFilter: (status: string, filter: string) =>
    filter === 'all' || (filter === 'open' ? status === 'pending' || status === 'paid' : status === filter),
  employeeAdvanceStatusLabel: (status: string) => ({
    pending: 'Pendente · a descontar',
    paid: 'Entregue · a descontar',
    deducted: 'Descontado em folha',
    baixado_externo: 'Baixado fora da folha',
    cancelado: 'Cancelado',
  })[status] ?? status,
}));

describe('AdvancesPanel — cancelamento auditável', () => {
  beforeEach(() => {
    mocks.cancel.mockReset();
  });

  it('mantém o vale cancelado visível e fora dos totais e saldos', () => {
    render(<AdvancesPanel />);

    const totalCard = screen.getByText('Total no período').closest('.bg-card');
    expect(totalCard).toHaveTextContent('R$ 40,00');
    expect(totalCard).toHaveTextContent('1 vale');
    expect(screen.getByText('Cancelado')).toBeInTheDocument();
    expect(screen.getByText(/Motivo: Registro criado duas vezes/)).toBeInTheDocument();
    expect(screen.getAllByLabelText('Cancelar vale')).toHaveLength(1);
  });

  it('exige motivo e envia o comando de cancelamento sem excluir o vale', () => {
    render(<AdvancesPanel />);

    fireEvent.click(screen.getByLabelText('Cancelar vale'));
    const confirm = screen.getByRole('button', { name: 'Cancelar vale' });
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Motivo do cancelamento *'), {
      target: { value: 'Valor lançado para o funcionário errado' },
    });
    fireEvent.click(confirm);

    expect(mocks.cancel).toHaveBeenCalledWith(
      { id: 'advance-active', reason: 'Valor lançado para o funcionário errado' },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(screen.queryByText(/Remover vale/)).not.toBeInTheDocument();
  });
});

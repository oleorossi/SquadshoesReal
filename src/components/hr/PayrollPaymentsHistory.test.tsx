import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PayrollPaymentsHistory from './PayrollPaymentsHistory';

const mocks = vi.hoisted(() => ({
  reverse: vi.fn(),
  getReceiptSignedUrl: vi.fn(),
}));

vi.mock('@/hooks/useEmployees', () => ({
  useEmployees: () => ({ data: [{ id: 'employee-1', name: 'Funcionário Teste' }] }),
}));

vi.mock('@/hooks/usePayrollPayments', () => ({
  usePayrollPaymentsHistory: () => ({
    isLoading: false,
    data: [{
      id: 'payment-active',
      amount: 20,
      paid_on: '2026-08-20',
      method: 'pix',
      reference: 'PIX ativo',
      receipt_path: '',
      reversed_at: null,
      reversal_reason: null,
      employee: { id: 'employee-1', name: 'Funcionário Teste', role: null, department: null, cpf: null },
      run: { id: 'run-1', period: '2026-08', total_liquido: 100, status: 'aprovado' },
    }, {
      id: 'payment-reversed',
      amount: 30,
      paid_on: '2026-08-19',
      method: 'pix',
      reference: 'PIX duplicado',
      receipt_path: 'run-1/payment-reversed.pdf',
      reversed_at: '2026-08-21T10:00:00Z',
      reversal_reason: 'Pagamento lançado em duplicidade',
      employee: { id: 'employee-1', name: 'Funcionário Teste', role: null, department: null, cpf: null },
      run: { id: 'run-1', period: '2026-08', total_liquido: 100, status: 'aprovado' },
    }],
  }),
  useReversePayrollPayment: () => ({ mutate: mocks.reverse, isPending: false }),
  getReceiptSignedUrl: mocks.getReceiptSignedUrl,
  paymentMethodLabel: () => 'Pix',
  formatPayrollPeriod: () => 'agosto/2026',
}));

vi.mock('@/lib/printPayrollReceipt', () => ({ printPayrollReceipt: vi.fn() }));

describe('PayrollPaymentsHistory — estorno auditável', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.reverse.mockReset();
    mocks.getReceiptSignedUrl.mockReset();
    mocks.getReceiptSignedUrl.mockResolvedValue('https://example.test/receipt.pdf');
    vi.spyOn(window, 'open').mockReturnValue(null);
  });

  it('mantém o estornado visível e o exclui de todos os KPIs', () => {
    render(<PayrollPaymentsHistory />);

    const paymentsKpi = screen.getByText('Pagamentos').closest('.bg-card');
    const totalKpi = screen.getByText('Total pago').closest('.bg-card');
    const receiptKpi = screen.getByText('Com recibo anexado').closest('.bg-card');

    expect(paymentsKpi).toHaveTextContent('1');
    expect(totalKpi).toHaveTextContent('R$ 20,00');
    expect(totalKpi).not.toHaveTextContent('R$ 50,00');
    expect(receiptKpi).toHaveTextContent('0/1');
    expect(screen.getByText('Estornado')).toBeInTheDocument();
    expect(screen.getByText('Pagamento lançado em duplicidade')).toBeInTheDocument();
    expect(screen.getAllByLabelText('Estornar pagamento')).toHaveLength(1);
    expect(screen.queryByLabelText('Remover pagamento')).not.toBeInTheDocument();
  });

  it('preserva o recibo do estornado e exige motivo para um novo estorno', async () => {
    render(<PayrollPaymentsHistory />);

    const reversedRow = screen.getByText('Pagamento lançado em duplicidade').closest('tr');
    expect(reversedRow).not.toBeNull();
    expect(within(reversedRow!).queryByTitle('Imprimir recibo')).not.toBeInTheDocument();
    fireEvent.click(within(reversedRow!).getByRole('button', { name: /Baixar/i }));
    await waitFor(() => {
      expect(mocks.getReceiptSignedUrl).toHaveBeenCalledWith('run-1/payment-reversed.pdf');
      expect(window.open).toHaveBeenCalledWith('https://example.test/receipt.pdf', '_blank');
    });

    fireEvent.click(screen.getByLabelText('Estornar pagamento'));
    const confirm = screen.getByRole('button', { name: 'Confirmar estorno' });
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Motivo do estorno *'), {
      target: { value: 'Pagamento confirmado na conta incorreta' },
    });
    fireEvent.click(confirm);

    expect(mocks.reverse).toHaveBeenCalledWith(
      { id: 'payment-active', reason: 'Pagamento confirmado na conta incorreta' },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });
});

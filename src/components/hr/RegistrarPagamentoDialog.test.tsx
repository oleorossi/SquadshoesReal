import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PayrollRun } from '@/hooks/useRH';
import { RegistrarPagamentoDialog } from './RegistrarPagamentoDialog';

const mocks = vi.hoisted(() => ({
  register: vi.fn(),
  reverse: vi.fn(),
  getReceiptSignedUrl: vi.fn(),
}));

vi.mock('@/hooks/usePayrollPayments', () => ({
  usePayrollPayments: () => ({
    data: [{
      id: 'payment-1',
      amount: 20,
      paid_on: '2026-08-20',
      method: 'pix',
      reference: '',
      notes: '',
      receipt_path: '',
      reversed_at: null,
      reversal_reason: null,
    }, {
      id: 'payment-2',
      amount: 30,
      paid_on: '2026-08-19',
      method: 'pix',
      reference: 'PIX legado',
      notes: '',
      receipt_path: 'run-1/payment-2.pdf',
      reversed_at: '2026-08-21T10:00:00Z',
      reversal_reason: 'Pagamento lançado em duplicidade',
    }],
  }),
  useRegisterPayrollPayment: () => ({ mutate: mocks.register, isPending: false }),
  useReversePayrollPayment: () => ({ mutate: mocks.reverse, isPending: false }),
  getReceiptSignedUrl: mocks.getReceiptSignedUrl,
  PAYMENT_METHODS: [{ value: 'pix', label: 'Pix' }],
  paymentMethodLabel: () => 'Pix',
  formatPayrollPeriod: () => 'agosto/2026',
  createPayrollPaymentIdempotencyKey: () => '00000000-0000-4000-8000-000000000001',
}));

vi.mock('@/lib/printPayrollReceipt', () => ({ printPayrollReceipt: vi.fn() }));

const RUN = {
  id: 'run-1',
  employee_id: 'employee-1',
  period: '2026-08',
  status: 'aprovado',
  total_liquido: 100,
  pares_medio: 0,
  pares_dificil: 0,
  business_days_worked: 0,
} as PayrollRun;

describe('RegistrarPagamentoDialog — limite do saldo líquido', () => {
  beforeEach(() => {
    mocks.register.mockReset();
    mocks.reverse.mockReset();
    mocks.getReceiptSignedUrl.mockReset();
    mocks.getReceiptSignedUrl.mockResolvedValue('https://example.test/receipt.pdf');
    vi.spyOn(window, 'open').mockReturnValue(null);
  });

  it('bloqueia valor maior que o saldo remanescente', async () => {
    render(
      <RegistrarPagamentoDialog
        open
        onOpenChange={vi.fn()}
        run={RUN}
        employeeName="Funcionário Teste"
      />,
    );

    // Líquido 100 − pagamento já registrado 20 = saldo máximo 80.
    const input = await screen.findByLabelText('Valor');
    await waitFor(() => expect(input).toHaveValue('80,00'));

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '90,00' } });

    expect(screen.getByRole('alert')).toHaveTextContent('O valor não pode superar o saldo de R$ 80,00.');
    expect(screen.getByRole('button', { name: /Registrar R\$\s*90,00/ })).toBeDisabled();
    expect(mocks.register).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: '80,00' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Registrar R\$\s*80,00/ })).toBeEnabled();
  });

  it('explica que payroll_payments recebe somente o saldo líquido', () => {
    render(
      <RegistrarPagamentoDialog
        open
        onOpenChange={vi.fn()}
        run={RUN}
        employeeName="Funcionário Teste"
      />,
    );

    expect(screen.getByText(/somente pagamentos do saldo líquido desta folha/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/primeira parcela do saldo líquido/i)).toBeInTheDocument();
  });

  it('não permite que uma data futura quite a folha antecipadamente', async () => {
    render(
      <RegistrarPagamentoDialog
        open
        onOpenChange={vi.fn()}
        run={RUN}
        employeeName="Funcionário Teste"
      />,
    );

    const date = screen.getByLabelText('Data');
    expect(date).toHaveAttribute('max');
    fireEvent.change(date, { target: { value: '2099-12-31' } });

    expect(screen.getByRole('alert')).toHaveTextContent('Pagamentos futuros não podem quitar a folha hoje.');
    const amount = await screen.findByLabelText('Valor');
    await waitFor(() => expect(amount).toHaveValue('80,00'));
    expect(screen.getByRole('button', { name: /Registrar R\$\s*80,00/ })).toBeDisabled();
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it('mantém pagamento estornado visível, fora de Pago/Saldo e com recibo abrível', async () => {
    render(
      <RegistrarPagamentoDialog
        open
        onOpenChange={vi.fn()}
        run={RUN}
        employeeName="Funcionário Teste"
      />,
    );

    expect(screen.getByText('Estornado')).toBeInTheDocument();
    expect(screen.getByText(/Pagamento lançado em duplicidade/)).toBeInTheDocument();
    expect(screen.getAllByLabelText('Estornar pagamento')).toHaveLength(1);
    expect(screen.queryByLabelText('Remover pagamento')).not.toBeInTheDocument();
    const reversedRow = screen.getByText(/Pagamento lançado em duplicidade/).closest('.rounded-md');
    expect(reversedRow).not.toBeNull();
    expect(within(reversedRow as HTMLElement).queryByTitle('Imprimir recibo pra assinar')).not.toBeInTheDocument();

    // O pagamento ativo de R$ 20 compõe o pago; o estornado de R$ 30 não reduz o saldo.
    const input = await screen.findByLabelText('Valor');
    await waitFor(() => expect(input).toHaveValue('80,00'));

    fireEvent.click(screen.getByTitle('Abrir recibo anexado'));
    await waitFor(() => {
      expect(mocks.getReceiptSignedUrl).toHaveBeenCalledWith('run-1/payment-2.pdf');
      expect(window.open).toHaveBeenCalledWith('https://example.test/receipt.pdf', '_blank');
    });
  });

  it('exige motivo e chama o estorno auditável sem excluir o pagamento', () => {
    render(
      <RegistrarPagamentoDialog
        open
        onOpenChange={vi.fn()}
        run={RUN}
        employeeName="Funcionário Teste"
      />,
    );

    fireEvent.click(screen.getByLabelText('Estornar pagamento'));
    const confirm = screen.getByRole('button', { name: 'Confirmar estorno' });
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Motivo do estorno *'), {
      target: { value: 'Pagamento lançado na conta errada' },
    });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    expect(mocks.reverse).toHaveBeenCalledWith(
      { id: 'payment-1', reason: 'Pagamento lançado na conta errada' },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it('encerra folha cancelada e não oferece novo pagamento', () => {
    render(
      <RegistrarPagamentoDialog
        open
        onOpenChange={vi.fn()}
        run={{ ...RUN, status: 'cancelado' }}
        employeeName="Funcionário Teste"
      />,
    );

    expect(screen.getByText(/Folha cancelada\. Este documento está encerrado/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Valor')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Registrar / })).not.toBeInTheDocument();
  });
});

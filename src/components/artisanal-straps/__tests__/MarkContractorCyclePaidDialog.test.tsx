import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MarkContractorCyclePaidDialog from '@/components/artisanal-straps/MarkContractorCyclePaidDialog';
import type { StrapContractorPaymentCycleOperational } from '@/hooks/useArtisanalStraps';

HTMLElement.prototype.hasPointerCapture ??= () => false;
HTMLElement.prototype.setPointerCapture ??= () => {};
HTMLElement.prototype.releasePointerCapture ??= () => {};
HTMLElement.prototype.scrollIntoView ??= () => {};

const mocks = vi.hoisted(() => ({ useMarkPaid: vi.fn(), mutateAsync: vi.fn() }));
vi.mock('@/hooks/useArtisanalStraps', () => ({
  useMarkArtisanalStrapContractorPaymentCyclePaid: mocks.useMarkPaid,
}));

const target: StrapContractorPaymentCycleOperational = {
  cycle_id: '00000000-0000-4000-8000-000000000001',
  contractor_id: '00000000-0000-4000-8000-000000000002',
  contractor_name: 'Facção de tiras',
  schedule_version_id: '00000000-0000-4000-8000-000000000003',
  accounts_payable_id: '00000000-0000-4000-8000-000000000004',
  cycle_start: '2020-02-01', cycle_end: '2020-02-07', payment_date: '2020-02-10',
  status: 'closed', accrual_count: 1, accepted_m: 50, discount_count: 0,
  gross_amount: 100, discount_amount: 0, carried_credit_in: 0, carried_credit_out: 0,
  net_amount: 100, closed_at: '2020-02-08T12:00:00Z',
  created_at: '2020-02-01T12:00:00Z', updated_at: '2020-02-08T12:00:00Z',
};
const confirmed = { cycle_id: target.cycle_id, accounts_payable_id: target.accounts_payable_id, status: 'paid', replayed: false };
const query = (isPending = false) => ({ mutateAsync: mocks.mutateAsync, isPending });

function setup(patch: Partial<React.ComponentProps<typeof MarkContractorCyclePaidDialog>> = {}) {
  const props = { target, onClose: vi.fn(), ...patch };
  return { ...render(<MarkContractorCyclePaidDialog {...props} />), props, user: userEvent.setup() };
}

async function fillRequired(user: ReturnType<typeof userEvent.setup>, label = 'Pix', date = '2020-02-29') {
  fireEvent.change(screen.getByLabelText('Data real do pagamento'), { target: { value: date } });
  await user.click(screen.getByRole('combobox', { name: 'Meio de pagamento' }));
  await user.click(await screen.findByRole('option', { name: label }));
}

function deferred() {
  let resolve: (value: Record<string, unknown>) => void;
  let reject: (failure: unknown) => void;
  const promise = new Promise<Record<string, unknown>>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve: resolve!, reject: reject! };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useMarkPaid.mockReturnValue(query());
  mocks.mutateAsync.mockResolvedValue(confirmed);
});

describe('Pagamento de ciclo — data e meio explícitos', () => {
  it('inicia vazio e explica saldo restante sem prometer transferência', () => {
    setup();
    expect(screen.getByLabelText('Data real do pagamento')).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'Meio de pagamento' })).toHaveTextContent('Selecione o meio utilizado');
    expect(screen.getByText(/líquido do ciclo/)).toHaveTextContent('100,00');
    expect(screen.getByText(/somente o saldo restante/)).toHaveTextContent('considerando baixas anteriores');
    expect(screen.getByText(/não transfere dinheiro nem altera o saldo bancário/)).toBeInTheDocument();
  });

  it('pede data e meio antes de enviar, com mensagens associadas aos campos', async () => {
    const { user, props } = setup();
    await user.click(screen.getByRole('button', { name: 'Confirmar pago' }));
    expect(screen.getByLabelText('Data real do pagamento')).toHaveAccessibleDescription('Informe a data real do pagamento, válida e não futura.');
    expect(screen.getByRole('combobox', { name: 'Meio de pagamento' })).toHaveAccessibleDescription('Selecione o meio de pagamento utilizado.');
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it.each([
    ['Pix', 'pix'], ['Transferência', 'transferencia'], ['Boleto', 'boleto'], ['Dinheiro', 'dinheiro'],
    ['Cheque', 'cheque'], ['Cartão', 'cartao'], ['Outro', 'outro'],
  ])('envia %s no formato canônico %s, sem recalcular valor no cliente', async (label, method) => {
    const { user, props } = setup();
    await fillRequired(user, label);
    await user.click(screen.getByRole('button', { name: 'Confirmar pago' }));
    expect(mocks.mutateAsync).toHaveBeenCalledExactlyOnceWith({
      cycleId: target.cycle_id, paymentDate: '2020-02-29', paymentMethod: method,
    });
    await waitFor(() => expect(props.onClose).toHaveBeenCalledTimes(1));
  });

  it.each(['', '9999-12-31', '2020-02-30'])('não confirma data inválida/futura: %s', async date => {
    const { user } = setup();
    await fillRequired(user, 'Pix', date);
    await user.click(screen.getByRole('button', { name: 'Confirmar pago' }));
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByText('Informe a data real do pagamento, válida e não futura.')).toBeInTheDocument();
  });

  it('mostra somente os sete meios canônicos, sem entrada de texto livre', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('combobox', { name: 'Meio de pagamento' }));
    expect(await screen.findAllByRole('option')).toHaveLength(7);
    expect(screen.queryByRole('textbox', { name: 'Meio de pagamento' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'TED' })).not.toBeInTheDocument();
  });

  it('aceita replay confirmado sem exigir status que o replay não retorna', async () => {
    mocks.mutateAsync.mockResolvedValue({ cycle_id: target.cycle_id, accounts_payable_id: target.accounts_payable_id, replayed: true });
    const { user, props } = setup();
    await fillRequired(user);
    await user.click(screen.getByRole('button', { name: 'Confirmar pago' }));
    await waitFor(() => expect(props.onClose).toHaveBeenCalledOnce());
  });
});

describe('Pagamento de ciclo — falha, espera e rascunho', () => {
  it.each([new Error('Pagamento recusado pelo servidor'), { message: 'Pagamento recusado pelo servidor' }])('mantém dados na falha e permite repetir a mesma intenção', async failure => {
    mocks.mutateAsync.mockRejectedValueOnce(failure).mockResolvedValueOnce(confirmed);
    const { user, props } = setup();
    await fillRequired(user, 'Transferência');
    await user.click(screen.getByRole('button', { name: 'Confirmar pago' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Pagamento recusado pelo servidor');
    expect(screen.getByLabelText('Data real do pagamento')).toHaveValue('2020-02-29');
    expect(screen.getByRole('combobox', { name: 'Meio de pagamento' })).toHaveTextContent('Transferência');
    expect(props.onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Confirmar pago' }));
    await waitFor(() => expect(props.onClose).toHaveBeenCalledOnce());
    expect(mocks.mutateAsync.mock.calls[1]).toEqual(mocks.mutateAsync.mock.calls[0]);
  });

  it.each([null, {}, { ...confirmed, cycle_id: 'outro-ciclo' }, { ...confirmed, accounts_payable_id: null }])('não fecha sem confirmação correspondente: %j', async response => {
    mocks.mutateAsync.mockResolvedValue(response);
    const { user, props } = setup();
    await fillRequired(user);
    await user.click(screen.getByRole('button', { name: 'Confirmar pago' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('O servidor não confirmou este ciclo como pago');
    expect(props.onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Data real do pagamento')).toHaveValue('2020-02-29');
  });

  it('impede duplo submit e fechamento enquanto aguarda a resposta, mesmo antes do hook rerenderizar', async () => {
    const pending = deferred();
    mocks.mutateAsync.mockReturnValue(pending.promise);
    const { user, props } = setup();
    await fillRequired(user);
    const form = screen.getByRole('form', { name: 'Confirmação de pagamento do ciclo' });
    act(() => { fireEvent.submit(form); fireEvent.submit(form); });
    expect(mocks.mutateAsync).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Confirmando…' })).toBeDisabled();
    expect(screen.getByLabelText('Data real do pagamento')).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Meio de pagamento' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Fechar diálogo' })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    fireEvent.pointerDown(document.body);
    expect(props.onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Aguarde antes de sair');
    await act(async () => { pending.resolve(confirmed); await pending.promise; });
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it('também bloqueia fechamento e submit quando o hook já está pendente', async () => {
    mocks.useMarkPaid.mockReturnValue(query(true));
    const { user, props } = setup();
    fireEvent.submit(screen.getByRole('form', { name: 'Confirmação de pagamento do ciclo' }));
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('cancelar fora do envio fecha; reabrir começa sem data ou meio herdados', async () => {
    const { user, props, rerender } = setup();
    await fillRequired(user, 'Boleto');
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(props.onClose).toHaveBeenCalledOnce();
    rerender(<MarkContractorCyclePaidDialog {...props} target={null} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    rerender(<MarkContractorCyclePaidDialog {...props} />);
    expect(screen.getByLabelText('Data real do pagamento')).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'Meio de pagamento' })).toHaveTextContent('Selecione o meio utilizado');
  });

  it('preserva rascunho em refetch do mesmo ciclo e limpa ao mudar de ciclo', async () => {
    const { user, props, rerender } = setup();
    await fillRequired(user, 'Cheque');
    rerender(<MarkContractorCyclePaidDialog {...props} target={{ ...target }} />);
    expect(screen.getByLabelText('Data real do pagamento')).toHaveValue('2020-02-29');
    rerender(<MarkContractorCyclePaidDialog {...props} target={{ ...target, cycle_id: 'outro-ciclo' }} />);
    expect(screen.getByLabelText('Data real do pagamento')).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'Meio de pagamento' })).toHaveTextContent('Selecione o meio utilizado');
  });

  it.each(['resolve', 'reject'])('resposta antiga %s não fecha nem contamina outro ciclo', async outcome => {
    const pending = deferred();
    mocks.mutateAsync.mockReturnValue(pending.promise);
    const { user, props, rerender } = setup();
    await fillRequired(user);
    fireEvent.submit(screen.getByRole('form', { name: 'Confirmação de pagamento do ciclo' }));
    rerender(<MarkContractorCyclePaidDialog {...props} target={{ ...target, cycle_id: 'outro-ciclo' }} />);
    await act(async () => {
      if (outcome === 'resolve') pending.resolve(confirmed);
      else pending.reject(new Error('Falha do ciclo antigo'));
      await pending.promise.catch(() => {});
    });
    expect(props.onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Data real do pagamento')).toHaveValue('');
  });

  it('não envia se refetch mostrar que o ciclo não está mais fechado', () => {
    const { props } = setup({ target: { ...target, status: 'paid' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Este ciclo não está mais fechado');
    fireEvent.submit(screen.getByRole('form', { name: 'Confirmação de pagamento do ciclo' }));
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
  });
});

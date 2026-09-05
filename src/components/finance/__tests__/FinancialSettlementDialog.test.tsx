import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FinancialSettlementDialog from '@/components/finance/FinancialSettlementDialog';
import type { SettlementTarget } from '@/lib/financialSettlement';

HTMLElement.prototype.hasPointerCapture ??= () => false;
HTMLElement.prototype.setPointerCapture ??= () => {};
HTMLElement.prototype.releasePointerCapture ??= () => {};
HTMLElement.prototype.scrollIntoView ??= () => {};

const mocks = vi.hoisted(() => ({ useBankAccounts: vi.fn(), refetch: vi.fn() }));
vi.mock('@/hooks/useFinanceAdvanced', () => ({ useBankAccounts: mocks.useBankAccounts }));

const bankId = '00000000-0000-4000-8000-000000000100';
const payable: SettlementTarget = { id: '00000000-0000-4000-8000-000000000001', kind: 'payable', description: 'Compra de napa', openAmount: 123.45 };
const receivable: SettlementTarget = { id: '00000000-0000-4000-8000-000000000002', kind: 'receivable', description: 'Venda de calçados', openAmount: 26.55 };
const accounts = [
  { id: bankId, name: 'Conta fábrica', bank_name: 'Banco de teste', active: true },
  { id: '00000000-0000-4000-8000-000000000101', name: 'Conta encerrada', bank_name: 'Banco antigo', active: false },
];
const bankQuery = (patch = {}) => ({ data: accounts, isPending: false, isError: false, isFetching: false, refetch: mocks.refetch, ...patch });

function setup(patch: Partial<React.ComponentProps<typeof FinancialSettlementDialog>> = {}) {
  const props = {
    targets: [payable], open: true, pending: false,
    onOpenChange: vi.fn(), onConfirm: vi.fn(async () => {}), ...patch,
  };
  const result = render(<FinancialSettlementDialog {...props} />);
  return { ...result, props, user: userEvent.setup() };
}

async function choose(user: ReturnType<typeof userEvent.setup>, name: string, option: string) {
  await user.click(screen.getByRole('combobox', { name }));
  await user.click(await screen.findByRole('option', { name: option }));
}

async function fillRequired(user: ReturnType<typeof userEvent.setup>, method = 'Pix') {
  fireEvent.change(screen.getByLabelText('Data real do movimento'), { target: { value: '2020-02-29' } });
  await choose(user, 'Forma do movimento', method);
}

describe('Registro financeiro — conferência antes da baixa', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useBankAccounts.mockReturnValue(bankQuery());
  });

  it('mostra o saldo, deixa data/forma vazias e distingue registro de transferência', () => {
    setup();
    expect(screen.getByLabelText(/Valor registrado/)).toHaveValue('123,45');
    expect(screen.getByLabelText('Data real do movimento')).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'Forma do movimento' })).toHaveTextContent('Selecione a forma');
    expect(screen.getByText(/não envia dinheiro nem executa transferências/)).toBeInTheDocument();
    expect(screen.getByText(/não atualiza o saldo de nenhuma conta bancária/)).toBeInTheDocument();
    expect(screen.getByLabelText('Resumo do lote')).toHaveTextContent('123,45');
  });

  it('não envia sem data e forma explícitas', async () => {
    const { user, props } = setup();
    await user.click(screen.getByRole('button', { name: 'Registrar movimento(s)' }));
    expect(screen.getByText('Informe uma data válida, não futura.')).toBeInTheDocument();
    expect(screen.getByText('Selecione a forma utilizada.')).toBeInTheDocument();
    expect(props.onConfirm).not.toHaveBeenCalled();
  });

  it('registra baixa parcial com centavos, data real, conta e referência', async () => {
    const { user, props } = setup();
    await fillRequired(user);
    await choose(user, 'Conta bancária', 'Conta fábrica · Banco de teste');
    fireEvent.change(screen.getByLabelText(/Valor registrado/), { target: { value: '20,35' } });
    fireEvent.change(screen.getByLabelText('Referência ou comprovante (opcional)'), { target: { value: '  Comprovante 007  ' } });
    fireEvent.change(screen.getByLabelText('Observações (opcional)'), { target: { value: '  Pagamento parcial  ' } });
    await user.click(screen.getByRole('button', { name: 'Registrar movimento(s)' }));
    expect(props.onConfirm).toHaveBeenCalledExactlyOnceWith([{
      kind: 'payable', account_id: payable.id, amount: 20.35, settled_on: '2020-02-29', method: 'pix',
      bank_account_id: bankId, reference: 'Comprovante 007', notes: 'Pagamento parcial',
    }]);
    await waitFor(() => expect(props.onOpenChange).toHaveBeenCalledExactlyOnceWith(false));
  });

  it('permite dinheiro sem conta e envia opcionais vazios como null', async () => {
    mocks.useBankAccounts.mockReturnValue(bankQuery({ data: [] }));
    const { user, props } = setup({ targets: [receivable] });
    await fillRequired(user, 'Dinheiro');
    expect(screen.getByText('Não há contas bancárias ativas cadastradas.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Registrar movimento(s)' }));
    expect(props.onConfirm).toHaveBeenCalledExactlyOnceWith([{
      kind: 'receivable', account_id: receivable.id, amount: 26.55, settled_on: '2020-02-29', method: 'dinheiro',
      bank_account_id: null, reference: null, notes: null,
    }]);
  });

  it('não inventa proibição de registrar Pix sem conta vinculada', async () => {
    const { user, props } = setup();
    await fillRequired(user);
    await user.click(screen.getByRole('button', { name: 'Registrar movimento(s)' }));
    expect(props.onConfirm).toHaveBeenCalledWith([expect.objectContaining({ method: 'pix', bank_account_id: null })]);
  });

  it('expõe somente contas ativas, além da opção sem conta', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('combobox', { name: 'Conta bancária' }));
    expect(await screen.findByRole('option', { name: 'Conta fábrica · Banco de teste' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Não informada' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Conta encerrada/ })).not.toBeInTheDocument();
  });

  it('mostra total do lote sem compensar recebimentos contra pagamentos', async () => {
    const { user, props } = setup({ targets: [payable, receivable] });
    const summary = screen.getByLabelText('Resumo do lote');
    expect(summary).toHaveTextContent('2 título(s) · 1 pagamento(s) · 1 recebimento(s)');
    expect(summary).toHaveTextContent('150,00');
    fireEvent.change(screen.getByLabelText(/Valor registrado.*Compra de napa/), { target: { value: '100.25' } });
    expect(summary).toHaveTextContent('126,80');
    await fillRequired(user, 'Transferência');
    await user.click(screen.getByRole('button', { name: 'Registrar movimento(s)' }));
    expect(props.onConfirm).toHaveBeenCalledWith([
      expect.objectContaining({ account_id: payable.id, amount: 100.25, method: 'transferencia' }),
      expect.objectContaining({ account_id: receivable.id, amount: 26.55, method: 'transferencia' }),
    ]);
  });

  it.each(['', '0', '-1', '0,001', '1.234,56', '1e2', 'NaN', 'Infinity', '123,46'])('bloqueia valor inválido ou acima do saldo: %s', async amount => {
    const { user, props } = setup();
    await fillRequired(user);
    fireEvent.change(screen.getByLabelText(/Valor registrado/), { target: { value: amount } });
    await user.click(screen.getByRole('button', { name: 'Registrar movimento(s)' }));
    expect(screen.getByText('Informe centavos exatos, acima de zero e até o saldo aberto.')).toBeInTheDocument();
    expect(screen.getByLabelText('Resumo do lote')).toHaveTextContent('Revise os valores');
    expect(props.onConfirm).not.toHaveBeenCalled();
  });

  it('não registra data futura', async () => {
    const { user, props } = setup();
    await fillRequired(user);
    fireEvent.change(screen.getByLabelText('Data real do movimento'), { target: { value: '9999-12-31' } });
    await user.click(screen.getByRole('button', { name: 'Registrar movimento(s)' }));
    expect(props.onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText('Informe uma data válida, não futura.')).toBeInTheDocument();
  });

  it('bloqueia o lote inteiro se uma linha está inválida', async () => {
    const { user, props } = setup({ targets: [payable, receivable] });
    await fillRequired(user);
    fireEvent.change(screen.getByLabelText(/Valor registrado.*Venda de calçados/), { target: { value: '26.56' } });
    await user.click(screen.getByRole('button', { name: 'Registrar movimento(s)' }));
    expect(props.onConfirm).not.toHaveBeenCalled();
  });
});

describe('Registro financeiro — consultas, sessão de edição e envio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useBankAccounts.mockReturnValue(bankQuery());
  });

  it('distingue carregamento de ausência de conta e impede envio', () => {
    mocks.useBankAccounts.mockReturnValue(bankQuery({ data: undefined, isPending: true }));
    const { props } = setup();
    expect(screen.getByRole('status')).toHaveTextContent('Carregando contas bancárias');
    expect(screen.queryByText('Não há contas bancárias ativas cadastradas.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Registrar movimento(s)' })).toBeDisabled();
    fireEvent.submit(screen.getByRole('form', { name: 'Registro de movimentos financeiros' }));
    expect(props.onConfirm).not.toHaveBeenCalled();
  });

  it('oculta cache bancário em erro e permite nova consulta sem enviar', async () => {
    mocks.useBankAccounts.mockReturnValue(bankQuery({ isError: true }));
    const { user, props } = setup();
    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível consultar as contas bancárias');
    expect(screen.queryByRole('combobox', { name: 'Conta bancária' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Conta fábrica/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Tentar contas novamente' }));
    expect(mocks.refetch).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Registrar movimento(s)' })).toBeDisabled();
    expect(props.onConfirm).not.toHaveBeenCalled();
  });

  it('revalida a conta selecionada se ela for desativada durante a edição', async () => {
    const { user, props, rerender } = setup();
    await fillRequired(user);
    await choose(user, 'Conta bancária', 'Conta fábrica · Banco de teste');
    mocks.useBankAccounts.mockReturnValue(bankQuery({ data: [{ ...accounts[0], active: false }] }));
    rerender(<FinancialSettlementDialog {...props} />);
    expect(screen.getByText(/A conta selecionada não está mais ativa/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Registrar movimento(s)' }));
    expect(props.onConfirm).not.toHaveBeenCalled();
    await choose(user, 'Conta bancária', 'Não informada');
    await user.click(screen.getByRole('button', { name: 'Registrar movimento(s)' }));
    expect(props.onConfirm).toHaveBeenCalledOnce();
  });

  it('preserva valores digitados em re-render com os mesmos títulos', async () => {
    const { user, props, rerender } = setup();
    await fillRequired(user, 'Boleto');
    fireEvent.change(screen.getByLabelText(/Valor registrado/), { target: { value: '40,12' } });
    rerender(<FinancialSettlementDialog {...props} targets={[{ ...payable }]} />);
    expect(screen.getByLabelText(/Valor registrado/)).toHaveValue('40,12');
    expect(screen.getByLabelText('Data real do movimento')).toHaveValue('2020-02-29');
    expect(screen.getByRole('combobox', { name: 'Forma do movimento' })).toHaveTextContent('Boleto');
  });

  it('não substitui silenciosamente o saldo quando o título muda', () => {
    const { props, rerender } = setup();
    fireEvent.change(screen.getByLabelText(/Valor registrado/), { target: { value: '40,12' } });
    rerender(<FinancialSettlementDialog {...props} targets={[{ ...payable, openAmount: 30 }]} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Os títulos ou saldos mudaram');
    expect(screen.getByLabelText(/Valor registrado/)).toHaveValue('40,12');
    expect(screen.getByRole('button', { name: 'Registrar movimento(s)' })).toBeDisabled();
  });

  it('inicia uma nova edição limpa somente depois de fechar e reabrir', async () => {
    const { user, props, rerender } = setup();
    await fillRequired(user);
    fireEvent.change(screen.getByLabelText(/Valor registrado/), { target: { value: '40,12' } });
    rerender(<FinancialSettlementDialog {...props} open={false} />);
    rerender(<FinancialSettlementDialog {...props} open targets={[{ ...payable, openAmount: 30 }]} />);
    expect(screen.getByLabelText(/Valor registrado/)).toHaveValue('30,00');
    expect(screen.getByLabelText('Data real do movimento')).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'Forma do movimento' })).toHaveTextContent('Selecione a forma');
  });

  it('preserva todos os campos após falha e não fecha o diálogo', async () => {
    const confirm = vi.fn().mockRejectedValueOnce(new Error('Saldo alterado no banco.')).mockResolvedValue(undefined);
    const { user, props } = setup({ onConfirm: confirm });
    await fillRequired(user, 'Cheque');
    fireEvent.change(screen.getByLabelText(/Valor registrado/), { target: { value: '50,01' } });
    fireEvent.change(screen.getByLabelText('Observações (opcional)'), { target: { value: 'Conferir comprovante' } });
    await user.click(screen.getByRole('button', { name: 'Registrar movimento(s)' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Saldo alterado no banco.');
    expect(screen.getByLabelText(/Valor registrado/)).toHaveValue('50,01');
    expect(screen.getByLabelText('Observações (opcional)')).toHaveValue('Conferir comprovante');
    expect(screen.getByLabelText('Data real do movimento')).toHaveValue('2020-02-29');
    expect(screen.getByRole('combobox', { name: 'Forma do movimento' })).toHaveTextContent('Cheque');
    expect(props.onOpenChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Registrar movimento(s)' }));
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(confirm.mock.calls[0][0]).toEqual(confirm.mock.calls[1][0]);
  });

  it('impede duplo envio, alteração e fechamento enquanto aguarda resposta', async () => {
    let resolve!: () => void;
    const confirm = vi.fn(() => new Promise<void>(done => { resolve = done; }));
    const { user, props } = setup({ onConfirm: confirm });
    await fillRequired(user);
    const form = screen.getByRole('form', { name: 'Registro de movimentos financeiros' });
    act(() => { fireEvent.submit(form); fireEvent.submit(form); });
    expect(confirm).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Registrando…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
    expect(screen.getByLabelText(/Valor registrado/)).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Fechar diálogo' })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(props.onOpenChange).not.toHaveBeenCalled();
    await act(async () => { resolve(); });
    expect(props.onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('respeita pending externo mesmo antes do primeiro clique', async () => {
    const { user, props } = setup({ pending: true });
    expect(screen.getByRole('button', { name: 'Registrando…' })).toBeDisabled();
    await user.keyboard('{Escape}');
    fireEvent.submit(screen.getByRole('form', { name: 'Registro de movimentos financeiros' }));
    expect(props.onConfirm).not.toHaveBeenCalled();
    expect(props.onOpenChange).not.toHaveBeenCalled();
  });

  it.each([
    ['nenhum título', []],
    ['título repetido', [payable, payable]],
    ['saldo zero', [{ ...payable, openAmount: 0 }]],
    ['saldo fracionário', [{ ...payable, openAmount: 1.005 }]],
    ['mais de 200 títulos', Array.from({ length: 201 }, (_, index) => ({ ...payable, id: `title-${index}` }))],
  ])('não envia seleção inválida: %s', (_, targets) => {
    const { props } = setup({ targets });
    expect(screen.getByRole('alert')).toHaveTextContent('Selecione de 1 a 200 títulos distintos');
    expect(screen.getByRole('button', { name: 'Registrar movimento(s)' })).toBeDisabled();
    fireEvent.submit(screen.getByRole('form', { name: 'Registro de movimentos financeiros' }));
    expect(props.onConfirm).not.toHaveBeenCalled();
  });

  it('permite cancelar antes de registrar e não consulta contas enquanto fechado', async () => {
    const { user, props, rerender } = setup({ open: false });
    expect(mocks.useBankAccounts).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    rerender(<FinancialSettlementDialog {...props} open />);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' }));
    expect(props.onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
    expect(props.onConfirm).not.toHaveBeenCalled();
  });
});

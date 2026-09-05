import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FinancialSettlementHistoryDialog from '@/components/finance/FinancialSettlementHistoryDialog';
import type { FinancialSettlementEvent, FinancialSettlementHistory } from '@/hooks/useFinancialSettlements';

const mocks = vi.hoisted(() => ({ useHistory: vi.fn(), refetch: vi.fn() }));
vi.mock('@/hooks/useFinancialSettlements', () => ({ useFinancialSettlementHistory: mocks.useHistory }));

const target = { id: '00000000-0000-4000-8000-000000000001', kind: 'payable' as const, description: 'Compra de napa' };
const original: FinancialSettlementEvent = {
  id: '00000000-0000-4000-8000-000000000010', event_type: 'settlement', amount: 125.35,
  effective_on: '2020-02-29', method: 'pix', bank_account_id: null, reference: 'Comprovante 007',
  notes: 'Pagamento parcial', source_type: 'manual', reverses_event_id: null,
  actor_id: '00000000-0000-4000-8000-000000000999', created_at: '2020-02-29T12:00:00Z',
};
const reversal: FinancialSettlementEvent = {
  ...original, id: '00000000-0000-4000-8000-000000000011', event_type: 'reversal',
  reverses_event_id: original.id, effective_on: '2020-03-01', notes: 'Registro incorreto, comprovante conferido.',
};
function history(events = [original], opening = 0): FinancialSettlementHistory {
  return { head: { opening_amount: opening, opening_payment_date: null, opening_history_warning: null }, events };
}
const query = (patch = {}) => ({ data: history(), isPending: false, isError: false, isFetching: false, error: null, refetch: mocks.refetch, ...patch });

function setup(patch: Partial<React.ComponentProps<typeof FinancialSettlementHistoryDialog>> = {}) {
  const props = { target, onOpenChange: vi.fn(), canEdit: true, pending: false, onReverse: vi.fn(async () => {}), ...patch };
  const result = render(<FinancialSettlementHistoryDialog {...props} />);
  return { ...result, props, user: userEvent.setup() };
}

async function select(user: ReturnType<typeof userEvent.setup>, date = '2020-03-01', reason = 'Registro incorreto, comprovante conferido.') {
  await user.click(screen.getByRole('button', { name: 'Estornar este movimento' }));
  if (date) fireEvent.change(screen.getByLabelText('Data real do estorno'), { target: { value: date } });
  if (reason) fireEvent.change(screen.getByLabelText('Motivo obrigatório'), { target: { value: reason } });
}

describe('Histórico financeiro — evidência e origem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.refetch.mockResolvedValue({ isError: false, data: history() });
    mocks.useHistory.mockReturnValue(query());
  });

  it('mostra cada evento com data, valor, origem, referência e identificação', () => {
    setup();
    expect(mocks.useHistory).toHaveBeenCalledWith('payable', target.id);
    const events = screen.getByRole('list', { name: 'Movimentos financeiros registrados' });
    expect(events).toHaveTextContent('125,35');
    expect(events).toHaveTextContent('29/02/2020');
    expect(events).toHaveTextContent('Forma: Pix · Origem: Manual');
    expect(events).toHaveTextContent('Comprovante 007');
    expect(events).toHaveTextContent('Pagamento parcial');
    expect(events).toHaveTextContent(original.id);
    expect(screen.getByText(/não apaga o original/)).toBeInTheDocument();
  });

  it.each([
    ['ofx', 'Extrato OFX'], ['contractor_cycle', 'Ciclo de terceirização'], ['factoring', 'Antecipação'], ['system', 'Sistema'],
  ])('não oferece estorno manual para origem %s', (source_type, label) => {
    mocks.useHistory.mockReturnValue(query({ data: history([{ ...original, source_type }]) }));
    setup();
    expect(screen.getByText(`Forma: Pix · Origem: ${label}`)).toBeInTheDocument();
    expect(screen.getByText('Alterações deste movimento devem ser feitas no fluxo de origem.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Estornar este movimento' })).not.toBeInTheDocument();
  });

  it('não transforma uma origem desconhecida em Manual nem resolve chaves do protótipo', () => {
    mocks.useHistory.mockReturnValue(query({ data: history([{ ...original, source_type: '__proto__', method: 'constructor' }]) }));
    setup();
    expect(screen.getByText('Forma: constructor · Origem: __proto__')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Estornar este movimento' })).not.toBeInTheDocument();
  });

  it('mostra original estornado e evento reversor, sem apagar ou oferecer nova reversão', () => {
    mocks.useHistory.mockReturnValue(query({ data: history([original, reversal]) }));
    setup();
    const events = within(screen.getByRole('list', { name: 'Movimentos financeiros registrados' })).getAllByRole('listitem');
    expect(events).toHaveLength(2);
    expect(events[0]).toHaveTextContent('Estornado');
    expect(events[1]).toHaveTextContent('Estorno');
    expect(events[1]).toHaveTextContent(`Estorna o registro: ${original.id}`);
    expect(events[1]).toHaveTextContent(reversal.notes!);
    expect(screen.queryByRole('button', { name: 'Estornar este movimento' })).not.toBeInTheDocument();
  });

  it('preserva o acumulado legado como abertura, sem fabricar evento ou permitir estorno', () => {
    mocks.useHistory.mockReturnValue(query({ data: {
      head: { opening_amount: 900.12, opening_payment_date: '2019-11-07', opening_history_warning: null }, events: [],
    } }));
    setup();
    const legacy = screen.getByLabelText('Saldo anterior preservado');
    expect(legacy).toHaveTextContent('Saldo liquidado anterior:');
    expect(legacy).toHaveTextContent('900,12');
    expect(legacy).toHaveTextContent('07/11/2019');
    expect(legacy).toHaveTextContent('Não é um pagamento novo e não pode ser estornado por esta tela.');
    expect(screen.getByText('Nenhum movimento individual registrado neste histórico.')).toBeInTheDocument();
    expect(within(legacy).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Estornar este movimento' })).not.toBeInTheDocument();
  });

  it('preserva aviso específico de abertura sem adivinhar sua data', () => {
    const data = history([], 10);
    data.head.opening_history_warning = 'Registro anterior sem comprovação individual.';
    mocks.useHistory.mockReturnValue(query({ data }));
    setup();
    expect(screen.getByLabelText('Saldo anterior preservado')).toHaveTextContent(data.head.opening_history_warning);
    expect(screen.getByText('Data antiga informada: Não informada')).toBeInTheDocument();
  });

  it('separa vazio real, carregamento e falha com dados em cache', () => {
    mocks.useHistory.mockReturnValue(query({ data: undefined, isPending: true }));
    const { props, rerender } = setup();
    expect(screen.getByRole('status')).toHaveTextContent('Carregando histórico');
    expect(screen.queryByText(/Nenhum movimento individual/)).not.toBeInTheDocument();
    mocks.useHistory.mockReturnValue(query({ data: history([]) }));
    rerender(<FinancialSettlementHistoryDialog {...props} />);
    expect(screen.getByText('Nenhum movimento individual registrado neste histórico.')).toBeInTheDocument();
    mocks.useHistory.mockReturnValue(query({ data: history(), isError: true, error: new Error('Consulta indisponível.') }));
    rerender(<FinancialSettlementHistoryDialog {...props} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Consulta indisponível.');
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.queryByText(/Nenhum movimento individual/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Estornar este movimento' })).not.toBeInTheDocument();
  });

  it.each([
    ['resposta ausente', undefined],
    ['abertura ausente', { events: [] }],
    ['abertura NaN', history([], NaN)],
    ['abertura negativa', history([], -1)],
    ['abertura null', history([], null as unknown as number)],
    ['valor inválido', history([{ ...original, amount: NaN }])],
    ['fração de centavo', history([{ ...original, amount: 1.005 }])],
    ['data inválida', history([{ ...original, effective_on: '2020-02-30' }])],
    ['evento duplicado', history([original, original])],
    ['reversão sem original', history([reversal])],
    ['reversão divergente', history([original, { ...reversal, amount: 10 }])],
    ['nota não textual', history([{ ...original, notes: {} as string }])],
  ])('não apresenta %s como histórico completo', (_, data) => {
    mocks.useHistory.mockReturnValue(query({ data }));
    setup();
    expect(screen.getByRole('alert')).toHaveTextContent('O histórico não foi retornado por completo.');
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Estornar este movimento' })).not.toBeInTheDocument();
  });

  it('permite refazer a consulta sem executar movimento financeiro', async () => {
    mocks.useHistory.mockReturnValue(query({ isError: true, error: new Error('Sem conexão.') }));
    const { user, props, rerender } = setup();
    await user.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(mocks.refetch).toHaveBeenCalledOnce();
    expect(props.onReverse).not.toHaveBeenCalled();
    mocks.useHistory.mockReturnValue(query());
    rerender(<FinancialSettlementHistoryDialog {...props} />);
    await user.click(screen.getByRole('button', { name: 'Atualizar histórico' }));
    expect(mocks.refetch).toHaveBeenCalledTimes(2);
  });

  it('expõe falha do próprio refetch sem manter ações apoiadas no cache', async () => {
    mocks.refetch.mockRejectedValueOnce(new Error('Falha simulada.'));
    const { user, props } = setup();
    await user.click(screen.getByRole('button', { name: 'Atualizar histórico' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível atualizar o histórico.');
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(props.onReverse).not.toHaveBeenCalled();
  });
});

describe('Histórico financeiro — validação e concorrência do estorno', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.refetch.mockResolvedValue({ isError: false, data: history() });
    mocks.useHistory.mockReturnValue(query());
  });

  it('abre a confirmação sem presumir hoje, exige motivo e avisa que não devolve dinheiro', async () => {
    const { user, props } = setup();
    await select(user, '', '');
    expect(screen.getByLabelText('Data real do estorno')).toHaveValue('');
    expect(screen.getByLabelText('Motivo obrigatório')).toHaveValue('');
    expect(screen.getByText(/não devolve dinheiro pela conta bancária/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirmar estorno' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Informe a data real do movimento.');
    expect(props.onReverse).not.toHaveBeenCalled();
  });

  it.each([
    ['2020-02-28', 'Motivo', 'não pode anteceder'],
    ['9999-12-31', 'Motivo', 'não pode estar no futuro'],
    ['2020-03-01', '   ', 'Informe o motivo'],
    ['2020-03-01', 'x'.repeat(4001), 'no máximo 4.000'],
  ])('rejeita data/motivo inválidos no cenário %s', async (date, reason, error) => {
    const { user, props } = setup();
    await select(user, date, reason);
    await user.click(screen.getByRole('button', { name: 'Confirmar estorno' }));
    expect(screen.getByRole('alert')).toHaveTextContent(error);
    expect(props.onReverse).not.toHaveBeenCalled();
  });

  it('aceita estorno na mesma data original e envia identificação/data/motivo, não um acumulado', async () => {
    const { user, props } = setup();
    await select(user, original.effective_on, '  Comprovante conferido.  ');
    await user.click(screen.getByRole('button', { name: 'Confirmar estorno' }));
    expect(props.onReverse).toHaveBeenCalledExactlyOnceWith([{
      event_id: original.id, reversed_on: original.effective_on, reason: 'Comprovante conferido.',
    }]);
    expect(props.onOpenChange).not.toHaveBeenCalled();
    expect(mocks.refetch).toHaveBeenCalledOnce();
    expect(screen.queryByLabelText('Conferência do estorno')).not.toBeInTheDocument();
    expect(screen.getByText('Estornado')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Estornar este movimento' })).not.toBeInTheDocument();
  });

  it('não ressuscita o botão se o refetch após sucesso ainda trouxer o original antigo', async () => {
    const { user, props, rerender } = setup();
    await select(user);
    await user.click(screen.getByRole('button', { name: 'Confirmar estorno' }));
    mocks.useHistory.mockReturnValue(query({ data: history([{ ...original }]) }));
    rerender(<FinancialSettlementHistoryDialog {...props} />);
    expect(screen.queryByRole('button', { name: 'Estornar este movimento' })).not.toBeInTheDocument();
    expect(screen.getByText('Estornado')).toBeInTheDocument();
  });

  it('falha de atualização após estorno não é tratada como autorização para estornar de novo', async () => {
    mocks.refetch.mockRejectedValueOnce(new Error('Sem rede depois da confirmação.'));
    const { user, props, rerender } = setup();
    await select(user);
    await user.click(screen.getByRole('button', { name: 'Confirmar estorno' }));
    expect(props.onReverse).toHaveBeenCalledOnce();
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível atualizar');
    await user.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    rerender(<FinancialSettlementHistoryDialog {...props} />);
    expect(screen.getByText('Estornado')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Estornar este movimento' })).not.toBeInTheDocument();
  });

  it('consulta pausada não prende a janela depois do estorno confirmado', async () => {
    let finishRefresh!: () => void;
    mocks.refetch.mockImplementationOnce(() => new Promise<void>(done => { finishRefresh = done; }));
    const { user, props } = setup();
    await select(user);
    await user.click(screen.getByRole('button', { name: 'Confirmar estorno' }));
    expect(props.onReverse).toHaveBeenCalledOnce();
    expect(screen.getByText('Estornado')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fechar histórico' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Fechar histórico' }));
    expect(props.onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
    await act(async () => { finishRefresh(); });
  });

  it('falha tardia de refetch de outro título não esconde o histórico atual', async () => {
    let rejectRefresh!: (reason: Error) => void;
    mocks.refetch.mockImplementationOnce(() => new Promise<void>((_, reject) => { rejectRefresh = reject; }));
    const { user, props, rerender } = setup();
    await user.click(screen.getByRole('button', { name: 'Atualizar histórico' }));
    rerender(<FinancialSettlementHistoryDialog {...props} target={{ ...target, id: 'titulo-diferente' }} />);
    await act(async () => { rejectRefresh(new Error('Falha da consulta anterior.')); });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Movimentos financeiros registrados' })).toBeInTheDocument();
  });

  it('preserva campos após recusa do comando e repete exatamente a intenção corrigível', async () => {
    const reverse = vi.fn().mockRejectedValueOnce(new Error('Saldo em conferência.')).mockResolvedValue(undefined);
    const { user, props } = setup({ onReverse: reverse });
    await select(user, '2020-03-01', 'Conferir baixa anterior.');
    await user.click(screen.getByRole('button', { name: 'Confirmar estorno' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Saldo em conferência.');
    expect(screen.getByLabelText('Data real do estorno')).toHaveValue('2020-03-01');
    expect(screen.getByLabelText('Motivo obrigatório')).toHaveValue('Conferir baixa anterior.');
    expect(props.onOpenChange).not.toHaveBeenCalled();
    expect(mocks.refetch).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Confirmar estorno' }));
    expect(reverse).toHaveBeenCalledTimes(2);
    expect(reverse.mock.calls[0][0]).toEqual(reverse.mock.calls[1][0]);
  });

  it.each([
    ['foi estornado', [original, reversal]],
    ['mudou para OFX', [{ ...original, source_type: 'ofx' }]],
    ['saiu do histórico', []],
    ['mudou de valor', [{ ...original, amount: 90 }]],
    ['mudou de data', [{ ...original, effective_on: '2020-03-02' }]],
  ])('bloqueia a seleção antiga quando o movimento %s', async (_, events) => {
    const { user, props, rerender } = setup();
    await select(user);
    mocks.useHistory.mockReturnValue(query({ data: history(events) }));
    rerender(<FinancialSettlementHistoryDialog {...props} />);
    expect(screen.getByRole('alert')).toHaveTextContent('O movimento selecionado mudou ou já foi estornado.');
    expect(screen.getByRole('button', { name: 'Confirmar estorno' })).toBeDisabled();
    expect(screen.getByLabelText('Motivo obrigatório')).toHaveValue('Registro incorreto, comprovante conferido.');
    expect(props.onReverse).not.toHaveBeenCalled();
  });

  it('bloqueia confirmação durante refetch, preservando o rascunho', async () => {
    const { user, props, rerender } = setup();
    await select(user);
    mocks.useHistory.mockReturnValue(query({ isFetching: true }));
    rerender(<FinancialSettlementHistoryDialog {...props} />);
    expect(screen.getByRole('status')).toHaveTextContent('Atualizando histórico');
    expect(screen.getByRole('button', { name: 'Confirmar estorno' })).toBeDisabled();
    expect(screen.getByLabelText('Motivo obrigatório')).toHaveValue('Registro incorreto, comprovante conferido.');
    expect(props.onReverse).not.toHaveBeenCalled();
  });

  it('oculta o formulário numa falha de consulta, mas o recupera preenchido após retry', async () => {
    const { user, props, rerender } = setup();
    await select(user);
    mocks.useHistory.mockReturnValue(query({ isError: true, error: new Error('Consulta falhou.') }));
    rerender(<FinancialSettlementHistoryDialog {...props} />);
    expect(screen.queryByLabelText('Motivo obrigatório')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirmar estorno' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    mocks.useHistory.mockReturnValue(query());
    rerender(<FinancialSettlementHistoryDialog {...props} />);
    expect(screen.getByLabelText('Motivo obrigatório')).toHaveValue('Registro incorreto, comprovante conferido.');
    expect(props.onReverse).not.toHaveBeenCalled();
  });

  it('respeita ausência e perda da permissão de edição sem esconder o histórico', async () => {
    const { user, props, rerender } = setup({ canEdit: false });
    expect(screen.getByRole('list')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Estornar este movimento' })).not.toBeInTheDocument();
    rerender(<FinancialSettlementHistoryDialog {...props} canEdit />);
    await select(user);
    rerender(<FinancialSettlementHistoryDialog {...props} canEdit={false} />);
    expect(screen.getByRole('button', { name: 'Confirmar estorno' })).toBeDisabled();
    expect(props.onReverse).not.toHaveBeenCalled();
  });

  it('impede duplo clique e fechamento até terminar a operação', async () => {
    let resolve!: () => void;
    const reverse = vi.fn(() => new Promise<void>(done => { resolve = done; }));
    const { user, props } = setup({ onReverse: reverse });
    await select(user);
    const button = screen.getByRole('button', { name: 'Confirmar estorno' });
    act(() => { fireEvent.click(button); fireEvent.click(button); });
    expect(reverse).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Registrando estorno…' })).toBeDisabled();
    expect(screen.getByLabelText('Motivo obrigatório')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Fechar histórico' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Fechar diálogo' })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(props.onOpenChange).not.toHaveBeenCalled();
    await act(async () => { resolve(); });
    expect(screen.getByText('Estornado')).toBeInTheDocument();
    expect(props.onOpenChange).not.toHaveBeenCalled();
  });

  it('respeita pending externo e só permite fechar quando liberado', async () => {
    const { user, props, rerender } = setup({ pending: true });
    expect(screen.getByRole('button', { name: 'Estornar este movimento' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Fechar histórico' })).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(props.onOpenChange).not.toHaveBeenCalled();
    rerender(<FinancialSettlementHistoryDialog {...props} pending={false} />);
    await user.click(screen.getByRole('button', { name: 'Fechar histórico' }));
    expect(props.onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('limpa o rascunho ao trocar de título ou fechar, sem alterar o histórico', async () => {
    const { user, props, rerender } = setup();
    await select(user);
    rerender(<FinancialSettlementHistoryDialog {...props} target={{ ...target, id: 'outro-titulo', kind: 'receivable' }} />);
    expect(screen.queryByLabelText('Conferência do estorno')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Histórico de recebimentos' })).toBeInTheDocument();
    expect(props.onReverse).not.toHaveBeenCalled();
    rerender(<FinancialSettlementHistoryDialog {...props} target={null} />);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

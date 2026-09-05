import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BankReconciliationTab from '@/components/finance/BankReconciliationTab';
import type { PersistedBankStatementLine } from '@/lib/bankReconciliation';

HTMLElement.prototype.hasPointerCapture ??= () => false;
HTMLElement.prototype.setPointerCapture ??= () => {};
HTMLElement.prototype.releasePointerCapture ??= () => {};
HTMLElement.prototype.scrollIntoView ??= () => {};

const mocks = vi.hoisted(() => ({
  sessions: vi.fn(), session: vi.fn(), items: vi.fn(), banks: vi.fn(),
  importOfx: vi.fn(), match: vi.fn(), unmatch: vi.fn(),
  payables: vi.fn(), receivables: vi.fn(), can: vi.fn(), readOfx: vi.fn(),
  importMutate: vi.fn(), matchMutate: vi.fn(), unmatchMutate: vi.fn(), refetch: vi.fn(),
}));

vi.mock('@/hooks/useBankReconciliation', () => ({
  useBankReconciliationSessions: mocks.sessions,
  useBankReconciliationSession: mocks.session,
  useBankReconciliationItems: mocks.items,
  useReconciliationBankAccounts: mocks.banks,
  useImportOfxStatement: mocks.importOfx,
  useMatchBankReconciliationItems: mocks.match,
  useUnmatchBankReconciliationItems: mocks.unmatch,
}));
vi.mock('@/hooks/useFinance', () => ({
  useAccountsPayable: mocks.payables,
  useAccountsReceivable: mocks.receivables,
}));
vi.mock('@/hooks/useAccessControl', () => ({ useCan: mocks.can }));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: '99999999-9999-4999-8999-999999999999' }, loading: false }),
}));
vi.mock('@/lib/ofxFileImport', () => ({ readOfxFile: mocks.readOfx }));

const reconciliationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const itemId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const payableId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const eventId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const baseItem: PersistedBankStatementLine = {
  id: itemId,
  reconciliation_id: reconciliationId,
  bank_account_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  movement_date: '2026-09-01',
  movement_type: 'debito',
  amount: 100,
  description: 'Fornecedor Alfa boleto',
  fit_id: 'FIT-001',
  transaction_type: 'DEBIT',
  transaction_name: 'Fornecedor Alfa',
  memo: 'boleto',
  status: 'nao_conciliado',
  matched_to_type: null,
  matched_to_id: null,
  settlement_event_id: null,
  revision: 0,
};

const session = {
  id: reconciliationId,
  bank_account_id: baseItem.bank_account_id,
  reconciliation_date: '2026-09-01', imported_at: '2026-09-01T12:00:00Z', imported_by: payableId,
  total_credits: 0, total_debits: 100, matched_count: 0, unmatched_count: 1, transaction_count: 1,
  pending_count: 0, duplicate_count: 0, status: 'em_andamento', account_kind: 'bank', institution_id: '',
  bank_id: '001', branch_id: '0001', account_number: '123', account_type: 'CHECKING', currency: 'BRL',
  ledger_balance: 500, ledger_balance_date: '2026-09-01', bank_accounts: { id: baseItem.bank_account_id, name: 'Conta teste', bank_name: 'Banco', agency: '0001', account_number: '123' },
};

function query(data: unknown, patch: Record<string, unknown> = {}) {
  return { data, isPending: false, isFetching: false, isError: false, error: null, refetch: mocks.refetch, ...patch };
}

function mutation(fn: ReturnType<typeof vi.fn>) {
  return { mutateAsync: fn, isPending: false };
}

function setup(item: PersistedBankStatementLine = baseItem) {
  mocks.items.mockReturnValue(query({ rows: [item], count: 1, page: 1, pageSize: 100, totalPages: 1 }));
  return render(<MemoryRouter initialEntries={[`/financeiro?tab=conciliacao&reconciliation=${reconciliationId}`]}><BankReconciliationTab /></MemoryRouter>);
}

async function openManualTitleSearch() {
  mocks.payables.mockReturnValue(query([
    {
      id: payableId, description: 'Compra de ínsumo', due_date: '2026-09-02', amount: 100,
      amount_paid: 0, status: 'pending', suppliers: { name: 'Fornecedor Álfá' },
    },
    {
      id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', description: 'Frete', due_date: '2026-09-02', amount: 100,
      amount_paid: 0, status: 'pending', suppliers: { name: 'Fornecedor Álfá' },
    },
  ]));
  const user = userEvent.setup();
  setup();
  await user.click(screen.getByRole('button', { name: 'Escolher título' }));
  return { user, dialog: within(screen.getByRole('dialog', { name: 'Escolher título para a linha OFX' })) };
}

describe('Conciliação OFX persistida', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.can.mockReturnValue({ canEdit: true, isAdmin: true, roles: ['admin'], loading: false });
    mocks.sessions.mockReturnValue(query([session]));
    mocks.session.mockReturnValue(query(session));
    mocks.banks.mockReturnValue(query([{ ...session.bank_accounts, account_type: 'corrente', active: true }]));
    mocks.payables.mockReturnValue(query([{
      id: payableId, description: 'Compra de insumo', due_date: '2026-09-02', amount: 100,
      amount_paid: 0, status: 'pending', suppliers: { name: 'Fornecedor Alfa' },
    }]));
    mocks.receivables.mockReturnValue(query([]));
    mocks.importMutate.mockResolvedValue({ reconciliation_id: reconciliationId, reused: false });
    mocks.matchMutate.mockResolvedValue({ ok: true });
    mocks.unmatchMutate.mockResolvedValue({ ok: true });
    mocks.importOfx.mockReturnValue(mutation(mocks.importMutate));
    mocks.match.mockReturnValue(mutation(mocks.matchMutate));
    mocks.unmatch.mockReturnValue(mutation(mocks.unmatchMutate));
  });

  it('renderiza o match persistido após reload e desfaz via item/revisão, sem event_id do cliente', async () => {
    const user = userEvent.setup();
    setup({
      ...baseItem, status: 'conciliado', matched_to_type: 'payable', matched_to_id: payableId,
      settlement_event_id: eventId, revision: 1,
    });
    expect(screen.getByText('Conciliado')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Desfazer' }));
    fireEvent.change(screen.getByLabelText('Motivo obrigatório'), { target: { value: 'Vínculo incorreto' } });
    await user.click(screen.getByRole('button', { name: 'Estornar e liberar linha' }));
    await waitFor(() => expect(mocks.unmatchMutate).toHaveBeenCalledOnce());
    const payload = mocks.unmatchMutate.mock.calls[0][0];
    expect(payload).toMatchObject({ reconciliationId, entries: [{ item_id: itemId, expected_revision: 1, reason: 'Vínculo incorreto' }] });
    expect(JSON.stringify(payload)).not.toContain(eventId);
  });

  it('envia auto-match em uma única chamada atômica sem valor/data/banco/FITID/origem', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: /Conciliar 1 de alta confiança/ }));
    await user.click(screen.getByRole('button', { name: 'Confirmar lote' }));
    await waitFor(() => expect(mocks.matchMutate).toHaveBeenCalledOnce());
    const payload = mocks.matchMutate.mock.calls[0][0];
    expect(payload).toEqual({
      reconciliationId,
      entries: [{ item_id: itemId, expected_revision: 0, kind: 'payable', account_id: payableId }],
    });
    expect(JSON.stringify(payload)).not.toMatch(/amount|movement_date|bank_account|fit_id|source|event_id/);
  });

  it('não renderiza cache antigo nem oferece match quando a consulta de itens falha', () => {
    mocks.items.mockReturnValue(query({ rows: [baseItem], count: 1, page: 1, pageSize: 100, totalPages: 1 }, {
      isError: true, error: new Error('falha de rede'),
    }));
    render(<MemoryRouter initialEntries={[`/financeiro?reconciliation=${reconciliationId}`]}><BankReconciliationTab /></MemoryRouter>);
    expect(screen.getByRole('alert')).toHaveTextContent('falha de rede');
    expect(screen.queryByText('Conciliado')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Desfazer' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /alta confiança/ })).not.toBeInTheDocument();
    expect(mocks.matchMutate).not.toHaveBeenCalled();
  });

  it('remove proposta memorizada quando o mesmo cache passa ao estado de erro', () => {
    const cached = { rows: [baseItem], count: 1, page: 1, pageSize: 100, totalPages: 1 };
    mocks.items.mockReturnValue(query(cached));
    const rendered = render(<MemoryRouter initialEntries={[`/financeiro?reconciliation=${reconciliationId}`]}><BankReconciliationTab /></MemoryRouter>);
    expect(screen.getByRole('button', { name: /Conciliar 1 de alta confiança/ })).toBeInTheDocument();
    mocks.items.mockReturnValue(query(cached, { isError: true, error: new Error('cache stale') }));
    rendered.rerender(<MemoryRouter initialEntries={[`/financeiro?reconciliation=${reconciliationId}`]}><BankReconciliationTab /></MemoryRouter>);
    expect(screen.queryByRole('button', { name: /alta confiança/ })).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('cache stale');
  });

  it('congela a proposta exibida e bloqueia confirmação se o candidato mudar', async () => {
    const user = userEvent.setup();
    const rendered = setup();
    await user.click(screen.getByRole('button', { name: /Conciliar 1 de alta confiança/ }));
    const otherPayableId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    mocks.payables.mockReturnValue(query([{
      id: otherPayableId, description: 'Compra de insumo', due_date: '2026-09-02', amount: 100,
      amount_paid: 0, status: 'pending', suppliers: { name: 'Fornecedor Alfa' },
    }]));
    rendered.rerender(<MemoryRouter initialEntries={[`/financeiro?tab=conciliacao&reconciliation=${reconciliationId}`]}><BankReconciliationTab /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: 'Confirmar lote' }));
    expect(mocks.matchMutate).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Confirmar lote' })).not.toBeInTheDocument();
  });

  it('permite escolha humana de título válido que não virou sugestão automática', async () => {
    const user = userEvent.setup();
    setup({
      ...baseItem,
      amount: 40,
      movement_date: '2026-06-01',
      description: 'sem pista textual',
      transaction_name: '',
      memo: '',
    });
    expect(screen.queryByRole('button', { name: /alta confiança/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Escolher título' }));
    await user.click(screen.getByRole('button', { name: /Vincular AP Fornecedor Alfa/ }));
    await waitFor(() => expect(mocks.matchMutate).toHaveBeenCalledWith({
      reconciliationId,
      entries: [{ item_id: itemId, expected_revision: 0, kind: 'payable', account_id: payableId }],
    }));
  });

  it('lê o arquivo por arrayBuffer/parser dedicado e troca a prévia só após validação', async () => {
    const statement = {
      account: { kind: 'bank', institutionId: '', bankId: '001', branchId: '0001', accountId: '123', accountType: 'CHECKING', currency: 'BRL' },
      transactions: [{ fitId: 'FIT-9', postedDate: '2026-09-01', postedAtRaw: '20260901', amountCents: 10000, type: 'CREDIT', name: 'Cliente', memo: '', checkNumber: '', referenceNumber: '' }],
      balance: { amountCents: 50000, asOfDate: '2026-09-01', asOfRaw: '20260901' }, pendingCount: 2, duplicateCount: 1,
    };
    mocks.readOfx.mockResolvedValue([statement]);
    setup();
    const file = new File(['OFX'], 'extrato.ofx', { type: 'application/x-ofx' });
    fireEvent.change(screen.getByLabelText('Arquivo OFX do banco'), { target: { files: [file] } });
    await waitFor(() => expect(mocks.readOfx).toHaveBeenCalledExactlyOnceWith(file));
    expect(await screen.findByText(/1 lançamento\(s\)/)).toBeInTheDocument();
    expect(screen.getByText('1 duplicado(s) removido(s)')).toBeInTheDocument();
    expect(screen.getByText('2 pendente(s) não importado(s)')).toBeInTheDocument();
  });

  it.each(['INSUMO alfa', 'alfa / insumo', '02-09-2026 alfa insumo', '2026-09-02 insumo alfa'])(
    'refina a escolha manual por todos os termos, sem acentos e em qualquer ordem: %s',
    async search => {
      const { user, dialog } = await openManualTitleSearch();
      await user.type(dialog.getByRole('textbox', { name: 'Buscar por nome, descrição, vencimento ou ID' }), search);
      expect(dialog.getAllByRole('button', { name: /^Vincular AP/ })).toHaveLength(1);
      expect(dialog.getByRole('button', { name: /Vincular AP Fornecedor Álfá Compra de ínsumo/ })).toBeInTheDocument();
      expect(dialog.queryByRole('button', { name: /Vincular AP Fornecedor Álfá Frete/ })).not.toBeInTheDocument();
      expect(mocks.matchMutate).not.toHaveBeenCalled();
    },
  );

  it('limpa a busca e restaura os títulos elegíveis sem efetuar conciliação', async () => {
    const { user, dialog } = await openManualTitleSearch();
    const input = dialog.getByRole('textbox', { name: 'Buscar por nome, descrição, vencimento ou ID' });
    await user.type(input, 'inexistente');
    expect(dialog.queryByRole('button', { name: /^Vincular AP/ })).not.toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: 'Limpar busca' }));
    expect(input).toHaveValue('');
    expect(input).toHaveFocus();
    expect(dialog.getAllByRole('button', { name: /^Vincular AP/ })).toHaveLength(2);
    expect(mocks.matchMutate).not.toHaveBeenCalled();
  });
});

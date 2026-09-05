import { describe, expect, it } from 'vitest';
import {
  assertOfxMatchesBankAccount,
  bankCommandId,
  buildOfxImportPayload,
  findBankStatementMatches,
  listBankStatementEligibleTargets,
  signedStatementAmount,
  type PersistedBankStatementLine,
  type ReconciliationFinancialRow,
} from '@/lib/bankReconciliation';
import type { OfxStatement } from '@/lib/ofxStatement';

const actorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const statement: OfxStatement = {
  account: {
    kind: 'bank', institutionId: '["TESTE","001"]', bankId: '001', branchId: '0001',
    accountId: '000012-3', accountType: 'CHECKING', currency: 'BRL',
  },
  transactions: [{
    fitId: 'FIT-001', postedDate: '2026-09-01', postedAtRaw: '20260901', amountCents: -12345,
    type: 'DEBIT', name: 'Fornecedor Alfa', memo: 'Boleto', checkNumber: '', referenceNumber: 'REF-1',
  }],
  balance: { amountCents: 50000, asOfDate: '2026-09-01', asOfRaw: '20260901' },
  pendingCount: 2,
  duplicateCount: 1,
};

const line = (overrides: Partial<PersistedBankStatementLine> = {}): PersistedBankStatementLine => ({
  id: '11111111-1111-4111-8111-111111111111',
  reconciliation_id: '22222222-2222-4222-8222-222222222222',
  bank_account_id: '33333333-3333-4333-8333-333333333333',
  movement_date: '2026-09-01', movement_type: 'debito', amount: 100,
  description: 'PIX fornecedor alfa', fit_id: 'FIT-1', transaction_type: 'DEBIT',
  transaction_name: 'Fornecedor Alfa', memo: '', status: 'nao_conciliado', matched_to_type: null,
  matched_to_id: null, settlement_event_id: null,
  ...overrides,
  revision: overrides.revision ?? 0,
});

const payable = (overrides: Partial<ReconciliationFinancialRow> = {}): ReconciliationFinancialRow => ({
  id: '44444444-4444-4444-8444-444444444444', description: 'Compra de insumo',
  due_date: '2026-09-02', amount: 100, amount_paid: 0, status: 'pending',
  suppliers: { name: 'Fornecedor Alfa' }, ...overrides,
});

describe('conciliação bancária — contrato OFX e sugestões', () => {
  it('serializa todos os campos de identidade e mantém centavos inteiros', () => {
    expect(buildOfxImportPayload(statement)).toEqual({
      version: 1,
      account: {
        kind: 'bank', institution_id: '["TESTE","001"]', bank_id: '001', branch_id: '0001',
        account_id: '000012-3', account_type: 'CHECKING', currency: 'BRL',
      },
      transactions: [{
        fit_id: 'FIT-001', posted_date: '2026-09-01', posted_at_raw: '20260901', amount_cents: -12345,
        transaction_type: 'DEBIT', name: 'Fornecedor Alfa', memo: 'Boleto', check_number: '', reference_number: 'REF-1',
      }],
      balance: { amount_cents: 50000, as_of_date: '2026-09-01', as_of_raw: '20260901' },
      pending_count: 2,
      duplicate_count: 1,
    });
  });

  it('exige que conta e agência do OFX correspondam ao cadastro selecionado', () => {
    const bank = {
      id: '33333333-3333-4333-8333-333333333333', name: 'Conta', bank_name: 'Banco',
      agency: '0001', account_number: '0000123', account_type: 'corrente', active: true,
    };
    expect(() => assertOfxMatchesBankAccount(bank, statement)).not.toThrow();
    expect(() => assertOfxMatchesBankAccount({ ...bank, account_number: '999' }, statement)).toThrow('número da conta');
    expect(() => assertOfxMatchesBankAccount({ ...bank, agency: '' }, statement)).toThrow('agência');
    expect(() => assertOfxMatchesBankAccount({ ...bank, account_number: '' }, statement)).toThrow('não possui número');
  });

  it('gera UUID idempotente para payload canônico e separa ator/operação/conteúdo', async () => {
    const first = await bankCommandId(actorId, 'import', { b: 2, a: 1 });
    expect(first).toMatch(/^[\da-f]{8}-[\da-f]{4}-5[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
    expect(await bankCommandId(actorId, 'import', { a: 1, b: 2 })).toBe(first);
    expect(await bankCommandId(actorId, 'match', { a: 1, b: 2 })).not.toBe(first);
    expect(await bankCommandId(actorId, 'import', { a: 1, b: 3 })).not.toBe(first);
  });

  it('separa rematch por revisão sem perder o replay da mesma tentativa', async () => {
    const firstAttempt = {
      reconciliation_id: '22222222-2222-4222-8222-222222222222',
      entries: [{
        item_id: line().id, expected_revision: 0, kind: 'payable', account_id: payable().id,
      }],
    };
    const retry = await bankCommandId(actorId, 'match', firstAttempt);
    expect(await bankCommandId(actorId, 'match', structuredClone(firstAttempt))).toBe(retry);
    expect(await bankCommandId(actorId, 'match', {
      ...firstAttempt,
      entries: [{ ...firstAttempt.entries[0], expected_revision: 2 }],
    })).not.toBe(retry);
  });

  it('mapeia sinal pelo tipo persistido e sugere AP exata com alta confiança', () => {
    expect(signedStatementAmount(line())).toBe(-100);
    expect(signedStatementAmount(line({ movement_type: 'credito' }))).toBe(100);
    expect(findBankStatementMatches(line(), [payable()], [])).toMatchObject([{
      kind: 'payable', settlementAmount: 100, openAmount: 100, confidence: 'alta', isPartial: false,
    }]);
  });

  it('permite sugerir baixa parcial somente com evidência de texto/data e nunca excede saldo', () => {
    const partial = findBankStatementMatches(line({ amount: 40 }), [payable({ amount: 100 })], []);
    expect(partial[0]).toMatchObject({ settlementAmount: 40, openAmount: 100, isPartial: true });
    expect(findBankStatementMatches(line({ amount: 101 }), [payable({ amount: 100 })], [])).toEqual([]);
    expect(findBankStatementMatches(line({ amount: 40, description: 'sem relação', transaction_name: '', movement_date: '2026-08-01' }), [payable()], [])).toEqual([]);
  });

  it('não oferece título terminal nem mistura crédito com AP', () => {
    expect(findBankStatementMatches(line(), [payable({ status: 'paid' })], [])).toEqual([]);
    expect(findBankStatementMatches(line({ movement_type: 'credito' }), [payable()], [])).toEqual([]);
  });

  it('mantém título válido acessível à escolha humana sem promovê-lo automaticamente', () => {
    const distant = line({
      amount: 40,
      movement_date: '2026-06-01',
      description: 'sem pista textual',
      transaction_name: '',
      memo: '',
    });
    const valid = payable({ amount: 100, due_date: '2026-09-02', suppliers: { name: 'Outro fornecedor' } });
    expect(findBankStatementMatches(distant, [valid], [])).toEqual([]);
    expect(listBankStatementEligibleTargets(distant, [valid], [])).toMatchObject([{
      accountId: valid.id, settlementAmount: 40, openAmount: 100, isPartial: true,
    }]);
  });
});

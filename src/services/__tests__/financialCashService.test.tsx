import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchFinancialCashMovements, fetchFinancialCashCmvMovements, fetchFinancialCmvPending } from '@/services/financialCashService';
import { useDREAuto, useFinanceKPIs } from '@/hooks/useFinanceIntelligence';

const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: mocks.from } }));

type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
let caps: Record<string, number>;
let failures: Record<string, (from: number) => Error | null>;
let counts: Record<string, number | null>;
let calls: { table: string; method: string; args: unknown[] }[];
const clients: QueryClient[] = [];

// Simula filtros, contagem e limite REST do servidor; não simula o cálculo
// financeiro. Serviço, paginação, agregador e queryFn dos hooks são os reais.
function source(table: string) {
  if (!tables[table]) throw new Error(`Fonte não configurada no teste: ${table}`);
  const filters: ((row: Row) => boolean)[] = [];
  let sortColumn = 'id';
  let ascending = true;
  let alias: string | undefined;
  const record = (method: string, ...args: unknown[]) => calls.push({ table, method, args });
  function result(from = 0, to = Number.MAX_SAFE_INTEGER, single = false) {
    const error = failures[table]?.(from) || null;
    const filtered = tables[table].filter(row => filters.every(filter => filter(row))).sort((a, b) =>
      String(a[sortColumn]).localeCompare(String(b[sortColumn])) * (ascending ? 1 : -1));
    const page = filtered.slice(from, Math.min(to + 1, from + (caps[table] ?? 1000))).map(row => alias ? { ...row, id: row[alias] } : { ...row });
    return Promise.resolve({ data: error ? null : single ? page[0] ?? null : page, error,
      count: Object.prototype.hasOwnProperty.call(counts, table) ? counts[table] : filtered.length });
  }
  const builder = {
    select(columns: string, options?: unknown) { record('select', columns, options); alias = /\bid:([a-z_]+)/.exec(columns)?.[1]; return builder; },
    eq(column: string, value: unknown) { record('eq', column, value); filters.push(row => row[column] === value); return builder; },
    neq(column: string, value: unknown) { record('neq', column, value); filters.push(row => row[column] !== value); return builder; },
    gte(column: string, value: string) { record('gte', column, value); filters.push(row => row[column] != null && String(row[column]) >= value); return builder; },
    lte(column: string, value: string) { record('lte', column, value); filters.push(row => row[column] != null && String(row[column]) <= value); return builder; },
    or(filter: string) {
      record('or', filter);
      const match = /^and\(effective_on\.gte\.(\d{4}-\d{2}-\d{2}),effective_on\.lte\.(\d{4}-\d{2}-\d{2})\),effective_on\.is\.null$/.exec(filter);
      if (!match) throw new Error(`Filtro não modelado: ${filter}`);
      filters.push(row => row.effective_on === null || (String(row.effective_on) >= match[1] && String(row.effective_on) <= match[2]));
      return builder;
    },
    order(column: string, options?: { ascending?: boolean }) { record('order', column, options); sortColumn = column; ascending = options?.ascending !== false; return builder; },
    range(from: number, to: number) { record('range', from, to); return result(from, to); },
    maybeSingle() { record('maybeSingle'); return result(0, 0, true); },
  };
  return builder;
}

const cash = (id: string, effective_on: string | null, amount_signed: number, patch: Row = {}): Row => ({
  id, effective_on, amount_signed, kind: 'receivable', account_id: 'same-receivable', category: 'venda', legacy: false, ...patch,
});
const cmv = (id: string, effective_on: string | null, amount_signed: number, legacy = false): Row => ({ id, effective_on, amount_signed, legacy });
function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-15T12:00:00Z'));
  tables = {
    financial_cash_movements: [], financial_cash_cmv_movements: [], financial_settlement_cmv_pending: [], financial_entries: [],
    companies: [{ id: 'company', is_primary: true, regime_tributario: '3', razao_social: 'Indústria de teste' }],
    bank_accounts: [], accounts_payable: [], accounts_receivable: [],
  };
  caps = {}; failures = {}; counts = {}; calls = [];
  mocks.from.mockImplementation(source);
});
afterEach(() => { clients.splice(0).forEach(client => client.clear()); vi.useRealTimers(); });

describe('serviço de caixa — fonte completa e período explícito', () => {
  it('filtra ambas as extremidades e mantém legado sem data fora da janela para aviso', async () => {
    tables.financial_cash_movements = [cash('a', '2026-08-01', 1), cash('b', '2026-08-31', 2), cash('fora', '2026-09-01', 9), cash('legado', null, 50, { legacy: true })];
    const rows = await fetchFinancialCashMovements('2026-08-01', '2026-08-31');
    expect(rows.map(row => row.id)).toEqual(['a', 'b', 'legado']);
    expect(calls).toContainEqual({ table: 'financial_cash_movements', method: 'select', args: ['id,kind,account_id,effective_on,amount_signed,category,legacy', { count: 'exact' }] });
    expect(calls).toContainEqual({ table: 'financial_cash_movements', method: 'order', args: ['id', { ascending: true }] });
  });

  it.each(['financial_cash_movements', 'financial_cash_cmv_movements'] as const)('consulta mais de mil linhas de %s com servidor limitado a 500', async table => {
    tables[table] = Array.from({ length: 1201 }, (_, index) => table === 'financial_cash_movements'
      ? cash(String(index).padStart(4, '0'), '2026-09-01', 0.01)
      : cmv(String(index).padStart(4, '0'), '2026-09-01', 0.01));
    caps[table] = 500;
    const fetch = table === 'financial_cash_movements' ? fetchFinancialCashMovements : fetchFinancialCashCmvMovements;
    const rows = await fetch('2026-09-01', '2026-09-30');
    expect(rows).toHaveLength(1201);
    expect(calls.filter(call => call.table === table && call.method === 'range').map(call => call.args)).toEqual([[0, 999], [500, 1499], [1000, 1999]]);
  });

  it('pagina também pendências de CMV usando a identidade correta da view', async () => {
    tables.financial_settlement_cmv_pending = Array.from({ length: 1001 }, (_, index) => ({
      settlement_event_id: String(index).padStart(4, '0'), receivable_id: 'ar', sale_order_id: 'pv', effective_on: '2026-09-10', received_amount: 1,
    }));
    caps.financial_settlement_cmv_pending = 500;
    const rows = await fetchFinancialCmvPending('2026-09-01', '2026-09-30');
    expect(rows).toHaveLength(1001);
    expect(rows[1000].id).toBe('1000');
    expect(calls).toContainEqual({ table: 'financial_settlement_cmv_pending', method: 'order', args: ['settlement_event_id', { ascending: true }] });
  });

  it.each(['financial_cash_movements', 'financial_cash_cmv_movements'] as const)('recusa subtotal quando uma página de %s falha', async table => {
    tables[table] = Array.from({ length: 501 }, (_, index) => table === 'financial_cash_movements'
      ? cash(String(index), '2026-09-01', 1) : cmv(String(index), '2026-09-01', 1));
    caps[table] = 500;
    failures[table] = from => from >= 500 ? new Error('Segunda página indisponível.') : null;
    const fetch = table === 'financial_cash_movements' ? fetchFinancialCashMovements : fetchFinancialCashCmvMovements;
    await expect(fetch('2026-09-01', '2026-09-30')).rejects.toThrow('Segunda página');
  });

  it('não aceita contagem desconhecida nem dados duplicados', async () => {
    counts.financial_cash_movements = null;
    await expect(fetchFinancialCashMovements('2026-09-01', '2026-09-30')).rejects.toThrow('consulta completa');
    delete counts.financial_cash_movements;
    tables.financial_cash_movements = [cash('repetido', '2026-09-01', 1), cash('repetido', '2026-09-01', 1)];
    await expect(fetchFinancialCashMovements('2026-09-01', '2026-09-30')).rejects.toThrow('inconsistentes');
  });

  it.each([
    ['2026-09-30', '2026-09-01'], ['2026-02-30', '2026-03-01'], ['2026-09-01),id.neq.x', '2026-09-30'],
  ])('rejeita período inválido antes de construir a consulta: %s', async (start, end) => {
    await expect(fetchFinancialCashMovements(start, end)).rejects.toThrow();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('valida o tipo oposto antes de devolver uma fonte aparentemente íntegra', async () => {
    tables.financial_cash_movements = [cash('ar', '2026-09-01', 10), cash('ap', null, -5, { kind: 'payable' })];
    await expect(fetchFinancialCashMovements('2026-09-01', '2026-09-30')).rejects.toThrow('sem data');
  });

  it('não converte booleano em valor financeiro válido', async () => {
    tables.financial_cash_movements = [cash('a', '2026-09-01', true as unknown as number)];
    await expect(fetchFinancialCashMovements('2026-09-01', '2026-09-30')).rejects.toThrow();
  });
});

describe('DRE e indicadores — movimentos não migram para a última data', () => {
  function seedSplit() {
    tables.financial_cash_movements = [
      cash('ar-agosto', '2026-08-15', 300), cash('ar-setembro', '2026-09-15', 700), cash('ar-estorno-outubro', '2026-10-10', -300),
      cash('ap-agosto', '2026-08-15', -120, { kind: 'payable', category: 'servico' }),
      cash('ap-setembro', '2026-09-15', -280, { kind: 'payable', category: 'servico' }),
      cash('ap-estorno-outubro', '2026-10-10', 120, { kind: 'payable', category: 'servico' }),
    ];
    tables.financial_cash_cmv_movements = [cmv('cmv-agosto', '2026-08-15', 180), cmv('cmv-setembro', '2026-09-15', 420), cmv('cmv-estorno-outubro', '2026-10-10', -180)];
  }

  it('mantém baixas em agosto/setembro e estorno negativo em outubro, sem reescrever meses anteriores', async () => {
    seedSplit();
    const before = JSON.stringify(tables.financial_cash_movements);
    const { result } = renderHook(() => useDREAuto(3), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.months.map(month => ({ period: month.period, receita: month.receita, cmv: month.cmv, despesa: month.despOperacionais, resultado: month.resultadoLiquido }))).toEqual([
      { period: '2026-08', receita: 300, cmv: 180, despesa: 120, resultado: 0 },
      { period: '2026-09', receita: 700, cmv: 420, despesa: 280, resultado: 0 },
      { period: '2026-10', receita: -300, cmv: -180, despesa: -120, resultado: 0 },
    ]);
    expect(JSON.stringify(tables.financial_cash_movements)).toBe(before);
    expect(result.current.data!.origemVazia).toEqual({ recebimentos: false, pagamentos: false, cmv: false });
  });

  it('não duplica pagamentos de material, MOD, frete e overhead como despesa além do CMV', async () => {
    seedSplit();
    tables.financial_cash_movements.push(...['material', 'mao_de_obra', 'frete', 'overhead'].map(category => cash(category, '2026-09-20', -100, { kind: 'payable', category })));
    const { result } = renderHook(() => useDREAuto(3), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.months[1]).toMatchObject({ cmv: 420, despOperacionais: 280, resultadoLiquido: 0 });
  });

  it('preserva a classificação de impostos conforme o regime, sem duplicá-los', async () => {
    tables.financial_cash_movements = [cash('receita', '2026-10-01', 100), cash('imposto', '2026-10-02', -12, { kind: 'payable', category: 'imposto' })];
    const normal = renderHook(() => useDREAuto(3), { wrapper: wrapper() });
    await waitFor(() => expect(normal.result.current.isSuccess).toBe(true));
    expect(normal.result.current.data!.months[2]).toMatchObject({ despOperacionais: 0, impostos: 12, resultadoLiquido: 88 });
    tables.companies[0].regime_tributario = '1';
    const simples = renderHook(() => useDREAuto(3), { wrapper: wrapper() });
    await waitFor(() => expect(simples.result.current.isSuccess).toBe(true));
    expect(simples.result.current.data!.months[2]).toMatchObject({ despOperacionais: 12, impostos: 0, resultadoLiquido: 88 });
  });

  it('legado sem data não entra nos meses, mesmo sendo a única informação existente', async () => {
    tables.financial_cash_movements = [cash('legado-ar', null, 250, { legacy: true }), cash('legado-ap', null, -100, { kind: 'payable', legacy: true })];
    tables.financial_cash_cmv_movements = [cmv('legado-cmv', null, 150, true)];
    const { result } = renderHook(() => useDREAuto(3), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.months.every(month => month.receita === 0 && month.cmv === 0 && month.despOperacionais === 0)).toBe(true);
    expect(result.current.data!.origemVazia).toEqual({ recebimentos: true, pagamentos: true, cmv: true });
    expect(result.current.data!.cashWarnings).toEqual({ legacyDatedCount: 0, undatedLegacyCount: 3, undatedReceipts: 250, undatedPayments: 100, undatedCmv: 150 });
  });

  it('identifica legado datado e não perde factoring acima de 1000 linhas', async () => {
    tables.financial_cash_movements = [cash('legado', '2026-10-01', 2000, { legacy: true })];
    tables.financial_entries = Array.from({ length: 1001 }, (_, id) => ({ id: String(id), entry_date: '2026-10-02', amount: 1, type: 'despesa', reference_type: 'sale_order_factoring', status: 'confirmado' }));
    tables.financial_entries.push({ id: 'cancelado', entry_date: '2026-10-02', amount: 999, type: 'despesa', reference_type: 'sale_order_factoring', status: 'estornado' });
    caps.financial_entries = 500;
    const { result } = renderHook(() => useDREAuto(3), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.months[2]).toMatchObject({ jurosFactoring: 1001, resultadoLiquido: 999 });
    expect(result.current.data!.cashWarnings.legacyDatedCount).toBe(1);
  });

  it('factoring ativo sozinho mantém apuração negativa mesmo sem AP, AR ou CMV no período', async () => {
    tables.financial_entries = [{ id: 'juros', entry_date: '2026-10-02', amount: 50, type: 'despesa', reference_type: 'sale_order_factoring', status: 'confirmado' }];
    const { result } = renderHook(() => useDREAuto(3), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.origemVazia).toEqual({ recebimentos: true, pagamentos: true, cmv: true });
    expect(result.current.data!.hasFactoringMovements).toBe(true);
    expect(result.current.data!.months[2]).toMatchObject({ receita: 0, cmv: 0, despOperacionais: 0, jurosFactoring: 50, resultadoLiquido: -50 });
  });

  it('factoring cancelado ou zerado não inventa movimento realizado na janela', async () => {
    tables.financial_entries = [
      { id: 'cancelado', entry_date: '2026-10-02', amount: 50, type: 'despesa', reference_type: 'sale_order_factoring', status: 'cancelado' },
      { id: 'zerado', entry_date: '2026-10-02', amount: 0, type: 'despesa', reference_type: 'sale_order_factoring', status: 'confirmado' },
    ];
    const { result } = renderHook(() => useDREAuto(3), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.hasFactoringMovements).toBe(false);
    expect(result.current.data!.months[2]).toMatchObject({ jurosFactoring: 0, resultadoLiquido: 0 });
  });

  it.each([NaN, Infinity])('DRE bloqueia factoring com valor não finito (%s), em vez de convertê-lo em zero ou lucro inválido', async amount => {
    seedSplit();
    tables.financial_entries = [{ id: 'juros', entry_date: '2026-10-02', amount, type: 'despesa', reference_type: 'sale_order_factoring', status: 'confirmado' }];
    const { result } = renderHook(() => useDREAuto(3), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isError).toBe(true);
    expect(result.current.data).toBeUndefined();
  });

  it.each(['financial_cash_movements', 'financial_cash_cmv_movements', 'financial_entries', 'companies', 'financial_settlement_cmv_pending'])('DRE falha inteira se a fonte %s falhar', async table => {
    seedSplit();
    failures[table] = () => new Error(`Falha em ${table}`);
    const { result } = renderHook(() => useDREAuto(3), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect(result.current.error!.message).toContain('Falha');
  });

  it('propaga pendência de CMV para a interface impedir apresentação de lucro incompleto', async () => {
    seedSplit();
    tables.financial_settlement_cmv_pending = [{ settlement_event_id: 'pendente', effective_on: '2026-09-15', receivable_id: 'ar', sale_order_id: 'pv', received_amount: 700 }];
    const { result } = renderHook(() => useDREAuto(3), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.cmvPending).toEqual([expect.objectContaining({ id: 'pendente', receivable_id: 'ar', sale_order_id: 'pv', received_amount: 700 })]);
  });

  it('KPI usa eventos atuais e previsão separada, mantendo estorno negativo no mês', async () => {
    seedSplit();
    tables.accounts_receivable = [{ id: 'ar', amount: 1000, amount_received: 700, status: 'partial', due_date: '2026-10-20' }];
    tables.accounts_payable = [{ id: 'ap', amount: 500, amount_paid: 280, status: 'partial', due_date: '2026-10-20' }];
    tables.bank_accounts = [{ id: 'bank', active: true, current_balance: 100 }];
    const { result } = renderHook(() => useFinanceKPIs(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject({ monthRevenue: -300, monthExpenses: -120, monthResult: -180,
      monthReceivableForecast: 300, monthPayableForecast: 220, totalBalance: 100, totalReceivable: 300, totalPayable: 220, netPosition: 180 });
  });

  it('KPI pagina bancos, AP e AR quando cada fonte tem mais de 1000 linhas e cap 500', async () => {
    tables.bank_accounts = Array.from({ length: 1001 }, (_, id) => ({ id: String(id), active: true, current_balance: 1 }));
    tables.accounts_receivable = Array.from({ length: 1001 }, (_, id) => ({ id: String(id), amount: 2, amount_received: 1, status: 'partial', due_date: '2026-10-20' }));
    tables.accounts_payable = Array.from({ length: 1001 }, (_, id) => ({ id: String(id), amount: 3, amount_paid: 1, status: 'partial', due_date: '2026-10-20' }));
    for (const table of ['bank_accounts', 'accounts_payable', 'accounts_receivable']) caps[table] = 500;
    const { result } = renderHook(() => useFinanceKPIs(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject({ totalBalance: 1001, bankAccountsCount: 1001, totalReceivable: 1001, totalPayable: 2002, netPosition: 0 });
    for (const table of ['bank_accounts', 'accounts_payable', 'accounts_receivable']) {
      expect(calls.filter(call => call.table === table && call.method === 'range').map(call => call.args)).toEqual([[0, 999], [500, 1499], [1000, 1999]]);
    }
  });

  it.each(['financial_cash_movements', 'bank_accounts', 'accounts_payable', 'accounts_receivable'])('KPI falha inteiro se a fonte %s falhar', async table => {
    failures[table] = () => new Error(`Falha em ${table}`);
    const { result } = renderHook(() => useFinanceKPIs(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });

  it('saldo bancário não finito não é um KPI válido', async () => {
    tables.bank_accounts = [{ id: 'bank', active: true, current_balance: Infinity }];
    const { result } = renderHook(() => useFinanceKPIs(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });

  it.each(['accounts_payable', 'accounts_receivable'] as const)('KPI bloqueia título com valor inválido em %s, sem apresentar subtotal de títulos válidos', async table => {
    const paidKey = table === 'accounts_payable' ? 'amount_paid' : 'amount_received';
    tables[table] = [
      { id: 'valido', amount: 100, [paidKey]: 10, status: 'partial', due_date: '2026-10-20' },
      { id: 'invalido', amount: NaN, [paidKey]: 0, status: 'pending', due_date: '2026-10-20' },
    ];
    const { result } = renderHook(() => useFinanceKPIs(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isError).toBe(true);
    expect(result.current.data).toBeUndefined();
  });
});

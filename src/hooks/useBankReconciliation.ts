import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useBankAccounts } from '@/hooks/useFinanceAdvanced';
import { invalidateFinanceDerivedQueries } from '@/lib/financeQueryInvalidation';
import { fetchFinancialRows } from '@/lib/financialPagination';
import { todayISO } from '@/lib/date';
import {
  assertOfxMatchesBankAccount,
  bankCommandId,
  buildOfxImportPayload,
  type PersistedBankStatementLine,
  type ReconciliationBankAccount,
} from '@/lib/bankReconciliation';
import type { OfxStatement } from '@/lib/ofxStatement';

const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
export const BANK_RECONCILIATION_PAGE_SIZE = 100;

export const bankReconciliationKeys = {
  all: ['bank-reconciliation'] as const,
  sessions: () => ['bank-reconciliation', 'sessions'] as const,
  session: (id: string | null | undefined) => ['bank-reconciliation', 'session', id] as const,
  items: (id: string | null | undefined, page: number) => ['bank-reconciliation', 'items', id, page] as const,
};

export interface BankReconciliationSession {
  id: string;
  bank_account_id: string;
  reconciliation_date: string;
  imported_at: string;
  imported_by: string;
  total_credits: number;
  total_debits: number;
  matched_count: number;
  unmatched_count: number;
  transaction_count: number;
  pending_count: number;
  duplicate_count: number;
  status: 'em_andamento' | 'conciliada' | 'divergencia' | 'cancelada';
  account_kind: 'bank' | 'credit-card';
  institution_id: string;
  bank_id: string;
  branch_id: string;
  account_number: string;
  account_type: string;
  currency: 'BRL';
  ledger_balance: number | null;
  ledger_balance_date: string | null;
  bank_accounts?: Pick<ReconciliationBankAccount, 'id' | 'name' | 'bank_name' | 'agency' | 'account_number'> | null;
}

export interface BankReconciliationItemsPage {
  rows: PersistedBankStatementLine[];
  count: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface BankReconciliationItemsChunk {
  data: PersistedBankStatementLine[] | null;
  error: unknown;
  count: number | null;
}

export async function fetchBankReconciliationItemsPage(
  reconciliationId: string,
  page: number,
  fetchChunk: (from: number, to: number) => PromiseLike<BankReconciliationItemsChunk>,
): Promise<BankReconciliationItemsPage> {
  if (!validUuid(reconciliationId) || !Number.isSafeInteger(page) || page < 1) {
    throw new Error('Página de conciliação inválida.');
  }
  const from = (page - 1) * BANK_RECONCILIATION_PAGE_SIZE;
  const rows: PersistedBankStatementLine[] = [];
  const ids = new Set<string>();
  let expectedCount: number | undefined;
  while (true) {
    const cursor = from + rows.length;
    const { data, error, count } = await fetchChunk(cursor, from + BANK_RECONCILIATION_PAGE_SIZE - 1);
    if (error) throw error;
    if (!Number.isSafeInteger(count) || count === null || count < 0
      || (expectedCount !== undefined && count !== expectedCount)) {
      throw new Error('A contagem do extrato mudou ou veio incompleta. Atualize antes de conciliar.');
    }
    expectedCount = count;
    const expectedRows = Math.max(0, Math.min(BANK_RECONCILIATION_PAGE_SIZE, count - from));
    if (data !== null && !Array.isArray(data)) {
      throw new Error('A página do extrato veio incompleta ou inconsistente. Atualize antes de conciliar.');
    }
    const batch = data ?? [];
    if (rows.length + batch.length > expectedRows || (!batch.length && rows.length < expectedRows)) {
      throw new Error('A página do extrato veio incompleta ou inconsistente. Atualize antes de conciliar.');
    }
    for (const row of batch) {
      if (!validUuid(row.id) || ids.has(row.id)) {
        throw new Error('A página do extrato repetiu uma linha. Atualize antes de conciliar.');
      }
      ids.add(row.id);
      rows.push(row);
    }
    if (rows.length === expectedRows) {
      return {
        rows,
        count,
        page,
        pageSize: BANK_RECONCILIATION_PAGE_SIZE,
        totalPages: Math.max(1, Math.ceil(count / BANK_RECONCILIATION_PAGE_SIZE)),
      };
    }
  }
}

export interface ImportOfxInput {
  bankAccount: ReconciliationBankAccount;
  statement: OfxStatement;
}

export interface MatchBankItemsInput {
  reconciliationId: string;
  entries: Array<{
    item_id: string;
    expected_revision: number;
    kind: 'payable' | 'receivable';
    account_id: string;
  }>;
}

export interface UnmatchBankItemsInput {
  reconciliationId: string;
  entries: Array<{
    item_id: string;
    expected_revision: number;
    reversed_on: string;
    reason: string;
  }>;
}

export type BankReconciliationIntent =
  | { command: 'import'; payload: { bank_account_id: string; statement: ReturnType<typeof buildOfxImportPayload> } }
  | { command: 'match'; payload: { reconciliation_id: string; entries: MatchBankItemsInput['entries'] } }
  | { command: 'unmatch'; payload: { reconciliation_id: string; entries: UnmatchBankItemsInput['entries'] } };

export interface BankReconciliationCommandResult {
  ok: true;
  command_id: string;
  command: BankReconciliationIntent['command'];
  reconciliation_id: string;
  event_ids: string[];
  item_count?: number;
  items?: Array<{ item_id: string; event_id?: string; revision: number; status?: string }>;
  replayed: boolean;
  reused?: boolean;
}

interface RpcResponse {
  data: unknown;
  error: { message: string; code?: string } | null;
}

interface ReconciliationRowsResponse<T> {
  data: T[] | null;
  error: { message: string; code?: string } | null;
  count: number | null;
}

interface ReconciliationQuery<T> extends PromiseLike<ReconciliationRowsResponse<T>> {
  select(columns?: string, options?: { count?: 'exact' }): ReconciliationQuery<T>;
  eq(column: string, value: unknown): ReconciliationQuery<T>;
  order(column: string, options?: { ascending?: boolean }): ReconciliationQuery<T>;
  range(from: number, to: number): ReconciliationQuery<T>;
  maybeSingle(): PromiseLike<{
    data: T | null;
    error: { message: string; code?: string } | null;
  }>;
}

const reconciliationApi = supabase as unknown as {
  from<T>(table: string): ReconciliationQuery<T>;
  rpc(name: string, args: Record<string, unknown>): PromiseLike<RpcResponse>;
  auth: typeof supabase.auth;
};

function validUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

function assertEntries(entries: unknown[], label: string): void {
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > 200) {
    throw new Error(`${label} exige entre 1 e 200 linhas.`);
  }
}

function normalizeMatch(input: MatchBankItemsInput): BankReconciliationIntent {
  if (!validUuid(input.reconciliationId)) throw new Error('Conciliação inválida. Atualize a página.');
  assertEntries(input.entries, 'A conciliação');
  const seen = new Set<string>();
  return {
    command: 'match',
    payload: {
      reconciliation_id: input.reconciliationId.toLowerCase(),
      entries: input.entries.map(entry => {
        const itemId = entry.item_id?.toLowerCase();
        const accountId = entry.account_id?.toLowerCase();
        if (!validUuid(itemId) || !validUuid(accountId) || seen.has(itemId)
          || !['payable', 'receivable'].includes(entry.kind)
          || !Number.isSafeInteger(entry.expected_revision) || entry.expected_revision < 0) {
          throw new Error('Linha, título ou revisão inválida. Atualize antes de conciliar.');
        }
        seen.add(itemId);
        return { item_id: itemId, expected_revision: entry.expected_revision, kind: entry.kind, account_id: accountId };
      }),
    },
  };
}

function normalizeUnmatch(input: UnmatchBankItemsInput): BankReconciliationIntent {
  if (!validUuid(input.reconciliationId)) throw new Error('Conciliação inválida. Atualize a página.');
  assertEntries(input.entries, 'O desfazer');
  const seen = new Set<string>();
  const today = todayISO();
  return {
    command: 'unmatch',
    payload: {
      reconciliation_id: input.reconciliationId.toLowerCase(),
      entries: input.entries.map(entry => {
        const itemId = entry.item_id?.toLowerCase();
        const reason = entry.reason?.trim();
        if (!validUuid(itemId) || seen.has(itemId)
          || !Number.isSafeInteger(entry.expected_revision) || entry.expected_revision < 0
          || !/^\d{4}-\d{2}-\d{2}$/.test(entry.reversed_on)
          || entry.reversed_on > today || !reason || reason.length > 4000) {
          throw new Error('Linha, revisão, data ou motivo inválido para desfazer.');
        }
        const date = new Date(`${entry.reversed_on}T12:00:00Z`);
        if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== entry.reversed_on) {
          throw new Error('Informe uma data real para desfazer a conciliação.');
        }
        seen.add(itemId);
        return { item_id: itemId, expected_revision: entry.expected_revision, reversed_on: entry.reversed_on, reason };
      }),
    },
  };
}

function assertCommandResult(
  value: unknown,
  commandId: string,
  intent: BankReconciliationIntent,
): BankReconciliationCommandResult {
  const result = value as BankReconciliationCommandResult | null;
  const expectedEvents = intent.command === 'import' ? 0 : intent.payload.entries.length;
  if (!result || result.ok !== true || result.command_id !== commandId
    || result.command !== intent.command || !validUuid(result.reconciliation_id)
    || !Array.isArray(result.event_ids) || result.event_ids.length !== expectedEvents
    || !result.event_ids.every(validUuid)
    || new Set(result.event_ids).size !== result.event_ids.length
    || typeof result.replayed !== 'boolean') {
    throw new Error('O servidor não confirmou a conciliação por completo. Atualize antes de repetir.');
  }
  if (intent.command === 'import') {
    if (result.item_count !== intent.payload.statement.transactions.length) {
      throw new Error('O servidor não confirmou todas as linhas importadas. Atualize antes de repetir.');
    }
  } else {
    const expectedStatus = intent.command === 'match' ? 'conciliado' : 'nao_conciliado';
    if (result.reconciliation_id.toLowerCase() !== intent.payload.reconciliation_id
      || !Array.isArray(result.items) || result.items.length !== intent.payload.entries.length
      || result.items.some((item, index) => {
        const expected = intent.payload.entries[index];
        return !validUuid(item.item_id) || item.item_id.toLowerCase() !== expected.item_id
          || !validUuid(item.event_id) || item.event_id !== result.event_ids[index]
          || !Number.isSafeInteger(item.revision)
          || item.revision !== expected.expected_revision + 1
          || item.status !== expectedStatus;
      })
      || new Set(result.items.map(item => item.item_id.toLowerCase())).size !== result.items.length) {
      throw new Error('O servidor não confirmou todos os vínculos da conciliação. Atualize antes de repetir.');
    }
  }
  return result;
}

/** IDs determinísticos permitem retry sem guardar conteúdo bancário no navegador. */
export async function executeBankReconciliationIntent(
  actorId: string,
  intent: BankReconciliationIntent,
  rpc: (args: Record<string, unknown>) => PromiseLike<RpcResponse> = args =>
    reconciliationApi.rpc('execute_bank_reconciliation_command', args),
): Promise<BankReconciliationCommandResult> {
  if (!validUuid(actorId)) throw new Error('Entre novamente para operar a conciliação bancária.');
  const commandId = await bankCommandId(actorId, intent.command, intent.payload);
  let response: RpcResponse;
  try {
    response = await rpc({
      p_command_id: commandId,
      p_command: intent.command,
      p_payload: intent.payload,
      p_expected_actor_id: actorId,
    });
  } catch {
    throw new Error('A resposta não chegou. Atualize a sessão ou repita exatamente a mesma operação.');
  }
  if (response.error) throw new Error(response.error.message);
  return assertCommandResult(response.data, commandId, intent);
}

export function useBankReconciliationSessions() {
  return useQuery({
    queryKey: bankReconciliationKeys.sessions(),
    queryFn: async (): Promise<BankReconciliationSession[]> => {
      const rows = await fetchFinancialRows<BankReconciliationSession>((from, to) => reconciliationApi
        .from<BankReconciliationSession>('bank_reconciliations')
        .select('*, bank_accounts(id,name,bank_name,agency,account_number)', { count: 'exact' })
        .order('id', { ascending: true })
        .range(from, to));
      return rows.sort((left, right) => right.imported_at.localeCompare(left.imported_at) || left.id.localeCompare(right.id));
    },
    staleTime: 30_000,
  });
}

export function useBankReconciliationSession(id: string | null | undefined) {
  return useQuery({
    queryKey: bankReconciliationKeys.session(id),
    enabled: validUuid(id),
    queryFn: async (): Promise<BankReconciliationSession> => {
      const { data, error } = await reconciliationApi.from<BankReconciliationSession>('bank_reconciliations')
        .select('*, bank_accounts(id,name,bank_name,agency,account_number)')
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('Conciliação não encontrada ou sem permissão de acesso.');
      return data as BankReconciliationSession;
    },
  });
}

export function useBankReconciliationItems(
  reconciliationId: string | null | undefined,
  page: number,
) {
  return useQuery({
    queryKey: bankReconciliationKeys.items(reconciliationId, page),
    enabled: validUuid(reconciliationId) && Number.isSafeInteger(page) && page >= 1,
    queryFn: () => fetchBankReconciliationItemsPage(reconciliationId!, page, (from, to) => reconciliationApi
      .from<PersistedBankStatementLine>('bank_reconciliation_items')
      .select('*', { count: 'exact' })
      .eq('reconciliation_id', reconciliationId)
      .order('movement_date', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to)),
    placeholderData: previous => previous?.page === page ? previous : undefined,
  });
}

function useCommandMutation<TInput>(
  expectedActorId: string | null | undefined,
  normalize: (input: TInput) => BankReconciliationIntent,
) {
  const qc = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: async (input: TInput) => {
      if (!validUuid(expectedActorId)) {
        throw new Error('A sessão mudou. Atualize a página antes de operar a conciliação.');
      }
      const { data, error } = await reconciliationApi.auth.getUser();
      if (error) throw error;
      if (!data.user || data.user.id !== expectedActorId) {
        throw new Error('A sessão mudou. Atualize a página antes de operar a conciliação.');
      }
      const result = await executeBankReconciliationIntent(expectedActorId, normalize(input));
      const current = await reconciliationApi.auth.getUser();
      if (current.error || current.data.user?.id !== expectedActorId) {
        throw new Error('A operação foi confirmada para a sessão anterior. Atualize a página para carregar o resultado.');
      }
      return result;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: bankReconciliationKeys.all });
      void qc.invalidateQueries({ queryKey: ['accounts_payable'] });
      void qc.invalidateQueries({ queryKey: ['accounts_receivable'] });
      void qc.invalidateQueries({ queryKey: ['financial-settlement-history'] });
      void qc.invalidateQueries({ queryKey: ['financial-cash-events'] });
      void qc.invalidateQueries({ queryKey: ['sale-order-cmv'] });
      invalidateFinanceDerivedQueries(qc);
    },
  });
}

export function useImportOfxStatement(expectedActorId: string | null | undefined) {
  return useCommandMutation<ImportOfxInput>(expectedActorId, ({ bankAccount, statement }) => {
    assertOfxMatchesBankAccount(bankAccount, statement);
    return {
      command: 'import',
      payload: { bank_account_id: bankAccount.id.toLowerCase(), statement: buildOfxImportPayload(statement) },
    };
  });
}

export function useMatchBankReconciliationItems(expectedActorId: string | null | undefined) {
  return useCommandMutation<MatchBankItemsInput>(expectedActorId, normalizeMatch);
}

export function useUnmatchBankReconciliationItems(expectedActorId: string | null | undefined) {
  return useCommandMutation<UnmatchBankItemsInput>(expectedActorId, normalizeUnmatch);
}

export function useReconciliationBankAccounts() {
  return useBankAccounts();
}

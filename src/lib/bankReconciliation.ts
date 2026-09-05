import type { OfxStatement } from '@/lib/ofxStatement';

export interface ReconciliationBankAccount {
  id: string;
  name: string;
  bank_name: string;
  agency: string | null;
  account_number: string | null;
  account_type: string;
  active: boolean;
}

export interface OfxImportPayload {
  version: 1;
  account: {
    kind: 'bank' | 'credit-card';
    institution_id: string;
    bank_id: string;
    branch_id: string;
    account_id: string;
    account_type: string;
    currency: string;
  };
  transactions: Array<{
    fit_id: string;
    posted_date: string;
    posted_at_raw: string;
    amount_cents: number;
    transaction_type: string;
    name: string;
    memo: string;
    check_number: string;
    reference_number: string;
  }>;
  balance: {
    amount_cents: number;
    as_of_date: string;
    as_of_raw: string;
  } | null;
  pending_count: number;
  duplicate_count: number;
}

export interface PersistedBankStatementLine {
  id: string;
  reconciliation_id: string;
  bank_account_id: string;
  movement_date: string;
  movement_type: 'credito' | 'debito';
  amount: number;
  description: string | null;
  fit_id: string;
  transaction_type: string | null;
  transaction_name: string | null;
  memo: string | null;
  status: 'nao_conciliado' | 'conciliado';
  matched_to_type: string | null;
  matched_to_id: string | null;
  settlement_event_id: string | null;
  revision: number;
}

export interface ReconciliationFinancialRow {
  id: string;
  description?: string | null;
  client_name?: string | null;
  due_date?: string | null;
  amount: number;
  amount_paid?: number | null;
  amount_received?: number | null;
  status?: string | null;
  suppliers?: { name?: string | null } | null;
}

export interface ReconciliationMatchCandidate {
  kind: 'payable' | 'receivable';
  accountId: string;
  description: string;
  party: string;
  dueDate: string | null;
  openAmount: number;
  settlementAmount: number;
  isPartial: boolean;
  confidence: 'alta' | 'media' | 'baixa';
}

const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

export function buildOfxImportPayload(statement: OfxStatement): OfxImportPayload {
  return {
    version: 1,
    account: {
      kind: statement.account.kind,
      institution_id: statement.account.institutionId,
      bank_id: statement.account.bankId,
      branch_id: statement.account.branchId,
      account_id: statement.account.accountId,
      account_type: statement.account.accountType,
      currency: statement.account.currency,
    },
    transactions: statement.transactions.map(transaction => ({
      fit_id: transaction.fitId,
      posted_date: transaction.postedDate,
      posted_at_raw: transaction.postedAtRaw,
      amount_cents: transaction.amountCents,
      transaction_type: transaction.type,
      name: transaction.name,
      memo: transaction.memo,
      check_number: transaction.checkNumber,
      reference_number: transaction.referenceNumber,
    })),
    balance: statement.balance ? {
      amount_cents: statement.balance.amountCents,
      as_of_date: statement.balance.asOfDate,
      as_of_raw: statement.balance.asOfRaw,
    } : null,
    pending_count: statement.pendingCount,
    duplicate_count: statement.duplicateCount,
  };
}

function normalizedAccountPart(value: string | null | undefined): string {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Pré-validação de UX; o RPC repete a prova sob lock e é a autoridade. */
export function assertOfxMatchesBankAccount(
  account: ReconciliationBankAccount,
  statement: OfxStatement,
): void {
  if (!account.active) throw new Error('Selecione uma conta bancária ativa.');
  const registeredAccount = normalizedAccountPart(account.account_number);
  const ofxAccount = normalizedAccountPart(statement.account.accountId);
  if (!registeredAccount) {
    throw new Error('A conta selecionada não possui número cadastrado. Complete o cadastro antes de importar o OFX.');
  }
  if (!ofxAccount || registeredAccount !== ofxAccount) {
    throw new Error('O número da conta do OFX não corresponde à conta bancária selecionada.');
  }
  const registeredBranch = normalizedAccountPart(account.agency);
  const ofxBranch = normalizedAccountPart(statement.account.branchId);
  if ((registeredBranch || ofxBranch) && registeredBranch !== ofxBranch) {
    throw new Error('A agência do OFX não corresponde ao cadastro bancário selecionado.');
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

/**
 * O mesmo usuário + operação + payload sempre reproduz o mesmo UUID. Assim uma
 * resposta perdida não exige guardar o conteúdo bancário no localStorage.
 */
export async function bankCommandId(
  actorId: string,
  operation: 'import' | 'match' | 'unmatch',
  payload: unknown,
): Promise<string> {
  if (!UUID.test(actorId)) throw new Error('Entre novamente para operar a conciliação bancária.');
  const bytes = new TextEncoder().encode(canonicalJson({ actorId: actorId.toLowerCase(), operation, payload }));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  // UUID determinístico com bits RFC 4122 (versão 5/variant 1). O servidor ainda
  // vincula command_id ao ator e ao hash integral do payload.
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = Array.from(digest.slice(0, 16), byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function signedStatementAmount(line: PersistedBankStatementLine): number {
  const amount = Math.abs(Number(line.amount) || 0);
  return line.movement_type === 'debito' ? -amount : amount;
}

function normalizedStatus(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function openAmount(row: ReconciliationFinancialRow, kind: 'payable' | 'receivable'): number {
  const settled = kind === 'payable' ? row.amount_paid : row.amount_received;
  return Math.max(0, Number(row.amount || 0) - Number(settled || 0));
}

function normalizedWords(value: unknown): string[] {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().split(/[^a-z0-9]+/)
    .filter(word => word.length >= 4);
}

function hasTextEvidence(line: PersistedBankStatementLine, ...values: unknown[]): boolean {
  const haystack = normalizedWords([line.description, line.transaction_name, line.memo].filter(Boolean).join(' '));
  if (!haystack.length) return false;
  const wanted = new Set(values.flatMap(normalizedWords));
  return haystack.some(word => wanted.has(word));
}

function civilDay(value: string | null | undefined): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) ? Math.floor(parsed / 86_400_000) : null;
}

interface ScoredBankCandidate {
  candidate: ReconciliationMatchCandidate;
  score: number;
  amountDistance: number;
}

function scoredBankStatementCandidates(
  line: PersistedBankStatementLine,
  payables: ReconciliationFinancialRow[],
  receivables: ReconciliationFinancialRow[],
): ScoredBankCandidate[] {
  const kind = line.movement_type === 'debito' ? 'payable' : 'receivable';
  const terminal = kind === 'payable'
    ? new Set(['paid', 'pago', 'cancelled', 'cancelado'])
    : new Set(['received', 'recebido', 'cancelled', 'cancelado']);
  const rows = kind === 'payable' ? payables : receivables;
  const statementAmount = Math.abs(Number(line.amount) || 0);
  if (!(statementAmount > 0)) return [];
  const movementDay = civilDay(line.movement_date);

  return rows.flatMap((row): ScoredBankCandidate[] => {
    if (!UUID.test(row.id) || terminal.has(normalizedStatus(row.status))) return [];
    const remaining = openAmount(row, kind);
    if (statementAmount > remaining + 0.005 || remaining <= 0) return [];
    const exact = Math.abs(remaining - statementAmount) <= 0.005;
    const dueDay = civilDay(row.due_date);
    const dayDistance = movementDay != null && dueDay != null ? Math.abs(movementDay - dueDay) : null;
    const party = kind === 'payable' ? row.suppliers?.name || '' : row.client_name || '';
    const textEvidence = hasTextEvidence(line, party, row.description);

    let score = exact ? 4 : 0;
    if (dayDistance != null) score += dayDistance <= 2 ? 3 : dayDistance <= 7 ? 2 : dayDistance <= 30 ? 1 : 0;
    if (textEvidence) score += 3;
    const confidence: ReconciliationMatchCandidate['confidence'] = score >= 7 ? 'alta' : score >= 5 ? 'media' : 'baixa';
    return [{
      score,
      amountDistance: Math.abs(remaining - statementAmount),
      candidate: {
        kind,
        accountId: row.id,
        description: row.description || 'Título sem descrição',
        party: party || '—',
        dueDate: row.due_date || null,
        openAmount: remaining,
        settlementAmount: statementAmount,
        isPartial: statementAmount < remaining - 0.005,
        confidence,
      },
    }];
  }).sort((a, b) => {
    return b.score - a.score
      || a.amountDistance - b.amountDistance
      || (a.candidate.dueDate || '').localeCompare(b.candidate.dueDate || '')
      || a.candidate.accountId.localeCompare(b.candidate.accountId);
  });
}

/** Sugestão conservadora; somente o comando SQL decide saldo e concorrência. */
export function findBankStatementMatches(
  line: PersistedBankStatementLine,
  payables: ReconciliationFinancialRow[],
  receivables: ReconciliationFinancialRow[],
): ReconciliationMatchCandidate[] {
  return scoredBankStatementCandidates(line, payables, receivables)
    .filter(entry => entry.score >= 3)
    .slice(0, 8)
    .map(entry => entry.candidate);
}

/** Busca humana completa; não promove candidatos fracos a match automático. */
export function listBankStatementEligibleTargets(
  line: PersistedBankStatementLine,
  payables: ReconciliationFinancialRow[],
  receivables: ReconciliationFinancialRow[],
): ReconciliationMatchCandidate[] {
  return scoredBankStatementCandidates(line, payables, receivables)
    .map(entry => entry.candidate);
}

export function maskedBankIdentity(statement: OfxStatement): string {
  const account = statement.account.accountId;
  const visible = account.length <= 4 ? account : `••••${account.slice(-4)}`;
  return [statement.account.bankId, statement.account.branchId, visible].filter(Boolean).join(' · ');
}

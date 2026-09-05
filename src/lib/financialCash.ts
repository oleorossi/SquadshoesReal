import { assertSettlementDate, settlementAmountCents, type SettlementKind } from '@/lib/financialSettlement';

/** Fluxo bancário: AP negativa, AR positiva; estorno tem o sinal inverso. */
export interface FinancialCashMovement {
  id: string;
  kind: SettlementKind;
  account_id: string;
  effective_on: string | null;
  amount_signed: number;
  category: string;
  legacy: boolean;
}

export interface FinancialCashSummary {
  amount: number;
  movements: number;
  legacyDatedCount: number;
  undatedLegacyCount: number;
  undatedLegacyAmount: number;
}

export function signedCashCents(amount: number): number {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) throw new Error('Valor de caixa inválido.');
  if (amount === 0) return 0;
  return Math.sign(amount) * settlementAmountCents(Math.abs(amount));
}

function addSafeCents(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new Error('O total de caixa excede o limite de precisão.');
  return result;
}

/**
 * Eventos são somados em sua própria data, inclusive estornos posteriores.
 * Saldo anterior sem data fica separado e visível, nunca migra para hoje.
 */
export function summarizeFinancialCash(
  rows: FinancialCashMovement[], kind: SettlementKind, startDate: string, endDate: string,
): FinancialCashSummary {
  assertSettlementDate(startDate, '9999-12-31');
  assertSettlementDate(endDate, '9999-12-31');
  if (startDate > endDate) throw new Error('Período de caixa inválido.');
  let cents = 0;
  let undatedCents = 0;
  const summary: FinancialCashSummary = { amount: 0, movements: 0, legacyDatedCount: 0, undatedLegacyCount: 0, undatedLegacyAmount: 0 };
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row.id || seen.has(row.id) || !['payable', 'receivable'].includes(row.kind) || typeof row.legacy !== 'boolean'
      || typeof row.account_id !== 'string' || !row.account_id || typeof row.category !== 'string' || !row.category.trim()) {
      throw new Error('A fonte de caixa contém movimentos inválidos ou repetidos.');
    }
    seen.add(row.id);
    // O relatório pede despesa positiva para AP, embora a saída bancária seja negativa.
    const amount = signedCashCents(row.amount_signed) * (row.kind === 'payable' ? -1 : 1);
    if (!row.effective_on && !row.legacy) throw new Error('Movimento financeiro sem data. O total não foi calculado parcialmente.');
    if (row.effective_on) assertSettlementDate(row.effective_on, '9999-12-31');
    if (row.kind !== kind) continue;
    if (!row.effective_on) {
      summary.undatedLegacyCount++;
      undatedCents = addSafeCents(undatedCents, amount);
      continue;
    }
    if (row.effective_on < startDate || row.effective_on > endDate) continue;
    cents = addSafeCents(cents, amount);
    summary.movements++;
    if (row.legacy) summary.legacyDatedCount++;
  }
  return { ...summary, amount: cents / 100, undatedLegacyAmount: undatedCents / 100 };
}

import {
  isCancelled,
  openBalanceOf,
  settledAmountOf,
  type LedgerKind,
  type LedgerRow,
} from '@/lib/ledgerBalance';

export interface DatedLedgerRow extends LedgerRow {
  payment_date?: string | null;
}

export interface MarginRow {
  revenue: number;
  cost: number;
  margin?: number;
}

export interface MarginSummary {
  revenue: number;
  cost: number;
  margin: number;
  marginPct: number;
}

function finiteNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Percentual seguro: nunca devolve Infinity ou NaN. */
export function percentageOf(numerator: unknown, denominator: unknown): number {
  const safeDenominator = finiteNumber(denominator);
  if (safeDenominator === 0) return 0;
  return (finiteNumber(numerator) / safeDenominator) * 100;
}

/**
 * Margem agregada ponderada pela receita.
 *
 * Somar valores absolutos antes de calcular o percentual evita o erro de dar o
 * mesmo peso para um mês de R$ 1 mil e outro de R$ 100 mil.
 */
export function summarizeMargin(rows: MarginRow[]): MarginSummary {
  const totals = rows.reduce<{ revenue: number; cost: number; margin: number }>(
    (acc, row) => {
      const revenue = finiteNumber(row.revenue);
      const cost = finiteNumber(row.cost);
      acc.revenue += revenue;
      acc.cost += cost;
      acc.margin += row.margin === undefined ? revenue - cost : finiteNumber(row.margin);
      return acc;
    },
    { revenue: 0, cost: 0, margin: 0 },
  );

  return {
    ...totals,
    marginPct: percentageOf(totals.margin, totals.revenue),
  };
}

/** Compara duas metades de uma série usando margens ponderadas. */
export function compareMarginHalves(rows: MarginRow[]) {
  if (rows.length < 2) return null;
  const half = Math.floor(rows.length / 2);
  const first = summarizeMargin(rows.slice(0, half));
  const second = summarizeMargin(rows.slice(half));
  return {
    firstPct: first.marginPct,
    secondPct: second.marginPct,
    delta: second.marginPct - first.marginPct,
  };
}

/** Dinheiro efetivamente pago/recebido dentro do período, em regime de caixa. */
export function sumRealizedInPeriod(
  rows: DatedLedgerRow[],
  kind: LedgerKind,
  startDate: string,
  endDate: string,
): number {
  return rows.reduce((sum, row) => {
    if (isCancelled(row) || !row.payment_date) return sum;
    if (row.payment_date < startDate || row.payment_date > endDate) return sum;
    return sum + settledAmountOf(row, kind);
  }, 0);
}

/** Saldo ainda aberto com vencimento dentro do período — visão de previsão. */
export function sumOpenDueInPeriod(
  rows: DatedLedgerRow[],
  kind: LedgerKind,
  startDate: string,
  endDate: string,
): number {
  return rows.reduce((sum, row) => {
    if (!row.due_date || row.due_date < startDate || row.due_date > endDate) return sum;
    return sum + openBalanceOf(row, kind);
  }, 0);
}

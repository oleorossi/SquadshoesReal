import { describe, expect, it } from 'vitest';
import {
  compareMarginHalves,
  percentageOf,
  summarizeMargin,
  sumOpenDueInPeriod,
  sumRealizedInPeriod,
} from './financeMath';

describe('percentageOf', () => {
  it('não propaga divisão por zero nem valores inválidos', () => {
    expect(percentageOf(10, 0)).toBe(0);
    expect(percentageOf(Number.NaN, 100)).toBe(0);
  });
});

describe('margem ponderada', () => {
  it('pondera pela receita em vez de tirar média simples dos percentuais', () => {
    const summary = summarizeMargin([
      { revenue: 100_000, cost: 80_000 },
      { revenue: 1_000, cost: 0 },
    ]);

    expect(summary.margin).toBe(21_000);
    expect(summary.marginPct).toBeCloseTo(20.792, 3);
    expect(summary.marginPct).not.toBe(60);
  });

  it('compara metades pelo valor agregado de cada período', () => {
    const trend = compareMarginHalves([
      { revenue: 100_000, cost: 80_000 },
      { revenue: 1_000, cost: 0 },
      { revenue: 100_000, cost: 70_000 },
      { revenue: 1_000, cost: 0 },
    ]);

    expect(trend?.firstPct).toBeCloseTo(20.792, 3);
    expect(trend?.secondPct).toBeCloseTo(30.693, 3);
    expect(trend?.delta).toBeCloseTo(9.901, 3);
  });
});

describe('realizado x previsto', () => {
  const rows = [
    { status: 'received', amount: 1_000, amount_received: 1_000, due_date: '2026-08-05', payment_date: '2026-08-10' },
    { status: 'parcial', amount: 1_000, amount_received: 300, due_date: '2026-08-20', payment_date: '2026-08-12' },
    { status: 'pending', amount: 500, amount_received: 0, due_date: '2026-09-02', payment_date: null },
    { status: 'cancelled', amount: 9_999, amount_received: 9_999, due_date: '2026-08-15', payment_date: '2026-08-15' },
  ];

  it('soma caixa pela data do pagamento e pelo valor efetivamente recebido', () => {
    expect(sumRealizedInPeriod(rows, 'receivable', '2026-08-01', '2026-08-31')).toBe(1_300);
  });

  it('soma previsão pelo saldo ainda aberto e pela data de vencimento', () => {
    expect(sumOpenDueInPeriod(rows, 'receivable', '2026-08-01', '2026-08-31')).toBe(700);
  });
});

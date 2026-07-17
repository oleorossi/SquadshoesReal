import { describe, it, expect } from 'vitest';
import {
  parseDaysInput,
  formatDaysLabel,
  simpleFactoringPct,
  computeMarkupPrice,
  deriveMarginFromTargetProfit,
  computeReverseAnalysis,
  CASH_DAYS,
} from './markupCalc';

describe('parseDaysInput', () => {
  it('número simples', () => expect(parseDaysInput('60')).toBe(60));
  it('parcelas "30/60/90" → média 60', () => expect(parseDaysInput('30/60/90')).toBe(60));
  it('vazio/inválido → 0', () => {
    expect(parseDaysInput('')).toBe(0);
    expect(parseDaysInput('abc')).toBe(0);
  });
  it('ignora parte inválida ("30//60" → média 45)', () => expect(parseDaysInput('30//60')).toBe(45));
});

describe('formatDaysLabel', () => {
  it('simples → "60d"', () => expect(formatDaysLabel('60')).toBe('60d'));
  it('vazio → "0d"', () => expect(formatDaysLabel('')).toBe('0d'));
  it('parcelas mostram a média', () => expect(formatDaysLabel('30/60/90')).toBe('30/60/90 (média 60,00d)'));
});

describe('computeMarkupPrice (fórmula direta)', () => {
  it('caso base: custo 20, imposto 6%, comissão 5%, margem 25% → divisor 0,64', () => {
    const r = computeMarkupPrice({
      totalCost: 20, taxPct: 6, profitPct: 25, factoringMonthlyPct: 0, days: 0, commissionPct: 5,
    });
    expect(r.isValid).toBe(true);
    expect(r.suggestedPrice).toBeCloseTo(20 / 0.64, 6);
    expect(r.realProfit).toBeCloseTo(r.suggestedPrice * 0.25, 6);
    // Conservação: preço − partes = custo
    expect(r.suggestedPrice - r.taxValue - r.commissionValue - r.factoringValue - r.realProfit)
      .toBeCloseTo(20, 6);
  });

  it('factoring simples: 3% a.m. × 60 dias = 6% do preço', () => {
    const r = computeMarkupPrice({
      totalCost: 50, taxPct: 0, profitPct: 0, factoringMonthlyPct: 3, days: 60, commissionPct: 0,
    });
    expect(r.factoringTotalPct).toBeCloseTo(6, 6);
    expect(r.suggestedPrice).toBeCloseTo(50 / 0.94, 6);
  });

  it('taxas ≥ 100% → inválido, preço 0', () => {
    const r = computeMarkupPrice({
      totalCost: 10, taxPct: 60, profitPct: 45, factoringMonthlyPct: 0, days: 0, commissionPct: 0,
    });
    expect(r.isValid).toBe(false);
    expect(r.suggestedPrice).toBe(0);
    expect(r.cashPrice).toBe(0);
  });

  it('à vista usa min(CASH_DAYS, prazo): prazo 60d → à vista com 7d de factoring', () => {
    const r = computeMarkupPrice({
      totalCost: 30, taxPct: 6, profitPct: 20, factoringMonthlyPct: 3, days: 60, commissionPct: 5,
    });
    const vistaPct = simpleFactoringPct(3, CASH_DAYS);
    const expected = 30 / (1 - (6 + 20 + vistaPct + 5) / 100);
    expect(r.cashPrice).toBeCloseTo(expected, 6);
    expect(r.cashPrice).toBeLessThan(r.suggestedPrice);
  });

  it('à vista NUNCA maior que a prazo quando o prazo é curto (< 7 dias)', () => {
    const r = computeMarkupPrice({
      totalCost: 30, taxPct: 6, profitPct: 20, factoringMonthlyPct: 3, days: 3, commissionPct: 5,
    });
    // min(7, 3) = 3 → à vista = a prazo (mesmos dias de factoring)
    expect(r.cashPrice).toBeCloseTo(r.suggestedPrice, 6);
  });
});

describe('deriveMarginFromTargetProfit (modo inverso "quero receber")', () => {
  it('R$ 10 líquido em custo R$ 15 sem taxas → margem 40%, preço R$ 25', () => {
    const margin = deriveMarginFromTargetProfit({
      totalCost: 15, taxPct: 0, factoringMonthlyPct: 0, days: 0, commissionPct: 0, targetProfitBrl: 10,
    });
    expect(margin).toBeCloseTo(40, 6);
  });

  it('round-trip: margem derivada reaplicada na direta devolve o mesmo lucro-alvo', () => {
    const p = { totalCost: 50, taxPct: 6, factoringMonthlyPct: 3, days: 60, commissionPct: 5 };
    const margin = deriveMarginFromTargetProfit({ ...p, targetProfitBrl: 15 });
    expect(margin).not.toBeNull();
    const direct = computeMarkupPrice({ ...p, profitPct: margin! });
    expect(direct.realProfit).toBeCloseTo(15, 6);
    expect(direct.suggestedPrice).toBeCloseTo(65 / (1 - 0.17), 4); // (custo+alvo)/(1−K)
  });

  it('alvo ≤ 0 ou K ≥ 100% → null (caller usa a margem manual)', () => {
    expect(deriveMarginFromTargetProfit({
      totalCost: 10, taxPct: 0, factoringMonthlyPct: 0, days: 0, commissionPct: 0, targetProfitBrl: 0,
    })).toBeNull();
    expect(deriveMarginFromTargetProfit({
      totalCost: 10, taxPct: 60, factoringMonthlyPct: 0, days: 0, commissionPct: 50, targetProfitBrl: 5,
    })).toBeNull();
  });
});

describe('computeReverseAnalysis (margem real de venda praticada)', () => {
  it('inverso exato: preço da direta → reversa recupera a MESMA margem', () => {
    const direct = computeMarkupPrice({
      totalCost: 20 + 3 + 2, taxPct: 6, profitPct: 25, factoringMonthlyPct: 3, days: 60, commissionPct: 5,
    });
    const rev = computeReverseAnalysis({
      soldPrice: direct.suggestedPrice, materialCost: 20, overhead: 3, freight: 2,
      taxPct: 6, factoringMonthlyPct: 3, days: 60, commissionPct: 5,
    });
    expect(rev).not.toBeNull();
    expect(rev!.realMarginPct).toBeCloseTo(25, 6);
    expect(rev!.realProfit).toBeCloseTo(direct.realProfit, 6);
    // Preço sugerido com a margem recuperada = preço original
    expect(rev!.suggestedPrice).toBeCloseTo(direct.suggestedPrice, 6);
  });

  it('entrada inválida (preço ou custo ≤ 0) → null', () => {
    const base = { taxPct: 6, factoringMonthlyPct: 0, days: 0, commissionPct: 5, overhead: 0, freight: 0 };
    expect(computeReverseAnalysis({ ...base, soldPrice: 0, materialCost: 10 })).toBeNull();
    expect(computeReverseAnalysis({ ...base, soldPrice: 22.9, materialCost: 0 })).toBeNull();
  });

  it('venda no prejuízo: margem negativa e à vista clampado em 0 quando nonsense', () => {
    const rev = computeReverseAnalysis({
      soldPrice: 10, materialCost: 100, overhead: 0, freight: 0,
      taxPct: 6, factoringMonthlyPct: 0, days: 0, commissionPct: 5,
    });
    expect(rev!.realMarginPct).toBeLessThan(0);
    // totalCost + realProfit = netRevenue (10 × 0,89 = 8,9 > 0) → à vista pequeno mas ≥ 0
    expect(rev!.cashPrice).toBeGreaterThanOrEqual(0);
  });

  it('markup bruto = (preço − custo total) / custo total', () => {
    const rev = computeReverseAnalysis({
      soldPrice: 30, materialCost: 10, overhead: 3, freight: 2,
      taxPct: 0, factoringMonthlyPct: 0, days: 0, commissionPct: 0,
    });
    expect(rev!.markupPct).toBeCloseTo(100, 6); // (30 − 15) / 15
  });
});

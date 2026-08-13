import { describe, it, expect } from 'vitest';
import {
  parseDaysInput,
  parseDaysInstallments,
  formatDaysLabel,
  compoundFactoringPct,
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
  it('preserva cada parcela para o factoring composto', () => {
    expect(parseDaysInstallments('30/60/90')).toEqual([30, 60, 90]);
    expect(compoundFactoringPct(3, parseDaysInstallments('30/60/90')))
      .toBeCloseTo((1 - ((1 / 1.03) + (1 / 1.03 ** 2) + (1 / 1.03 ** 3)) / 3) * 100, 6);
  });
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

  it('factoring composto: 3% a.m. por 60 dias usa o mesmo desconto do financeiro', () => {
    const r = computeMarkupPrice({
      totalCost: 50, taxPct: 0, profitPct: 0, factoringMonthlyPct: 3, days: 60, commissionPct: 0,
    });
    const discountPct = compoundFactoringPct(3, 60);
    expect(discountPct).toBeCloseTo((1 - 1 / (1.03 ** 2)) * 100, 6);
    expect(r.factoringTotalPct).toBeCloseTo(discountPct, 6);
    expect(r.suggestedPrice).toBeCloseTo(50 / (1 - discountPct / 100), 6);
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
    const vistaPct = compoundFactoringPct(3, CASH_DAYS);
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
    const k = 6 + compoundFactoringPct(3, 60) + 5;
    expect(direct.suggestedPrice).toBeCloseTo(65 / (1 - k / 100), 4); // (custo+alvo)/(1−K)
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
      soldPrice: direct.suggestedPrice, materialCost: 20, labor: 0, overhead: 3, packaging: 0, freight: 2,
      taxPct: 6, factoringMonthlyPct: 3, days: 60, commissionPct: 5,
    });
    expect(rev).not.toBeNull();
    expect(rev!.realMarginPct).toBeCloseTo(25, 6);
    expect(rev!.realProfit).toBeCloseTo(direct.realProfit, 6);
    // Preço sugerido com a margem recuperada = preço original
    expect(rev!.suggestedPrice).toBeCloseTo(direct.suggestedPrice, 6);
  });

  it('entrada inválida (preço ou custo ≤ 0) → null', () => {
    const base = { taxPct: 6, factoringMonthlyPct: 0, days: 0, commissionPct: 5, labor: 0, overhead: 0, packaging: 0, freight: 0 };
    expect(computeReverseAnalysis({ ...base, soldPrice: 0, materialCost: 10 })).toBeNull();
    expect(computeReverseAnalysis({ ...base, soldPrice: 22.9, materialCost: 0 })).toBeNull();
  });

  it('venda no prejuízo: margem negativa e à vista clampado em 0 quando nonsense', () => {
    const rev = computeReverseAnalysis({
      soldPrice: 10, materialCost: 100, labor: 0, overhead: 0, packaging: 0, freight: 0,
      taxPct: 6, factoringMonthlyPct: 0, days: 0, commissionPct: 5,
    });
    expect(rev!.realMarginPct).toBeLessThan(0);
    // totalCost + realProfit = netRevenue (10 × 0,89 = 8,9 > 0) → à vista pequeno mas ≥ 0
    expect(rev!.cashPrice).toBeGreaterThanOrEqual(0);
  });

  it('markup bruto = (preço − custo total) / custo total', () => {
    const rev = computeReverseAnalysis({
      soldPrice: 30, materialCost: 10, labor: 0, overhead: 3, packaging: 0, freight: 2,
      taxPct: 0, factoringMonthlyPct: 0, days: 0, commissionPct: 0,
    });
    expect(rev!.markupPct).toBeCloseTo(100, 6); // (30 − 15) / 15
  });

  it('inclui mão de obra e embalagem na margem real e mantém paridade com a direta', () => {
    const totalCost = 20 + 4 + 3 + 2 + 1;
    const direct = computeMarkupPrice({
      totalCost, taxPct: 6, profitPct: 20, factoringMonthlyPct: 3, days: 60, commissionPct: 5,
    });
    const rev = computeReverseAnalysis({
      soldPrice: direct.suggestedPrice, materialCost: 20, labor: 4, overhead: 3, packaging: 2, freight: 1,
      taxPct: 6, factoringMonthlyPct: 3, days: 60, commissionPct: 5,
    });
    expect(rev).not.toBeNull();
    expect(rev!.totalCost).toBeCloseTo(totalCost, 6);
    expect(rev!.realMarginPct).toBeCloseTo(20, 6);
  });
});

import { describe, it, expect } from 'vitest';
import {
  parseDaysInput,
  parseDaysInstallments,
  formatDaysLabel,
  averageDays,
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
  it('preserva cada parcela e calcula deságio linear no prazo médio', () => {
    expect(parseDaysInstallments('30/60/90')).toEqual([30, 60, 90]);
    // 3% a.m. × (60/30) = 6%
    expect(simpleFactoringPct(3, parseDaysInstallments('30/60/90'))).toBeCloseTo(6, 6);
  });
});

describe('formatDaysLabel', () => {
  it('simples → "60d"', () => expect(formatDaysLabel('60')).toBe('60d'));
  it('vazio → "0d"', () => expect(formatDaysLabel('')).toBe('0d'));
  it('parcelas mostram a média', () => expect(formatDaysLabel('30/60/90')).toBe('30/60/90 (média 60,00d)'));
});

describe('simpleFactoringPct (deságio linear MALUPE)', () => {
  it('CASH_DAYS = 3 (à vista)', () => {
    expect(CASH_DAYS).toBe(3);
  });

  it('3% a.m. × 60d = 6% (simples)', () => {
    expect(simpleFactoringPct(3, 60)).toBeCloseTo(6, 6);
  });

  it('30/60 → média 45 → 3% × 45/30 = 4,5%', () => {
    expect(averageDays([30, 60])).toBe(45);
    expect(simpleFactoringPct(3, [30, 60])).toBeCloseTo(4.5, 6);
  });

  it('caso ouro MALUPE op. 296: face 16.488 → líquido 15.750,50 em 42d', () => {
    // deságio R$ 737,50 / 16.488 = 4,47295…% → taxa = 4,47295 × 30/42 ≈ 3,19496% a.m.
    const face = 16488;
    const net = 15750.5;
    const days = 42;
    const ratePct = ((face - net) / face) * (30 / days) * 100;
    const discPct = simpleFactoringPct(ratePct, days);
    const predictedNet = face * (1 - discPct / 100);
    expect(predictedNet).toBeCloseTo(net, 2);
    expect(Math.round((face - predictedNet) * 100) / 100).toBeCloseTo(737.5, 2);
  });

  it('taxa ou prazo zero → 0', () => {
    expect(simpleFactoringPct(0, 60)).toBe(0);
    expect(simpleFactoringPct(3, 0)).toBe(0);
    expect(simpleFactoringPct(3, [])).toBe(0);
  });
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

  it('factoring simples: 3% a.m. por 60 dias = 6% de deságio', () => {
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

  it('à vista usa min(CASH_DAYS, prazo): prazo 60d → à vista com 3d de factoring', () => {
    const r = computeMarkupPrice({
      totalCost: 30, taxPct: 6, profitPct: 20, factoringMonthlyPct: 3, days: 60, commissionPct: 5,
    });
    const vistaPct = simpleFactoringPct(3, CASH_DAYS); // 3% × 3/30 = 0,3%
    const expected = 30 / (1 - (6 + 20 + vistaPct + 5) / 100);
    expect(r.cashPrice).toBeCloseTo(expected, 6);
    expect(r.cashPrice).toBeLessThan(r.suggestedPrice);
  });

  it('à vista NUNCA maior que a prazo quando o prazo é curto (< 3 dias)', () => {
    const r = computeMarkupPrice({
      totalCost: 30, taxPct: 6, profitPct: 20, factoringMonthlyPct: 3, days: 2, commissionPct: 5,
    });
    // min(3, 2) = 2 → à vista = a prazo
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
    const k = 6 + simpleFactoringPct(3, 60) + 5; // 6 + 6 + 5 = 17
    expect(direct.suggestedPrice).toBeCloseTo(65 / (1 - k / 100), 4);
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
    expect(rev!.suggestedPrice).toBeCloseTo(direct.suggestedPrice, 6);
  });

  it('cascata: lucro da reversa = líquido na conta − custos (mesmo do simulador)', () => {
    const direct = computeMarkupPrice({
      totalCost: 13.49 + 1.2, taxPct: 6.5, profitPct: 15, factoringMonthlyPct: 3.2, days: [30, 60], commissionPct: 5,
    });
    const liquidoConta = direct.suggestedPrice - direct.taxValue - direct.commissionValue - direct.factoringValue;
    const lucroBolso = liquidoConta - (13.49 + 1.2);
    expect(lucroBolso).toBeCloseTo(direct.realProfit, 6);

    const rev = computeReverseAnalysis({
      soldPrice: direct.suggestedPrice, materialCost: 13.49, labor: 0, overhead: 1.2, packaging: 0, freight: 0,
      taxPct: 6.5, factoringMonthlyPct: 3.2, days: [30, 60], commissionPct: 5,
    });
    expect(rev!.realProfit).toBeCloseTo(direct.realProfit, 6);
    expect(rev!.netRevenue).toBeCloseTo(liquidoConta, 6);
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
    expect(rev!.cashPrice).toBeGreaterThanOrEqual(0);
  });

  it('markup bruto = (preço − custo total) / custo total', () => {
    const rev = computeReverseAnalysis({
      soldPrice: 30, materialCost: 10, labor: 0, overhead: 3, packaging: 0, freight: 2,
      taxPct: 0, factoringMonthlyPct: 0, days: 0, commissionPct: 0,
    });
    expect(rev!.markupPct).toBeCloseTo(100, 6);
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

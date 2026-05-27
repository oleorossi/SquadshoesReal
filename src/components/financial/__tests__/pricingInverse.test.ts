import { describe, it, expect } from 'vitest';

/**
 * Replica a lógica de cálculo do simulador Markup pra validar a fórmula
 * inversa "Quero receber líquido (R$/par)" introduzida em 24/05/2026.
 *
 * Fórmula inversa (deriva margem % a partir do target_profit_brl):
 *   sale_price = (totalCost + target_profit_brl) / (1 - (tax + factoring + commission)/100)
 *   margin_pct = (target_profit_brl / sale_price) * 100
 *
 * Validação chave: substituindo margin_pct de volta na fórmula original
 * (markup divisor) deve gerar o MESMO sale_price.
 */
function calcInverse(opts: {
  cost: number;
  tax: number;        // %
  factoring: number;  // % a.m.
  days: number;
  commission: number; // %
  freight: number;    // R$
  overhead: number;   // R$
  targetProfitBrl: number;
}) {
  const totalCost = opts.cost + opts.overhead + opts.freight;
  const factoringTotalPct = (opts.factoring / 30) * opts.days;
  const nonMarginPct = opts.tax + factoringTotalPct + opts.commission;
  const denom = 1 - (nonMarginPct / 100);
  if (denom <= 0) return null;
  const salePrice = (totalCost + opts.targetProfitBrl) / denom;
  const marginPct = (opts.targetProfitBrl / salePrice) * 100;
  // Re-aplica fórmula direta pra validar
  const totalMarkupPct = opts.tax + marginPct + factoringTotalPct + opts.commission;
  const markupDivisor = 1 - (totalMarkupPct / 100);
  const salePriceForward = totalCost / markupDivisor;
  return { salePrice, marginPct, salePriceForward };
}

describe('Pricing — modo inverso (target profit)', () => {
  it('R$ 10 líquido em custo R$ 15 sem outras taxas → margem 40%, preço R$ 25', () => {
    // sale = (15 + 10) / 1 = 25; margem = 10/25 = 40%
    const r = calcInverse({
      cost: 15, tax: 0, factoring: 0, days: 0, commission: 0,
      freight: 0, overhead: 0, targetProfitBrl: 10,
    });
    expect(r).not.toBeNull();
    expect(r!.salePrice).toBeCloseTo(25, 2);
    expect(r!.marginPct).toBeCloseTo(40, 2);
  });

  it('com imposto 6% + comissão 5%: preço inverso bate com fórmula direta', () => {
    const r = calcInverse({
      cost: 20, tax: 6, factoring: 0, days: 0, commission: 5,
      freight: 0, overhead: 0, targetProfitBrl: 10,
    });
    expect(r).not.toBeNull();
    // sale = (20 + 10) / (1 - 0.11) = 30/0.89 = ~33.708
    expect(r!.salePrice).toBeCloseTo(33.7079, 3);
    // re-aplicado com a margem derivada deve dar o mesmo preço
    expect(r!.salePriceForward).toBeCloseTo(r!.salePrice, 2);
  });

  it('com factoring 3%/mês × 60 dias = 6% efetivo', () => {
    const r = calcInverse({
      cost: 50, tax: 6, factoring: 3, days: 60, commission: 5,
      freight: 0, overhead: 0, targetProfitBrl: 15,
    });
    expect(r).not.toBeNull();
    // nonMarginPct = 6 + 6 + 5 = 17 → denom = 0.83
    // sale = (50 + 15) / 0.83 = ~78.31
    expect(r!.salePrice).toBeCloseTo(78.3133, 2);
    expect(r!.salePriceForward).toBeCloseTo(r!.salePrice, 2);
  });

  it('inclui overhead + frete no custo total', () => {
    const r = calcInverse({
      cost: 10, tax: 0, factoring: 0, days: 0, commission: 0,
      freight: 2, overhead: 3, targetProfitBrl: 5,
    });
    // totalCost = 10+3+2 = 15; sale = (15+5)/1 = 20; margem = 5/20 = 25%
    expect(r!.salePrice).toBeCloseTo(20, 2);
    expect(r!.marginPct).toBeCloseTo(25, 2);
  });

  it('retorna null quando taxas totais ≥ 100% (impossível)', () => {
    const r = calcInverse({
      cost: 10, tax: 60, factoring: 0, days: 0, commission: 50,
      freight: 0, overhead: 0, targetProfitBrl: 5,
    });
    expect(r).toBeNull();
  });

  it('PV real: cabedal R$ 15, imposto 6%, factoring 3% × 60d, margem alvo R$ 10', () => {
    const r = calcInverse({
      cost: 15, tax: 6, factoring: 3, days: 60, commission: 5,
      freight: 0, overhead: 0, targetProfitBrl: 10,
    });
    // nonMarginPct = 6 + 6 + 5 = 17 → denom = 0.83
    // sale = (15 + 10) / 0.83 = ~30.12
    expect(r!.salePrice).toBeCloseTo(30.1205, 2);
    // margem = 10/30.12 ≈ 33.2%
    expect(r!.marginPct).toBeGreaterThan(33);
    expect(r!.marginPct).toBeLessThan(34);
  });
});

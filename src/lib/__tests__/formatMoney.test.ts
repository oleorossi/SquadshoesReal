import { describe, it, expect } from 'vitest';
import { formatMoney, formatCurrency } from '../utils';

// Regressão do relatório "Materiais necessários" (Compras por Pedido), 2026-07-20:
// totais saíam com 3–4 casas ("Total estimado: R$ 12.689,945", "R$ 967,2672")
// porque usavam formatCurrency, que vai até 4 casas de propósito (preço unitário).
// A regra: TOTAL fecha em 2 casas; PREÇO UNITÁRIO mantém a precisão cadastrada.

const nbsp = (s: string) => s.replace(/ /g, ' ');

describe('formatMoney — dinheiro fechado (total/subtotal)', () => {
  it('sempre 2 casas, padrão R$ 0.000,00', () => {
    expect(nbsp(formatMoney(12689.945))).toBe('R$ 12.689,95');
    expect(nbsp(formatMoney(967.2672))).toBe('R$ 967,27');
    expect(nbsp(formatMoney(5360.221))).toBe('R$ 5.360,22');
    expect(nbsp(formatMoney(1695.705))).toBe('R$ 1.695,71');
    expect(nbsp(formatMoney(450.7052))).toBe('R$ 450,71');
  });

  it('completa casas em valor inteiro', () => {
    expect(nbsp(formatMoney(1056))).toBe('R$ 1.056,00');
    expect(nbsp(formatMoney(0))).toBe('R$ 0,00');
  });

  it('entrada suja não quebra (null/undefined/string pt-BR)', () => {
    expect(nbsp(formatMoney(null))).toBe('R$ 0,00');
    expect(nbsp(formatMoney(undefined))).toBe('R$ 0,00');
    expect(nbsp(formatMoney('1,5'))).toBe('R$ 1,50');
  });

  it('negativo mantém 2 casas', () => {
    expect(nbsp(formatMoney(-50.005))).toBe('-R$ 50,01');
  });
});

describe('formatCurrency — preço unitário (mantém precisão)', () => {
  it('NÃO arredonda sub-centavo pra 2 casas (senão o total não fecha)', () => {
    // 4.608 un × R$ 0,031 = R$ 142,85. Se o preço virasse R$ 0,03 → R$ 138,24.
    expect(nbsp(formatCurrency(0.031))).toBe('R$ 0,031');
    expect(nbsp(formatCurrency(17.995))).toBe('R$ 17,995');
  });

  it('preço "redondo" continua com 2 casas', () => {
    expect(nbsp(formatCurrency(24.9))).toBe('R$ 24,90');
    expect(nbsp(formatCurrency(1.9))).toBe('R$ 1,90');
  });
});

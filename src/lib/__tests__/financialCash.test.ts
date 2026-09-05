import { describe, expect, it } from 'vitest';
import { summarizeFinancialCash, type FinancialCashMovement } from '@/lib/financialCash';

function row(id: string, date: string | null, amount: number, overrides: Partial<FinancialCashMovement> = {}): FinancialCashMovement {
  return { id, kind: 'receivable', account_id: 'titulo-a', effective_on: date, amount_signed: amount, category: 'venda', legacy: false, ...overrides };
}

describe('caixa por evento', () => {
  it('mantém baixas parciais em meses distintos, sem mover o acumulado para a última data', () => {
    const rows = [row('a', '2026-08-15', 300), row('b', '2026-09-01', 700)];
    expect(summarizeFinancialCash(rows, 'receivable', '2026-08-01', '2026-08-31').amount).toBe(300);
    expect(summarizeFinancialCash(rows, 'receivable', '2026-09-01', '2026-09-30').amount).toBe(700);
  });
  it('estorno posterior reduz o caixa no mês do estorno e preserva o movimento original', () => {
    const rows = [row('a', '2026-08-15', 300), row('b', '2026-09-01', -300)];
    expect(summarizeFinancialCash(rows, 'receivable', '2026-08-01', '2026-08-31').amount).toBe(300);
    expect(summarizeFinancialCash(rows, 'receivable', '2026-09-01', '2026-09-30').amount).toBe(-300);
    expect(summarizeFinancialCash(rows, 'receivable', '2026-08-01', '2026-09-30').amount).toBe(0);
    expect(rows[0].amount_signed).toBe(300);
  });
  it('não inventa data para saldo antigo, nem o trata como zero desconhecido', () => {
    const rows = [row('abertura', null, 150, { legacy: true }), row('novo', '2026-09-02', 50)];
    expect(summarizeFinancialCash(rows, 'receivable', '2026-09-01', '2026-09-30')).toEqual({
      amount: 50, movements: 1, legacyDatedCount: 0, undatedLegacyCount: 1, undatedLegacyAmount: 150,
    });
  });
  it('identifica valor legado datado sem alegar discriminação histórica', () => {
    expect(summarizeFinancialCash([row('antigo', '2026-09-01', 10, { legacy: true })], 'receivable', '2026-09-01', '2026-09-30').legacyDatedCount).toBe(1);
  });
  it('separa entrada e saída, soma centavos sem deriva binária', () => {
    const rows = [row('a', '2026-09-01', 0.1), row('b', '2026-09-02', 0.2), row('c', '2026-09-03', -0.05, { kind: 'payable' })];
    expect(summarizeFinancialCash(rows, 'receivable', '2026-09-01', '2026-09-30').amount).toBe(0.3);
    expect(summarizeFinancialCash(rows, 'payable', '2026-09-01', '2026-09-30').amount).toBe(0.05);
  });
  it('saída bancária vira despesa positiva e estorno de AP reduz a despesa', () => {
    const rows = [row('pagamento', '2026-08-01', -125, { kind: 'payable' }), row('estorno', '2026-09-02', 25, { kind: 'payable' })];
    expect(summarizeFinancialCash(rows, 'payable', '2026-08-01', '2026-08-31').amount).toBe(125);
    expect(summarizeFinancialCash(rows, 'payable', '2026-09-01', '2026-09-30').amount).toBe(-25);
  });
  it.each([NaN, Infinity, -Infinity, 0.001, -0.001])('recusa quantidade inválida %s sem ocultar movimento', amount => {
    expect(() => summarizeFinancialCash([row('a', '2026-09-01', amount)], 'receivable', '2026-09-01', '2026-09-30')).toThrow();
  });
  it('não aceita IDs repetidos nem evento novo sem data ou com data impossível', () => {
    const a = row('a', '2026-09-01', 1);
    for (const rows of [[a, a], [row('b', null, 1)], [row('c', '2026-02-30', 1)]]) {
      expect(() => summarizeFinancialCash(rows, 'receivable', '2026-09-01', '2026-09-30')).toThrow();
    }
  });
  it('não deixa erro em fonte de outro tipo passar como relatório íntegro', () => {
    expect(() => summarizeFinancialCash([row('a', null, 1, { kind: 'payable' })], 'receivable', '2026-09-01', '2026-09-30')).toThrow();
  });
  it('exige período válido e inclui suas duas extremidades', () => {
    const rows = [row('a', '2026-09-01', 1), row('b', '2026-09-30', 1), row('c', '2026-10-01', 1)];
    expect(summarizeFinancialCash(rows, 'receivable', '2026-09-01', '2026-09-30').amount).toBe(2);
    expect(() => summarizeFinancialCash(rows, 'receivable', '2026-10-01', '2026-09-30')).toThrow();
  });
});

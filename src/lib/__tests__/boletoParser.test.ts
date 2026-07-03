import { describe, it, expect } from 'vitest';
import {
  parseDigitableLine,
  extractDigitableLine,
  fatorVencimentoToDate,
  formatDigitableLine,
  bankNameFromCode,
} from '../boletoParser';

// Data fixa pra deixar a lógica de rollover do fator de vencimento determinística.
const NOW = Date.UTC(2026, 6, 3); // 2026-07-03

describe('fatorVencimentoToDate', () => {
  it('mapeia o fator reiniciado (1000) para 22/02/2025 (reset FEBRABAN)', () => {
    expect(fatorVencimentoToDate(1000, NOW)).toBe('2025-02-22');
  });

  it('retorna null quando o fator é zero (boleto sem vencimento)', () => {
    expect(fatorVencimentoToDate(0, NOW)).toBeNull();
  });

  it('escolhe a data plausível mais próxima de hoje no rollover', () => {
    const iso = fatorVencimentoToDate(3737, NOW)!;
    const year = Number(iso.slice(0, 4));
    expect(year).toBeGreaterThanOrEqual(2021);
    expect(year).toBeLessThanOrEqual(2033);
  });
});

describe('parseDigitableLine (boleto bancário)', () => {
  // Linha digitável real de Banco do Brasil (DVs conferem).
  const line = '00190500954014481606906809350314337370000000100';

  it('decodifica banco, valor e valida os dígitos verificadores', () => {
    const p = parseDigitableLine(line, NOW);
    expect(p.kind).toBe('bancario');
    expect(p.bankCode).toBe('001');
    expect(p.bankName).toBe('Banco do Brasil');
    expect(p.amount).toBe(1); // 0000000100 centavos = R$ 1,00
    expect(p.valid).toBe(true);
    expect(p.barcode).toHaveLength(44);
  });

  it('aceita a linha com máscara (pontos e espaços)', () => {
    const masked = '00190.50095 40144.816069 06809.350314 3 37370000000100';
    const p = parseDigitableLine(masked, NOW);
    expect(p.bankCode).toBe('001');
    expect(p.amount).toBe(1);
  });

  it('rejeita linha com contagem de dígitos inválida', () => {
    expect(() => parseDigitableLine('123456', NOW)).toThrow();
  });
});

describe('extractDigitableLine', () => {
  it('encontra a linha digitável dentro de texto ruidoso de PDF', () => {
    const messy =
      'Pague este boleto  Linha Digitável: 00190.50095 40144.816069 ' +
      '06809.350314 3 37370000000100  Vencimento 15/03/2026';
    expect(extractDigitableLine(messy)).toBe('00190500954014481606906809350314337370000000100');
  });

  it('retorna null quando não há linha digitável', () => {
    expect(extractDigitableLine('boleto sem código algum aqui')).toBeNull();
  });
});

describe('formatDigitableLine', () => {
  it('aplica a máscara padrão de 47 dígitos', () => {
    expect(formatDigitableLine('00190500954014481606906809350314337370000000100')).toBe(
      '00190.50095 40144.816069 06809.350314 3 37370000000100',
    );
  });
});

describe('bankNameFromCode', () => {
  it('resolve bancos conhecidos e devolve null pra desconhecidos', () => {
    expect(bankNameFromCode('341')).toBe('Itaú');
    expect(bankNameFromCode('237')).toBe('Bradesco');
    expect(bankNameFromCode('999')).toBeNull();
    expect(bankNameFromCode(null)).toBeNull();
  });
});

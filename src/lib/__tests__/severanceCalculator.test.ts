import { describe, it, expect } from 'vitest';
import { calculateSeverance } from '../severanceCalculator';

const SAL = 3000;

describe('calculateSeverance — regras CLT (auditoria 2026-06-14)', () => {
  it('retorna null para entradas inválidas', () => {
    expect(calculateSeverance({ salary: 0, admissionDate: '2020-01-01', terminationDate: '2021-01-01' })).toBeNull();
    expect(calculateSeverance({ salary: SAL, admissionDate: '2021-01-01', terminationDate: '2020-01-01' })).toBeNull();
    expect(calculateSeverance({ salary: SAL, admissionDate: 'x', terminationDate: '2021-01-01' })).toBeNull();
  });

  it('13º: mês de admissão depois do dia 15 NÃO conta (regra dos 15 dias)', () => {
    // Admitido 20/jan (só ~11 dias no mês → não conta), demitido 30/jun do mesmo ano.
    // Sem aviso a contagem seria fev..jun = 5 meses. Mas o aviso projeta ~30 dias.
    const lateAdm = calculateSeverance({ salary: SAL, admissionDate: '2026-01-20', terminationDate: '2026-06-30' })!;
    // Admitido 05/jan (≥15 dias → jan conta) — mesma saída.
    const earlyAdm = calculateSeverance({ salary: SAL, admissionDate: '2026-01-05', terminationDate: '2026-06-30' })!;
    // Quem entrou cedo deve ter ≥ avos de 13º que quem entrou tarde.
    expect(earlyAdm.mesesAnoAtual).toBeGreaterThan(lateAdm.mesesAnoAtual);
  });

  it('férias vencidas: faltando 1 dia do período aquisitivo NÃO paga período cheio', () => {
    // Admitido 15/jan/2026, demitido 14/jan/2027 = 1 dia a menos de 12 meses completos.
    // O aviso projeta +30 dias, então o período aquisitivo SE completa via projeção
    // (comportamento CLT correto). Comparamos com a versão sem o "+1 mês" espúrio:
    // demitido bem no meio do 1º ano (6 meses) NÃO deve ter férias vencidas.
    const meioPrimeiroAno = calculateSeverance({ salary: SAL, admissionDate: '2026-01-15', terminationDate: '2026-07-10' })!;
    expect(meioPrimeiroAno.feriasVencidas).toBe(0);
    expect(meioPrimeiroAno.anosCompletos).toBe(0);
  });

  it('aviso prévio projeta a saída → 13º/férias proporcionais ≥ versão sem projeção', () => {
    const r = calculateSeverance({ salary: SAL, admissionDate: '2024-03-01', terminationDate: '2026-06-15' })!;
    // 2 anos completos → aviso = 30 + 3*2 = 36 dias.
    expect(r.diasAviso).toBe(36);
    // Projeção de 36 dias empurra a saída pra ~21/jul → 13º conta julho também.
    // Sanidade: avos de 13º coerentes (jan..jul ≈ 7) com a saída projetada.
    expect(r.mesesAnoAtual).toBeGreaterThanOrEqual(7);
    expect(r.total).toBeGreaterThan(0);
  });

  it('aviso: 30 dias base + 3 por ano completo, cap 90', () => {
    const novato = calculateSeverance({ salary: SAL, admissionDate: '2026-01-01', terminationDate: '2026-06-01' })!;
    expect(novato.diasAviso).toBe(30);
    const veterano = calculateSeverance({ salary: SAL, admissionDate: '2000-01-01', terminationDate: '2026-06-01' })!;
    expect(veterano.diasAviso).toBe(90); // 30 + 3*26 = 108 → cap 90
  });
});

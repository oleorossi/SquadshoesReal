import { describe, it, expect } from 'vitest';
import { calculateSeverance } from '../severanceCalculator';
import { QUADRO_PJ, isQuadroPj } from '../payrollContract';

const SAL = 3000;
const clt = { contractKind: 'clt' as const };

describe('quadro PJ (decisão 2026-08-29)', () => {
  it('QUADRO_PJ está ligado', () => {
    expect(QUADRO_PJ).toBe(true);
    expect(isQuadroPj()).toBe(true);
    expect(isQuadroPj(undefined)).toBe(true);
    expect(isQuadroPj('pj')).toBe(true);
    expect(isQuadroPj('clt')).toBe(false);
  });

  it('caminho default zera férias, 13º, aviso, FGTS, multa e total', () => {
    const r = calculateSeverance({
      salary: SAL,
      admissionDate: '2024-03-01',
      terminationDate: '2026-06-15',
    })!;
    expect(r.aplicavel).toBe(false);
    expect(r.saldoSalario).toBe(0);
    expect(r.decimoTerceiroProporcional).toBe(0);
    expect(r.feriasVencidas).toBe(0);
    expect(r.feriasProporcionais).toBe(0);
    expect(r.avisoPrevioIndenizado).toBe(0);
    expect(r.multaFgts).toBe(0);
    expect(r.fgtsDepositadoEstimado).toBe(0);
    expect(r.total).toBe(0);
  });

  it('contractKind pj explícito também zera', () => {
    const r = calculateSeverance({
      salary: SAL,
      admissionDate: '2020-01-01',
      terminationDate: '2026-06-01',
      contractKind: 'pj',
    })!;
    expect(r.aplicavel).toBe(false);
    expect(r.total).toBe(0);
  });
});

describe('calculateSeverance — regras CLT (auditoria 2026-06-14, só com contractKind clt)', () => {
  it('retorna null para entradas inválidas', () => {
    expect(calculateSeverance({ salary: 0, admissionDate: '2020-01-01', terminationDate: '2021-01-01', ...clt })).toBeNull();
    expect(calculateSeverance({ salary: SAL, admissionDate: '2021-01-01', terminationDate: '2020-01-01', ...clt })).toBeNull();
    expect(calculateSeverance({ salary: SAL, admissionDate: 'x', terminationDate: '2021-01-01', ...clt })).toBeNull();
  });

  it('13º: mês de admissão depois do dia 15 NÃO conta (regra dos 15 dias)', () => {
    const lateAdm = calculateSeverance({ salary: SAL, admissionDate: '2026-01-20', terminationDate: '2026-06-30', ...clt })!;
    const earlyAdm = calculateSeverance({ salary: SAL, admissionDate: '2026-01-05', terminationDate: '2026-06-30', ...clt })!;
    expect(earlyAdm.mesesAnoAtual).toBeGreaterThan(lateAdm.mesesAnoAtual);
    expect(earlyAdm.aplicavel).toBe(true);
  });

  it('férias vencidas: faltando 1 dia do período aquisitivo NÃO paga período cheio', () => {
    const meioPrimeiroAno = calculateSeverance({ salary: SAL, admissionDate: '2026-01-15', terminationDate: '2026-07-10', ...clt })!;
    expect(meioPrimeiroAno.feriasVencidas).toBe(0);
    expect(meioPrimeiroAno.anosCompletos).toBe(0);
  });

  it('aviso prévio projeta a saída → 13º/férias proporcionais ≥ versão sem projeção', () => {
    const r = calculateSeverance({ salary: SAL, admissionDate: '2024-03-01', terminationDate: '2026-06-15', ...clt })!;
    expect(r.diasAviso).toBe(36);
    expect(r.mesesAnoAtual).toBeGreaterThanOrEqual(7);
    expect(r.total).toBeGreaterThan(0);
  });

  it('aviso: 30 dias base + 3 por ano completo, cap 90', () => {
    const novato = calculateSeverance({ salary: SAL, admissionDate: '2026-01-01', terminationDate: '2026-06-01', ...clt })!;
    expect(novato.diasAviso).toBe(30);
    const veterano = calculateSeverance({ salary: SAL, admissionDate: '2000-01-01', terminationDate: '2026-06-01', ...clt })!;
    expect(veterano.diasAviso).toBe(90);
  });
});

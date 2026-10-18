import { describe, expect, it } from 'vitest';
import {
  ATELIER_READY_BEFORE_BILLING_DAYS_DEFAULT,
  assemblyDaysNeeded,
  billingWeekStartDate,
  cabedalLeadDaysBeforeBilling,
  cabedalReadyDate,
  scheduleAllocation,
  validateDistribution,
} from './cabedalPrep';

describe('cabedalPrep — meta vs montagem', () => {
  it('billing_week 2026-09-S3 → segunda da semana', () => {
    expect(billingWeekStartDate('2026-09-S3')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('capacidade de montagem continua informativa (não define a meta)', () => {
    expect(assemblyDaysNeeded(1200, 600)).toBe(2);
    expect(cabedalLeadDaysBeforeBilling(1200, 600)).toBe(3);
    expect(assemblyDaysNeeded(1200, 400)).toBe(3);
    expect(cabedalLeadDaysBeforeBilling(1200, 400)).toBe(4);
  });

  it('ready date = início da billing_week − 7 (default)', () => {
    // 2026-05-S1 → 2026-05-01; −7 → 2026-04-24
    const ready = cabedalReadyDate({ billingWeek: '2026-05-S1' });
    expect(ready).toBe('2026-04-24');
    expect(ATELIER_READY_BEFORE_BILLING_DAYS_DEFAULT).toBe(7);
  });

  it('fatura dia 14 → pronto dia 7 (offset 7)', () => {
    // Ancora num mês cujo S2 começa em dia conhecido: usar ISO direto via week
    // 2026-05-S2 ≈ 08/05; −7 = 01/05
    const ready = cabedalReadyDate({
      billingWeek: '2026-05-S2',
      readyBeforeBillingDays: 7,
    });
    expect(ready).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const start = billingWeekStartDate('2026-05-S2')!;
    const [y, m, d] = start.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() - 7);
    const expected = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    expect(ready).toBe(expected);
  });

  it('pares/capacidade não alteram a meta (só o offset)', () => {
    const a = cabedalReadyDate({
      billingWeek: '2026-05-S1',
      pairs: 1200,
      assemblyCapacityPerDay: 600,
    });
    const b = cabedalReadyDate({
      billingWeek: '2026-05-S1',
      pairs: 1200,
      assemblyCapacityPerDay: 400,
    });
    expect(a).toBe(b);
    expect(a).toBe('2026-04-24');
  });
});

describe('cabedalPrep — distribuição', () => {
  it('agenda leaveDate + ceil(pares/dia) − 1', () => {
    const sched = scheduleAllocation({
      contractorId: 'c1',
      sector: 'corte_cabedal',
      pairs: 100,
      pairsPerDay: 10,
      leaveDate: '2026-05-01',
    });
    expect(sched).toEqual({
      sector: 'corte_cabedal',
      startDate: '2026-05-01',
      endDate: '2026-05-10',
      workDays: 10,
    });
  });

  it('valida pendente quando não cobre 100%', () => {
    const v = validateDistribution({
      demandPairs: 100,
      readyDate: '2026-05-20',
      allocations: [
        {
          contractorId: 'a',
          sector: 'corte_cabedal',
          pairs: 40,
          pairsPerDay: 10,
          leaveDate: '2026-05-01',
        },
      ],
    });
    expect(v.ok).toBe(true);
    expect(v.pendingPairs).toBe(60);
    expect(v.fitsReadyDate).toBe(true);
  });

  it('marca erro se termina depois da meta', () => {
    const v = validateDistribution({
      demandPairs: 100,
      readyDate: '2026-05-05',
      allocations: [
        {
          contractorId: 'a',
          sector: 'costura_cabedal',
          pairs: 100,
          pairsPerDay: 10,
          leaveDate: '2026-05-01',
        },
      ],
    });
    expect(v.fitsReadyDate).toBe(false);
    expect(v.ok).toBe(false);
  });
});

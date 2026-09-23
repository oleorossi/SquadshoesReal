import { describe, expect, it } from 'vitest';
import {
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

  it('1200 pares / 600 por dia → 2 dias montagem → lead 3', () => {
    expect(assemblyDaysNeeded(1200, 600)).toBe(2);
    expect(cabedalLeadDaysBeforeBilling(1200, 600)).toBe(3);
  });

  it('1200 pares / 400 por dia → 3 dias montagem → lead 4', () => {
    expect(assemblyDaysNeeded(1200, 400)).toBe(3);
    expect(cabedalLeadDaysBeforeBilling(1200, 400)).toBe(4);
  });

  it('ready date = início da billing_week − lead', () => {
    // 2026-05-S1 → 2026-05-01 (clamped); lead 3 → 2026-04-28
    const ready = cabedalReadyDate({
      billingWeek: '2026-05-S1',
      pairs: 1200,
      assemblyCapacityPerDay: 600,
    });
    expect(ready).toBe('2026-04-28');
  });

  it('ready date com cap 400 → 4 dias antes', () => {
    const ready = cabedalReadyDate({
      billingWeek: '2026-05-S1',
      pairs: 1200,
      assemblyCapacityPerDay: 400,
    });
    expect(ready).toBe('2026-04-27');
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

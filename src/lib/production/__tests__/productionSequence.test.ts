import { describe, expect, it } from 'vitest';
import {
  compareProductionSequence,
  isAtelierFactoryReady,
  sequenceUrgency,
  sortProductionSequence,
} from '@/lib/production/productionSequence';

describe('productionSequence', () => {
  const today = new Date('2026-10-03T12:00:00');

  it('fecha PV (completion) vence mesma urgência e cor de outro PV', () => {
    const almostDone = {
      id: 'a',
      completionPct: 80,
      dueDate: '2026-10-10',
      color: 'PRETO',
      reference: 'I90',
      createdAt: '2026-01-02',
    };
    const fresh = {
      id: 'b',
      completionPct: 10,
      dueDate: '2026-10-10',
      color: 'PRETO',
      reference: 'I90',
      createdAt: '2026-01-01',
    };
    expect(compareProductionSequence(almostDone, fresh, today)).toBeLessThan(0);
    expect(sortProductionSequence([fresh, almostDone], today).map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('urgência billing desempatá após completion', () => {
    const urgent = {
      id: 'u',
      completionPct: 50,
      dueDate: '2026-10-04',
      color: 'PRETO',
      reference: 'A',
      createdAt: '2026-01-01',
    };
    const later = {
      id: 'l',
      completionPct: 50,
      dueDate: '2026-10-20',
      color: 'PRETO',
      reference: 'A',
      createdAt: '2026-01-01',
    };
    expect(compareProductionSequence(urgent, later, today)).toBeLessThan(0);
  });

  it('agrupa cor antes de referência', () => {
    const pretoB = {
      id: '1',
      completionPct: 40,
      dueDate: '2026-10-10',
      color: 'PRETO',
      reference: 'B-REF',
      createdAt: '2026-01-01',
    };
    const begeA = {
      id: '2',
      completionPct: 40,
      dueDate: '2026-10-10',
      color: 'BEGE',
      reference: 'A-REF',
      createdAt: '2026-01-01',
    };
    // BEGE < PRETO lexicograficamente após normalize
    expect(compareProductionSequence(begeA, pretoB, today)).toBeLessThan(0);
  });

  it('data planejada cedo reduz urgência sem zerar', () => {
    const onTime = sequenceUrgency({ dueDate: '2026-10-10', daysUntilPlannedStart: 0, today });
    const early = sequenceUrgency({ dueDate: '2026-10-10', daysUntilPlannedStart: 5, today });
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(onTime);
  });

  it('cabedal complexo só ready após received_at_factory', () => {
    expect(isAtelierFactoryReady({
      isComplexReference: true,
      pipelineStatus: 'sent_to_contractor',
    }).ready).toBe(false);
    expect(isAtelierFactoryReady({
      isComplexReference: true,
      pipelineStatus: 'received_at_factory',
    }).ready).toBe(true);
    expect(isAtelierFactoryReady({
      isComplexReference: false,
      pipelineStatus: null,
    }).ready).toBe(true);
  });
});

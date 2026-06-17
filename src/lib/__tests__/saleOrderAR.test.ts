import { describe, it, expect } from 'vitest';
import { computeARSchedule } from '@/lib/saleOrderAR';

/**
 * Cronograma de parcelas + override de faturamento antecipado.
 * O override ancora a 1ª parcela na data escolhida; as demais seguem os GAPS
 * da payment_condition (days[i] - days[0]) — mesma regra das duplicatas da NF.
 */
describe('computeARSchedule — base padrão (sem override)', () => {
  it('60/75/90 sem factoring → base = delivery_deadline + dias', () => {
    const s = computeARSchedule({
      total: 300,
      paymentCondition: '60/75/90',
      deliveryDeadline: '2026-06-22',
      isFactoring: false,
      factoringReceivingDays: null,
    });
    expect(s).toHaveLength(3);
    expect(s[0].due_date).toBe('2026-08-21'); // 22/06 + 60d
    expect(s[1].due_date).toBe('2026-09-05'); // +75d
    expect(s[2].due_date).toBe('2026-09-20'); // +90d
    expect(s.reduce((a, p) => a + p.amount, 0)).toBeCloseTo(300, 6);
  });

  it('condição vazia → 1 parcela em days=0', () => {
    const s = computeARSchedule({
      total: 100, paymentCondition: '', deliveryDeadline: '2026-06-22',
      isFactoring: false, factoringReceivingDays: null,
    });
    expect(s).toHaveLength(1);
    expect(s[0].due_date).toBe('2026-06-22');
    expect(s[0].amount).toBe(100);
  });
});

describe('computeARSchedule — override de 1ª data de vencimento', () => {
  it('60/75/90 + override 15/08 → 15/08, 30/08, 14/09 (gaps +0/+15/+15)', () => {
    const s = computeARSchedule({
      total: 300,
      paymentCondition: '60/75/90',
      deliveryDeadline: '2026-06-22',
      isFactoring: false,
      factoringReceivingDays: null,
      firstDueDateOverride: '2026-08-15',
    });
    expect(s.map((p) => p.due_date)).toEqual(['2026-08-15', '2026-08-30', '2026-09-14']);
    expect(s.reduce((a, p) => a + p.amount, 0)).toBeCloseTo(300, 6);
  });

  it('override IGNORA a base de factoring (ancora direto na data escolhida)', () => {
    const comFactoring = computeARSchedule({
      total: 300, paymentCondition: '60/75/90', deliveryDeadline: '2026-06-22',
      isFactoring: true, factoringReceivingDays: 2,
      firstDueDateOverride: '2026-08-15',
      now: new Date('2026-06-17T12:00:00'),
    });
    // mesma âncora que sem factoring — o override manda
    expect(comFactoring.map((p) => p.due_date)).toEqual(['2026-08-15', '2026-08-30', '2026-09-14']);
  });

  it('30/60/90 + override 01/09 → 01/09, 01/10, 31/10 (gaps +0/+30/+60)', () => {
    const s = computeARSchedule({
      total: 90, paymentCondition: '30/60/90', deliveryDeadline: null,
      isFactoring: false, factoringReceivingDays: null,
      firstDueDateOverride: '2026-09-01',
    });
    expect(s.map((p) => p.due_date)).toEqual(['2026-09-01', '2026-10-01', '2026-10-31']);
  });

  it('parcela única + override → vence exatamente na data escolhida', () => {
    const s = computeARSchedule({
      total: 100, paymentCondition: '28', deliveryDeadline: '2026-06-22',
      isFactoring: false, factoringReceivingDays: null,
      firstDueDateOverride: '2026-07-10',
    });
    expect(s).toHaveLength(1);
    expect(s[0].due_date).toBe('2026-07-10');
  });

  it('override null/undefined não muda o comportamento padrão', () => {
    const base = computeARSchedule({
      total: 300, paymentCondition: '60/75/90', deliveryDeadline: '2026-06-22',
      isFactoring: false, factoringReceivingDays: null,
    });
    const comNull = computeARSchedule({
      total: 300, paymentCondition: '60/75/90', deliveryDeadline: '2026-06-22',
      isFactoring: false, factoringReceivingDays: null, firstDueDateOverride: null,
    });
    expect(comNull.map((p) => p.due_date)).toEqual(base.map((p) => p.due_date));
  });
});

import { describe, expect, it } from 'vitest';
import { computePeriodFolha } from '../salaryPayroll';
import { buildPayrollHtml, type BundleDay } from '../printPayrollBundle';
import { classifyPayrollCalendarDay } from '../ponto/payrollCalendarDay';

const SCHED = {
  entry_time: '08:00:00', exit_time: '18:00:00', lunch_start: '12:00:00', lunch_end: '13:00:00',
  works_sunday: false, works_monday: true, works_tuesday: true, works_wednesday: true,
  works_thursday: true, works_friday: true, works_saturday: false,
};

function day(partial: Partial<BundleDay> & { date: string }): BundleDay {
  return {
    punches: [],
    expected_minutes: 540,
    worked_minutes: 0,
    raw_credit_minutes: 0,
    raw_delay_minutes: 0,
    compensated_credit_minutes: 0,
    compensated_delay_minutes: 0,
    payable_overtime_minutes: 0,
    payable_delay_minutes: 0,
    discarded_tolerance_minutes: 0,
    status: 'neutral',
    ...partial,
  };
}

describe('classifyPayrollCalendarDay — falta como horas', () => {
  it('falta integral NÃO rotula "falta": mostra débito líquido em minutos', () => {
    const tone = classifyPayrollCalendarDay(day({
      date: '2026-08-25',
      status: 'absence',
      raw_delay_minutes: 540,
      payable_delay_minutes: 540,
    }));
    expect(tone.kind).toBe('delay');
    expect(tone.label).toBe('−9h');
    expect(tone.label.toLowerCase()).not.toContain('falta');
  });

  it('falta integral compensada por HE do período vira "compensado"', () => {
    const tone = classifyPayrollCalendarDay(day({
      date: '2026-08-25',
      status: 'absence',
      raw_delay_minutes: 540,
      compensated_delay_minutes: 540,
      payable_delay_minutes: 0,
    }));
    expect(tone.kind).toBe('compensated');
    expect(tone.label).toBe('compensado');
  });

  it('motor v3: falta + HE no mesmo período → célula da falta mostra o saldo líquido', () => {
    // Seg 04/05 falta; Ter 05/05 08–21 → +180 crédito. Compensa 180 dos 540 → −6h líquido.
    const punches = new Map<string, string[]>([
      ['2026-05-05', ['08:00', '12:00', '13:00', '21:00']],
    ]);
    const r = computePeriodFolha({
      salary: 2200,
      from: '2026-05-04',
      to: '2026-05-05',
      schedule: SCHED,
      holidaysSet: new Set(),
      punchesByDate: punches,
      coveredDates: new Set(['2026-05-04', '2026-05-05']),
      heNormalRate: 20,
    });
    const falta = r.day_ledger!.find(d => d.date === '2026-05-04')!;
    expect(falta.status).toBe('absence');
    expect(falta.raw_delay_minutes).toBe(540);
    expect(falta.compensated_delay_minutes).toBe(180);
    expect(falta.payable_delay_minutes).toBe(360);

    const tone = classifyPayrollCalendarDay(falta, 'mensalista');
    expect(tone.kind).toBe('delay');
    expect(tone.label).toBe('−6h');
  });

  it('impressão do calendário não emite o rótulo literal "falta"', () => {
    const html = buildPayrollHtml({
      periodTitle: '16/08 a 31/08',
      docs: { folha: false, calendario: true, holerite: false },
      employees: [{
        id: 'e1',
        name: 'Marcio',
        run: {
          base_salary: 2200,
          total_proventos: 2200,
          overtime_amount: 55,
          total_liquido: 2255,
          period: '2026-08',
          payment_type: 'mensalista',
        },
        days: [
          day({
            date: '2026-08-25',
            status: 'absence',
            raw_delay_minutes: 540,
            compensated_delay_minutes: 540,
            payable_delay_minutes: 0,
          }),
          day({
            date: '2026-08-28',
            status: 'credit',
            worked_minutes: 720,
            raw_credit_minutes: 180,
            compensated_credit_minutes: 180,
            payable_overtime_minutes: 0,
          }),
        ],
      }],
      autoPrint: false,
    });
    expect(html).toContain('compensado');
    expect(html).toContain('atraso líquido (falta em horas)');
    expect(html).not.toMatch(/>\s*falta\s*</i);
  });

  it('reexport de printPayrollBundle aponta pro mesmo classificador', async () => {
    const bundle = await import('../printPayrollBundle');
    expect(bundle.classifyPayrollCalendarDay).toBe(classifyPayrollCalendarDay);
  });
});

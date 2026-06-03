import { describe, it, expect } from 'vitest';
import { evaluationDetail, type EmployeeTimesheetData } from '../printTimesheet';

// Salário de referência: R$ 2.200 → valor-hora = 2200/220 = 10; valor-dia = 2200/30 = 73,333…
const SAL = 2200;
const VH = SAL / 220;      // 10
const VDIA = SAL / 30;     // 73,33

function emp(days: Partial<EmployeeTimesheetData['days'][number]>[]): EmployeeTimesheetData {
  return {
    name: 'Teste',
    schedule: { overtime_multiplier: 1.5, holiday_multiplier: 2 },
    hourlySalary: VH,
    expectedDayMin: 540, // jornada 08–18 c/ 1h almoço (igual à folha)
    days: days.map((d) => ({
      date: '2026-05-01', dayOfWeek: 1, punches: [], workedMinutes: 0,
      expectedMinutes: 540, overtimeMinutes: 0, isHoliday: false, isAbsent: false, status: 'normal',
      ...d,
    })),
  };
}

describe('evaluationDetail — reconcilia com a folha (salário − descontos)', () => {
  it('FALTA em dia útil desconta 1 dia (salário ÷ 30), não déficit × valor-hora', () => {
    const e = evaluationDetail(emp([{ dayOfWeek: 1, punches: [], isAbsent: true, expectedMinutes: 540 }]));
    expect(e.faltaDays).toHaveLength(1);
    expect(e.faltaDays[0].deficit).toBe(540);
    expect(e.faltaDays[0].desconto).toBeCloseTo(VDIA, 5); // 73,33 — NÃO (540/60)*10=90
  });

  it('ATRASO (chegou 08:35, saiu 17:18) = déficit 77min × valor-hora', () => {
    // span 08:35→17:18 = 523min; >6h ⇒ −1h almoço ⇒ 463 normais; déficit 540−463 = 77
    const e = evaluationDetail(emp([{ dayOfWeek: 1, punches: ['08:35', '17:18'], expectedMinutes: 540 }]));
    expect(e.faltaDays).toHaveLength(1);
    expect(e.faltaDays[0].deficit).toBe(77);
    expect(e.faltaDays[0].desconto).toBeCloseTo((77 / 60) * VH, 5);
    expect(e.extraDays).toHaveLength(0);
  });

  it('Domingo trabalhado = HE 1,5× sobre tudo (sem desconto)', () => {
    const e = evaluationDetail(emp([{ dayOfWeek: 0, punches: ['08:00', '12:00'], expectedMinutes: 0 }]));
    expect(e.faltaDays).toHaveLength(0);
    expect(e.extraDays).toHaveLength(1);
    expect(e.extraDays[0].extra).toBe(240); // 4h
    expect(e.extraDays[0].valor).toBeCloseTo((240 / 60) * VH * 1.5, 5); // 60
  });

  it('Após as 18h em dia útil vira HE 1,5× (e zera o déficit das horas normais)', () => {
    // 08:00→19:00 = 660 span; −1h almoço = 600; 540 normais (até 18h) + 60 premium (18–19h)
    const e = evaluationDetail(emp([{ dayOfWeek: 1, punches: ['08:00', '19:00'], expectedMinutes: 540 }]));
    expect(e.faltaDays).toHaveLength(0);           // cumpriu as 9h normais
    expect(e.extraDays).toHaveLength(1);
    expect(e.extraDays[0].extra).toBe(60);
    expect(e.extraDays[0].valor).toBeCloseTo((60 / 60) * VH * 1.5, 5); // 15
  });

  it('Batida ÍMPAR fica PENDENTE — não desconta nem paga', () => {
    const e = evaluationDetail(emp([{ dayOfWeek: 1, punches: ['08:00'], expectedMinutes: 540 }]));
    expect(e.pendingDays).toBe(1);
    expect(e.faltaDays).toHaveLength(0);
    expect(e.extraDays).toHaveLength(0);
  });

  it('Dia cheio 08–18 exato = sem desconto e sem HE', () => {
    const e = evaluationDetail(emp([{ dayOfWeek: 1, punches: ['08:00', '18:00'], expectedMinutes: 540 }]));
    expect(e.faltaDays).toHaveLength(0);
    expect(e.extraDays).toHaveLength(0);
  });
});

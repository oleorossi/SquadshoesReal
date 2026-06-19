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
    days: days.map((d, i) => ({
      date: `2026-05-${String((i % 28) + 1).padStart(2, '0')}`, dayOfWeek: 1, punches: [], workedMinutes: 0,
      expectedMinutes: 540, overtimeMinutes: 0, isHoliday: false, isAbsent: false, status: 'normal',
      ...d,
    })),
  };
}

describe('evaluationDetail — BRUTO por-dia (mesma conta da folha)', () => {
  it('FALTA em dia útil desconta 1 dia (salário ÷ 30), sem HE/atraso', () => {
    const e = evaluationDetail(emp([{ dayOfWeek: 1, punches: [], expectedMinutes: 540 }]));
    expect(e.faltaCount).toBe(1);
    expect(e.faltaDesconto).toBeCloseTo(VDIA, 5); // 73,33 — NÃO (540/60)*10
    expect(e.heMin).toBe(0);
    expect(e.atrasoMin).toBe(0);
  });

  it('ATRASO (chegou 08:35, saiu 17:18) = déficit 77min × valor-hora, sem HE', () => {
    // span 08:35→17:18 = 523min; >6h ⇒ −1h almoço ⇒ 463 trab.; déficit 540−463 = 77
    const e = evaluationDetail(emp([{ dayOfWeek: 1, punches: ['08:35', '17:18'], expectedMinutes: 540 }]));
    expect(e.atrasoMin).toBe(77);
    expect(e.atrasoDesconto).toBeCloseTo((77 / 60) * VH, 5);
    expect(e.heMin).toBe(0);
  });

  it('Domingo trabalhado (sem mais nada) = HE 1,5× sobre tudo', () => {
    const e = evaluationDetail(emp([{ dayOfWeek: 0, punches: ['08:00', '12:00'], expectedMinutes: 0 }]));
    expect(e.atrasoMin).toBe(0);
    expect(e.heMin).toBe(240); // 4h
    expect(e.heValue).toBeCloseTo((240 / 60) * VH * 1.5, 5); // 60
  });

  it('Após as 18h num dia útil (cumprindo a meta) = HE 1,5× só o excedente', () => {
    // 08:00→19:00 = 660 span; −1h almoço = 600; meta 540 ⇒ saldo +60
    const e = evaluationDetail(emp([{ dayOfWeek: 1, punches: ['08:00', '19:00'], expectedMinutes: 540 }]));
    expect(e.atrasoMin).toBe(0);
    expect(e.heMin).toBe(60);
    expect(e.heValue).toBeCloseTo((60 / 60) * VH * 1.5, 5); // 15
  });

  it('BRUTO por-dia: domingo trabalhado é HE; déficit de seg NÃO é abatido', () => {
    // Seg 08–12 (240, esperado 540 ⇒ déficit 300). Dom 2h (120). BRUTO: atraso 300 + HE 120.
    const e = evaluationDetail(emp([
      { dayOfWeek: 1, punches: ['08:00', '12:00'], expectedMinutes: 540 },
      { dayOfWeek: 0, punches: ['14:00', '16:00'], expectedMinutes: 0 },
    ]));
    expect(e.atrasoMin).toBe(300);
    expect(e.atrasoDesconto).toBeCloseTo((300 / 60) * VH, 5); // 50
    expect(e.heMin).toBe(120);                                 // domingo = HE
    expect(e.heValue).toBeCloseTo((120 / 60) * VH * 1.5, 5);   // 30
  });

  it('Batida ÍMPAR fica PENDENTE — não desconta nem paga', () => {
    const e = evaluationDetail(emp([{ dayOfWeek: 1, punches: ['08:00'], expectedMinutes: 540 }]));
    expect(e.pendingDays).toBe(1);
    expect(e.faltaCount).toBe(0);
    expect(e.atrasoMin).toBe(0);
    expect(e.heMin).toBe(0);
  });

  it('Dia cheio 08–18 exato = sem desconto e sem HE', () => {
    const e = evaluationDetail(emp([{ dayOfWeek: 1, punches: ['08:00', '12:00', '13:00', '18:00'], expectedMinutes: 540 }]));
    expect(e.atrasoMin).toBe(0);
    expect(e.heMin).toBe(0);
    expect(e.dayRows).toHaveLength(1);
    expect(e.dayRows[0].kind).toBe('ok');
  });
});

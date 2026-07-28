import { describe, it, expect } from 'vitest';
import { evaluationDetail, type EmployeeTimesheetData } from '../printTimesheet';
import { calculateSalaryPayroll, type SalaryPolicy, type SalaryDayInput } from '../salaryPayroll';

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

// ── M26 (auditoria 2026-07-28): com emp.policy, o Detalhe (Excel/espelho) usa a
// MESMA política do Resumo pago: falta = salário ÷ dias úteis do mês; atraso =
// min × (valorDia ÷ jornada); HE = R$/h absoluto com mínimo diário. ──────────
describe('evaluationDetail — política canônica (emp.policy)', () => {
  const SAL3K = 3000;
  const POLICY: SalaryPolicy = {
    businessDaysDivisor: 22,
    businessDaysByMonth: { '2026-05': 22 },
    journeyMinutes: 540,
    heNormalRate: 15,
    heSundayHolidayRate: 20,
    minOvertimeMin: 10,
  };

  function empPol(days: Partial<EmployeeTimesheetData['days'][number]>[]): EmployeeTimesheetData {
    const base = emp(days);
    return { ...base, hourlySalary: SAL3K / 220, monthlySalary: SAL3K, policy: POLICY };
  }

  it('FALTA desconta salário ÷ dias úteis (R$136,36 num mês de 22), NÃO ÷30 (R$100)', () => {
    const e = evaluationDetail(empPol([{ dayOfWeek: 1, punches: [], expectedMinutes: 540 }]));
    expect(e.faltaDesconto).toBeCloseTo(SAL3K / 22, 2);   // 136,36 — o caso do relatório
    expect(e.dayRows[0].descontoDia).toBeCloseTo(SAL3K / 22, 2);
  });

  it('HE em dia útil usa o R$/h CADASTRADO (não vh × 1,5)', () => {
    // 08:00→19:00 = 660 − 60 almoço = 600 ⇒ excedente 60min > mínimo 10 ⇒ 1h × R$15.
    const e = evaluationDetail(empPol([{ dayOfWeek: 1, punches: ['08:00', '19:00'], expectedMinutes: 540 }]));
    expect(e.heMin).toBe(60);
    expect(e.heValue).toBeCloseTo(15, 5);
    expect(e.dayRows[0].excedenteDia).toBeCloseTo(15, 5);
  });

  it('excedente ≤ mínimo de HE da escala é descartado', () => {
    // 08:00→18:05 = 605 − 60 = 545 ⇒ excedente 5min ≤ 10 ⇒ 0 HE.
    const e = evaluationDetail(empPol([{ dayOfWeek: 1, punches: ['08:00', '18:05'], expectedMinutes: 540 }]));
    expect(e.heMin).toBe(0);
    expect(e.heValue).toBe(0);
  });

  it('domingo/feriado usa a taxa domingo/feriado', () => {
    const e = evaluationDetail(empPol([{ dayOfWeek: 0, punches: ['08:00', '12:00'], expectedMinutes: 0 }]));
    expect(e.heMin).toBe(240);
    expect(e.heValue).toBeCloseTo(4 * 20, 5);   // 4h × R$20
  });

  it('atraso desconta pelo valor-hora da política (valorDia ÷ jornada)', () => {
    // 08:35→17:18 = 523 − 60 = 463 ⇒ déficit 77min × ((3000/22) ÷ 9h).
    const e = evaluationDetail(empPol([{ dayOfWeek: 1, punches: ['08:35', '17:18'], expectedMinutes: 540 }]));
    expect(e.atrasoMin).toBe(77);
    expect(e.atrasoDesconto).toBeCloseTo((77 / 60) * (SAL3K / 22 / 9), 4);
  });

  it('PARIDADE: agregados batem com calculateSalaryPayroll (motor do Resumo) com a mesma policy', () => {
    const days: Partial<EmployeeTimesheetData['days'][number]>[] = [
      { dayOfWeek: 1, punches: ['08:00', '19:00'], expectedMinutes: 540 },  // HE 60
      { dayOfWeek: 2, punches: ['08:35', '17:18'], expectedMinutes: 540 },  // atraso 77
      { dayOfWeek: 3, punches: [], expectedMinutes: 540 },                  // falta
      { dayOfWeek: 0, punches: ['08:00', '12:00'], expectedMinutes: 0 },    // domingo HE
    ];
    const e = evaluationDetail(empPol(days));
    const motorDays: SalaryDayInput[] = empPol(days).days.map(d => ({
      date: d.date, dayOfWeek: d.dayOfWeek, isHoliday: d.isHoliday,
      isWorkday: (d.expectedMinutes || 0) > 0,
      expectedMinutes: (d.expectedMinutes || 0) > 0 ? 540 : 0,
      punches: d.punches,
    }));
    const motor = calculateSalaryPayroll(SAL3K, motorDays, 0, undefined, undefined, undefined, undefined, 0, 1.5, POLICY);
    expect(e.faltaDesconto).toBeCloseTo(motor.falta_desconto, 2);
    expect(e.atrasoDesconto).toBeCloseTo(motor.atraso_desconto, 2);
    expect(e.heValue).toBeCloseTo(motor.he_value, 2);
    expect(e.heMin).toBe(motor.he_minutes);
    expect(e.atrasoMin).toBe(motor.atraso_minutes);
    expect(e.faltaCount).toBe(motor.falta_days);
  });
});

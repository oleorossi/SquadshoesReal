/**
 * Tests CLT do payrollCalc (Súmula 172 TST, art. 7º XVI, divisor 220).
 *
 * Cobre as 4 questões críticas levantadas pela auditoria 2026-05:
 *   1. Divisor 220 (salário-hora correto)
 *   2. Multiplicadores 50% (útil) e 100% (dom/feriado)
 *   3. DSR reflexo sobre HE (passivo trabalhista #1)
 *   4. Folha só paga HE se RH lançou manualmente (paidOvertimeMinutes)
 */

import { describe, it, expect } from 'vitest';
import { calculatePayroll } from '../payrollCalc';
import type { PayrollEmployeeInput, PayrollDayInput, BenefitsConfig } from '../payrollCalc';

const DEFAULT_CONFIG: BenefitsConfig = {
  vt_daily_value: 0,
  vt_employee_discount_pct: 0,
  vr_daily_value: 0,
  va_monthly_value: 0,
  health_plan_default: 0,
  monthly_hours: 220,  // divisor CLT padrão (44h × 5 sem)
  overtime_50_pct: 50,
  overtime_100_pct: 100,
  night_bonus_pct: 20,
  night_shift_start_min: 22 * 60,
  night_shift_end_min: 5 * 60,
};

function mkEmployee(overrides: Partial<PayrollEmployeeInput> = {}): PayrollEmployeeInput {
  return {
    id: 'e1',
    name: 'Funcionário Teste',
    base_salary: 2200,
    receives_vt: false,
    receives_vr: false,
    receives_va: false,
    health_plan_value: 0,
    weekly_hours: 44,
    tolerance_minutes: 10,
    minimum_overtime_minutes: 10,
    overtime_50_pct: 50,
    overtime_100_pct: 100,
    night_bonus_pct: 20,
    ...overrides,
  };
}

function mkDay(date: string, dayOfWeek: number, punches: string[] = [], opts: { isHoliday?: boolean; isBusinessDay?: boolean; expectedMinutes?: number } = {}): PayrollDayInput {
  return {
    date,
    dayOfWeek,
    isHoliday: opts.isHoliday ?? false,
    isBusinessDay: opts.isBusinessDay ?? (dayOfWeek !== 0),
    punches,
    expectedMinutes: opts.expectedMinutes ?? (dayOfWeek === 0 ? 0 : 480),
  };
}

describe('calculatePayroll — Divisor 220 e salário-hora (CLT art. 64)', () => {
  it('R$ 2.200 ÷ 220h = R$ 10/h, HE 50% = R$ 15/h', () => {
    const days: PayrollDayInput[] = [
      // 1 dia útil com 1h extra (60min HE 50%)
      mkDay('2026-05-04', 1, ['08:00', '12:00', '13:00', '19:00'], { expectedMinutes: 480 }),
    ];
    const r = calculatePayroll(
      mkEmployee(),
      days,
      [],
      0,
      DEFAULT_CONFIG,
      { ot50: 60, ot100: 0 }, // 60min de HE 50% explícita
    );
    expect(r.hourly_rate).toBe(10);
    // 60min × (R$10/60) × 1.5 = R$15
    expect(r.overtime_50_value).toBe(15);
  });

  it('Divisor configurável: R$ 2.200 ÷ 200h = R$ 11/h (jornada 40h)', () => {
    const r = calculatePayroll(
      mkEmployee({ base_salary: 2200 }),
      [],
      [],
      0,
      { ...DEFAULT_CONFIG, monthly_hours: 200 },
    );
    expect(r.hourly_rate).toBe(11);
  });
});

describe('calculatePayroll — HE 50% (dia útil) e 100% (dom/feriado)', () => {
  it('HE 100% (domingo): 2h × R$10 × 2.0 = R$ 40', () => {
    const days: PayrollDayInput[] = [
      mkDay('2026-05-10', 0, ['08:00', '10:00'], { expectedMinutes: 0 }),
    ];
    const r = calculatePayroll(
      mkEmployee(),
      days,
      [],
      0,
      DEFAULT_CONFIG,
      { ot50: 0, ot100: 120 }, // 120min HE 100%
    );
    expect(r.overtime_100_value).toBe(40);
  });

  it('Soma HE 50% + 100%: 60min útil + 60min domingo = R$ 15 + R$ 20', () => {
    const days: PayrollDayInput[] = [];
    const r = calculatePayroll(
      mkEmployee(),
      days,
      [],
      0,
      DEFAULT_CONFIG,
      { ot50: 60, ot100: 60 },
    );
    expect(r.overtime_50_value).toBe(15);
    expect(r.overtime_100_value).toBe(20);
  });
});

describe('calculatePayroll — DSR reflexo sobre HE (Súmula 172 TST)', () => {
  it('DSR fator ≈ 0.1538 em mês padrão (4 dom / 26 úteis)', () => {
    // 26 dias úteis + 4 domingos + 0 feriados = mês "limpo"
    const days: PayrollDayInput[] = [];
    for (let d = 1; d <= 30; d++) {
      const date = `2026-04-${String(d).padStart(2, '0')}`;
      const dow = new Date(2026, 3, d).getDay(); // 0=dom
      days.push(mkDay(date, dow, [], { expectedMinutes: dow === 0 ? 0 : 480, isBusinessDay: dow !== 0 }));
    }
    const r = calculatePayroll(
      mkEmployee(),
      days,
      [],
      0,
      DEFAULT_CONFIG,
      { ot50: 300, ot100: 0 }, // 5h HE × R$15 = R$75
    );
    // Total HE = 75. Fator DSR = 4/26 ≈ 0.1538. DSR ≈ 75 × 0.1538 = 11.54
    expect(r.overtime_50_value).toBe(75);
    expect(r.dsr_value).toBeGreaterThanOrEqual(11.5);
    expect(r.dsr_value).toBeLessThanOrEqual(11.6);
  });

  it('DSR aumenta em mês com feriado (5 descansos / 25 úteis)', () => {
    // Simulado: 5 dias de descanso (4 dom + 1 feriado em dia útil)
    const days: PayrollDayInput[] = [];
    days.push(mkDay('2026-05-01', 5, [], { isHoliday: true, expectedMinutes: 0 })); // sex feriado
    for (let d = 2; d <= 31; d++) {
      const dt = new Date(2026, 4, d);
      const dow = dt.getDay();
      days.push(mkDay(`2026-05-${String(d).padStart(2, '0')}`, dow, [], { expectedMinutes: dow === 0 ? 0 : 480 }));
    }
    const r = calculatePayroll(
      mkEmployee(),
      days,
      [],
      0,
      DEFAULT_CONFIG,
      { ot50: 300, ot100: 0 },
    );
    // 5 descansos vs ~25 úteis → fator ~0.2, maior que 0.1538.
    expect(r.dsr_value).toBeGreaterThan(11.54);
  });

  it('DSR zera quando sem HE no mês', () => {
    const r = calculatePayroll(
      mkEmployee(),
      [],
      [],
      0,
      DEFAULT_CONFIG,
      { ot50: 0, ot100: 0 },
    );
    expect(r.dsr_value).toBe(0);
  });

  it('Total Proventos inclui DSR reflexo', () => {
    const days: PayrollDayInput[] = [];
    for (let d = 1; d <= 30; d++) {
      const dow = new Date(2026, 3, d).getDay();
      days.push(mkDay(`2026-04-${String(d).padStart(2, '0')}`, dow, [], { expectedMinutes: dow === 0 ? 0 : 480 }));
    }
    const r = calculatePayroll(
      mkEmployee(),
      days,
      [],
      0,
      DEFAULT_CONFIG,
      { ot50: 300, ot100: 0 },
    );
    // 2200 + 75 (HE) + 11.54 (DSR) = ~2286.54
    expect(r.total_proventos).toBeGreaterThanOrEqual(2286);
    expect(r.total_proventos).toBeLessThanOrEqual(2287);
  });
});

describe('calculatePayroll — paidOvertimeMinutes (modo manual)', () => {
  it('Sem paidOvertimeMinutes: cálculo automático legado', () => {
    const days: PayrollDayInput[] = [
      mkDay('2026-05-04', 1, ['08:00', '12:00', '13:00', '20:00'], { expectedMinutes: 480 }),
    ];
    const r = calculatePayroll(mkEmployee(), days, [], 0, DEFAULT_CONFIG);
    // 4h + 7h = 11h trabalhadas em 8h esperadas → 3h HE 50% automática
    expect(r.overtime_50_minutes).toBeGreaterThan(0);
  });

  it('Com paidOvertimeMinutes: desliga automático, usa só manual', () => {
    const days: PayrollDayInput[] = [
      mkDay('2026-05-04', 1, ['08:00', '12:00', '13:00', '20:00'], { expectedMinutes: 480 }),
    ];
    const r = calculatePayroll(
      mkEmployee(),
      days,
      [],
      0,
      DEFAULT_CONFIG,
      { ot50: 0, ot100: 0 }, // RH não marcou nada pra pagar
    );
    expect(r.overtime_50_minutes).toBe(0);
    expect(r.overtime_100_minutes).toBe(0);
  });
});

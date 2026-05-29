/**
 * Testes do cálculo de folha em REGIME PJ (Pessoa Jurídica).
 *
 * Empresa contrata 100% via PJ — sem vínculo CLT, sem retenção de INSS/IRRF,
 * sem multiplier de hora extra. O relógio só conta horas trabalhadas.
 *
 * O arquivo anterior (payrollCalc.clt.test.ts) foi removido em 2026-05-29
 * porque testava regras CLT que não se aplicam.
 */
import { describe, it, expect } from 'vitest';
import { calculatePayroll } from '../payrollCalc';
import type { PayrollEmployeeInput, PayrollDayInput, BenefitsConfig } from '../payrollCalc';

const DEFAULT_CONFIG: BenefitsConfig = {
  vr_daily_value: 0,
  va_monthly_value: 0,
  health_plan_default: 0,
  monthly_hours: 220,
};

function mkEmployee(overrides: Partial<PayrollEmployeeInput> = {}): PayrollEmployeeInput {
  return {
    id: 'emp-1',
    name: 'Test PJ',
    base_salary: 2200,
    receives_vr: false,
    receives_va: false,
    health_plan_value: 0,
    weekly_hours: 44,
    tolerance_minutes: 10,
    minimum_overtime_minutes: 0,
    ...overrides,
  };
}

function mkDays(count: number, expectedMinPerDay = 480): PayrollDayInput[] {
  return Array.from({ length: count }).map((_, i) => {
    const date = new Date(2026, 4, i + 1); // maio
    return {
      date: date.toISOString().slice(0, 10),
      dayOfWeek: date.getDay(),
      isHoliday: false,
      isBusinessDay: date.getDay() !== 0 && date.getDay() !== 6,
      punches: ['08:00', '12:00', '13:00', '17:00'],
      expectedMinutes: date.getDay() !== 0 && date.getDay() !== 6 ? expectedMinPerDay : 0,
    };
  });
}

describe('calculatePayroll PJ — pagamento básico', () => {
  it('paga base_salary cheio quando funcionário trabalha o mês todo', () => {
    const r = calculatePayroll(mkEmployee(), mkDays(31), [], 0, DEFAULT_CONFIG);
    expect(r.base_salary).toBe(2200);
    expect(r.total_proventos).toBe(2200);
    expect(r.total_descontos).toBe(0);
    expect(r.total_liquido).toBe(2200);
  });

  it('aplica prorata em mês de admissão (admitido dia 15)', () => {
    const days = mkDays(31);
    const r = calculatePayroll(
      mkEmployee({ admission_date: '2026-05-15' }),
      days,
      [],
      0,
      DEFAULT_CONFIG,
    );
    // 17 dias / 31 dias * 2200 ≈ 1206.45
    expect(r.base_salary).toBeCloseTo(1206.45, 1);
  });

  it('desconta adiantamentos (advancesTotal)', () => {
    const r = calculatePayroll(mkEmployee(), mkDays(31), [], 500, DEFAULT_CONFIG);
    expect(r.total_descontos).toBe(500);
    expect(r.total_liquido).toBe(1700);
  });
});

describe('calculatePayroll PJ — horas extras autorizadas', () => {
  it('paga HE × valor_hora SEM multiplier (não há CLT art. 7 XVI)', () => {
    // 2200/220 = R$10/h. 60 min de HE autorizado = R$10.
    const r = calculatePayroll(mkEmployee(), mkDays(31), [], 0, DEFAULT_CONFIG, 60);
    expect(r.overtime_paid_minutes).toBe(60);
    expect(r.overtime_paid_value).toBe(10);
    expect(r.total_proventos).toBe(2210);
  });

  it('zera HE quando paidOvertimeMinutes não fornecido', () => {
    const r = calculatePayroll(mkEmployee(), mkDays(31), [], 0, DEFAULT_CONFIG);
    expect(r.overtime_paid_minutes).toBe(0);
    expect(r.overtime_paid_value).toBe(0);
  });
});

describe('calculatePayroll PJ — INSS/IRRF/DSR não aplicam', () => {
  it('inss_value e irrf_value zerados (PJ paga próprios impostos)', () => {
    const r = calculatePayroll(
      mkEmployee({ base_salary: 5000 }),
      mkDays(31),
      [],
      0,
      DEFAULT_CONFIG,
    );
    expect(r.inss_value).toBe(0);
    expect(r.irrf_value).toBe(0);
  });

  it('dsr_value zerado mesmo com HE paga (Súmula 172 TST não aplica)', () => {
    const r = calculatePayroll(mkEmployee(), mkDays(31), [], 0, DEFAULT_CONFIG, 120);
    expect(r.dsr_value).toBe(0);
  });

  it('night_bonus_value zerado mesmo com batidas noturnas (art. 73 não aplica)', () => {
    const nightDays: PayrollDayInput[] = [{
      date: '2026-05-15',
      dayOfWeek: 5,
      isHoliday: false,
      isBusinessDay: true,
      punches: ['22:00', '06:00'],  // 8h noturno
      expectedMinutes: 480,
    }];
    const r = calculatePayroll(mkEmployee(), nightDays, [], 0, DEFAULT_CONFIG);
    expect(r.night_bonus_value).toBe(0);
    expect(r.night_minutes).toBe(0);
  });
});

describe('calculatePayroll PJ — faltas e benefícios', () => {
  it('desconta dia de falta injustificada não-paga', () => {
    const days = mkDays(31);
    const absences = [{
      start_date: '2026-05-05',
      end_date: '2026-05-05',
      absence_type: 'falta_injustificada',
      paid: false,
      hours_per_day: null,
    }];
    const r = calculatePayroll(mkEmployee(), days, absences, 0, DEFAULT_CONFIG);
    expect(r.absent_days).toBe(1);
    expect(r.absence_discount).toBeGreaterThan(0);
  });

  it('VR pago apenas se receives_vr=true', () => {
    const config = { ...DEFAULT_CONFIG, vr_daily_value: 25 };
    const days = mkDays(31);
    const r = calculatePayroll(mkEmployee({ receives_vr: true }), days, [], 0, config);
    // ~21 dias úteis × R$25 = ~R$525
    expect(r.vr_value).toBeGreaterThan(400);
  });
});

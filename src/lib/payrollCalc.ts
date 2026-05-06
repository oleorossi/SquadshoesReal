/**
 * Cálculo de folha de pagamento — CLT 2026.
 *
 * Fórmulas resumidas:
 *   - Valor da hora normal       = salário / divisor_mensal (220h padrão)
 *   - HE 50%                     = horas_extra × valor_hora × 1.50
 *   - HE 100%                    = horas_dom_feriado × valor_hora × 2.00
 *   - Adic. noturno              = minutos_22h_5h × (valor_hora/60) × (1 + bonus%/100)
 *   - DSR sobre HE               = (HE total / dias_úteis) × dias_descanso
 *   - VT desconto funcionário    = min(VT_total_dias_úteis, salário × 6%)
 *   - INSS/IRRF                  = tabelas progressivas (ver INSS_2026, IRRF_2026)
 *
 * Tabelas INSS/IRRF abaixo são as vigentes 2024/2025 — ajustáveis via
 * benefits_config.notes ou nova migration quando o governo atualizar.
 */

export interface BenefitsConfig {
  vt_daily_value: number;
  vt_employee_discount_pct: number;
  vr_daily_value: number;
  va_monthly_value: number;
  health_plan_default: number;
  monthly_hours: number;
  overtime_50_pct: number;
  overtime_100_pct: number;
  night_bonus_pct: number;
  night_shift_start_min: number;
  night_shift_end_min: number;
}

export interface PayrollEmployeeInput {
  id: string;
  name: string;
  base_salary: number;
  receives_vt: boolean;
  receives_vr: boolean;
  receives_va: boolean;
  health_plan_value: number;
}

export interface PayrollDayInput {
  date: string;          // YYYY-MM-DD
  dayOfWeek: number;     // 0 = Sunday
  isHoliday: boolean;
  isBusinessDay: boolean;
  punches: string[];     // ['08:00','12:00','13:00','18:00']
  expectedMinutes: number; // jornada esperada do dia
}

export interface PayrollAbsenceInput {
  start_date: string;
  end_date: string;
  absence_type: string;
  paid: boolean;
  hours_per_day: number | null;
}

export interface PayrollResult {
  base_salary: number;
  hourly_rate: number;
  worked_minutes: number;
  expected_minutes: number;
  business_days: number;
  business_days_worked: number;
  absent_days: number;
  overtime_50_minutes: number;
  overtime_100_minutes: number;
  night_minutes: number;
  overtime_50_value: number;
  overtime_100_value: number;
  night_bonus_value: number;
  dsr_value: number;
  vr_value: number;
  va_value: number;
  vt_total_value: number;
  vt_employee_discount: number;
  health_plan_discount: number;
  inss_value: number;
  irrf_value: number;
  absence_discount: number;
  total_proventos: number;
  total_descontos: number;
  total_liquido: number;
}

// ── Tabelas INSS/IRRF (valores 2024/2025; usar config.notes para registrar versão) ──
// INSS: alíquota incide sobre cada faixa (progressiva)
const INSS_2026 = [
  { upTo: 1412.00, rate: 0.075 },
  { upTo: 2666.68, rate: 0.09 },
  { upTo: 4000.03, rate: 0.12 },
  { upTo: 7786.02, rate: 0.14 },
];
const INSS_CEILING_VALUE = 908.86; // INSS máximo (teto)

// IRRF: alíquota progressiva com dedução
const IRRF_2026 = [
  { upTo: 2259.20, rate: 0,     deduction: 0 },
  { upTo: 2826.65, rate: 0.075, deduction: 169.44 },
  { upTo: 3751.05, rate: 0.15,  deduction: 381.44 },
  { upTo: 4664.68, rate: 0.225, deduction: 662.77 },
  { upTo: Infinity, rate: 0.275, deduction: 896.00 },
];

export function calculateINSS(grossSalary: number): number {
  if (grossSalary <= 0) return 0;
  let total = 0;
  let prev = 0;
  for (const band of INSS_2026) {
    if (grossSalary <= band.upTo) {
      total += (grossSalary - prev) * band.rate;
      return Number(total.toFixed(2));
    }
    total += (band.upTo - prev) * band.rate;
    prev = band.upTo;
  }
  // Acima do teto: usa valor fixo do teto
  return INSS_CEILING_VALUE;
}

export function calculateIRRF(baseAfterINSS: number): number {
  if (baseAfterINSS <= 0) return 0;
  for (const band of IRRF_2026) {
    if (baseAfterINSS <= band.upTo) {
      const tax = baseAfterINSS * band.rate - band.deduction;
      return Math.max(0, Number(tax.toFixed(2)));
    }
  }
  return 0;
}

function timeToMin(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Conta minutos noturnos (entre night_shift_start_min e night_shift_end_min,
 * cruzando meia-noite) em pares de batidas (entrada-saída).
 */
function countNightMinutes(
  punches: string[],
  nightStart: number,
  nightEnd: number,
): number {
  if (punches.length < 2) return 0;
  let total = 0;
  for (let i = 0; i + 1 < punches.length; i += 2) {
    const start = timeToMin(punches[i]);
    const end   = timeToMin(punches[i + 1]);
    if (end === start) continue;

    // Midnight-crossing shift: split into two intra-day segments.
    // e.g. 22:30→05:00 becomes [1350,1440] and [0,300].
    const segments: [number, number][] =
      end < start ? [[start, 1440], [0, end]] : [[start, end]];

    for (const [s, e] of segments) {
      // Janela noturna: [nightStart, 1440] ∪ [0, nightEnd]
      const a = Math.max(s, nightStart);
      const b = Math.min(e, 1440);
      if (b > a) total += b - a;
      const c = Math.max(s, 0);
      const d = Math.min(e, nightEnd);
      if (d > c) total += d - c;
    }
  }
  return total;
}

/**
 * Soma minutos trabalhados em um dia a partir de pares de batidas.
 */
function workedMinutesFromPunches(punches: string[]): number {
  if (punches.length < 2) return 0;
  let total = 0;
  for (let i = 0; i + 1 < punches.length; i += 2) {
    const a = timeToMin(punches[i]);
    const b = timeToMin(punches[i + 1]);
    // Midnight-crossing: b < a means the shift ends after midnight
    total += b > a ? b - a : b < a ? (1440 - a) + b : 0;
  }
  return total;
}

export function calculatePayroll(
  employee: PayrollEmployeeInput,
  days: PayrollDayInput[],
  absences: PayrollAbsenceInput[],
  advancesTotal: number,
  config: BenefitsConfig,
): PayrollResult {
  const baseSalary = Number(employee.base_salary) || 0;
  const monthlyHours = config.monthly_hours || 220;
  const hourlyRate = monthlyHours > 0 ? baseSalary / monthlyHours : 0;
  const minuteRate = hourlyRate / 60;

  let workedMin = 0;
  let expectedMin = 0;
  let ot50Min = 0;
  let ot100Min = 0;
  let nightMin = 0;
  let businessDays = 0;
  let businessDaysWorked = 0;

  // Dias com ausência registrada — set de YYYY-MM-DD
  const absenceDays = new Map<string, PayrollAbsenceInput>();
  for (const a of absences) {
    const start = new Date(a.start_date + 'T00:00:00');
    const end = new Date(a.end_date + 'T00:00:00');
    const cur = new Date(start);
    while (cur <= end) {
      absenceDays.set(cur.toISOString().slice(0, 10), a);
      cur.setDate(cur.getDate() + 1);
    }
  }

  for (const d of days) {
    expectedMin += d.expectedMinutes;
    if (d.isBusinessDay && !d.isHoliday) businessDays++;

    const dayWorked = workedMinutesFromPunches(d.punches);
    workedMin += dayWorked;
    if (dayWorked > 0 && d.isBusinessDay && !d.isHoliday) businessDaysWorked++;

    // HE: dia útil → 50% sobre o que ultrapassar a jornada;
    //     domingo/feriado → 100% sobre todas as horas trabalhadas
    if (d.isHoliday || d.dayOfWeek === 0) {
      ot100Min += dayWorked;
    } else if (dayWorked > d.expectedMinutes) {
      ot50Min += dayWorked - d.expectedMinutes;
    }

    nightMin += countNightMinutes(d.punches, config.night_shift_start_min, config.night_shift_end_min);
  }

  // Faltas injustificadas (descontadas)
  let absentDays = 0;
  let absenceDiscount = 0;
  const dailyRate = baseSalary / Math.max(1, businessDays || 22);
  for (const [, a] of absenceDays) {
    if (a.absence_type === 'falta_injustificada' && !a.paid) {
      absentDays++;
      absenceDiscount += dailyRate;
    }
  }

  // Valores
  const ot50Value = ot50Min * minuteRate * (1 + config.overtime_50_pct / 100);
  const ot100Value = ot100Min * minuteRate * (1 + config.overtime_100_pct / 100);
  const nightBonusValue = nightMin * minuteRate * (config.night_bonus_pct / 100);

  // DSR sobre HE: (HE_total_R$ / dias_úteis) × dias_descanso
  // Aprox: dias de descanso = (30 ou 31) - dias_úteis
  const totalDaysInMonth = days.length || 30;
  const restDays = Math.max(1, totalDaysInMonth - businessDays);
  const dsrValue = businessDays > 0
    ? ((ot50Value + ot100Value + nightBonusValue) / businessDays) * restDays
    : 0;

  // Benefícios
  const vrValue = employee.receives_vr ? config.vr_daily_value * businessDaysWorked : 0;
  const vaValue = employee.receives_va ? config.va_monthly_value : 0;

  // VT: empresa paga vt_daily × dias_úteis_trabalhados; funcionário tem desconto até 6% do salário
  const vtTotal = employee.receives_vt ? config.vt_daily_value * businessDaysWorked : 0;
  const vtCap = baseSalary * (config.vt_employee_discount_pct / 100);
  const vtEmployeeDiscount = Math.min(vtTotal, vtCap);

  const healthPlanDiscount = employee.health_plan_value > 0
    ? employee.health_plan_value
    : config.health_plan_default;

  // Proventos brutos para INSS: salário base + adicionais habituais (HE, DSR, noturno)
  const grossForINSS = baseSalary + ot50Value + ot100Value + nightBonusValue + dsrValue;
  const inssValue = calculateINSS(grossForINSS);
  const irrfBase = grossForINSS - inssValue;
  const irrfValue = calculateIRRF(irrfBase);

  const totalProventos = baseSalary + ot50Value + ot100Value + nightBonusValue + dsrValue + vrValue + vaValue;
  const totalDescontos =
    inssValue + irrfValue + vtEmployeeDiscount + healthPlanDiscount + absenceDiscount + advancesTotal;
  const totalLiquido = totalProventos - totalDescontos;

  const round2 = (n: number) => Math.round(n * 100) / 100;
  return {
    base_salary: round2(baseSalary),
    hourly_rate: Number(hourlyRate.toFixed(4)),
    worked_minutes: workedMin,
    expected_minutes: expectedMin,
    business_days: businessDays,
    business_days_worked: businessDaysWorked,
    absent_days: absentDays,
    overtime_50_minutes: ot50Min,
    overtime_100_minutes: ot100Min,
    night_minutes: nightMin,
    overtime_50_value: round2(ot50Value),
    overtime_100_value: round2(ot100Value),
    night_bonus_value: round2(nightBonusValue),
    dsr_value: round2(dsrValue),
    vr_value: round2(vrValue),
    va_value: round2(vaValue),
    vt_total_value: round2(vtTotal),
    vt_employee_discount: round2(vtEmployeeDiscount),
    health_plan_discount: round2(healthPlanDiscount),
    inss_value: round2(inssValue),
    irrf_value: round2(irrfValue),
    absence_discount: round2(absenceDiscount),
    total_proventos: round2(totalProventos),
    total_descontos: round2(totalDescontos),
    total_liquido: round2(totalLiquido),
  };
}

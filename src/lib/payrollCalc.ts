/**
 * Cálculo de folha de pagamento — REGIME DE CONTRATO (não-CLT).
 *
 * Empresa contrata por contrato (PJ/prestador) — cada profissional é
 * responsável pelos próprios impostos (INSS, IRRF). A folha aqui calcula:
 *
 *   - Valor da hora normal      = salário / divisor_mensal (220h padrão)
 *   - HE em dia útil            = horas_extra × valor_hora × (1 + employee.overtime_50_pct/100)
 *   - HE em dom/feriado         = horas × valor_hora × (1 + employee.overtime_100_pct/100)
 *   - Adic. noturno             = minutos_22h_5h × (valor_hora/60) × (employee.night_bonus_pct/100)
 *   - Tolerância/min HE         = aplicados SEMANALMENTE (employee.tolerance_minutes
 *                                  e minimum_overtime_minutes; defaults 10/10)
 *   - Benefícios pagos          = VR (por dia útil), VA (mensal flat)
 *   - Descontos                 = plano de saúde + faltas + adiantamentos
 *   - Líquido                   = proventos − descontos
 *
 * Multiplicadores de HE são CONFIGURÁVEIS por funcionário (cada contrato
 * pode ter regra própria — alguns hora simples, outros adicional). Defaults
 * em zero (= hora simples sem adicional).
 *
 * INSS/IRRF/DSR/VT-desconto NÃO se aplicam (não-CLT). As funções calculateINSS
 * e calculateIRRF ficam mantidas como utilitários históricos / pra simulação.
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
  /** Carga semanal contratada (ex: 44, 40, 36). Default 44. */
  weekly_hours?: number;
  /** Tolerância em minutos: variações <= este valor não geram HE nem débito.
   *  Default 10 (alinhado com work_schedules.tolerance_minutes default e RPC). */
  tolerance_minutes?: number;
  /** HE < este valor é descartada (aplicada por semana). Default 0 — alinhado
   *  com work_schedules.minimum_overtime_minutes default e UI fallback. */
  minimum_overtime_minutes?: number;
  /** Multiplicador da HE em dia útil. Default 0 = hora simples (sem adicional).
   *  Vem de employees.overtime_50_pct — configurável por contrato. */
  overtime_50_pct?: number;
  /** Multiplicador da HE em domingo/feriado. Default 0 = hora simples. */
  overtime_100_pct?: number;
  /** % adicional pelas horas noturnas. Default 0 = sem adicional. */
  night_bonus_pct?: number;
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

// ── Tabelas INSS/IRRF ───────────────────────────────────────────────────────
// ATENÇÃO: estas tabelas são publicadas pelo governo e mudam normalmente em
// JANEIRO de cada ano. Quando mudar, atualizar AQUI e bumpar PAYROLL_TAX_YEAR.
// O frontend exibe alerta âmbar em /payroll quando o ano da folha calculada
// não bate com PAYROLL_TAX_YEAR.
export const PAYROLL_TAX_YEAR = 2026;

// INSS: alíquota incide sobre cada faixa (progressiva). Em ordem crescente.
export const INSS_BANDS = [
  { upTo: 1412.00, rate: 0.075 },
  { upTo: 2666.68, rate: 0.09 },
  { upTo: 4000.03, rate: 0.12 },
  { upTo: 7786.02, rate: 0.14 },
];
export const INSS_CEILING_VALUE = 908.86; // INSS máximo (teto)

// IRRF: alíquota progressiva com dedução
export const IRRF_BANDS = [
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
  for (const band of INSS_BANDS) {
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

/**
 * @deprecated Mantida pra histórico/auditoria. Cálculo de IRRF segue a tabela
 * RFB vigente. NÃO é chamada em calculatePayroll() — regime de contrato
 * (não-CLT) não retém IRRF; cada contratado é responsável pelo próprio.
 */
export function calculateIRRF(baseAfterINSS: number): number {
  if (baseAfterINSS <= 0) return 0;
  for (const band of IRRF_BANDS) {
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
 * Punches ímpares (3, 5, ...) retornam 0 — alinhado com banco que marca
 * o dia como `partial` em vez de presumir entrada/saída faltante.
 */
function workedMinutesFromPunches(punches: string[]): number {
  if (punches.length < 2 || punches.length % 2 !== 0) return 0;
  let total = 0;
  for (let i = 0; i + 1 < punches.length; i += 2) {
    const a = timeToMin(punches[i]);
    const b = timeToMin(punches[i + 1]);
    // Midnight-crossing: b < a means the shift ends after midnight
    total += b > a ? b - a : b < a ? (1440 - a) + b : 0;
  }
  return total;
}

/** Retorna a segunda-feira (00:00) da semana de `date`, em YYYY-MM-DD. */
function mondayOf(dateISO: string): string {
  const d = new Date(dateISO + 'T00:00:00');
  const dow = d.getDay();             // 0 = dom, 1 = seg
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

/**
 * @param paidOvertimeMinutes Quando fornecido, DESATIVA o cálculo automático
 * de HE 50/100. Esses minutos vêm de `bank_hours_movements` onde RH marcou
 * explicitamente "pagar". Decisão da gestão (2026-05-21): a fábrica não
 * segue o padrão CLT teórico — HE só vai pra folha se for explicitamente
 * autorizada pelo RH.
 */
export function calculatePayroll(
  employee: PayrollEmployeeInput,
  days: PayrollDayInput[],
  absences: PayrollAbsenceInput[],
  advancesTotal: number,
  config: BenefitsConfig,
  paidOvertimeMinutes?: { ot50: number; ot100: number },
): PayrollResult {
  const baseSalary = Number(employee.base_salary) || 0;
  const monthlyHours = config.monthly_hours || 220;
  const hourlyRate = monthlyHours > 0 ? baseSalary / monthlyHours : 0;
  const minuteRate = hourlyRate / 60;

  // Tolerância e mínimo de HE — defaults alinhados com work_schedules e com
  // calculate_employee_bank_balance() do banco. Aplicados POR SEMANA (não dia)
  // pra evitar discrepância entre o cálculo da folha e o saldo do banco de horas.
  // Defaults idênticos aos do RPC calculate_employee_bank_balance:
  //   tolerance_minutes default 10, minimum_overtime_minutes default 0.
  // Antes minimum_overtime_minutes usava `?? 10`, divergindo do RPC e dos
  // fallbacks de UI (Timesheet.tsx, useTimeAnalytics.ts: =0). Resultado:
  // funcionários sem work_schedule tinham HE entre 1–9 min descartadas só
  // na folha, batendo divergência com banco de horas exibido na UI.
  const TOLERANCE_MIN = Math.max(0, employee.tolerance_minutes ?? 10);
  const MIN_OT_MIN   = Math.max(0, employee.minimum_overtime_minutes ?? 0);

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

  // Agrupa dias por semana (chave = segunda-feira) pra aplicar tolerância
  // semanal: dias curtos compensam dias longos antes de gerar HE.
  type WeekBucket = {
    workedBusiness: number;     // minutos trabalhados em dias úteis (não-feriado, não-domingo)
    expectedBusiness: number;   // minutos esperados em dias úteis
    workedHolidaySunday: number; // minutos trabalhados em domingo/feriado (vão pra HE 100)
  };
  const weeks = new Map<string, WeekBucket>();

  for (const d of days) {
    expectedMin += d.expectedMinutes;
    if (d.isBusinessDay && !d.isHoliday) businessDays++;

    const dayWorked = workedMinutesFromPunches(d.punches);
    workedMin += dayWorked;
    if (dayWorked > 0 && d.isBusinessDay && !d.isHoliday) businessDaysWorked++;

    const weekKey = mondayOf(d.date);
    const bucket = weeks.get(weekKey) ?? { workedBusiness: 0, expectedBusiness: 0, workedHolidaySunday: 0 };

    if (d.isHoliday || d.dayOfWeek === 0) {
      bucket.workedHolidaySunday += dayWorked;
    } else {
      bucket.workedBusiness += dayWorked;
      bucket.expectedBusiness += d.expectedMinutes;
    }
    weeks.set(weekKey, bucket);

    nightMin += countNightMinutes(d.punches, config.night_shift_start_min, config.night_shift_end_min);
  }

  // HE manual (decisão 2026-05-21): se o caller passou paidOvertimeMinutes,
  // usa esses valores e PULA o cálculo automático semanal. Isso garante que
  // a folha só pague o que o RH explicitamente aprovou em bank_hours_movements
  // (movement_type='pay' ou similar) — alinhado com a regra "fábrica não
  // segue CLT teórico".
  if (paidOvertimeMinutes) {
    ot50Min = Math.max(0, paidOvertimeMinutes.ot50);
    ot100Min = Math.max(0, paidOvertimeMinutes.ot100);
  } else {
    // Fallback legado: cálculo automático semanal (caller antigo não migrado).
    // - Se |worked - expected| <= tolerância → ignora (saldo = 0 na semana)
    // - Se diff > 0 mas < mínimo de HE → ignora (não gera HE)
    // - Domingo/feriado sempre vira HE 100, sem tolerância (CLT)
    for (const [, w] of weeks) {
      const diff = w.workedBusiness - w.expectedBusiness;
      if (Math.abs(diff) > TOLERANCE_MIN) {
        if (diff > 0 && diff >= MIN_OT_MIN) {
          ot50Min += diff;
        }
        // diff < 0 (devedor) NÃO entra como HE; cai no banco de horas (negativo)
      }
      // Domingo/feriado: aplica só o mínimo de HE pra evitar "5 min de HE 100"
      if (w.workedHolidaySunday >= MIN_OT_MIN) {
        ot100Min += w.workedHolidaySunday;
      }
    }
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

  // Multiplicadores POR FUNCIONÁRIO (regime contrato — cada um tem seu acordo).
  // Default 0 = hora simples (sem adicional CLT). employees.overtime_*_pct
  // sobrescreve por funcionário; config.overtime_*_pct é fallback global.
  const ot50Pct      = employee.overtime_50_pct  ?? config.overtime_50_pct  ?? 0;
  const ot100Pct     = employee.overtime_100_pct ?? config.overtime_100_pct ?? 0;
  const nightBonus   = employee.night_bonus_pct  ?? config.night_bonus_pct  ?? 0;

  const ot50Value = ot50Min * minuteRate * (1 + ot50Pct / 100);
  const ot100Value = ot100Min * minuteRate * (1 + ot100Pct / 100);
  const nightBonusValue = nightMin * minuteRate * (nightBonus / 100);

  // DSR / INSS / IRRF / VT desconto: NÃO se aplicam em regime de contrato
  // (não-CLT). Contratado é PJ/prestador — cada um cuida dos próprios impostos.
  // Mantemos os campos no result com zero pra preservar contrato de tipo e
  // facilitar futura adição de um modo "CLT" se necessário.
  const dsrValue = 0;
  const inssValue = 0;
  const irrfValue = 0;
  const vtTotal = 0;
  const vtEmployeeDiscount = 0;

  // Benefícios pagos (não-CLT, são acordos contratuais — VR/VA continuam)
  const vrValue = employee.receives_vr ? config.vr_daily_value * businessDaysWorked : 0;
  const vaValue = employee.receives_va ? config.va_monthly_value : 0;

  const healthPlanDiscount = employee.health_plan_value > 0
    ? employee.health_plan_value
    : config.health_plan_default;

  const totalProventos = baseSalary + ot50Value + ot100Value + nightBonusValue + vrValue + vaValue;
  const totalDescontos = healthPlanDiscount + absenceDiscount + advancesTotal;
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

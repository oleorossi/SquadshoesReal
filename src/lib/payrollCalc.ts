/**
 * Cálculo de pagamento — REGIME PJ (Pessoa Jurídica / Contratado).
 *
 * Todos os funcionários da empresa são PJ — emitem NF própria e cuidam dos
 * próprios impostos (INSS, IRRF, etc.). A empresa contratante apenas paga
 * o valor acordado. O relógio de ponto é APENAS pra contabilizar horas
 * trabalhadas; não há vínculo CLT.
 *
 * Modelo simplificado de pagamento:
 *
 *   bruto    = base_salary                                  (valor fixo mensal acordado em contrato)
 *            + horas_extras_pagas × valor_hora              (sem multiplier — acordo PJ não tem CLT art. 7 XVI)
 *            + VR (R$/dia útil trabalhado)                  (benefício contratual opcional)
 *            + VA (R$ flat mensal)                          (benefício contratual opcional)
 *   descontos = plano_saúde + faltas_descontadas + adiantamentos
 *   líquido  = bruto − descontos
 *
 * O QUE NÃO SE APLICA (porque não há CLT):
 *   - INSS / IRRF / VT discount / FGTS              (PJ paga próprios impostos)
 *   - DSR reflexo sobre HE (Súmula 172 TST)         (regra CLT mensalista)
 *   - Adicional noturno fator 7/8 (art. 73)         (regra CLT)
 *   - Multiplier de hora extra 50%/100% (art. 7)    (regra CLT mensalista)
 *   - 13º salário (Lei 4090/62)                     (verba CLT)
 *   - Férias remuneradas (CLT)                      (verba CLT)
 *
 * Tolerância e mínimo de HE em minutos continuam relevantes porque são
 * acordos práticos de "margem de erro" no relógio (PJ pode acordar 10min de
 * folga sem ser cobrado dos dois lados). Banco de horas (compensação) é
 * acordo livre entre as partes.
 */

export interface BenefitsConfig {
  /** R$/dia útil trabalhado — benefício PJ opcional. */
  vr_daily_value: number;
  /** R$ mensal flat — benefício PJ opcional. */
  va_monthly_value: number;
  /** Desconto padrão de plano de saúde se employee.health_plan_value == 0. */
  health_plan_default: number;
  /** Divisor mensal pra cálculo de valor-hora. Default 220. */
  monthly_hours: number;
}

export interface PayrollEmployeeInput {
  id: string;
  name: string;
  /** Valor fixo mensal acordado em contrato PJ. */
  base_salary: number;
  /** Data de início do contrato — usada pra cálculo proporcional se o
   *  contrato começou/terminou no meio do mês. */
  admission_date?: string | null;
  /** Data de encerramento do contrato — usada pra cálculo proporcional. */
  termination_date?: string | null;
  receives_vr: boolean;
  receives_va: boolean;
  health_plan_value: number;
  /** Carga semanal contratada (ex: 44, 40, 36). Default 44. */
  weekly_hours?: number;
  /** Tolerância em minutos: variações <= este valor não geram crédito/débito
   *  no banco de horas. Default 10. */
  tolerance_minutes?: number;
  /** HE < este valor é descartada (aplicada por semana). Default 0. */
  minimum_overtime_minutes?: number;
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
  /** Total de minutos de HE autorizados (vindos de paidOvertimeMinutes —
   *  decisão explícita do gestor de pagar via folha). Antes era ot_50/100
   *  separados (regra CLT); em PJ não há essa distinção, soma única. */
  overtime_paid_minutes: number;
  overtime_paid_value: number;
  vr_value: number;
  va_value: number;
  health_plan_discount: number;
  absence_discount: number;
  total_proventos: number;
  total_descontos: number;
  total_liquido: number;

  /**
   * @deprecated Campos legados CLT — preservados zerados pra backward-compat
   * com callers e DB schema. Não usados em regime PJ. Próxima migração de
   * schema poderá removê-los.
   */
  overtime_50_minutes: number;
  /** @deprecated CLT-only. Use overtime_paid_minutes. */
  overtime_100_minutes: number;
  /** @deprecated CLT-only. Use overtime_paid_minutes. */
  night_minutes: number;
  /** @deprecated CLT-only. Soma agregada em overtime_paid_value. */
  overtime_50_value: number;
  /** @deprecated CLT-only. */
  overtime_100_value: number;
  /** @deprecated CLT-only. */
  night_bonus_value: number;
  /** @deprecated CLT-only (Súmula 172 TST não aplica PJ). */
  dsr_value: number;
  /** @deprecated CLT-only. */
  vt_total_value: number;
  /** @deprecated CLT-only. */
  vt_employee_discount: number;
  /** @deprecated CLT-only — PJ paga próprios impostos. */
  inss_value: number;
  /** @deprecated CLT-only — PJ paga próprios impostos. */
  irrf_value: number;
}

function timeToMin(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
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
    // Cruzando meia-noite: b < a significa que o turno termina depois da meia-noite
    total += b > a ? b - a : b < a ? (1440 - a) + b : 0;
  }
  return total;
}

/**
 * Calcula folha PJ. Parâmetros:
 *  - employee: contratado e seus parâmetros de pagamento (R$/mês, beneficios)
 *  - days: dias do período com batidas pra contabilizar horas trabalhadas
 *  - absences: ausências pra descontar faltas não-pagas
 *  - advancesTotal: total de vales/adiantamentos do período (já em R$)
 *  - paidOvertimeMinutes: minutos de HE explicitamente autorizados pelo gestor
 *    (vêm de bank_hours_movements onde RH marcou "pagar"). Em PJ, HE só vai
 *    pra folha se for explicitamente autorizada — fábrica não segue CLT teórico.
 */
export function calculatePayroll(
  employee: PayrollEmployeeInput,
  days: PayrollDayInput[],
  absences: PayrollAbsenceInput[],
  advancesTotal: number,
  config: BenefitsConfig,
  paidOvertimeMinutes?: number,
): PayrollResult {
  const baseSalaryFull = Number(employee.base_salary) || 0;

  // Proporcional ao mês de admissão/demissão. Em PJ é opcional (depende do
  // contrato), mas adotamos prorata por padrão — gestor pode editar manual
  // se acordo diferente.
  let baseSalary = baseSalaryFull;
  if (days.length > 0) {
    const firstDay = new Date(days[0].date + 'T00:00:00');
    const lastDay = new Date(days[days.length - 1].date + 'T00:00:00');
    const monthDays = new Date(firstDay.getFullYear(), firstDay.getMonth() + 1, 0).getDate();
    const admissionDate = employee.admission_date ? new Date(employee.admission_date + 'T00:00:00') : null;
    const terminationDate = employee.termination_date ? new Date(employee.termination_date + 'T00:00:00') : null;
    let workedDaysInMonth = monthDays;
    if (admissionDate && admissionDate > firstDay && admissionDate <= lastDay) {
      workedDaysInMonth = monthDays - admissionDate.getDate() + 1;
    }
    if (terminationDate && terminationDate >= firstDay && terminationDate < lastDay) {
      const terminationDay = terminationDate.getDate();
      workedDaysInMonth = Math.min(workedDaysInMonth, terminationDay);
    }
    if (workedDaysInMonth < monthDays) {
      baseSalary = Math.round((baseSalaryFull * workedDaysInMonth / monthDays) * 100) / 100;
    }
  }

  const monthlyHours = config.monthly_hours || 220;
  const hourlyRate = monthlyHours > 0 ? baseSalaryFull / monthlyHours : 0;
  const minuteRate = hourlyRate / 60;

  let workedMin = 0;
  let expectedMin = 0;
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
  }

  // Horas extras: SOMENTE as explicitamente autorizadas (paidOvertimeMinutes).
  // Em PJ não há CLT mandando pagar HE automaticamente; cabe ao gestor decidir
  // o que vai pra folha (e a quantidade tipicamente vem de bank_hours_movements).
  const otMin = Math.max(0, paidOvertimeMinutes ?? 0);
  const otValue = otMin * minuteRate; // sem multiplier — acordo PJ paga hora cheia

  // Faltas injustificadas (descontadas se acordado)
  let absentDays = 0;
  let absenceDiscount = 0;
  const dailyRate = baseSalary / Math.max(1, businessDays || 22);
  for (const [, a] of absenceDays) {
    if (a.absence_type === 'falta_injustificada' && !a.paid) {
      absentDays++;
      absenceDiscount += dailyRate;
    }
  }

  // Benefícios contratuais (acordos opcionais; defaults zero)
  const vrValue = employee.receives_vr ? config.vr_daily_value * businessDaysWorked : 0;
  const vaValue = employee.receives_va ? config.va_monthly_value : 0;

  const healthPlanDiscount = employee.health_plan_value > 0
    ? employee.health_plan_value
    : config.health_plan_default;

  const totalProventos = baseSalary + otValue + vrValue + vaValue;
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
    overtime_paid_minutes: otMin,
    overtime_paid_value: round2(otValue),
    vr_value: round2(vrValue),
    va_value: round2(vaValue),
    health_plan_discount: round2(healthPlanDiscount),
    absence_discount: round2(absenceDiscount),
    total_proventos: round2(totalProventos),
    total_descontos: round2(totalDescontos),
    total_liquido: round2(totalLiquido),

    // Campos legados CLT — zerados (PJ não tem essas verbas). Preservados
    // pra não quebrar callers/schema. Limpeza completa em migração futura.
    overtime_50_minutes: 0,
    overtime_100_minutes: 0,
    night_minutes: 0,
    overtime_50_value: 0,
    overtime_100_value: 0,
    night_bonus_value: 0,
    dsr_value: 0,
    vt_total_value: 0,
    vt_employee_discount: 0,
    inss_value: 0,
    irrf_value: 0,
  };
}

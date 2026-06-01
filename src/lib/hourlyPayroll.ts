/**
 * Folha por HORA TRABALHADA — modelo ÚNICO do RH (decisão do usuário, 2026-06-01).
 *
 * O setor de RH existe pra UMA coisa: pagar cada funcionário pelas horas que ele
 * efetivamente bateu no ponto. Não há mais jornada esperada, falta, banco de
 * horas, HE automática 50/100, DSR, INSS/IRRF nem VR/VA/VT — tudo isso foi
 * aposentado. O único desconto é ADIANTAMENTO (vale).
 *
 * Cada funcionário tem um SALÁRIO-REFERÊNCIA de jornada cheia (220h/mês):
 *   valor-hora (VH) = salário ÷ 220        (as 44h/semana viram 220h/mês com DSR)
 *
 * Soma-se só as horas batidas (pares entrada→saída). Cada hora vale:
 *   - 1,5×  → sábado, domingo ou feriado (dia inteiro), OU depois das 18:00 num
 *             dia útil;
 *   - 1,0×  → o resto (dia útil, até as 18:00).
 * NÃO acumula: feriado depois das 18h continua 1,5× (não 2,25×).
 *
 *   bruto   = horas_normais × VH + horas_1,5 × VH × 1,5
 *   líquido = bruto − adiantamentos
 *
 * Quem trabalha menos (meio período, dia sim-dia não) recebe menos
 * automaticamente, porque bate menos horas — a proporção vem das HORAS, não do
 * salário. O salário cadastrado é sempre a referência cheia de 220h/mês.
 */

/** 44h/semana → 220h/mês (DSR embutido). Base do valor-hora. */
export const MONTHLY_HOURS_DIVISOR = 220;
/** Após 18:00 em dia útil, a hora é 1,5×. */
export const PREMIUM_CUTOFF_MIN = 18 * 60;
/** Multiplicador da hora "extra" (após 18h / fim de semana / feriado). */
export const PREMIUM_MULTIPLIER = 1.5;

export interface HourlyDayInput {
  date: string; // YYYY-MM-DD
  dayOfWeek: number; // 0=domingo … 6=sábado
  isHoliday: boolean;
  punches: string[]; // ['08:00','12:00','15:00','18:00']
}

export interface HourlyPayrollResult {
  hourly_rate: number; // salário ÷ 220
  normal_minutes: number; // minutos 1,0×
  premium_minutes: number; // minutos 1,5×
  worked_minutes: number; // normais + 1,5×
  normal_value: number; // R$ das horas normais
  premium_value: number; // R$ das horas 1,5× (já com o ×1,5)
  gross_value: number; // bruto
  advances_total: number; // adiantamentos (único desconto)
  net_value: number; // líquido a pagar
  incomplete_days: number; // dias com nº ímpar de batidas (falta entrada/saída)
  days_worked: number; // dias com alguma hora batida
}

function timeToMin(t: string): number {
  const [h, m] = String(t).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * Divide os minutos batidos de UM dia em normais × 1,5×.
 * - Sábado/domingo/feriado → tudo 1,5×.
 * - Dia útil → antes das 18:00 normal; depois das 18:00 vira 1,5×.
 * Pares (i, i+1); o intervalo 12:00→15:00 (almoço) some sozinho porque não é
 * um par batido. Batida ímpar sobrando é ignorada e marca o dia como incompleto
 * (RH corrige na entrada manual). Cruzamento de meia-noite é tratado de forma
 * defensiva (raro em fábrica): [a,24:00] no dia + [00:00,b] como madrugada normal.
 */
export function splitDayMinutes(
  punches: string[],
  dayOfWeek: number,
  isHoliday: boolean,
): { normal: number; premium: number; incomplete: boolean } {
  const allPremium = isHoliday || dayOfWeek === 0 || dayOfWeek === 6;
  let normal = 0;
  let premium = 0;
  for (let i = 0; i + 1 < punches.length; i += 2) {
    const a = timeToMin(punches[i]);
    const b = timeToMin(punches[i + 1]);
    if (b === a) continue;
    // Cruza meia-noite (b<a) → dois segmentos intra-dia.
    const segments: [number, number][] = b < a ? [[a, 1440], [0, b]] : [[a, b]];
    for (const [s, e] of segments) {
      const dur = e - s;
      if (dur <= 0) continue;
      if (allPremium) {
        premium += dur;
        continue;
      }
      // Dia útil: parte antes das 18:00 = normal; o que passar = 1,5×.
      const normalPart = Math.max(0, Math.min(e, PREMIUM_CUTOFF_MIN) - s);
      normal += normalPart;
      premium += dur - normalPart;
    }
  }
  const incomplete = punches.length % 2 !== 0 && punches.length > 0;
  return { normal, premium, incomplete };
}

export function calculateHourlyPayroll(
  salary: number,
  days: HourlyDayInput[],
  advancesTotal: number,
  divisor: number = MONTHLY_HOURS_DIVISOR,
): HourlyPayrollResult {
  const hourlyRate = divisor > 0 ? (Number(salary) || 0) / divisor : 0;
  let normalMin = 0;
  let premiumMin = 0;
  let incompleteDays = 0;
  let daysWorked = 0;

  for (const d of days) {
    const punches = Array.isArray(d.punches) ? d.punches : [];
    if (punches.length < 2) {
      if (punches.length === 1) incompleteDays++;
      continue;
    }
    const { normal, premium, incomplete } = splitDayMinutes(punches, d.dayOfWeek, d.isHoliday);
    if (incomplete) incompleteDays++;
    if (normal + premium > 0) daysWorked++;
    normalMin += normal;
    premiumMin += premium;
  }

  const normalValue = (normalMin / 60) * hourlyRate;
  const premiumValue = (premiumMin / 60) * hourlyRate * PREMIUM_MULTIPLIER;
  const gross = normalValue + premiumValue;
  const adv = Number(advancesTotal) || 0;
  const round2 = (n: number) => Math.round(n * 100) / 100;

  return {
    hourly_rate: Number(hourlyRate.toFixed(4)),
    normal_minutes: normalMin,
    premium_minutes: premiumMin,
    worked_minutes: normalMin + premiumMin,
    normal_value: round2(normalValue),
    premium_value: round2(premiumValue),
    gross_value: round2(gross),
    advances_total: round2(adv),
    net_value: round2(gross - adv),
    incomplete_days: incompleteDays,
    days_worked: daysWorked,
  };
}

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
/** Almoço padrão deduzido quando o almoço NÃO foi batido (só entrada+saída,
 *  ou batida faltando) e o dia é longo. */
export const STANDARD_LUNCH_MIN = 60;
/** Acima disso (6h) o dia é longo o bastante pra incluir almoço. */
export const LONG_DAY_MIN = 360;
/** Janela em que o almoço acontece: 12:00–14:00 (decisão 2026-06-02). */
export const LUNCH_WINDOW_START = 12 * 60;
export const LUNCH_WINDOW_END = 14 * 60;

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
  // Tolera anotações do relógio de ponto: '18:00*' marca batida ASSUMIDA/inferida
  // pelo sistema antigo (e há minutos ≠ 0, ex.: '12:37*'). Sem descartar o '*',
  // Number('37*')=NaN zeraria os minutos. Remove tudo que não for dígito/':'.
  const clean = String(t).replace(/[^\d:]/g, '');
  const [h, m] = clean.split(':').map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

/**
 * Divide os minutos batidos de UM dia em normais × 1,5×.
 * - Sábado/domingo/feriado → tudo 1,5×.
 * - Dia útil → antes das 18:00 normal; depois das 18:00 vira 1,5×.
 *
 * Batidas:
 * - **4+ pares** (ex.: 08:00,12:00,13:00,18:00) → soma os pares reais.
 * - **2 batidas** (entrada+saída) → span do 1º ao último (não perde a tarde).
 * - **nº ÍMPAR** (pulou uma batida) → INCONSISTENTE: 0h + `incomplete`. Não é mais
 *   "chutado" pelo intervalo (inflava/deflava a folha); fica de fora do cálculo até
 *   ser resolvido manualmente na aba Pendências de Ponto (decisão do usuário 2026-06).
 *
 * Almoço (decisão 2026-06-02): é **1h dentro de 12:00–14:00**. Em dia longo (>6h)
 * que cruza o meio-dia, garante **no mínimo 1h** de almoço — se a pessoa bateu uma
 * pausa MENOR que 1h nessa janela (ou não bateu), desconta o que faltar pra 1h; se
 * bateu pausa MAIOR (ex.: saiu 2h), respeita a real. O desconto sai da hora normal
 * (12–14 é período normal); o que sobrar sai do 1,5×. Meia-noite tratada de forma
 * defensiva.
 */
export function splitDayMinutes(
  punches: string[],
  dayOfWeek: number,
  isHoliday: boolean,
): { normal: number; premium: number; incomplete: boolean } {
  const n = punches.length;
  if (n < 2) return { normal: 0, premium: 0, incomplete: n === 1 };
  // Ordena as batidas numericamente antes de parear: o relógio pode entregar fora de
  // ordem e, sem ordenar, os pares saem trocados e o almoço deixa de ser deduzido
  // (ex.: 08,18,12,13 → [08→18]+[12→13] = 11h em vez de 9h). A validação já ordena
  // (timeValidationRules), mas o motor não — contrato silencioso. Numérico, não lexical
  // (tolera '12:37*'). Idempotente em batidas já ordenadas.
  const ps = [...punches].sort((a, b) => timeToMin(a) - timeToMin(b));
  // Nº ÍMPAR de batidas:
  //  • n = 3 (FALTOU uma batida) → INCONSISTENTE: 0h + incomplete, resolve manual
  //    em Pendências (não dá pra inferir com segurança qual batida faltou).
  //  • n ≥ 5 (BATIDA EXTRA) → calcula tratando a ÚLTIMA batida como SAÍDA: se ele
  //    bateu naquele último horário, foi quando foi embora (decisão do dono
  //    2026-06-21). Cai no ramo de span 1º→último abaixo + desconto de almoço, em
  //    vez de virar pendência. Antes qualquer ímpar zerava (decisão 2026-06).
  if (n % 2 !== 0 && n < 5) return { normal: 0, premium: 0, incomplete: true };
  const allPremium = isHoliday || dayOfWeek === 0 || dayOfWeek === 6;

  // Intervalos trabalhados: pares reais (par 4+) ou span do 1º ao último (2 batidas
  // OU ímpar ≥5 = batida extra → última batida é a saída).
  let intervals: [number, number][];
  if (n >= 4 && n % 2 === 0) {
    intervals = [];
    for (let i = 0; i + 1 < n; i += 2) intervals.push([timeToMin(ps[i]), timeToMin(ps[i + 1])]);
  } else {
    intervals = [[timeToMin(ps[0]), timeToMin(ps[n - 1])]];
  }

  // Classifica normal × 1,5× (corte às 18:00; tudo 1,5× em sáb/dom/feriado).
  let normal = 0;
  let premium = 0;
  for (const [a, b] of intervals) {
    const segments: [number, number][] = b < a ? [[a, 1440], [0, b]] : [[a, b]];
    for (const [s, e] of segments) {
      const dur = e - s;
      if (dur <= 0) continue;
      if (allPremium) { premium += dur; continue; }
      const normalPart = Math.max(0, Math.min(e, PREMIUM_CUTOFF_MIN) - s);
      normal += normalPart;
      premium += dur - normalPart;
    }
  }

  // Almoço mínimo de 1h dentro de 12:00–14:00, em dia longo que cruza o meio-dia.
  const first = timeToMin(ps[0]);
  const last = timeToMin(ps[n - 1]);
  const spansLunch = last > first && first < 13 * 60 && last > 13 * 60 && (last - first) > LONG_DAY_MIN;
  if (spansLunch) {
    const onShiftInWin = Math.max(0, Math.min(last, LUNCH_WINDOW_END) - Math.max(first, LUNCH_WINDOW_START));
    let workedInWin = 0;
    for (const [a, b] of intervals) {
      if (b < a) continue; // ignora cruzamento de meia-noite p/ a janela de almoço
      workedInWin += Math.max(0, Math.min(b, LUNCH_WINDOW_END) - Math.max(a, LUNCH_WINDOW_START));
    }
    const breakInWin = Math.max(0, onShiftInWin - workedInWin); // pausa já tirada em 12–14
    let lunch = Math.max(0, STANDARD_LUNCH_MIN - breakInWin);    // completa até 1h
    const fromNormal = Math.min(lunch, normal);
    normal -= fromNormal;
    lunch -= fromNormal;
    premium = Math.max(0, premium - lunch);
  }

  // Aqui só chegam: par (≥2) e ímpar ≥5 (batida extra, já calculado via span). Ambos
  // são considerados COMPLETOS — ímpar <5 (n=3) já retornou incomplete acima.
  return { normal, premium, incomplete: false };
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

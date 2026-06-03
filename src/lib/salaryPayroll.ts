/**
 * Folha SALÁRIO CHEIO − DESCONTOS (decisão do usuário 2026-06-03).
 *
 * Modelo do RH para o PAGAMENTO (folha): parte do salário mensal cheio e DESCONTA
 * faltas, atrasos e saídas cedo medidos contra a JORNADA ESPERADA cadastrada
 * (08:00–18:00 com 1h de almoço = 9h/dia, seg–sex, por padrão). Hora extra acima
 * do esperado (após as 18:00, ou em sábado/domingo/feriado) SOMA a 1,5×.
 *
 * Regras (confirmadas pelo usuário):
 *   - valor-dia  = salário ÷ 30      (desconto de 1 falta = 1 dia)
 *   - valor-hora = salário ÷ 220     (desconto de atraso/saída-cedo e cálculo da HE)
 *   - Falta (dia útil sem trabalho)        → − valor-dia
 *   - Atraso + saída cedo (trabalhou < esperado) → − (esperado − trabalhado) × valor-hora
 *   - Hora extra (após 18h / fim de semana / feriado) → + horas × valor-hora × 1,5
 *   - Falta NÃO tira o DSR (desconta só o dia).
 *   - Dia com nº ÍMPAR de batidas = INCONSISTENTE → fica PENDENTE: não desconta nem
 *     paga, conta só pra alerta (resolver na aba Pendências de Ponto antes de fechar).
 *
 *   bruto   = salário − faltas − atrasos + horas_extras
 *   líquido = bruto − adiantamentos
 *
 * Base = salário CHEIO do mês. As duas migrações do relógio (01→20 e 21→fim) são
 * COMPLEMENTARES: juntas cobrem o mês inteiro. Se só uma estiver carregada, a folha
 * sai PARCIAL (os dias não importados não são descontados) — a tela avisa.
 */
import { splitDayMinutes, PREMIUM_MULTIPLIER } from './hourlyPayroll';

/** 1 falta desconta 1 dia = salário ÷ 30 (diária CLT). */
export const SALARY_DAY_DIVISOR = 30;
/** Atraso/saída-cedo e HE usam valor-hora = salário ÷ 220. */
export const SALARY_HOUR_DIVISOR = 220;

// ─── Jornada da escala (FONTE ÚNICA) ─────────────────────────────────────────
// Usada pela folha (Payroll) E pela Avaliação de Jornada (printTimesheet) pra
// garantir que "esperado" seja idêntico nos dois — evita o atraso descontar
// valores diferentes entre folha e relatório.
const WORKS_DOW = ['works_sunday', 'works_monday', 'works_tuesday', 'works_wednesday', 'works_thursday', 'works_friday', 'works_saturday'] as const;

/** "08:30" → 510 minutos. Tolerante a nulos/vazios. */
export function timeToMin(t: string): number {
  const [h, m] = String(t || '0:0').split(':').map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

/** Escala trabalha neste dia da semana? (0=dom … 6=sáb) */
export function worksOnDow(sch: any, dow: number): boolean {
  return !!(sch && sch[WORKS_DOW[dow]]);
}

/** Jornada esperada do dia (min): saída − entrada − almoço. Ex.: 08–18 c/ 12–13 = 540 (9h). */
export function expectedDayMinutes(sch: any): number {
  if (!sch) return 0;
  return Math.max(0, timeToMin(sch.exit_time) - timeToMin(sch.entry_time) - (timeToMin(sch.lunch_end) - timeToMin(sch.lunch_start)));
}

export interface SalaryDayInput {
  date: string;          // YYYY-MM-DD
  dayOfWeek: number;     // 0=domingo … 6=sábado
  isHoliday: boolean;
  /** true se é dia de trabalho na escala (seg–sex por padrão) E não é feriado. */
  isWorkday: boolean;
  /** jornada esperada do dia em minutos (ex.: 540 = 9h). 0 em folga/feriado. */
  expectedMinutes: number;
  punches: string[];     // ['08:00','12:00','13:00','18:00']
}

export interface SalaryPayrollResult {
  base_salary: number;     // salário MENSAL cheio (referência p/ valor-dia/valor-hora)
  valor_dia: number;       // salário ÷ 30
  valor_hora: number;      // salário ÷ 220
  period_days: number;     // nº de dias corridos do período (30 = mês cheio)
  period_base: number;     // R$ base proporcional do período = valor-dia × period_days
  expected_minutes: number;
  worked_minutes: number;  // soma das horas batidas em dias VÁLIDOS (não pendentes)
  normal_minutes: number;
  premium_minutes: number;
  workdays: number;        // dias úteis esperados no período coberto
  worked_days: number;     // dias úteis com alguma hora trabalhada
  falta_days: number;
  falta_desconto: number;  // R$ (faltas × valor-dia)
  atraso_minutes: number;  // minutos faltantes (atraso + saída cedo) em dias parciais
  atraso_desconto: number; // R$ (atraso_minutes × valor-hora)
  he_minutes: number;
  he_value: number;        // R$ (he_minutes × valor-hora × 1,5)
  pending_days: number;    // dias com batida ímpar (inconsistente) — não entram no cálculo
  advances_total: number;
  total_descontos: number; // faltas + atrasos + adiantamentos
  total_proventos: number; // salário + HE
  gross_value: number;     // salário − faltas − atrasos + HE
  net_value: number;       // bruto − adiantamentos
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function calculateSalaryPayroll(
  salary: number,
  days: SalaryDayInput[],
  advancesTotal: number,
  dayDivisor: number = SALARY_DAY_DIVISOR,
  hourDivisor: number = SALARY_HOUR_DIVISOR,
  /**
   * Dias CORRIDOS do período pago (quinzena/intervalo). Quando informado, a base de
   * proventos vira PROPORCIONAL: valor-dia × periodDays (ex.: quinzena 01–15 = 15 dias
   * = metade do salário). Omitido/≤0 ⇒ mês cheio (base = salário). valor-dia e
   * valor-hora continuam sobre o salário MENSAL (faltas/atrasos não mudam de escala).
   */
  periodDays?: number,
): SalaryPayrollResult {
  const sal = Number(salary) || 0;
  const valorDia = dayDivisor > 0 ? sal / dayDivisor : 0;
  const valorHora = hourDivisor > 0 ? sal / hourDivisor : 0;
  const valorMin = valorHora / 60;
  // Base de proventos do período: proporcional aos dias quando periodDays vier
  // (paga-se por quinzena); senão, mês cheio.
  const periodDaysEff = periodDays != null && periodDays > 0 ? periodDays : dayDivisor;
  const periodBase = periodDays != null && periodDays > 0 ? valorDia * periodDays : sal;

  let expectedMin = 0;
  let workedMin = 0;
  let normalMin = 0;
  let premiumMin = 0;
  let workdays = 0;
  let workedDays = 0;
  let faltaDays = 0;
  let atrasoMin = 0;
  let heMin = 0;
  let pendingDays = 0;

  for (const d of days) {
    const punches = Array.isArray(d.punches) ? d.punches : [];
    const sp = punches.length >= 2
      ? splitDayMinutes(punches, d.dayOfWeek, d.isHoliday)
      : { normal: 0, premium: 0, incomplete: punches.length === 1 };

    // Batida ímpar / inconsistente → PENDENTE: não desconta nem paga.
    if (sp.incomplete) {
      pendingDays++;
      continue;
    }

    const worked = sp.normal + sp.premium;

    if (d.isWorkday && d.expectedMinutes > 0) {
      expectedMin += d.expectedMinutes;
      workdays++;
      if (worked === 0) {
        // Falta: dia útil sem trabalho → desconta 1 valor-dia.
        faltaDays++;
        continue;
      }
      workedDays++;
      workedMin += worked;
      normalMin += sp.normal;
      premiumMin += sp.premium;
      // Atraso + saída cedo: o que faltou pra cumprir a jornada (parte normal).
      const deficit = Math.max(0, d.expectedMinutes - sp.normal);
      if (deficit > 0) atrasoMin += deficit;
      // Após as 18:00 num dia útil → hora extra a 1,5×.
      if (sp.premium > 0) heMin += sp.premium;
    } else {
      // Dia NÃO útil (fim de semana/feriado) — tudo trabalhado é hora extra 1,5×.
      if (worked > 0) {
        workedMin += worked;
        normalMin += sp.normal;
        premiumMin += sp.premium;
        heMin += worked; // splitDayMinutes já marcou tudo como premium em fds/feriado
      }
    }
  }

  const faltaDesconto = faltaDays * valorDia;
  const atrasoDesconto = (atrasoMin / 60) * valorHora;
  const heValue = (heMin / 60) * valorHora * PREMIUM_MULTIPLIER;
  const adv = Number(advancesTotal) || 0;
  const gross = periodBase - faltaDesconto - atrasoDesconto + heValue;

  return {
    base_salary: round2(sal),
    valor_dia: round2(valorDia),
    valor_hora: Number(valorHora.toFixed(4)),
    period_days: periodDaysEff,
    period_base: round2(periodBase),
    expected_minutes: expectedMin,
    worked_minutes: workedMin,
    normal_minutes: normalMin,
    premium_minutes: premiumMin,
    workdays,
    worked_days: workedDays,
    falta_days: faltaDays,
    falta_desconto: round2(faltaDesconto),
    atraso_minutes: atrasoMin,
    atraso_desconto: round2(atrasoDesconto),
    he_minutes: heMin,
    he_value: round2(heValue),
    pending_days: pendingDays,
    advances_total: round2(adv),
    total_descontos: round2(faltaDesconto + atrasoDesconto + adv),
    total_proventos: round2(periodBase + heValue),
    gross_value: round2(gross),
    net_value: round2(gross - adv),
  };
}

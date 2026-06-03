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
  base_salary: number;
  valor_dia: number;       // salário ÷ 30
  valor_hora: number;      // salário ÷ 220
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
): SalaryPayrollResult {
  const sal = Number(salary) || 0;
  const valorDia = dayDivisor > 0 ? sal / dayDivisor : 0;
  const valorHora = hourDivisor > 0 ? sal / hourDivisor : 0;
  const valorMin = valorHora / 60;

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
  const gross = sal - faltaDesconto - atrasoDesconto + heValue;

  return {
    base_salary: round2(sal),
    valor_dia: round2(valorDia),
    valor_hora: Number(valorHora.toFixed(4)),
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
    total_proventos: round2(sal + heValue),
    gross_value: round2(gross),
    net_value: round2(gross - adv),
  };
}

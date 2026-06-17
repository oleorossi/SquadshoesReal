/**
 * MOTOR ÚNICO DE PONTO (funcionários) — fonte única da BASE por-dia.
 *
 * Decisão do usuário (2026-06-17): um motor só pra selecionar e calcular tudo de
 * funcionários, com relatórios que SE COMPLEMENTAM (mesma base, sem se contradizer).
 *
 * Arquitetura:
 *   1. `buildPontoDays`  → BASE canônica por-dia (batidas + escala → trabalhadas /
 *      esperadas / status). TODOS os relatórios derivam DAQUI, então "trabalhadas",
 *      "esperadas" e "faltas" ficam IDÊNTICAS em folha, espelho, banco e visão geral.
 *   2. Em cima da base, cada relatório agrega a HORA EXTRA conforme a sua INTENÇÃO:
 *      - `computeFolha`   → período-LÍQUIDO (pagamento). É a FONTE DA VERDADE do que
 *        se paga; reexporta `computePeriodFolha` (salaryPayroll) → paridade garantida
 *        byte-a-byte, zero mudança de folha.
 *      - `computeWeekly`  → semanal-CLT (banco de horas / espelho / visão gerencial),
 *        com tolerância + mínimo, via `calculateWeeklyPeriod`.
 *
 * Regra de ouro: as duas agregações partem da MESMA `buildPontoDays`. Divergência de
 * base entre relatórios = bug; divergência de AGREGAÇÃO de HE = intencional (rotulada).
 *
 * Histórico do banco de horas: CONGELADO (saldos já fechados ficam como estão); o
 * motor unificado vale daqui pra frente. (decisão do usuário 2026-06-17.)
 */
import { splitDayMinutes } from '../hourlyPayroll';
import {
  expectedDayMinutes,
  worksOnDow,
  getDaysInRange,
  computePeriodFolha,
  type PeriodFolhaInput,
  type SalaryPayrollResult,
} from '../salaryPayroll';
import {
  calculateWeeklyPeriod,
  type WeeklyCalcDay,
  type PeriodSummary,
} from '../weeklyTimeCalculation';

/** Status canônico de um dia de ponto (mesma união usada pelos relatórios). */
export type PontoDayStatus =
  | 'normal'    // dia útil presente (trabalhou)
  | 'absent'    // dia útil sem trabalho = FALTA
  | 'irregular' // nº ímpar de batidas (inconsistente) → PENDENTE, não conta
  | 'weekend'   // fim de semana com trabalho (abate déficit / vira HE no líquido)
  | 'holiday'   // feriado com trabalho
  | 'folga';    // dia não-útil sem trabalho (não conta)

/** Resultado canônico de UM dia — a base que todos os relatórios consomem. */
export interface PontoDay {
  date: string;            // YYYY-MM-DD
  dayOfWeek: number;       // 0=domingo … 6=sábado
  isHoliday: boolean;
  isWorkday: boolean;      // dia de trabalho na escala E não-feriado
  expectedMinutes: number; // jornada esperada do dia (0 em folga/feriado)
  workedMinutes: number;   // trabalhadas no dia (0 se ímpar/falta)
  normalMinutes: number;
  premiumMinutes: number;  // trabalho em fds/feriado/após-jornada (base do 1,5× no semanal)
  status: PontoDayStatus;
  punches: string[];
}

/** Entrada da BASE — mesma forma do período da folha (escala + feriados + batidas). */
export interface PontoEngineInput {
  from: string;
  to: string;
  schedule: any;                          // work_schedule (entry/exit/lunch/works_*)
  holidaysSet: Set<string>;               // feriados (dia inteiro)
  punchesByDate: Map<string, string[]>;   // data → batidas
  maxCoveredDate?: string | null;         // clamp na última data importada
}

/**
 * BASE CANÔNICA por-dia. Usa EXATAMENTE os mesmos primitivos da folha
 * (`splitDayMinutes`, `expectedDayMinutes`, `worksOnDow`, `getDaysInRange`), então a
 * soma de `workedMinutes`/`expectedMinutes` reconcilia com `computeFolha` por
 * construção (ver pontoEngine.test.ts — paridade travada).
 */
export function buildPontoDays(inp: PontoEngineInput): PontoDay[] {
  let dates = getDaysInRange(inp.from, inp.to);
  if (inp.maxCoveredDate) dates = dates.filter(d => d.date <= inp.maxCoveredDate!);

  return dates.map(({ date, dow }) => {
    const isHoliday = inp.holidaysSet.has(date);
    const isWorkday = worksOnDow(inp.schedule, dow) && !isHoliday;
    const expectedMinutes = isWorkday ? expectedDayMinutes(inp.schedule) : 0;
    const punches = inp.punchesByDate.get(date) || [];

    const sp = punches.length >= 2
      ? splitDayMinutes(punches, dow, isHoliday)
      : { normal: 0, premium: 0, incomplete: punches.length === 1 };

    let workedMinutes = 0;
    let normalMinutes = 0;
    let premiumMinutes = 0;
    let status: PontoDayStatus;

    if (sp.incomplete) {
      // Batida ímpar → inconsistente → PENDENTE: não desconta nem paga.
      status = 'irregular';
    } else {
      workedMinutes = sp.normal + sp.premium;
      normalMinutes = sp.normal;
      premiumMinutes = sp.premium;
      if (isWorkday) {
        status = workedMinutes > 0 ? 'normal' : 'absent';
      } else if (workedMinutes > 0) {
        status = isHoliday ? 'holiday' : 'weekend';
      } else {
        status = 'folga';
      }
    }

    return {
      date, dayOfWeek: dow, isHoliday, isWorkday,
      expectedMinutes, workedMinutes, normalMinutes, premiumMinutes,
      status, punches,
    };
  });
}

/** Mapeia a base canônica pro shape do cálculo semanal (banco/espelho/visão geral). */
export function pontoDaysToWeeklyDays(days: PontoDay[]): WeeklyCalcDay[] {
  return days.map(d => ({
    date: d.date,
    dayOfWeek: d.dayOfWeek,
    workedMinutes: d.workedMinutes,
    expectedMinutes: d.expectedMinutes,
    overtimeMinutes: 0, // recalculado no nível semanal
    isHoliday: d.isHoliday,
    isAbsent: d.status === 'absent',
    status: d.status,
    punches: d.punches,
  }));
}

/**
 * VISÃO PAGAMENTO (período-líquido). Fonte da verdade do que se paga.
 * É `computePeriodFolha` (salaryPayroll) — mantido idêntico p/ não mexer na folha.
 */
export function computeFolha(inp: PeriodFolhaInput): SalaryPayrollResult {
  return computePeriodFolha(inp);
}

/**
 * VISÃO SEMANAL-CLT (banco de horas / espelho / visão gerencial). Parte da MESMA
 * base por-dia e agrega HE por semana ISO, com tolerância e mínimo da escala.
 */
export function computeWeekly(
  inp: PontoEngineInput,
  schedule?: { tolerance_minutes?: number; weekly_hours?: number; minimum_overtime_minutes?: number },
): PeriodSummary {
  const days = buildPontoDays(inp);
  return calculateWeeklyPeriod(pontoDaysToWeeklyDays(days), schedule || inp.schedule || {});
}

// Reexports úteis pra os relatórios consumirem TUDO do motor único.
export { splitDayMinutes };
export { expectedDayMinutes, worksOnDow, getDaysInRange, computePeriodFolha };
export type { PeriodFolhaInput, SalaryPayrollResult, PeriodSummary, WeeklyCalcDay };

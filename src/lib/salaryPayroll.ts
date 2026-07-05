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
 *   - Falta (dia útil sem trabalho)        → − valor-dia (à parte, fora da conta de horas)
 *   - BRUTO por-dia (decisão do usuário 2026-06-19, SUPERSEDE o líquido de 2026-06-04):
 *     cada dia compara o trabalhado com o esperado DAQUELE dia. Excedente → hora extra
 *     × valor-hora × 1,5. Déficit → atraso × valor-hora. SEM compensação entre dias
 *     (um dia que sobrou NÃO apaga o atraso de outro). Dia não-útil (fds/feriado)
 *     trabalhado = tudo hora extra. Falta (dia útil sem trabalho) = −1 valor-dia à parte.
 *   - Falta NÃO tira o DSR (desconta só o dia).
 *   - Tolerância (work_schedules.tolerance_minutes, default 10min): se |trabalhado −
 *     esperado| do dia ≤ tolerância, o dia é NORMAL (zera atraso E hora extra), igual
 *     à classificação da tela do Ponto (useTimesheet). Acima dela, conta o saldo cheio.
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

/**
 * Teto de atraso POR-DIA em minutos (auditoria 2026-07-04).
 *
 * Os divisores são inconsistentes de propósito (falta ÷30, atraso ÷220), então
 * SEM teto o atraso de um dia quase-vazio passa de 1 valor-dia: com 220/30, um
 * dia de 9h zerado custaria `9×(sal÷220)=0,0409·sal` contra `sal÷30=0,0333·sal`
 * de uma falta — mostrar 1 minuto sairia MAIS CARO que faltar o dia inteiro.
 * O teto `(hora÷dia)×60` = 440 min (com 220/30) faz um dia inteiro de atraso
 * custar exatamente 1 valor-dia, igual a uma falta limpa. Independe do salário.
 * Cap nos MINUTOS (não só no R$) pra manter `atraso_desconto == min × valor-hora`
 * no holerite.
 */
export function atrasoCapMinutes(
  dayDivisor: number = SALARY_DAY_DIVISOR,
  hourDivisor: number = SALARY_HOUR_DIVISOR,
): number {
  return dayDivisor > 0 ? (hourDivisor / dayDivisor) * 60 : Infinity;
}

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
  /** Ausência JUSTIFICADA cobrindo o dia (férias/atestado/licença). Dia útil sem
   *  batida E excused=true → abonado (não conta falta nem desconta). */
  excused?: boolean;
  /** Troca de dia / compensação (tabela workday_swaps): este dia é um DIA FLEX.
   *  Quando TRABALHADO, lê como dia útil NORMAL (esperado da escala, sem 1,5× de
   *  fim de semana/feriado — só o excedente vira HE). Quando NÃO trabalhado (sem
   *  batida), é NEUTRO: não gera falta nem entra no esperado (o funcionário pode
   *  ter tirado a folga da troca). Vale tanto pra work_date quanto pra off_date. */
  swapFlex?: boolean;
}

export interface SalaryPayrollResult {
  base_salary: number;     // salário MENSAL cheio (referência p/ valor-dia/valor-hora)
  valor_dia: number;       // salário ÷ 30
  valor_hora: number;      // salário ÷ 220
  period_days: number;     // nº de dias corridos do período (30 = mês cheio)
  period_base: number;     // R$ base proporcional do período (com monthDays: salário × period_days ÷ dias_do_mês)
  expected_minutes: number;
  worked_minutes: number;  // soma das horas batidas em dias VÁLIDOS (não pendentes)
  normal_minutes: number;
  premium_minutes: number;
  workdays: number;        // dias úteis esperados no período coberto
  worked_days: number;     // dias úteis com alguma hora trabalhada
  falta_days: number;
  falta_desconto: number;  // R$ (faltas × valor-dia)
  /** Dias úteis sem batida cobertos por ausência justificada (abonados, sem desconto). */
  excused_days?: number;
  atraso_minutes: number;  // minutos faltantes (atraso + saída cedo) em dias parciais
  atraso_desconto: number; // R$ (atraso_minutes × valor-hora)
  he_minutes: number;
  he_value: number;        // R$ (he_minutes × valor-hora × 1,5)
  pending_days: number;    // dias com batida ímpar (inconsistente) — não entram no cálculo
  /** Atraso/saída-cedo POR DIA (dias em que trabalhou menos que o esperado). Base
   *  do relatório de atrasos. Vazio em remoto/diarista (não há desconto de atraso). */
  late_days?: { date: string; minutes: number }[];
  /** Hora extra POR DIA (excedente do esperado, ou dia não-útil trabalhado). Base
   *  do relatório de hora extra. `weekend`=true em fds/feriado (tudo HE 1,5×).
   *  Vazio em remoto/diarista (não há HE). */
  he_days?: { date: string; minutes: number; weekend?: boolean }[];
  advances_total: number;
  total_descontos: number; // faltas + atrasos + adiantamentos
  total_proventos: number; // salário + HE
  gross_value: number;     // salário − faltas − atrasos + HE
  net_value: number;       // bruto − adiantamentos
  // Regime de pagamento (2026-06-19): 'mensalista' = padrão (acima); 'remoto' =
  // salário cheio ignorando ponto (sem falta/atraso/HE); 'diarista' = diária × dias
  // trabalhados (sem salário mensal nem desconto de falta).
  payment_type: 'mensalista' | 'remoto' | 'diarista';
  daily_rate: number;      // R$/dia (só diarista)
  paid_days: number;       // dias pagos (diarista = dias com batida; senão worked_days)
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
  /**
   * Dias CORRIDOS do MÊS (28–31). Com periodDays, a base proporcional da quinzena usa
   * periodDays/monthDays — assim 1ª (15/mês) + 2ª ((mês−15)/mês) = salário EXATO (sem
   * pagar "1 dia a mais" num mês de 31). Sem monthDays, cai no legado (÷30).
   */
  monthDays?: number,
  /**
   * Tolerância de atraso/HE em minutos (work_schedules.tolerance_minutes). Se o saldo
   * do dia |trabalhado − esperado| ≤ tolerância, o dia é NORMAL (zera atraso E hora
   * extra), igual à tela do Ponto. Default 0 (sem tolerância) p/ caller direto — quem
   * aplica a política (10min) é computePeriodFolha, lendo da escala.
   */
  toleranceMin: number = 0,
  /**
   * Multiplicador da hora extra (work_schedules.overtime_multiplier). Default 1,5×
   * (decisão do dono: 1,5× flat, sem premium de feriado). Quem aplica a política lendo
   * da escala é computePeriodFolha — antes era a constante PREMIUM_MULTIPLIER hardcoded.
   */
  premiumMultiplier: number = PREMIUM_MULTIPLIER,
): SalaryPayrollResult {
  const sal = Number(salary) || 0;
  const valorDia = dayDivisor > 0 ? sal / dayDivisor : 0;
  const valorHora = hourDivisor > 0 ? sal / hourDivisor : 0;
  const valorMin = valorHora / 60;
  const atrasoCap = atrasoCapMinutes(dayDivisor, hourDivisor); // teto de atraso/dia (min)
  // Base de proventos do período: proporcional aos dias quando periodDays vier (paga-se
  // por quinzena). Com monthDays, prorateia por periodDays/monthDays (as 2 quinzenas
  // somam o salário EXATO, sem dia a mais); sem ele, legado valor-dia×periodDays.
  const prorate = periodDays != null && periodDays > 0;
  const periodDaysEff = prorate ? periodDays : dayDivisor;
  const periodBase = prorate
    ? (monthDays != null && monthDays > 0 ? (sal * periodDays) / monthDays : valorDia * periodDays)
    : sal;

  let expectedMin = 0;        // esperado total dos dias úteis (inclui faltas) — só p/ relatório
  let expectedPresentMin = 0; // esperado dos dias PRESENTES (falta excluída) — p/ relatório
  let workedMin = 0;          // TUDO trabalhado (dias úteis presentes + fim de semana/feriado)
  let normalMin = 0;
  let premiumMin = 0;
  let workdays = 0;
  let workedDays = 0;
  let faltaDays = 0;
  let excusedDays = 0;
  let pendingDays = 0;
  // BRUTO por-dia (decisão do usuário 2026-06-19): HE e atraso acumulam POR DIA
  // (excedente/déficit de cada dia), SEM compensação entre dias. Ver loop abaixo.
  let heMin = 0;
  let atrasoMin = 0;
  const lateDays: { date: string; minutes: number }[] = [];  // atraso/saída-cedo por dia (relatório)
  const heDays: { date: string; minutes: number; weekend?: boolean }[] = [];  // hora extra por dia (relatório)

  for (const d of days) {
    const punches = Array.isArray(d.punches) ? d.punches : [];
    const sp = punches.length >= 2
      ? splitDayMinutes(punches, d.dayOfWeek, d.isHoliday, d.swapFlex)
      : { normal: 0, premium: 0, incomplete: punches.length === 1 };

    // Dia de TROCA (flex) SEM batida válida → NEUTRO: não é falta, não entra no
    // esperado/workdays (o funcionário pode ter tirado a folga da troca). Só passa a
    // contar como dia útil normal quando efetivamente TRABALHADO (ramo abaixo).
    // Batida ímpar (incomplete) NÃO é neutralizada aqui — continua pendente.
    if (d.swapFlex && !sp.incomplete && (sp.normal + sp.premium) === 0) {
      continue;
    }

    // ESPERADO é da ESCALA, não da batida: todo dia útil tem jornada esperada,
    // INDEPENDENTE de a batida estar completa. Pendente (ímpar) e falta TAMBÉM
    // contam pro esperado — senão a meta do período encolhe quando faltam batidas
    // (bug 2026-06-20: 6 dias com batida ímpar sumiam do esperado e a quinzena de
    // 90h aparecia como 36h). Só o WORKED/HE/atraso/falta depende de batida válida.
    const isSchedWorkday = d.isWorkday && d.expectedMinutes > 0;
    if (isSchedWorkday) {
      expectedMin += d.expectedMinutes;
      workdays++;
    }

    // Batida ímpar / inconsistente → PENDENTE: não desconta nem paga (o dia JÁ
    // contou pro esperado/workdays acima — é dia de escala, só falta resolver a batida).
    if (sp.incomplete) {
      pendingDays++;
      continue;
    }

    const worked = sp.normal + sp.premium;

    if (isSchedWorkday) {
      if (worked === 0) {
        // Dia útil sem trabalho. Ausência JUSTIFICADA (férias/atestado/licença) é
        // abonada: não conta falta nem desconta. Senão, falta (desconta 1 valor-dia).
        if (d.excused) { excusedDays++; continue; }
        faltaDays++;
        continue;
      }
      workedDays++;
      workedMin += worked;
      normalMin += sp.normal;
      premiumMin += sp.premium;
      expectedPresentMin += d.expectedMinutes;
      // BRUTO por-dia: compara o trabalhado com o esperado DAQUELE dia. Excedente → HE;
      // déficit → atraso. Sem compensação entre dias (um dia que sobrou NÃO apaga o
      // atraso de outro). SUPERSEDE o modelo líquido de 2026-06-04.
      // Tolerância bilateral all-or-nothing: dentro da janela o dia é normal (0 atraso,
      // 0 HE), igual à classificação da tela (useTimesheet:644). Fora dela, saldo cheio.
      const rawBal = worked - d.expectedMinutes;
      const dayBal = Math.abs(rawBal) <= toleranceMin ? 0 : rawBal;
      if (dayBal > 0) { heMin += dayBal; heDays.push({ date: d.date, minutes: dayBal }); }
      // Atraso capado por-dia (ver atrasoCapMinutes): um dia quase-vazio não pode
      // descontar mais que 1 valor-dia, senão sai mais caro que uma falta limpa.
      else if (dayBal < 0) { const late = Math.min(-dayBal, atrasoCap); atrasoMin += late; lateDays.push({ date: d.date, minutes: late }); }
    } else if (worked > 0) {
      // Dia NÃO útil (fim de semana/feriado) trabalhado: esperado = 0 → TUDO é hora extra.
      workedMin += worked;
      normalMin += sp.normal;
      premiumMin += sp.premium;
      heMin += worked;
      heDays.push({ date: d.date, minutes: worked, weekend: true });
    }
  }

  const faltaDesconto = faltaDays * valorDia;
  const atrasoDesconto = (atrasoMin / 60) * valorHora;
  const heValue = (heMin / 60) * valorHora * premiumMultiplier;
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
    excused_days: excusedDays,
    atraso_minutes: atrasoMin,
    atraso_desconto: round2(atrasoDesconto),
    late_days: lateDays,
    he_days: heDays,
    he_minutes: heMin,
    he_value: round2(heValue),
    pending_days: pendingDays,
    advances_total: round2(adv),
    total_descontos: round2(faltaDesconto + atrasoDesconto + adv),
    total_proventos: round2(periodBase + heValue),
    gross_value: round2(gross),
    net_value: round2(gross - adv),
    payment_type: 'mensalista',
    daily_rate: 0,
    paid_days: workedDays,
  };
}

// ─── Helper de período (FONTE ÚNICA) ─────────────────────────────────────────
// Monta os dias da escala (esperado/feriado/batidas) e calcula a folha. Usado pela
// FOLHA (Payroll) E pela tela do PONTO (Timesheet), pra os dois mostrarem a MESMA conta
// (HE líquida do período, esperado da escala). O Espelho/Banco continuam no caminho legal.

/** Dias corridos no intervalo [from, to] inclusive → [{date, dow}]. */
export function getDaysInRange(from: string, to: string): { date: string; dow: number }[] {
  if (!from || !to || from > to) return [];
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  if (!fy || !fm || !fd || !ty || !tm || !td) return [];
  const out: { date: string; dow: number }[] = [];
  // Itera em UTC (não horário local): com setDate(+1) em fuso com horário de verão,
  // a virada (spring-forward) faz um dia ser PULADO da lista. UTC não tem DST.
  for (let t = Date.UTC(fy, fm - 1, fd); t <= Date.UTC(ty, tm - 1, td); t += 86400000) {
    const dt = new Date(t);
    const y = dt.getUTCFullYear(), m = dt.getUTCMonth() + 1, d = dt.getUTCDate();
    out.push({ date: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, dow: dt.getUTCDay() });
  }
  return out;
}

export interface PeriodFolhaInput {
  salary: number;
  from: string;
  to: string;
  schedule: any;                          // work_schedule (entry/exit/lunch/works_*)
  holidaysSet: Set<string>;               // feriados obrigatórios (dia inteiro 1,5×)
  /** Troca de dia (workday_swaps) — DIAS FLEX (work_date): lê como dia útil NORMAL
   *  quando trabalhado (não vira HE de fim de semana/feriado); neutro quando não
   *  trabalhado (sem falta). Prevalece sobre holidaysSet nesse dia. */
  swapWorkedSet?: Set<string>;
  /** Troca de dia (workday_swaps) — DIAS FLEX (off_date, folga compensatória):
   *  mesmo tratamento do work_date — neutro quando não trabalhado (sem falta),
   *  normal quando trabalhado. Manter os dois iguais evita divergência de colisão. */
  swapOffSet?: Set<string>;
  punchesByDate: Map<string, string[]>;   // data (YYYY-MM-DD) → batidas
  /** Datas (YYYY-MM-DD) cobertas por ausência JUSTIFICADA → dia útil sem batida vira
   *  abonado (não desconta falta). Default vazio = comportamento legado. */
  absenceDates?: Set<string>;
  advancesTotal?: number;
  periodDays?: number;                    // base proporcional (quinzena); undefined = mês cheio
  monthDays?: number;                     // dias do mês (28–31) → prorateia 1ª+2ª = salário exato
  maxCoveredDate?: string | null;         // clamp: ignora dias após a última data importada
  payRegime?: 'mensalista' | 'remoto' | 'diarista';  // regime de pagamento (default mensalista)
  dailyRate?: number;                     // R$/dia (só diarista)
}

/** Monta os SalaryDayInput do período (escala/feriados/batidas) e calcula a folha. */
export function computePeriodFolha(inp: PeriodFolhaInput): SalaryPayrollResult {
  let dates = getDaysInRange(inp.from, inp.to);
  if (inp.maxCoveredDate) dates = dates.filter(d => d.date <= inp.maxCoveredDate!);
  const days: SalaryDayInput[] = dates.map(d => {
    // Troca de dia (workday_swaps): work_date E off_date são DIAS FLEX. Prevalecem
    // sobre feriado. Quando trabalhados, leem como dia útil normal; quando não, o
    // motor os neutraliza (sem falta). Tratar os dois iguais elimina a divergência
    // de precedência quando uma data é work_date de uma troca e off_date de outra.
    const isSwap = (inp.swapWorkedSet?.has(d.date) ?? false) || (inp.swapOffSet?.has(d.date) ?? false);
    const isHoliday = !isSwap && inp.holidaysSet.has(d.date);
    const isWorkday = isSwap ? true : (worksOnDow(inp.schedule, d.dow) && !isHoliday);
    return {
      date: d.date, dayOfWeek: d.dow, isHoliday, isWorkday,
      expectedMinutes: isWorkday ? expectedDayMinutes(inp.schedule) : 0,
      punches: inp.punchesByDate.get(d.date) || [],
      excused: inp.absenceDates?.has(d.date) ?? false,
      swapFlex: isSwap,
    };
  });
  // Tolerância REMOVIDA (pedido do dono 2026-06-30): todo minuto conta — atraso
  // a partir do 1º minuto abaixo da jornada, hora extra a partir do 1º minuto
  // acima. Antes havia janela de 10min (work_schedules.tolerance_minutes) que
  // zerava o dia. Mantido 0 fixo p/ não depender do campo da escala.
  const tolerance = 0;
  // Multiplicador de HE da escala (default 1,5×) — antes era PREMIUM_MULTIPLIER fixo.
  // A partir daqui, editar "Multiplicador HE" na escala (Ponto→Escalas) altera a folha.
  const premiumMult = Number(inp.schedule?.overtime_multiplier ?? PREMIUM_MULTIPLIER);
  const base = calculateSalaryPayroll(inp.salary, days, inp.advancesTotal || 0, undefined, undefined, inp.periodDays, inp.monthDays, tolerance, premiumMult);
  const regime = inp.payRegime || 'mensalista';
  const adv = base.advances_total;

  // ── REMOTO: não bate ponto → salário cheio do período, ZERO desconto/HE de ponto.
  if (regime === 'remoto') {
    return {
      ...base, payment_type: 'remoto', daily_rate: 0, paid_days: 0,
      worked_minutes: 0, normal_minutes: 0, premium_minutes: 0,
      worked_days: 0, falta_days: 0, falta_desconto: 0, excused_days: 0,
      atraso_minutes: 0, atraso_desconto: 0, late_days: [], he_days: [], he_minutes: 0, he_value: 0, pending_days: 0,
      total_proventos: base.period_base, total_descontos: adv,
      gross_value: base.period_base, net_value: round2(base.period_base - adv),
    };
  }

  // ── DIARISTA: paga diária × dias trabalhados (dias com batida). Sem salário
  // mensal, sem desconto de falta, sem atraso. (batida ímpar conta como presença.)
  if (regime === 'diarista') {
    const dr = Number(inp.dailyRate) || 0;
    const paidDays = days.filter(d => (d.punches?.length || 0) >= 1).length;
    const grossD = round2(dr * paidDays);
    return {
      ...base, payment_type: 'diarista', daily_rate: dr, paid_days: paidDays,
      falta_days: 0, falta_desconto: 0, excused_days: 0, atraso_minutes: 0, atraso_desconto: 0, late_days: [], he_days: [],
      he_minutes: 0, he_value: 0,
      period_base: grossD, total_proventos: grossD, total_descontos: adv,
      gross_value: grossD, net_value: round2(grossD - adv),
    };
  }

  return base; // mensalista
}

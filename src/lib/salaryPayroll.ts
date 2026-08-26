/**
 * Folha SALÁRIO CHEIO − DESCONTOS (decisão do usuário 2026-06-03).
 *
 * Modelo do RH para o PAGAMENTO (folha): parte do salário mensal cheio e DESCONTA
 * faltas, atrasos e saídas cedo medidos contra a JORNADA ESPERADA cadastrada
 * (08:00–18:00 com 1h de almoço = 9h/dia, seg–sex, por padrão). O saldo positivo
 * do período usa as taxas individuais de HE cadastradas no funcionário.
 *
 * Regras oficiais (confirmadas pelo usuário):
 *   - valor-dia  = salário ÷ dias úteis do mês
 *   - valor-hora de atraso = valor-dia ÷ horas da jornada diária
 *   - HE = saldo positivo do período × taxa absoluta individual
 *   - Falta (dia útil sem trabalho)        → − valor-dia (à parte, fora da conta de horas)
 *   - SALDO LÍQUIDO DO PERÍODO (decisão do usuário 2026-08-13): excedentes de um
 *     dia compensam atrasos parciais de outro dentro do intervalo calculado. Só o
 *     saldo final positivo pode virar HE; saldo negativo vira desconto de atraso.
 *     Falta integral continua à parte e não entra nessa compensação.
 *   - Falta NÃO tira o DSR (desconta só o dia).
 *   - Atraso não tem tolerância diária. Depois da compensação, saldo positivo de até
 *     10min não vira HE; acima de 10min, todo o saldo positivo é pago.
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

/** Versão persistida junto do snapshot da folha para auditoria histórica. */
export const PAYROLL_RULE_VERSION = 'saldo-periodo-v2-2026-08-26';

/** Divisor legado usado somente por callers diretos sem SalaryPolicy. */
export const SALARY_DAY_DIVISOR = 30;
/** Divisor legado usado somente por callers diretos sem SalaryPolicy. */
export const SALARY_HOUR_DIVISOR = 220;

/**
 * Teto de atraso POR-DIA do caminho legado (auditoria 2026-07-04).
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

/** Shape estrutural mínimo aceito pelo motor salarial. Mantém a lib independente
 * dos hooks React e permite escalas parciais em relatórios/testes. */
export type SalaryWorkSchedule = Partial<Record<(typeof WORKS_DOW)[number], boolean | null>> & {
  entry_time?: string | null;
  exit_time?: string | null;
  lunch_start?: string | null;
  lunch_end?: string | null;
  saturday_entry?: string | null;
  saturday_exit?: string | null;
  overtime_multiplier?: number | null;
};

/** "08:30" → 510 minutos. Tolerante a nulos/vazios. */
export function timeToMin(t?: string | null): number {
  const [h, m] = String(t || '0:0').split(':').map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

/** Escala trabalha neste dia da semana? (0=dom … 6=sáb) */
export function worksOnDow(sch: SalaryWorkSchedule | null | undefined, dow: number): boolean {
  const key = WORKS_DOW[dow];
  return !!(sch && key && sch[key]);
}

/** Jornada esperada do dia (min): saída − entrada − almoço. Ex.: 08–18 c/ 12–13 = 540 (9h).
 *  SÁBADO (dow=6): se a escala tem saturday_entry/saturday_exit, usa a jornada de sábado
 *  (normalmente mais curta, sem almoço) — senão um sábado de meio-período viraria falso
 *  atraso comparado à jornada de dia útil. Sem os campos de sábado, cai na jornada padrão. */
export function expectedDayMinutes(sch: SalaryWorkSchedule | null | undefined, dow?: number): number {
  if (!sch) return 0;
  if (dow === 6 && sch.saturday_entry && sch.saturday_exit) {
    return Math.max(0, timeToMin(sch.saturday_exit) - timeToMin(sch.saturday_entry));
  }
  return Math.max(0, timeToMin(sch.exit_time) - timeToMin(sch.entry_time) - (timeToMin(sch.lunch_end) - timeToMin(sch.lunch_start)));
}

/**
 * Política CANÔNICA de folha do dono (spec: specs/gestao-de-pessoas.md, 2026-07-09).
 * Aplicada SÓ por computePeriodFolha (fonte única). Quando presente, muda vs. o
 * legado ÷30/÷220/×1,5:
 *   • falta   = salário ÷ dias_úteis_do_mês        (businessDaysDivisor)
 *   • atraso  = min × ((salário ÷ dias_úteis) ÷ jornada_diária)
 *   • HE      = min × R$/hora ABSOLUTO por funcionário (não multiplicador):
 *               dia útil / sábado / noturno → heNormalRate
 *               domingo / feriado           → heSundayHolidayRate (fallback normal)
 *   • HE só conta se o saldo positivo DO PERÍODO passar de minOvertimeMin (10min).
 */
export interface SalaryPolicy {
  /** Dias úteis do mês do INÍCIO do período (fallback/exibição). valorDia = salário ÷ isto. */
  businessDaysDivisor: number;
  /** Dias úteis POR mês (YYYY-MM → nº). Falta/atraso de cada dia usa o divisor do mês em
   *  que o dia cai — corrige períodos que cruzam meses. Ausente ⇒ usa businessDaysDivisor. */
  businessDaysByMonth?: Record<string, number>;
  /** Jornada diária esperada (min) da escala. valorHora de desconto = valorDia ÷ (jornada/60). */
  journeyMinutes: number;
  /** R$/hora extra normal (dia útil, sábado, noturno). */
  heNormalRate: number;
  /** R$/hora extra domingo/feriado. undefined ⇒ usa heNormalRate. */
  heSundayHolidayRate?: number;
  /** Mínimo de HE: saldo positivo do período ≤ este valor ⇒ 0 HE. Default 10. */
  minOvertimeMin?: number;
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
  /** Minutos de ausência remunerada PARCIAL. Só cobrem a defasagem entre a
   *  jornada e as horas realmente trabalhadas; nunca geram hora extra. */
  excusedMinutes?: number;
  /** Troca de dia / compensação (tabela workday_swaps): este dia é um DIA FLEX.
   *  Quando TRABALHADO, lê como dia útil NORMAL (fora da taxa de domingo/feriado;
   *  só o excedente vira crédito). Quando NÃO trabalhado (sem
   *  batida), é NEUTRO: não gera falta nem entra no esperado (o funcionário pode
   *  ter tirado a folga da troca). Vale tanto pra work_date quanto pra off_date. */
  swapFlex?: boolean;
  /** Cobertura da importação: true = o relógio foi lido nesse dia (há batida de
   *  algum funcionário) → dia útil sem batida = FALTA. false = dia sem importação
   *  (lacuna/além do arquivo) → NEUTRO, não vira falta. undefined = legado (sempre
   *  conta como falta, comportamento anterior sem set de cobertura). */
  covered?: boolean;
}

export type SalaryDayLedgerStatus =
  | 'normal'
  | 'credit'
  | 'debit'
  | 'absence'
  | 'excused'
  | 'pending'
  | 'neutral';

/**
 * Extrato diário CANÔNICO. Relatórios não devem recalcular valores a partir das
 * batidas: devem exibir este ledger e os totais de SalaryPayrollResult.
 */
export interface SalaryDayLedger {
  date: string;
  day_of_week: number;
  punches: string[];
  is_holiday: boolean;
  is_workday: boolean;
  expected_minutes: number;
  worked_minutes: number;
  /** Parcela remunerada da ausência efetivamente usada para cobrir a jornada. */
  excused_minutes?: number;
  raw_balance_minutes: number;
  raw_credit_minutes: number;
  raw_delay_minutes: number;
  compensated_credit_minutes: number;
  compensated_delay_minutes: number;
  payable_overtime_minutes: number;
  payable_delay_minutes: number;
  discarded_tolerance_minutes: number;
  overtime_bucket?: 'normal' | 'holiday';
  status: SalaryDayLedgerStatus;
}

export interface SalaryPayrollResult {
  rule_version: string;
  base_salary: number;     // salário MENSAL cheio (referência p/ valor-dia/valor-hora)
  valor_dia: number;       // política oficial: salário ÷ dias úteis do mês
  valor_hora: number;      // política oficial: valor-dia ÷ jornada diária
  period_days: number;     // nº de dias corridos do período (30 = mês cheio)
  period_base: number;     // R$ base proporcional do período (com monthDays: salário × period_days ÷ dias_do_mês)
  expected_minutes: number;
  worked_minutes: number;  // soma das horas batidas em dias VÁLIDOS (não pendentes)
  normal_minutes: number;
  premium_minutes: number;
  workdays: number;        // dias úteis esperados no período coberto
  worked_days: number;     // dias úteis com alguma hora trabalhada
  falta_days: number;
  /** Datas (YYYY-MM-DD) dos dias úteis sem batida = FALTAS. Base do Relatório de
   *  Faltas (calendário). Vazio em remoto/diarista (não há falta). */
  falta_dates?: string[];
  falta_desconto: number;  // R$ (faltas × valor-dia do mês de cada ocorrência)
  /** Dias úteis sem batida cobertos por ausência justificada (abonados, sem desconto). */
  excused_days?: number;
  /** Débito bruto antes da compensação entre dias. */
  raw_delay_minutes?: number;
  /** Crédito bruto antes da compensação e do mínimo de HE. */
  raw_credit_minutes?: number;
  /** Minutos efetivamente compensados entre créditos e atrasos. */
  compensated_minutes?: number;
  /** Saldo positivo de até 10min descartado depois da compensação. */
  discarded_tolerance_minutes?: number;
  atraso_minutes: number;  // atraso LÍQUIDO após compensação entre dias
  atraso_desconto: number; // R$ (atraso_minutes × valor-hora)
  he_minutes: number;
  he_value: number;        // R$ (minutos pagos × taxa individual do respectivo tipo)
  /** HE em minutos por taxa (política canônica): normal = dia útil/sábado/noturno;
   *  holiday = domingo/feriado. Somados = he_minutes. Zerados no modo legado. */
  he_normal_minutes?: number;
  he_holiday_minutes?: number;
  /** true quando há minutos de HE mas a taxa R$/h do funcionário está 0/não cadastrada
   *  → he_value sai R$0 apesar de he_minutes>0. A UI deve alertar (spec req.5/15). */
  he_rate_missing?: boolean;
  pending_days: number;    // dias com batida ímpar (inconsistente) — não entram no cálculo
  /** Atraso/saída-cedo POR DIA (dias em que trabalhou menos que o esperado). Base
   *  do relatório de atrasos. Vazio em remoto/diarista (não há desconto de atraso). */
  late_days?: { date: string; minutes: number; compensated_minutes?: number; payable_minutes?: number }[];
  /** Crédito de hora POR DIA (excedente do esperado, ou dia não-útil trabalhado). Base
   *  do relatório de hora extra. `weekend`=true em fds/feriado (taxa individual própria).
   *  Vazio em remoto/diarista (não há HE). */
  he_days?: { date: string; minutes: number; weekend?: boolean; compensated_minutes?: number; payable_minutes?: number; discarded_tolerance_minutes?: number }[];
  /** Extrato diário que explica os totais acima e alimenta todos os relatórios. */
  day_ledger?: SalaryDayLedger[];
  advances_total: number;
  total_descontos: number; // faltas + atrasos + adiantamentos
  total_proventos: number; // salário + HE
  gross_value: number;     // salário − faltas − atrasos + HE
  net_value: number;       // bruto − adiantamentos
  // Regime de pagamento (2026-06-19): 'mensalista' = padrão (acima); 'remoto' =
  // salário cheio ignorando ponto (sem falta/atraso/HE); 'diarista' = diária × dias
  // trabalhados (sem salário mensal nem desconto de falta); 'producao' = pares
  // produzidos × R$/par (Ficha de Montadores), ignora salário e ponto (2026-07-18).
  payment_type: 'mensalista' | 'remoto' | 'diarista' | 'producao';
  daily_rate: number;      // R$/dia (só diarista)
  paid_days: number;       // dias pagos (diarista = dias com batida; senão worked_days)
  /** Pares valorados (só producao): base do bruto = pares × R$/par snapshot. */
  pares_medio?: number;
  pares_dificil?: number;
  /** Bruto SEPARADO por dificuldade. Holerite e relatório usam isto em vez de
   *  ratear o bruto total: médio e difícil pagam R$/par diferentes, então
   *  `bruto ÷ pares` não é a taxa de nenhum dos dois. */
  bruto_medio?: number;
  bruto_dificil?: number;
  /** R$/par efetivo por dificuldade. Com uma taxa só no período (o normal), é o
   *  próprio valor gravado; `taxa_variou` marca quando houve reajuste no meio. */
  taxa_medio?: number;
  taxa_dificil?: number;
  taxa_variou?: boolean;
  /** Fichas (lotes de 12/15/18) do período — só producao. Medida de RITMO; o
   *  pagamento é por par. `fichas_derivadas` = alguma linha não tinha detalhe e
   *  o lote foi inferido como 12 (o relatório marca com asterisco). */
  fichas?: number;
  fichas_derivadas?: boolean;
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
   * Tolerância diária legada de atraso/HE. A folha oficial passa 0: cada minuto entra
   * no saldo do período. O mínimo de 10min é aplicado somente ao saldo positivo final.
   */
  toleranceMin: number = 0,
  /**
   * Multiplicador legado da hora extra. A folha oficial usa as taxas absolutas por
   * funcionário da SalaryPolicy; este parâmetro existe só para callers antigos.
   */
  premiumMultiplier: number = PREMIUM_MULTIPLIER,
  /**
   * Política CANÔNICA do dono (ver SalaryPolicy). Presente ⇒ falta ÷ dias úteis,
   * atraso via valorDia/jornada, HE em R$/h por funcionário e mínimo de 10min.
   * Ausente ⇒ comportamento LEGADO (÷30/÷220/×1,5) — usado só por callers diretos/testes
   * de baixo nível; a folha real (computePeriodFolha) SEMPRE passa a policy.
   */
  policy?: SalaryPolicy,
): SalaryPayrollResult {
  const sal = Number(salary) || 0;
  const usePolicy = !!policy;
  const bizDivisor = policy?.businessDaysDivisor;
  const valorDia = usePolicy && bizDivisor && bizDivisor > 0
    ? sal / bizDivisor
    : (dayDivisor > 0 ? sal / dayDivisor : 0);
  // valor-hora de desconto (atraso/saída-cedo). Policy: valorDia ÷ jornada. Legado: sal ÷ 220.
  const journeyMin = usePolicy ? (Number(policy!.journeyMinutes) > 0 ? Number(policy!.journeyMinutes) : 0) : 0;
  const valorHora = usePolicy
    ? (journeyMin > 0 ? valorDia / (journeyMin / 60) : 0)
    : (hourDivisor > 0 ? sal / hourDivisor : 0);
  const minOt = usePolicy ? (policy!.minOvertimeMin ?? 10) : 0;
  const heNormalRate = usePolicy ? (Number(policy!.heNormalRate) || 0) : 0;
  const heHolidayRate = usePolicy
    ? (policy!.heSundayHolidayRate != null && Number(policy!.heSundayHolidayRate) > 0
        ? Number(policy!.heSundayHolidayRate) : heNormalRate)
    : 0;
  const atrasoCap = atrasoCapMinutes(dayDivisor, hourDivisor); // teto de atraso/dia (min) — modo legado
  // valorDia/valorHora POR DIA: em policy, falta/atraso de cada dia usam o divisor do MÊS
  // do dia (businessDaysByMonth) — corrige períodos que cruzam meses. Sem mapa (ou legado),
  // caem no valorDia/valorHora únicos → resultado idêntico ao de antes (mês único).
  const bdByMonth = usePolicy ? (policy!.businessDaysByMonth || {}) : {};
  const valorDiaFor = (date: string): number => {
    if (usePolicy) {
      const bd = bdByMonth[String(date || '').slice(0, 7)];
      if (bd && bd > 0) return sal / bd;
    }
    return valorDia;
  };
  const valorHoraFor = (date: string): number =>
    usePolicy ? (journeyMin > 0 ? valorDiaFor(date) / (journeyMin / 60) : 0) : valorHora;
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
  let heMin = 0;
  let heNormalMin = 0;   // HE a taxa normal (policy): dia útil/sábado/noturno
  let heHolidayMin = 0;  // HE a taxa domingo/feriado (policy)
  let atrasoMin = 0;
  let faltaDescontoAcc = 0;   // R$ de falta acumulado por-dia (divisor do mês de cada falta)
  const faltaDates: string[] = [];  // datas de falta (dia útil sem batida) — relatório de faltas
  const dayLedger: SalaryDayLedger[] = [];

  for (const d of days) {
    const punches = Array.isArray(d.punches) ? d.punches : [];
    const sp = punches.length >= 2
      ? splitDayMinutes(punches, d.dayOfWeek, d.isHoliday, d.swapFlex)
      : { normal: 0, premium: 0, incomplete: punches.length === 1 };
    const worked = sp.normal + sp.premium;
    const ledger: SalaryDayLedger = {
      date: d.date,
      day_of_week: d.dayOfWeek,
      punches: [...punches],
      is_holiday: d.isHoliday,
      is_workday: d.isWorkday && d.expectedMinutes > 0,
      expected_minutes: d.isWorkday ? d.expectedMinutes : 0,
      worked_minutes: worked,
      excused_minutes: 0,
      raw_balance_minutes: 0,
      raw_credit_minutes: 0,
      raw_delay_minutes: 0,
      compensated_credit_minutes: 0,
      compensated_delay_minutes: 0,
      payable_overtime_minutes: 0,
      payable_delay_minutes: 0,
      discarded_tolerance_minutes: 0,
      status: 'neutral',
    };

    // NEUTRO (não é falta, não entra no esperado/workdays) quando o dia útil não tem
    // batida válida E:
    //  • é dia de TROCA (flex) — o funcionário pode ter tirado a folga da troca; OU
    //  • NÃO foi COBERTO pela importação (covered===false) — o relógio não foi lido
    //    nesse dia (lacuna de cobertura / dia além do arquivo importado). Sem isso, um
    //    dia sem importação virava falta como se o funcionário não tivesse ido.
    // Batida ímpar (incomplete) NÃO é neutralizada aqui — continua pendente.
    if (!sp.incomplete && (sp.normal + sp.premium) === 0 && (d.swapFlex || d.covered === false)) {
      dayLedger.push(ledger);
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
      ledger.status = 'pending';
      dayLedger.push(ledger);
      continue;
    }

    if (isSchedWorkday) {
      // Abono integral mantém compatibilidade com o contrato anterior. O abono
      // parcial é limitado à DEFASAGEM real do dia: 2h de atestado + 8h
      // trabalhadas numa jornada de 9h quitam apenas 1h, sem fabricar 1h de HE.
      const excusedAvailable = d.excused
        ? d.expectedMinutes
        : Math.max(0, Number(d.excusedMinutes) || 0);
      const excusedApplied = Math.min(
        d.expectedMinutes,
        Math.max(0, d.expectedMinutes - worked),
        excusedAvailable,
      );
      ledger.excused_minutes = excusedApplied;

      if (worked === 0) {
        // Dia útil sem trabalho. Ausência JUSTIFICADA (férias/atestado/licença) é
        // abonada: não conta falta nem desconta. Senão, falta (desconta 1 valor-dia).
        if (excusedApplied >= d.expectedMinutes) {
          excusedDays++;
          ledger.status = 'excused';
          dayLedger.push(ledger);
          continue;
        }
        // Ausência parcial remunerada sem batida: desconta somente a parcela
        // restante como minutos de atraso. Não pode virar falta integral.
        if (excusedApplied > 0) {
          expectedPresentMin += d.expectedMinutes - excusedApplied;
          const late = d.expectedMinutes - excusedApplied;
          ledger.status = 'debit';
          ledger.raw_balance_minutes = -late;
          ledger.raw_delay_minutes = late;
          dayLedger.push(ledger);
          continue;
        }
        faltaDays++;
        faltaDates.push(d.date);
        faltaDescontoAcc += valorDiaFor(d.date);  // divisor do MÊS da falta
        ledger.status = 'absence';
        dayLedger.push(ledger);
        continue;
      }
      workedDays++;
      workedMin += worked;
      normalMin += sp.normal;
      premiumMin += sp.premium;
      expectedPresentMin += d.expectedMinutes;
      const rawBal = worked - d.expectedMinutes + excusedApplied;
      const dayBal = Math.abs(rawBal) <= toleranceMin ? 0 : rawBal;
      ledger.raw_balance_minutes = dayBal;
      if (dayBal > 0) {
        ledger.status = 'credit';
        ledger.raw_credit_minutes = dayBal;
        ledger.overtime_bucket = 'normal';
      }
      // Atraso capado por-dia: policy = jornada esperada do dia (um dia inteiro atrasado
      // = 1 valor-dia = 1 falta); legado = teto 220/30. Um dia quase-vazio nunca custa
      // mais que uma falta limpa. Ausência integral elimina a defasagem; ausência
      // parcial elimina somente os minutos remunerados informados pelo RH.
      else if (dayBal < 0) {
        const cap = usePolicy ? d.expectedMinutes : atrasoCap;
        const late = Math.min(-dayBal, cap);
        ledger.status = 'debit';
        ledger.raw_balance_minutes = -late;
        ledger.raw_delay_minutes = late;
      } else {
        ledger.status = 'normal';
      }
      dayLedger.push(ledger);
    } else if (worked > 0) {
      // Dia não útil trabalhado entra como CRÉDITO BRUTO. Ele também participa da
      // compensação antes de qualquer minuto virar HE paga.
      workedMin += worked;
      normalMin += sp.normal;
      premiumMin += sp.premium;
      ledger.status = 'credit';
      ledger.raw_balance_minutes = worked;
      ledger.raw_credit_minutes = worked;
      ledger.overtime_bucket = d.isHoliday || d.dayOfWeek === 0 ? 'holiday' : 'normal';
      dayLedger.push(ledger);
    } else {
      dayLedger.push(ledger);
    }
  }

  // ── Compensação CANÔNICA do período ─────────────────────────────────────
  // Créditos normais são consumidos primeiro; domingo/feriado fica preservado
  // quando ainda houver saldo positivo. Dentro de cada grupo, a ordem é cronológica.
  const creditDays = dayLedger
    .filter(d => d.raw_credit_minutes > 0)
    .sort((a, b) => {
      const pa = a.overtime_bucket === 'holiday' ? 1 : 0;
      const pb = b.overtime_bucket === 'holiday' ? 1 : 0;
      return pa - pb || a.date.localeCompare(b.date);
    });
  const debitDays = dayLedger.filter(d => d.raw_delay_minutes > 0).sort((a, b) => a.date.localeCompare(b.date));
  const rawCreditMin = creditDays.reduce((s, d) => s + d.raw_credit_minutes, 0);
  const rawDelayMin = debitDays.reduce((s, d) => s + d.raw_delay_minutes, 0);
  const compensatedMin = Math.min(rawCreditMin, rawDelayMin);

  let debitToOffset = rawDelayMin;
  for (const d of creditDays) {
    const used = Math.min(d.raw_credit_minutes, debitToOffset);
    d.compensated_credit_minutes = used;
    debitToOffset -= used;
  }
  let creditToOffset = rawCreditMin;
  for (const d of debitDays) {
    const used = Math.min(d.raw_delay_minutes, creditToOffset);
    d.compensated_delay_minutes = used;
    d.payable_delay_minutes = d.raw_delay_minutes - used;
    creditToOffset -= used;
  }

  const positiveBalance = Math.max(0, rawCreditMin - rawDelayMin);
  const discardPositive = usePolicy && positiveBalance > 0 && positiveBalance <= minOt;
  for (const d of creditDays) {
    const remaining = d.raw_credit_minutes - d.compensated_credit_minutes;
    if (discardPositive) d.discarded_tolerance_minutes = remaining;
    else d.payable_overtime_minutes = remaining;
  }

  atrasoMin = debitDays.reduce((s, d) => s + d.payable_delay_minutes, 0);
  heNormalMin = creditDays
    .filter(d => d.overtime_bucket !== 'holiday')
    .reduce((s, d) => s + d.payable_overtime_minutes, 0);
  heHolidayMin = creditDays
    .filter(d => d.overtime_bucket === 'holiday')
    .reduce((s, d) => s + d.payable_overtime_minutes, 0);
  heMin = heNormalMin + heHolidayMin;

  const lateDays = debitDays.map(d => ({
    date: d.date,
    minutes: d.raw_delay_minutes,
    compensated_minutes: d.compensated_delay_minutes,
    payable_minutes: d.payable_delay_minutes,
  }));
  const heDays = creditDays.map(d => ({
    date: d.date,
    minutes: d.raw_credit_minutes,
    weekend: !d.is_workday,
    compensated_minutes: d.compensated_credit_minutes,
    payable_minutes: d.payable_overtime_minutes,
    discarded_tolerance_minutes: d.discarded_tolerance_minutes,
  }));

  const faltaDesconto = faltaDescontoAcc;
  const atrasoDesconto = debitDays.reduce(
    (sum, d) => sum + (d.payable_delay_minutes / 60) * valorHoraFor(d.date),
    0,
  );
  // HE: policy = valor ABSOLUTO R$/h por funcionário (normal vs domingo/feriado, sem
  // multiplicador); legado = valor-hora × multiplicador (1,5×).
  const heValue = usePolicy
    ? (heNormalMin / 60) * heNormalRate + (heHolidayMin / 60) * heHolidayRate
    : (heMin / 60) * valorHora * premiumMultiplier;
  // Aviso: HE em minutos mas taxa 0/não cadastrada → he_value sai R$0 (spec req.5/15).
  const heRateMissing = usePolicy && (
    (heNormalMin > 0 && !(heNormalRate > 0)) || (heHolidayMin > 0 && !(heHolidayRate > 0))
  );
  const adv = Number(advancesTotal) || 0;
  const gross = periodBase - faltaDesconto - atrasoDesconto + heValue;
  // O holerite impresso mostra Proventos, Descontos e Líquido. Cada um era
  // arredondado por um caminho diferente (`round2(pb+he)`, `round2(f+a+adv)` e
  // `round2(gross-adv)`), então Bruto − Descontos podia divergir do Líquido em
  // 1 centavo e o holerite não fechava. O Líquido passa a SAIR dos dois totais
  // já arredondados — a identidade vale por construção.
  const totalProventos = round2(periodBase + heValue);
  const totalDescontos = round2(faltaDesconto + atrasoDesconto + adv);

  return {
    rule_version: PAYROLL_RULE_VERSION,
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
    falta_dates: faltaDates,
    falta_desconto: round2(faltaDesconto),
    excused_days: excusedDays,
    raw_delay_minutes: rawDelayMin,
    raw_credit_minutes: rawCreditMin,
    compensated_minutes: compensatedMin,
    discarded_tolerance_minutes: creditDays.reduce((s, d) => s + d.discarded_tolerance_minutes, 0),
    atraso_minutes: atrasoMin,
    atraso_desconto: round2(atrasoDesconto),
    late_days: lateDays,
    he_days: heDays,
    he_minutes: heMin,
    he_normal_minutes: heNormalMin,
    he_holiday_minutes: heHolidayMin,
    he_rate_missing: heRateMissing,
    he_value: round2(heValue),
    day_ledger: dayLedger,
    pending_days: pendingDays,
    advances_total: round2(adv),
    total_descontos: totalDescontos,
    total_proventos: totalProventos,
    gross_value: round2(gross),
    net_value: round2(totalProventos - totalDescontos),
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

/**
 * Dias ÚTEIS do mês que contém `anyDateInMonth` = dias escalados (works_*) da escala
 * menos os feriados. Base do desconto de falta/atraso (spec: salário ÷ dias úteis).
 * Sábado conta se a escala trabalha sábado; domingos e feriados nunca contam.
 */
export function businessDaysInMonth(anyDateInMonth: string, schedule: SalaryWorkSchedule | null | undefined, holidaysSet: Set<string>): number {
  const [y, m] = String(anyDateInMonth || '').split('-').map(Number);
  if (!y || !m) return 0;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  let n = 0;
  for (let d = 1; d <= lastDay; d++) {
    const dt = new Date(Date.UTC(y, m - 1, d));
    const ds = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (worksOnDow(schedule, dt.getUTCDay()) && !holidaysSet.has(ds)) n++;
  }
  return n;
}

/** Dias CORRIDOS do mês (28–31) que contém `anyDateInMonth`. */
export function daysInCalendarMonth(anyDateInMonth: string): number {
  const [y, m] = String(anyDateInMonth || '').split('-').map(Number);
  if (!y || !m) return 30;
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export interface PeriodFolhaInput {
  salary: number;
  from: string;
  to: string;
  schedule: SalaryWorkSchedule | null;    // work_schedule (entry/exit/lunch/works_*)
  holidaysSet: Set<string>;               // feriados obrigatórios (crédito na taxa individual de feriado)
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
  /** Minutos remunerados de ausência parcial por data. Somados à jornada
   *  somente até cobrir a defasagem real, nunca para gerar HE. */
  absenceMinutes?: Map<string, number>;
  advancesTotal?: number;
  periodDays?: number;                    // base proporcional (quinzena); undefined = mês cheio
  monthDays?: number;                     // dias do mês (28–31) → prorateia 1ª+2ª = salário exato
  maxCoveredDate?: string | null;         // clamp: ignora dias após a última data importada
  /** Datas COBERTAS pela importação (relógio lido = há batida de algum funcionário).
   *  Dia útil sem batida só vira FALTA se estiver aqui; fora dela (lacuna no meio ou
   *  além do arquivo) é NEUTRO. Omitido = legado (todo dia útil sem batida = falta).
   *  Fonte única da regra de falta por cobertura (espelha useMonthlyClosing). */
  coveredDates?: Set<string>;
  /** Data de admissão (YYYY-MM-DD): dias ANTES dela são ignorados (o funcionário
   *  ainda não trabalhava aqui → não geram falta/esperado). Sem isso, um funcionário
   *  admitido no meio (ou depois) do período aparecia com falta em todo dia útil. */
  activeFrom?: string | null;
  /** Data de demissão (YYYY-MM-DD): dias DEPOIS dela são ignorados. */
  activeTo?: string | null;
  payRegime?: 'mensalista' | 'remoto' | 'diarista' | 'producao';  // regime de pagamento (default mensalista)
  dailyRate?: number;                     // R$/dia (só diarista)
  /** Produção por par (regime 'producao') — agregada do período a partir da Ficha
   *  de Montadores (Σ pares × R$/par snapshot). O motor NÃO consulta o banco:
   *  recebe pronto (ver src/lib/montadorProduction.ts). */
  producaoBruto?: number;
  producaoParesMedio?: number;
  producaoParesDificil?: number;
  /** Bruto separado por dificuldade + taxas efetivas (ver ProducaoAgg). */
  producaoBrutoMedio?: number;
  producaoBrutoDificil?: number;
  producaoTaxaMedio?: number;
  producaoTaxaDificil?: number;
  producaoTaxaVariou?: boolean;
  /** DIAS PRODUTIVOS do período (dias distintos com pares lançados). É o
   *  "dias trabalhados" de quem é por par — substitui worked_days, que mede
   *  presença no relógio e não se aplica a este regime. */
  producaoDias?: number;
  /** Fichas (lotes) do período e se alguma foi inferida por falta de detalhe. */
  producaoFichas?: number;
  producaoFichasDerivadas?: boolean;
  /** HE em R$/hora ABSOLUTO (spec 2026-07-09): dia útil/sábado/noturno. Default 0. */
  heNormalRate?: number;
  /** HE em R$/hora ABSOLUTO domingo/feriado. undefined/0 ⇒ usa heNormalRate. */
  heSundayHolidayRate?: number;
  /** Mínimo de HE em minutos (saldo positivo do período ≤ isto ⇒ 0 HE). Default 10. */
  minOvertimeMin?: number;
}

/** Monta os SalaryDayInput do período (escala/feriados/batidas) e calcula a folha. */
export function computePeriodFolha(inp: PeriodFolhaInput): SalaryPayrollResult {
  let dates = getDaysInRange(inp.from, inp.to);
  if (inp.maxCoveredDate) dates = dates.filter(d => d.date <= inp.maxCoveredDate!);
  // Recorte por vínculo: ignora dias antes da admissão / depois da demissão — senão
  // um funcionário admitido no meio (ou depois) do período vira falta em todo dia útil.
  if (inp.activeFrom) dates = dates.filter(d => d.date >= inp.activeFrom!);
  if (inp.activeTo) dates = dates.filter(d => d.date <= inp.activeTo!);
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
      expectedMinutes: isWorkday ? expectedDayMinutes(inp.schedule, d.dow) : 0,
      punches: inp.punchesByDate.get(d.date) || [],
      excused: inp.absenceDates?.has(d.date) ?? false,
      excusedMinutes: inp.absenceMinutes?.get(d.date) || 0,
      swapFlex: isSwap,
      covered: inp.coveredDates ? inp.coveredDates.has(d.date) : undefined,
    };
  });
  // Tolerância REMOVIDA (pedido do dono 2026-06-30): todo minuto conta — atraso
  // a partir do 1º minuto abaixo da jornada, hora extra a partir do 1º minuto
  // acima. Antes havia janela de 10min (work_schedules.tolerance_minutes) que
  // zerava o dia. Mantido 0 fixo p/ não depender do campo da escala.
  const tolerance = 0;
  // Multiplicador mantido apenas para compatibilidade do caminho legado; a folha
  // oficial usa as taxas absolutas individuais presentes na policy abaixo.
  const premiumMult = Number(inp.schedule?.overtime_multiplier ?? PREMIUM_MULTIPLIER);
  // Política CANÔNICA da folha (spec: specs/gestao-de-pessoas.md). Fonte ÚNICA — só
  // computePeriodFolha aplica. Falta = salário ÷ dias úteis do mês; atraso = min ×
  // (valorDia ÷ jornada); HE = R$/h absoluto por funcionário (normal vs domingo/feriado);
  // HE só acima de 10min. businessDays usa a escala + feriados do mês do início do período.
  // Dias úteis POR MÊS abrangido pelo período — falta/atraso de cada dia usam o divisor
  // do MÊS em que caem (períodos que cruzam meses ficam corretos; dentro do mês, idêntico).
  const bdByMonth: Record<string, number> = {};
  for (const d of dates) {
    const ym = d.date.slice(0, 7);
    if (!(ym in bdByMonth)) bdByMonth[ym] = businessDaysInMonth(d.date, inp.schedule, inp.holidaysSet);
  }
  const policy: SalaryPolicy = {
    businessDaysDivisor: bdByMonth[inp.from.slice(0, 7)] ?? businessDaysInMonth(inp.from, inp.schedule, inp.holidaysSet),
    businessDaysByMonth: bdByMonth,
    journeyMinutes: expectedDayMinutes(inp.schedule),
    heNormalRate: Number(inp.heNormalRate) || 0,
    heSundayHolidayRate: inp.heSundayHolidayRate != null && Number(inp.heSundayHolidayRate) > 0
      ? Number(inp.heSundayHolidayRate) : undefined,
    minOvertimeMin: inp.minOvertimeMin ?? 10,
  };
  // Base prorateada (quinzena): se periodDays veio mas monthDays não, usa os dias corridos
  // do mês do início — senão o fallback valorDia×periodDays (com valorDia=÷dias úteis)
  // inflaria a base. Todos os callers vivos já passam monthDays; isto blinda futuros.
  const monthDaysEff = inp.monthDays ?? (inp.periodDays != null && inp.periodDays > 0 ? daysInCalendarMonth(inp.from) : undefined);
  const base = calculateSalaryPayroll(inp.salary, days, inp.advancesTotal || 0, undefined, undefined, inp.periodDays, monthDaysEff, tolerance, premiumMult, policy);
  const regime = inp.payRegime || 'mensalista';
  const adv = base.advances_total;
  const neutralLedger = (keepPending = false): SalaryDayLedger[] => (base.day_ledger || []).map(d => ({
    ...d,
    raw_balance_minutes: 0,
    raw_credit_minutes: 0,
    raw_delay_minutes: 0,
    compensated_credit_minutes: 0,
    compensated_delay_minutes: 0,
    payable_overtime_minutes: 0,
    payable_delay_minutes: 0,
    discarded_tolerance_minutes: 0,
    overtime_bucket: undefined,
    status: keepPending && d.status === 'pending' ? 'pending' : d.worked_minutes > 0 ? 'normal' : 'neutral',
  }));

  // ── REMOTO: não bate ponto → salário cheio do período, ZERO desconto/HE de ponto.
  if (regime === 'remoto') {
    return {
      ...base, payment_type: 'remoto', daily_rate: 0, paid_days: 0,
      worked_minutes: 0, normal_minutes: 0, premium_minutes: 0,
      worked_days: 0, falta_days: 0, falta_dates: [], falta_desconto: 0, excused_days: 0,
      atraso_minutes: 0, atraso_desconto: 0, late_days: [], he_days: [], he_minutes: 0,
      raw_delay_minutes: 0, raw_credit_minutes: 0, compensated_minutes: 0, discarded_tolerance_minutes: 0,
      day_ledger: neutralLedger(),
      he_normal_minutes: 0, he_holiday_minutes: 0, he_rate_missing: false, he_value: 0, pending_days: 0,
      total_proventos: base.period_base, total_descontos: adv,
      gross_value: base.period_base, net_value: round2(base.period_base - adv),
    };
  }

  // ── DIARISTA: paga diária × dias trabalhados, com MEIA-DIÁRIA (spec req.3):
  // ≥6h no dia → 1 diária; 2–6h → 0,5; <2h → 0. Dia com batida ÍMPAR/ÚNICA (não dá pra
  // medir horas) NÃO paga automático — vira PENDÊNCIA (resolver no Ponto antes de fechar),
  // pra não pagar diária cheia por uma aparição de 10min. Sem salário mensal, sem falta/atraso.
  if (regime === 'diarista') {
    const dr = Number(inp.dailyRate) || 0;
    let paidUnits = 0;    // soma de diárias (pode ser fracionária: 0,5)
    let presentDays = 0;  // dias com alguma diária (unit > 0)
    let pendingD = 0;     // dias com batida ímpar/única — não pagos até resolver
    for (const d of days) {
      const punches = Array.isArray(d.punches) ? d.punches : [];
      if (punches.length < 1) continue;
      if (punches.length < 2) { pendingD++; continue; }  // batida única = pendência
      const sp = splitDayMinutes(punches, d.dayOfWeek, d.isHoliday, d.swapFlex);
      if (sp.incomplete) { pendingD++; continue; }        // ímpar (3, 5…) = pendência
      const workedH = (sp.normal + sp.premium) / 60;
      const unit = workedH >= 6 ? 1 : workedH >= 2 ? 0.5 : 0;
      if (unit > 0) presentDays++;
      paidUnits += unit;
    }
    const grossD = round2(dr * paidUnits);
    return {
      ...base, payment_type: 'diarista', daily_rate: dr, paid_days: presentDays,
      falta_days: 0, falta_dates: [], falta_desconto: 0, excused_days: 0, atraso_minutes: 0, atraso_desconto: 0, late_days: [], he_days: [],
      raw_delay_minutes: 0, raw_credit_minutes: 0, compensated_minutes: 0, discarded_tolerance_minutes: 0,
      day_ledger: neutralLedger(true),
      he_minutes: 0, he_normal_minutes: 0, he_holiday_minutes: 0, he_rate_missing: false, he_value: 0,
      pending_days: pendingD,
      period_base: grossD, total_proventos: grossD, total_descontos: adv,
      gross_value: grossD, net_value: round2(grossD - adv),
    };
  }

  // ── PRODUÇÃO (por par): bruto = Σ pares × R$/par (Ficha de Montadores), já
  // valorado no caller pelo snapshot de cada apontamento. IGNORA salário e ponto
  // por completo — sem salário, sem falta/atraso/HE, sem esperado. Líquido =
  // bruto − adiantamentos (pode ficar negativo = saldo devedor). O relógio de
  // ponto do funcionário serve só pra presença (spec funcionarios-pagamento-por-par).
  if (regime === 'producao') {
    const bruto = round2(Number(inp.producaoBruto) || 0);
    const diasProd = Number(inp.producaoDias) || 0;
    return {
      // paid_days = DIAS PRODUTIVOS. É a única leitura de "dias trabalhados" que
      // faz sentido aqui: worked_days conta dia com batida, e o ponto não paga
      // nada neste regime. Sem isto o relatório do RH imprimia "0 dias" pra quem
      // produziu o mês inteiro.
      ...base, payment_type: 'producao', daily_rate: 0, paid_days: diasProd,
      base_salary: 0, valor_dia: 0, valor_hora: 0,
      expected_minutes: 0, worked_minutes: 0, normal_minutes: 0, premium_minutes: 0,
      workdays: 0, worked_days: 0,
      falta_days: 0, falta_dates: [], falta_desconto: 0, excused_days: 0,
      atraso_minutes: 0, atraso_desconto: 0, late_days: [], he_days: [], he_minutes: 0,
      raw_delay_minutes: 0, raw_credit_minutes: 0, compensated_minutes: 0, discarded_tolerance_minutes: 0,
      day_ledger: neutralLedger(),
      he_normal_minutes: 0, he_holiday_minutes: 0, he_rate_missing: false, he_value: 0, pending_days: 0,
      pares_medio: Number(inp.producaoParesMedio) || 0,
      pares_dificil: Number(inp.producaoParesDificil) || 0,
      bruto_medio: round2(Number(inp.producaoBrutoMedio) || 0),
      bruto_dificil: round2(Number(inp.producaoBrutoDificil) || 0),
      taxa_medio: Number(inp.producaoTaxaMedio) || 0,
      taxa_dificil: Number(inp.producaoTaxaDificil) || 0,
      taxa_variou: !!inp.producaoTaxaVariou,
      fichas: Number(inp.producaoFichas) || 0,
      fichas_derivadas: !!inp.producaoFichasDerivadas,
      period_base: bruto, total_proventos: bruto, total_descontos: adv,
      gross_value: bruto, net_value: round2(bruto - adv),
    };
  }

  return base; // mensalista
}

import { describe, it, expect } from 'vitest';
import { calculateSalaryPayroll, computePeriodFolha, getDaysInRange, businessDaysInMonth, type SalaryDayInput } from '../salaryPayroll';

// Folha SALÁRIO CHEIO − DESCONTOS (decisão 2026-06-03). Trava a regra:
//   valor-dia = salário/30 ; valor-hora = salário/220
//   falta = −valor-dia ; atraso/saída-cedo = −(esperado−trabalhado)×valor-hora
//   HE (após 18h / fds / feriado) = +horas×valor-hora×1,5 ; falta NÃO tira DSR
//   batida ímpar = pendente (não desconta nem paga)
const MON = 1, THU = 4, FRI = 5, SUN = 0;

// Dia útil (seg–sex): jornada esperada 9h (540min). Fim de semana/feriado: 0.
const work = (date: string, dow: number, punches: string[]): SalaryDayInput =>
  ({ date, dayOfWeek: dow, isHoliday: false, isWorkday: dow >= 1 && dow <= 5, expectedMinutes: dow >= 1 && dow <= 5 ? 540 : 0, punches });
const weekend = (date: string, dow: number, punches: string[]): SalaryDayInput =>
  ({ date, dayOfWeek: dow, isHoliday: false, isWorkday: false, expectedMinutes: 0, punches });

describe('calculateSalaryPayroll', () => {
  it('dia perfeito (08–18): sem desconto, recebe o salário cheio', () => {
    const r = calculateSalaryPayroll(2200, [work('2026-05-04', MON, ['08:00', '12:00', '13:00', '18:00'])], 0);
    expect(r.valor_dia).toBeCloseTo(73.33, 1);
    expect(r.valor_hora).toBeCloseTo(10, 4);
    expect(r.falta_days).toBe(0);
    expect(r.atraso_minutes).toBe(0);
    expect(r.he_minutes).toBe(0);
    expect(r.gross_value).toBeCloseTo(2200, 2);
  });

  it('FALTA (dia útil sem batida): desconta 1 valor-dia (sem mexer no DSR)', () => {
    const r = calculateSalaryPayroll(2200, [work('2026-05-04', MON, [])], 0);
    expect(r.falta_days).toBe(1);
    expect(r.falta_desconto).toBeCloseTo(73.33, 1);
    expect(r.gross_value).toBeCloseTo(2200 - 73.333, 1);
  });

  it('ATRASO + saída cedo (Marcio 21/05, 08:35–17:18): desconta 77min × valor-hora', () => {
    // span 08:35→17:18 = 523min − 1h almoço = 463 normal. déficit = 540 − 463 = 77min.
    const r = calculateSalaryPayroll(1850, [work('2026-05-21', THU, ['08:35', '17:18'])], 0);
    expect(r.normal_minutes).toBe(463);
    expect(r.atraso_minutes).toBe(77);
    expect(r.atraso_desconto).toBeCloseTo((77 / 60) * (1850 / 220), 2); // ≈ 10.79
    expect(r.he_minutes).toBe(0);
    expect(r.gross_value).toBeCloseTo(1850 - (77 / 60) * (1850 / 220), 2);
  });

  it('atraso grande de 4 batidas (Marcio 22/05, 09:59–17:23): déficit 164min', () => {
    const r = calculateSalaryPayroll(1850, [work('2026-05-22', FRI, ['09:59', '11:56', '13:04', '17:23'])], 0);
    expect(r.normal_minutes).toBe(376); // (11:56−09:59)+(17:23−13:04)
    expect(r.atraso_minutes).toBe(164); // 540 − 376
    expect(r.atraso_desconto).toBeCloseTo((164 / 60) * (1850 / 220), 2);
  });

  it('DOMINGO trabalhado (Marcio 24/05, 09:45–17:48): tudo HE 1,5×, sem desconto', () => {
    // span 09:45→17:48 = 483 − 1h = 423min, todo premium (domingo).
    const r = calculateSalaryPayroll(1850, [weekend('2026-05-24', SUN, ['09:45', '17:48'])], 0);
    expect(r.falta_days).toBe(0);
    expect(r.atraso_minutes).toBe(0);
    expect(r.he_minutes).toBe(423);
    expect(r.he_value).toBeCloseTo((423 / 60) * (1850 / 220) * 1.5, 2); // ≈ 88.93
    expect(r.gross_value).toBeCloseTo(1850 + (423 / 60) * (1850 / 220) * 1.5, 2);
  });

  it('batida ÍMPAR (pulou batida): PENDENTE — não desconta nem paga, MAS conta no esperado', () => {
    const r = calculateSalaryPayroll(2200, [work('2026-05-21', THU, ['08:21', '13:06', '18:30'])], 0);
    expect(r.pending_days).toBe(1);
    expect(r.falta_days).toBe(0);
    expect(r.atraso_minutes).toBe(0);
    // Esperado é da ESCALA: o dia útil pendente conta no esperado/workdays (senão a
    // meta do período encolhe quando há batida ímpar). worked fica 0 até resolver.
    expect(r.workdays).toBe(1);
    expect(r.expected_minutes).toBe(540);
    expect(r.worked_minutes).toBe(0);
    expect(r.gross_value).toBeCloseTo(2200, 2); // sem desconto enquanto não resolver
  });

  it('hora extra após 18h em dia útil: desconta nada, soma a 1,5×', () => {
    // 08:00–20:00 com almoço: 9h normal + 2h após 18h.
    const r = calculateSalaryPayroll(2200, [work('2026-05-04', MON, ['08:00', '12:00', '13:00', '20:00'])], 0);
    expect(r.atraso_minutes).toBe(0);
    expect(r.he_minutes).toBe(120);
    expect(r.he_value).toBeCloseTo((120 / 60) * 10 * 1.5, 2); // 30
    expect(r.gross_value).toBeCloseTo(2200 + 30, 2);
  });

  it('mês: 2 perfeitos + 1 falta + 1 atraso + 1 vale; líquido = salário − descontos', () => {
    const r = calculateSalaryPayroll(2200, [
      work('2026-05-04', MON, ['08:00', '12:00', '13:00', '18:00']), // perfeito
      work('2026-05-05', 2,   ['08:00', '12:00', '13:00', '18:00']), // perfeito
      work('2026-05-06', 3,   []),                                   // falta
      work('2026-05-07', THU, ['08:30', '18:00']),                   // atraso 30min
    ], 200);
    expect(r.falta_days).toBe(1);
    expect(r.falta_desconto).toBeCloseTo(73.333, 1);
    expect(r.atraso_minutes).toBe(30); // 08:30 span − 1h almoço = 510 normal; 540−510=30
    expect(r.atraso_desconto).toBeCloseTo((30 / 60) * 10, 2); // 5
    expect(r.advances_total).toBe(200);
    const expectedGross = 2200 - 73.333 - 5;
    expect(r.gross_value).toBeCloseTo(expectedGross, 1);
    expect(r.net_value).toBeCloseTo(expectedGross - 200, 1);
  });
});

describe('calculateSalaryPayroll — base proporcional por quinzena (periodDays + monthDays)', () => {
  it('mês de 31: 1ª quinzena (15 dias) = salário × 15/31', () => {
    const r = calculateSalaryPayroll(3000, [], 0, 30, 220, 15, 31);
    expect(r.base_salary).toBe(3000);        // salário mensal cheio (referência)
    expect(r.valor_dia).toBeCloseTo(100, 2);  // 3000/30 (faltas seguem ÷30)
    expect(r.period_days).toBe(15);
    expect(r.period_base).toBeCloseTo(45000 / 31, 2);  // 1451,61
    expect(r.gross_value).toBeCloseTo(45000 / 31, 2);
  });

  it('mês de 31: 2ª quinzena (16 dias) = salário × 16/31', () => {
    const r = calculateSalaryPayroll(3000, [], 0, 30, 220, 16, 31);
    expect(r.period_base).toBeCloseTo(48000 / 31, 2);  // 1548,39
  });

  it('INVARIANTE: 1ª + 2ª quinzena somam o salário EXATO (sem dia a mais)', () => {
    const q1 = calculateSalaryPayroll(3000, [], 0, 30, 220, 15, 31);
    const q2 = calculateSalaryPayroll(3000, [], 0, 30, 220, 16, 31);
    expect(q1.period_base + q2.period_base).toBeCloseTo(3000, 2);  // antes dava 3100 (31/30)
  });

  it('mês de 30: 1ª quinzena (15 dias) = metade (1500) — sem mudança', () => {
    const r = calculateSalaryPayroll(3000, [], 0, 30, 220, 15, 30);
    expect(r.period_base).toBeCloseTo(1500, 2);
  });

  it('sem periodDays = mês cheio (base = salário)', () => {
    const r = calculateSalaryPayroll(3000, [], 0);
    expect(r.period_days).toBe(30);
    expect(r.period_base).toBeCloseTo(3000, 2);
    expect(r.gross_value).toBeCloseTo(3000, 2);
  });

  it('falta numa quinzena desconta valor-dia (salário/30) sobre a base proporcional', () => {
    // 1 dia útil sem batida (falta) numa 1ª quinzena de 15 dias num mês de 31
    const r = calculateSalaryPayroll(3000, [work('2026-05-04', MON, [])], 0, 30, 220, 15, 31);
    expect(r.falta_days).toBe(1);
    expect(r.falta_desconto).toBeCloseTo(100, 2);          // valor-dia = 3000/30 (inalterado)
    expect(r.period_base).toBeCloseTo(45000 / 31, 2);      // 1451,61
    expect(r.gross_value).toBeCloseTo(45000 / 31 - 100, 2); // 1351,61
  });

  it('legado: sem monthDays, cai no ÷30 (salário/30 × dias)', () => {
    const r = calculateSalaryPayroll(3000, [], 0, 30, 220, 15);
    expect(r.period_base).toBeCloseTo(1500, 2);
  });
});

describe('calculateSalaryPayroll — BRUTO por-dia (atraso e HE por dia, sem compensação)', () => {
  it('domingo trabalhado é HE; déficit de seg NÃO é abatido pelo domingo', () => {
    // Seg: 08–12 (240 trab, esperado 540 ⇒ déficit 300). Dom: 2h trabalhadas.
    // BRUTO: atraso 300 (seg) + HE 120 (dom) — sem compensação entre dias.
    const r = calculateSalaryPayroll(2200, [
      work('2026-05-04', MON, ['08:00', '12:00']),
      weekend('2026-05-10', SUN, ['14:00', '16:00']),
    ], 0);
    expect(r.atraso_minutes).toBe(300);
    expect(r.atraso_desconto).toBeCloseTo(50, 2); // 5h × (2200/220)=10
    expect(r.he_minutes).toBe(120);               // domingo = hora extra (esperado 0)
    expect(r.he_value).toBeCloseTo(30, 2);        // 2h × 10 × 1,5
  });

  it('cumpriu a meta + sábado extra: o EXCEDENTE vira hora extra 1,5×', () => {
    const week = [
      work('2026-05-04', 1, ['08:00', '12:00', '13:00', '18:00']),
      work('2026-05-05', 2, ['08:00', '12:00', '13:00', '18:00']),
      work('2026-05-06', 3, ['08:00', '12:00', '13:00', '18:00']),
      work('2026-05-07', 4, ['08:00', '12:00', '13:00', '18:00']),
      work('2026-05-08', 5, ['08:00', '12:00', '13:00', '18:00']),
      weekend('2026-05-09', 6, ['08:00', '12:00']), // sábado +4h
    ];
    const r = calculateSalaryPayroll(2200, week, 0);
    expect(r.atraso_minutes).toBe(0);
    expect(r.he_minutes).toBe(240);           // só o excedente (o sábado)
    expect(r.he_value).toBeCloseTo(60, 2);    // 4h × 10 × 1,5
  });

  it('atraso num dia e saída tarde noutro NÃO se compensam (bruto)', () => {
    // Seg 10:00–18:00 = 420 trab (deve 540 ⇒ atraso 120). Ter 08–20 c/ almoço = 660
    // (sobra 120 ⇒ HE 120). BRUTO: atraso 120 E HE 120 — NÃO se anulam (era 0/0 no líquido).
    const r = calculateSalaryPayroll(2200, [
      work('2026-05-04', 1, ['10:00', '18:00']),
      work('2026-05-05', 2, ['08:00', '12:00', '13:00', '20:00']),
    ], 0);
    expect(r.atraso_minutes).toBe(120);
    expect(r.he_minutes).toBe(120);
    expect(r.atraso_desconto).toBeCloseTo(20, 2); // 2h × 10
    expect(r.he_value).toBeCloseTo(30, 2);        // 2h × 10 × 1,5
  });

  it('atraso é capado em 1 valor-dia: dia quase-vazio NÃO custa mais que uma falta', () => {
    // Dia de 9h (540) com só 30min batidos → déficit bruto 510. Sem teto o desconto
    // seria 510/60×10 = R$85 > valor-dia (R$73,33) = mais caro que faltar. Capado a
    // 440min (=(220/30)×60) → desconto = 440/60×10 = R$73,33 = exatamente 1 valor-dia.
    const r = calculateSalaryPayroll(2200, [work('2026-05-04', MON, ['08:00', '08:30'])], 0);
    expect(r.atraso_minutes).toBe(440);                 // capado (não 510)
    expect(r.atraso_desconto).toBeCloseTo(73.33, 2);    // = valor_dia
    expect(r.atraso_desconto).toBeCloseTo(r.valor_dia, 2);
  });
})

const SCHED = {
  entry_time: '08:00:00', exit_time: '18:00:00', lunch_start: '12:00:00', lunch_end: '13:00:00',
  works_sunday: false, works_monday: true, works_tuesday: true, works_wednesday: true,
  works_thursday: true, works_friday: true, works_saturday: false,
};
const NO_HOL = new Set<string>();
const full = ['08:00', '12:00', '13:00', '18:00'];

describe('computePeriodFolha — helper de período (escala + feriados + batidas)', () => {
  it('getDaysInRange conta os dias corridos', () => {
    expect(getDaysInRange('2026-05-04', '2026-05-08')).toHaveLength(5);
    expect(getDaysInRange('2026-05-04', '2026-05-04')).toHaveLength(1);
    expect(getDaysInRange('2026-05-08', '2026-05-04')).toHaveLength(0); // from > to
  });

  it('semana perfeita (seg–sex 08–18) = salário cheio, sem desconto/HE', () => {
    const punches = new Map<string, string[]>();
    for (const d of ['2026-05-04', '2026-05-05', '2026-05-06', '2026-05-07', '2026-05-08']) punches.set(d, full);
    const r = computePeriodFolha({ salary: 2200, from: '2026-05-04', to: '2026-05-08', schedule: SCHED, holidaysSet: NO_HOL, punchesByDate: punches });
    expect(r.workdays).toBe(5);
    expect(r.falta_days).toBe(0);
    expect(r.atraso_minutes).toBe(0);
    expect(r.he_minutes).toBe(0);
    expect(r.gross_value).toBeCloseTo(2200, 2);
  });

  it('feriado obrigatório não vira falta; trabalho nele = HE', () => {
    const punches = new Map<string, string[]>([['2026-05-01', ['08:00', '12:00']]]);
    const r = computePeriodFolha({ salary: 2200, from: '2026-05-01', to: '2026-05-01', schedule: SCHED, holidaysSet: new Set(['2026-05-01']), punchesByDate: punches });
    expect(r.falta_days).toBe(0);
    expect(r.he_minutes).toBe(240); // 4h no feriado
  });

  it('falta_dates lista as datas de falta (dia útil coberto sem batida)', () => {
    // seg/ter com batida; qua/qui/sex sem batida → 3 faltas (period sem clamp).
    const punches = new Map<string, string[]>();
    for (const d of ['2026-05-04', '2026-05-05']) punches.set(d, full);
    const r = computePeriodFolha({ salary: 2200, from: '2026-05-04', to: '2026-05-08', schedule: SCHED, holidaysSet: NO_HOL, punchesByDate: punches });
    expect(r.falta_days).toBe(3);
    expect(r.falta_dates).toEqual(['2026-05-06', '2026-05-07', '2026-05-08']);
  });

  it('activeFrom (admissão) ignora dias antes do vínculo — não viram falta', () => {
    // Admitido 07/05 (qui): seg–qua (04–06) são antes da admissão → não contam.
    const punches = new Map<string, string[]>([['2026-05-07', full], ['2026-05-08', full]]);
    const r = computePeriodFolha({
      salary: 2200, from: '2026-05-04', to: '2026-05-08', schedule: SCHED,
      holidaysSet: NO_HOL, punchesByDate: punches, activeFrom: '2026-05-07',
    });
    expect(r.falta_days).toBe(0);        // 04,05,06 não geram falta (pré-admissão)
    expect(r.falta_dates).toEqual([]);
    expect(r.workdays).toBe(2);          // só qui e sex contam
  });

  it('activeTo (demissão) ignora dias após o desligamento', () => {
    // Demitido 05/05 (ter): qua–sex (06–08) são após → não geram falta.
    const punches = new Map<string, string[]>([['2026-05-04', full], ['2026-05-05', full]]);
    const r = computePeriodFolha({
      salary: 2200, from: '2026-05-04', to: '2026-05-08', schedule: SCHED,
      holidaysSet: NO_HOL, punchesByDate: punches, activeTo: '2026-05-05',
    });
    expect(r.falta_days).toBe(0);
    expect(r.workdays).toBe(2);
  });

  it('diarista/remoto NÃO vazam falta_dates (regressão)', () => {
    const punches = new Map<string, string[]>([['2026-05-04', full]]); // seg trabalhado; ter–sex sem batida
    const dia = computePeriodFolha({ salary: 0, from: '2026-05-04', to: '2026-05-08', schedule: SCHED, holidaysSet: NO_HOL, punchesByDate: punches, payRegime: 'diarista', dailyRate: 150 });
    expect(dia.falta_days).toBe(0);
    expect(dia.falta_dates).toEqual([]);   // diarista não tem falta
    const rem = computePeriodFolha({ salary: 3000, from: '2026-05-04', to: '2026-05-08', schedule: SCHED, holidaysSet: NO_HOL, punchesByDate: new Map(), payRegime: 'remoto' });
    expect(rem.falta_dates).toEqual([]);
  });

  it('coveredDates: dia útil sem batida NÃO coberto = neutro (não vira falta)', () => {
    // seg (04) com batida; cobertura só tem 04 e 05 (ter, importado de outro func).
    // Logo ter(05) sem batida = falta; qua–sex (06,07,08) sem importação = neutro.
    const punches = new Map<string, string[]>([['2026-05-04', full]]);
    const covered = new Set(['2026-05-04', '2026-05-05']);
    const r = computePeriodFolha({ salary: 2200, from: '2026-05-04', to: '2026-05-08', schedule: SCHED, holidaysSet: NO_HOL, punchesByDate: punches, coveredDates: covered });
    expect(r.falta_dates).toEqual(['2026-05-05']);
    expect(r.falta_days).toBe(1);
    // sem coveredDates (legado): qua–sex também viram falta → 4 faltas
    const legacy = computePeriodFolha({ salary: 2200, from: '2026-05-04', to: '2026-05-08', schedule: SCHED, holidaysSet: NO_HOL, punchesByDate: punches });
    expect(legacy.falta_days).toBe(4);
  });

  it('maxCoveredDate (clamp) ignora dias não importados — não viram falta', () => {
    const punches = new Map<string, string[]>();
    for (const d of ['2026-05-04', '2026-05-05', '2026-05-06']) punches.set(d, full);
    const r = computePeriodFolha({ salary: 2200, from: '2026-05-04', to: '2026-05-08', schedule: SCHED, holidaysSet: NO_HOL, punchesByDate: punches, maxCoveredDate: '2026-05-06' });
    expect(r.workdays).toBe(3);
    expect(r.falta_days).toBe(0);
    const r2 = computePeriodFolha({ salary: 2200, from: '2026-05-04', to: '2026-05-08', schedule: SCHED, holidaysSet: NO_HOL, punchesByDate: punches });
    expect(r2.falta_days).toBe(2); // sem clamp, qui/sex viram falta
  });
});

describe('computePeriodFolha — troca de dia / compensação (workday_swaps)', () => {
  // 2026-05-03 é um DOMINGO. Sem troca, trabalhar nele = tudo hora extra.
  it('domingo SEM troca = tudo hora extra', () => {
    const punches = new Map<string, string[]>([['2026-05-03', full]]); // 9h no domingo
    const r = computePeriodFolha({ salary: 2200, from: '2026-05-03', to: '2026-05-03', schedule: SCHED, holidaysSet: NO_HOL, punchesByDate: punches });
    expect(r.he_minutes).toBe(540); // 9h todas como HE
    expect(r.premium_minutes).toBe(540);
  });

  it('domingo COM troca = dia útil normal (jornada esperada, sem HE)', () => {
    const punches = new Map<string, string[]>([['2026-05-03', full]]); // 9h = jornada padrão
    const r = computePeriodFolha({
      salary: 2200, from: '2026-05-03', to: '2026-05-03', schedule: SCHED,
      holidaysSet: NO_HOL, swapWorkedSet: new Set(['2026-05-03']), punchesByDate: punches,
    });
    expect(r.workdays).toBe(1);         // domingo virou dia útil
    expect(r.he_minutes).toBe(0);       // trabalhou a jornada esperada → nada de HE
    expect(r.premium_minutes).toBe(0);  // não é fim de semana pra fins de 1,5×
    expect(r.falta_days).toBe(0);
  });

  it('excedente da jornada no dia trocado ainda vira HE (só o que passa do esperado)', () => {
    const punches = new Map<string, string[]>([['2026-05-03', ['08:00', '12:00', '13:00', '19:00']]]); // 10h
    const r = computePeriodFolha({
      salary: 2200, from: '2026-05-03', to: '2026-05-03', schedule: SCHED,
      holidaysSet: NO_HOL, swapWorkedSet: new Set(['2026-05-03']), punchesByDate: punches,
    });
    expect(r.he_minutes).toBe(60); // 10h − 9h esperado = 1h de HE
  });

  it('feriado trabalhado COM troca vira dia normal (deixa de ser HE)', () => {
    // 2026-05-01 (sexta) é feriado. Com troca, lê normal.
    const punches = new Map<string, string[]>([['2026-05-01', full]]);
    const r = computePeriodFolha({
      salary: 2200, from: '2026-05-01', to: '2026-05-01', schedule: SCHED,
      holidaysSet: new Set(['2026-05-01']), swapWorkedSet: new Set(['2026-05-01']), punchesByDate: punches,
    });
    expect(r.workdays).toBe(1);
    expect(r.he_minutes).toBe(0);
    expect(r.falta_days).toBe(0);
  });

  it('folga compensatória (off_date) num dia útil não gera falta', () => {
    // 2026-05-04 (segunda) sem batida, mas marcado como folga compensatória.
    const r = computePeriodFolha({
      salary: 2200, from: '2026-05-04', to: '2026-05-04', schedule: SCHED,
      holidaysSet: NO_HOL, swapOffSet: new Set(['2026-05-04']), punchesByDate: new Map(),
    });
    expect(r.falta_days).toBe(0);   // folga, não falta
    expect(r.workdays).toBe(0);     // dia sem jornada esperada
  });

  it('dia de troca (work_date) SEM batida = neutro, NÃO vira falta', () => {
    // Ponte registrada pra todos, mas o funcionário não trabalhou (nem bateu ponto).
    // Regra flex: sem batida = neutro — não penaliza quem não trabalhou a ponte.
    const r = computePeriodFolha({
      salary: 2200, from: '2026-05-03', to: '2026-05-03', schedule: SCHED,
      holidaysSet: NO_HOL, swapWorkedSet: new Set(['2026-05-03']), punchesByDate: new Map(),
    });
    expect(r.falta_days).toBe(0);   // não é falta
    expect(r.workdays).toBe(0);     // neutro, fora do esperado
    expect(r.he_minutes).toBe(0);
  });

  it('folga compensatória (off_date) TRABALHADA lê como dia normal (não 1,5×)', () => {
    // Funcionário trabalha na folga: conta como dia útil normal, não hora extra.
    const punches = new Map<string, string[]>([['2026-05-04', full]]); // 9h numa segunda-folga
    const r = computePeriodFolha({
      salary: 2200, from: '2026-05-04', to: '2026-05-04', schedule: SCHED,
      holidaysSet: NO_HOL, swapOffSet: new Set(['2026-05-04']), punchesByDate: punches,
    });
    expect(r.workdays).toBe(1);
    expect(r.he_minutes).toBe(0);       // jornada normal → sem HE
    expect(r.premium_minutes).toBe(0);  // sem 1,5×
    expect(r.falta_days).toBe(0);
  });

  it('colisão work_date×off_date na mesma data: tratamento idêntico (dia flex)', () => {
    // 2026-05-03 (domingo) é work_date de uma troca E off_date de outra. Como ambos
    // são dia flex, o resultado é o mesmo independente da precedência.
    const punches = new Map<string, string[]>([['2026-05-03', full]]);
    const both = computePeriodFolha({
      salary: 2200, from: '2026-05-03', to: '2026-05-03', schedule: SCHED, holidaysSet: NO_HOL,
      swapWorkedSet: new Set(['2026-05-03']), swapOffSet: new Set(['2026-05-03']), punchesByDate: punches,
    });
    expect(both.he_minutes).toBe(0);
    expect(both.premium_minutes).toBe(0);
    expect(both.workdays).toBe(1);
  });
});

describe('computePeriodFolha — regimes remoto e diarista (2026-06-19)', () => {
  it('REMOTO: salário cheio, ignora ponto (sem falta/atraso/HE) mesmo sem bater nada', () => {
    const r = computePeriodFolha({ salary: 3000, from: '2026-05-04', to: '2026-05-08', schedule: SCHED, holidaysSet: NO_HOL, punchesByDate: new Map(), payRegime: 'remoto' });
    expect(r.payment_type).toBe('remoto');
    expect(r.falta_days).toBe(0);
    expect(r.atraso_minutes).toBe(0);
    expect(r.he_minutes).toBe(0);
    expect(r.gross_value).toBeCloseTo(3000, 2); // salário cheio
    expect(r.net_value).toBeCloseTo(3000, 2);
  });

  it('REMOTO com adiantamento: salário cheio − vale', () => {
    const r = computePeriodFolha({ salary: 3000, from: '2026-05-04', to: '2026-05-08', schedule: SCHED, holidaysSet: NO_HOL, punchesByDate: new Map(), payRegime: 'remoto', advancesTotal: 500 });
    expect(r.net_value).toBeCloseTo(2500, 2);
  });

  it('DIARISTA: diária × dias com batida; sem falta nem salário mensal', () => {
    const punches = new Map<string, string[]>();
    for (const d of ['2026-05-04', '2026-05-05', '2026-05-06']) punches.set(d, full); // veio 3 dias, faltou qui/sex
    const r = computePeriodFolha({ salary: 0, from: '2026-05-04', to: '2026-05-08', schedule: SCHED, holidaysSet: NO_HOL, punchesByDate: punches, payRegime: 'diarista', dailyRate: 150 });
    expect(r.payment_type).toBe('diarista');
    expect(r.paid_days).toBe(3);
    expect(r.falta_days).toBe(0);
    expect(r.daily_rate).toBe(150);
    expect(r.gross_value).toBeCloseTo(450, 2); // 3 × 150
    expect(r.net_value).toBeCloseTo(450, 2);
  });

  it('DIARISTA: dia de batida ÚNICA vira PENDÊNCIA — não paga diária cheia até resolver', () => {
    const punches = new Map<string, string[]>([['2026-05-04', full], ['2026-05-05', ['08:00']]]);
    const r = computePeriodFolha({ salary: 0, from: '2026-05-04', to: '2026-05-08', schedule: SCHED, holidaysSet: NO_HOL, punchesByDate: punches, payRegime: 'diarista', dailyRate: 100 });
    expect(r.paid_days).toBe(1);                 // só o dia com par completo (04)
    expect(r.pending_days).toBe(1);              // 05 (batida única) fica pendente
    expect(r.gross_value).toBeCloseTo(100, 2);   // não paga a diária do dia incompleto
  });
});

describe('computePeriodFolha — SEM tolerância (todo minuto conta, 2026-06-30) e ordenação de batidas (D18)', () => {
  const sched = (tol: number) => ({ ...SCHED, tolerance_minutes: tol });

  it('atraso de 8min → conta 8min CHEIOS mesmo com tolerance_minutes=10 na escala (ignorado)', () => {
    const punches = new Map<string, string[]>([['2026-05-04', ['08:08', '12:00', '13:00', '18:00']]]); // déficit 8min
    const r = computePeriodFolha({ salary: 2200, from: '2026-05-04', to: '2026-05-04', schedule: sched(10), holidaysSet: NO_HOL, punchesByDate: punches });
    expect(r.atraso_minutes).toBe(8);
    expect(r.he_minutes).toBe(0);
    // Política canônica (2026-07-09): atraso = min × ((salário ÷ dias_úteis) ÷ jornada).
    // mai/2026 tem 21 dias úteis (seg–sex); jornada 9h. valor-hora = (2200/21)/9.
    const BD = 21;
    expect(r.gross_value).toBeCloseTo(2200 - (8 / 60) * ((2200 / BD) / 9), 2);
  });

  it('atraso de 20min → conta o atraso CHEIO (20min)', () => {
    const punches = new Map<string, string[]>([['2026-05-04', ['08:20', '12:00', '13:00', '18:00']]]);
    const r = computePeriodFolha({ salary: 2200, from: '2026-05-04', to: '2026-05-04', schedule: sched(10), holidaysSet: NO_HOL, punchesByDate: punches });
    expect(r.atraso_minutes).toBe(20);
  });

  it('HE de 5min → DESCARTADA (mínimo de 10min, spec 2026-07-09)', () => {
    const punches = new Map<string, string[]>([['2026-05-04', ['08:00', '12:00', '13:00', '18:05']]]); // +5min ≤ 10 → 0
    const r = computePeriodFolha({ salary: 2200, from: '2026-05-04', to: '2026-05-04', schedule: sched(10), holidaysSet: NO_HOL, punchesByDate: punches });
    expect(r.he_minutes).toBe(0);
  });

  it('HE de 15min → conta os 15min (passou do mínimo de 10min)', () => {
    const punches = new Map<string, string[]>([['2026-05-04', ['08:00', '12:00', '13:00', '18:15']]]); // +15min > 10
    const r = computePeriodFolha({ salary: 2200, from: '2026-05-04', to: '2026-05-04', schedule: sched(10), holidaysSet: NO_HOL, punchesByDate: punches });
    expect(r.he_minutes).toBe(15);
  });

  it('atraso de 7min conta mesmo sem tolerance_minutes na escala (sem tolerância)', () => {
    const punches = new Map<string, string[]>([['2026-05-04', ['08:07', '12:00', '13:00', '18:00']]]); // 7min
    const r = computePeriodFolha({ salary: 2200, from: '2026-05-04', to: '2026-05-04', schedule: SCHED, holidaysSet: NO_HOL, punchesByDate: punches });
    expect(r.atraso_minutes).toBe(7);
  });

  it('batidas fora de ordem são ordenadas (D18): 08,18,12,13 = 9h, não 11h', () => {
    const punches = new Map<string, string[]>([['2026-05-04', ['08:00', '18:00', '12:00', '13:00']]]);
    const r = computePeriodFolha({ salary: 2200, from: '2026-05-04', to: '2026-05-04', schedule: SCHED, holidaysSet: NO_HOL, punchesByDate: punches });
    expect(r.worked_minutes).toBe(540); // 9h (almoço deduzido), não 660
    expect(r.atraso_minutes).toBe(0);
    expect(r.he_minutes).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// POLÍTICA CANÔNICA (spec: specs/gestao-de-pessoas.md, dono 2026-07-09)
//   • HE = R$/hora ABSOLUTO por funcionário (não multiplicador): dia útil/sábado/
//     noturno → heNormalRate; domingo/feriado → heSundayHolidayRate (fallback normal).
//   • falta  = salário ÷ dias_úteis_do_mês.
//   • atraso = min × ((salário ÷ dias_úteis) ÷ jornada_diária).
//   • HE só acima de 10min.
// mai/2026: 21 dias úteis (seg–sex, SCHED sem sábado); jornada 9h (540min).
// ════════════════════════════════════════════════════════════════════════════
describe('computePeriodFolha — política canônica de HE/falta/atraso (2026-07-09)', () => {
  const BD = 21;               // dias úteis mai/2026 (seg–sex)
  const base = { schedule: SCHED, holidaysSet: NO_HOL };

  it('HE dia útil = min × R$/h NORMAL (não multiplicador ×1,5)', () => {
    // Seg 08:00–20:00: excedente 120min (2h) sobre 9h. HE normal R$15/h → 2×15 = 30.
    const punches = new Map<string, string[]>([['2026-05-04', ['08:00', '12:00', '13:00', '20:00']]]);
    const r = computePeriodFolha({ salary: 2200, from: '2026-05-04', to: '2026-05-04', ...base, punchesByDate: punches, heNormalRate: 15 });
    expect(r.he_minutes).toBe(120);
    expect(r.he_normal_minutes).toBe(120);
    expect(r.he_holiday_minutes).toBe(0);
    expect(r.he_value).toBeCloseTo(30, 2);           // 2h × 15 (NÃO 2h × valor-hora × 1,5)
    expect(r.gross_value).toBeCloseTo(2200 + 30, 2);
  });

  it('HE domingo = taxa domingo/feriado; sábado = taxa NORMAL', () => {
    // Domingo 03/05 4h @ R$25 = 100. Sábado 02/05 4h @ R$20 (normal) = 80.
    const dom = new Map<string, string[]>([['2026-05-03', ['08:00', '12:00']]]);
    const rd = computePeriodFolha({ salary: 2200, from: '2026-05-03', to: '2026-05-03', ...base, punchesByDate: dom, heNormalRate: 20, heSundayHolidayRate: 25 });
    expect(rd.he_holiday_minutes).toBe(240);
    expect(rd.he_normal_minutes).toBe(0);
    expect(rd.he_value).toBeCloseTo(100, 2);         // 4h × 25

    const sab = new Map<string, string[]>([['2026-05-02', ['08:00', '12:00']]]);
    const rs = computePeriodFolha({ salary: 2200, from: '2026-05-02', to: '2026-05-02', ...base, punchesByDate: sab, heNormalRate: 20, heSundayHolidayRate: 25 });
    expect(rs.he_normal_minutes).toBe(240);          // sábado usa a NORMAL
    expect(rs.he_holiday_minutes).toBe(0);
    expect(rs.he_value).toBeCloseTo(80, 2);          // 4h × 20
  });

  it('HE domingo sem taxa própria cai na HE normal (fallback)', () => {
    const dom = new Map<string, string[]>([['2026-05-03', ['08:00', '12:00']]]);
    const r = computePeriodFolha({ salary: 2200, from: '2026-05-03', to: '2026-05-03', ...base, punchesByDate: dom, heNormalRate: 18 });
    expect(r.he_value).toBeCloseTo(72, 2);           // 4h × 18 (fallback pra HE normal)
  });

  it('FALTA = salário ÷ dias úteis do mês (não ÷30)', () => {
    // Qua 06/05 sem batida → 1 falta. 2100 ÷ 21 = 100.
    const r = computePeriodFolha({ salary: 2100, from: '2026-05-06', to: '2026-05-06', ...base, punchesByDate: new Map() });
    expect(r.falta_days).toBe(1);
    expect(r.falta_desconto).toBeCloseTo(2100 / BD, 2);   // 100
    expect(r.gross_value).toBeCloseTo(2100 - 2100 / BD, 2);
  });

  it('ATRASO = min × ((salário ÷ dias úteis) ÷ jornada)', () => {
    // Seg 08:20 → atraso 20min. (2100/21)/9 = 11,111/h. 20min → 3,70.
    const punches = new Map<string, string[]>([['2026-05-04', ['08:20', '12:00', '13:00', '18:00']]]);
    const r = computePeriodFolha({ salary: 2100, from: '2026-05-04', to: '2026-05-04', ...base, punchesByDate: punches });
    expect(r.atraso_minutes).toBe(20);
    expect(r.atraso_desconto).toBeCloseTo((20 / 60) * ((2100 / BD) / 9), 2);
  });

  it('ATRASO JUSTIFICADO: dia marcado como ausência não desconta o atraso (req.10)', () => {
    const punches = new Map<string, string[]>([['2026-05-04', ['08:40', '12:00', '13:00', '18:00']]]); // atraso 40min
    const sem = computePeriodFolha({ salary: 2100, from: '2026-05-04', to: '2026-05-04', ...base, punchesByDate: punches });
    expect(sem.atraso_minutes).toBe(40);
    const com = computePeriodFolha({ salary: 2100, from: '2026-05-04', to: '2026-05-04', ...base, punchesByDate: punches, absenceDates: new Set(['2026-05-04']) });
    expect(com.atraso_minutes).toBe(0);       // abonado pelo RH
    expect(com.atraso_desconto).toBeCloseTo(0, 2);
  });

  it('E5: sábado de meio-período usa a jornada de SÁBADO (sem falso atraso)', () => {
    // Escala que trabalha sábado 08:00–12:00 (4h). Sábado 02/05/2026 trabalhado 4h.
    const schSat = { ...SCHED, works_saturday: true, saturday_entry: '08:00:00', saturday_exit: '12:00:00' };
    const punches = new Map<string, string[]>([['2026-05-02', ['08:00', '12:00']]]);
    const r = computePeriodFolha({ salary: 2100, from: '2026-05-02', to: '2026-05-02', schedule: schSat, holidaysSet: NO_HOL, punchesByDate: punches });
    expect(r.atraso_minutes).toBe(0);   // 4h trabalhadas == 4h esperadas de sábado (não 9h)
    expect(r.he_minutes).toBe(0);
  });

  it('E1: período que CRUZA meses — falta de fev usa dias úteis de FEVEREIRO (não de jan)', () => {
    // 2026-01-29 (qui) → 2026-02-03 (ter). Dias úteis: 29,30,fev02,fev03 (31 sáb, fev01 dom).
    // Bate ponto em 29/30/fev02; fev03 sem batida = falta em FEVEREIRO.
    const punches = new Map<string, string[]>();
    for (const d of ['2026-01-29', '2026-01-30', '2026-02-02']) punches.set(d, ['08:00', '12:00', '13:00', '18:00']);
    const r = computePeriodFolha({ salary: 2100, from: '2026-01-29', to: '2026-02-03', ...base, punchesByDate: punches });
    const bdFev = businessDaysInMonth('2026-02-01', SCHED, NO_HOL);
    expect(r.falta_dates).toEqual(['2026-02-03']);
    expect(r.falta_desconto).toBeCloseTo(2100 / bdFev, 2);   // divisor de FEV, não do mês de início (jan)
  });

  it('DIARISTA com meia-diária: ≥6h→1, 2–6h→0,5, <2h→0', () => {
    const punches = new Map<string, string[]>([
      ['2026-05-04', ['08:00', '12:00', '13:00', '18:00']], // 9h → 1
      ['2026-05-05', ['08:00', '12:00']],                   // 4h → 0,5
      ['2026-05-06', ['08:00', '09:30']],                   // 1,5h → 0
    ]);
    const r = computePeriodFolha({ salary: 0, from: '2026-05-04', to: '2026-05-06', ...base, punchesByDate: punches, payRegime: 'diarista', dailyRate: 120 });
    expect(r.paid_days).toBe(2);                     // 2 dias com diária (1 + 0,5)
    expect(r.gross_value).toBeCloseTo(120 * 1.5, 2); // 1,5 diárias × 120 = 180
  });
});

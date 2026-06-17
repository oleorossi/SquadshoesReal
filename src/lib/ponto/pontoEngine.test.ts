import { describe, it, expect } from 'vitest';
import {
  buildPontoDays,
  computeFolha,
  computeWeekly,
  type PontoEngineInput,
} from './pontoEngine';
import { computePeriodFolha, type PeriodFolhaInput } from '../salaryPayroll';

// Escala padrão 08–18 com 1h de almoço, seg–sex (esperado = 540 min/dia).
const schedule = {
  entry_time: '08:00', exit_time: '18:00',
  lunch_start: '12:00', lunch_end: '13:00',
  works_sunday: false, works_monday: true, works_tuesday: true,
  works_wednesday: true, works_thursday: true, works_friday: true,
  works_saturday: false,
  tolerance_minutes: 10, minimum_overtime_minutes: 0,
};

// Semana 2026-06-01 (seg) … 2026-06-07 (dom) — mesma semana ISO.
const punchesByDate = new Map<string, string[]>([
  ['2026-06-01', ['08:00', '12:00', '13:00', '18:00']], // normal (540)
  ['2026-06-02', ['08:00', '12:00', '13:00', '19:00']], // +1h após jornada
  // 2026-06-03 → SEM batidas = falta
  ['2026-06-04', ['08:00', '12:00', '13:00', '18:00']], // normal (540)
  ['2026-06-05', ['08:00', '17:00']],                   // 2 batidas, déficit (almoço inferido)
  ['2026-06-06', ['08:00', '12:00']],                   // sábado trabalhado (não-útil)
  ['2026-06-07', ['08:00']],                            // batida ÍMPAR → irregular/pendente
]);

const base: PontoEngineInput = {
  from: '2026-06-01', to: '2026-06-07',
  schedule, holidaysSet: new Set<string>(), punchesByDate,
};

const folhaInput: PeriodFolhaInput = {
  salary: 2200,
  from: '2026-06-01', to: '2026-06-07',
  schedule, holidaysSet: new Set<string>(), punchesByDate,
  advancesTotal: 0,
};

describe('pontoEngine — base canônica por-dia', () => {
  const days = buildPontoDays(base);

  it('classifica o status de cada dia corretamente', () => {
    const byDate = Object.fromEntries(days.map(d => [d.date, d.status]));
    expect(byDate['2026-06-01']).toBe('normal');
    expect(byDate['2026-06-03']).toBe('absent');   // dia útil sem trabalho = falta
    expect(byDate['2026-06-06']).toBe('weekend');  // sábado trabalhado
    expect(byDate['2026-06-07']).toBe('irregular'); // batida ímpar = pendente
  });

  it('esperado = 540 nos dias úteis e 0 nos não-úteis', () => {
    expect(days.find(d => d.date === '2026-06-01')!.expectedMinutes).toBe(540);
    expect(days.find(d => d.date === '2026-06-06')!.expectedMinutes).toBe(0); // sábado
    expect(days.find(d => d.date === '2026-06-07')!.expectedMinutes).toBe(0); // domingo
  });

  it('dia pendente (ímpar) não soma horas trabalhadas', () => {
    expect(days.find(d => d.date === '2026-06-07')!.workedMinutes).toBe(0);
  });
});

describe('pontoEngine — PARIDADE base ↔ folha (pagamento)', () => {
  const days = buildPontoDays(base);
  const folha = computeFolha(folhaInput);

  it('computeFolha é idêntico a computePeriodFolha (zero mudança de folha)', () => {
    expect(folha).toEqual(computePeriodFolha(folhaInput));
  });

  it('Σ workedMinutes da base === folha.worked_minutes', () => {
    const sumWorked = days.reduce((s, d) => s + d.workedMinutes, 0);
    expect(sumWorked).toBe(folha.worked_minutes);
  });

  it('Σ expectedMinutes (dias úteis) da base === folha.expected_minutes', () => {
    const sumExpected = days.filter(d => d.isWorkday).reduce((s, d) => s + d.expectedMinutes, 0);
    expect(sumExpected).toBe(folha.expected_minutes);
  });

  it('contagem de faltas e pendências bate com a folha', () => {
    expect(days.filter(d => d.status === 'absent').length).toBe(folha.falta_days);
    expect(days.filter(d => d.status === 'irregular').length).toBe(folha.pending_days);
  });
});

describe('pontoEngine — PARIDADE base ↔ semanal (banco/espelho)', () => {
  const days = buildPontoDays(base);
  const weekly = computeWeekly(base, schedule);
  const folha = computeFolha(folhaInput);

  it('totalWorked/totalExpected do semanal === mesma base (e === folha)', () => {
    const sumWorked = days.reduce((s, d) => s + d.workedMinutes, 0);
    const sumExpected = days.filter(d => d.isWorkday).reduce((s, d) => s + d.expectedMinutes, 0);
    expect(weekly.totalWorkedMinutes).toBe(sumWorked);
    expect(weekly.totalExpectedMinutes).toBe(sumExpected);
    // Reconcilia com a folha → relatórios se COMPLEMENTAM (mesma base).
    expect(weekly.totalWorkedMinutes).toBe(folha.worked_minutes);
    expect(weekly.totalExpectedMinutes).toBe(folha.expected_minutes);
  });

  it('falta e feriado-trabalhado contabilizados na visão semanal', () => {
    expect(weekly.totalAbsences).toBe(1);        // 2026-06-03
    expect(weekly.totalIncomplete).toBe(1);      // 2026-06-07 (irregular)
  });
});

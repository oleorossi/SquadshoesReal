import { describe, it, expect, beforeAll } from 'vitest';
import {
  computeParallelWindows,
  computeForwardSchedule,
  setHolidayCache,
  businessDaysBetween,
  type SectorKey,
} from '@/lib/sectorCapacity';

/**
 * Guarda do motor de cascata (D4). O lead time + a topologia (prep paralelo
 * Corte Palmilha ‖ Corte Forração ‖ Aviamento ‖ Costura → convergem em Silk →
 * sequencial até Acabamento) vivem em UM lugar (leadTime.ts + sectorCapacity.ts)
 * e são consumidos pela cascata REVERSA (computeParallelWindows, espelho do SQL
 * compute_wave_timeline) e pela DIRETA (computeForwardSchedule). Este teste trava
 * o contrato entre elas: se alguém mexer no motor e quebrar a simetria
 * forward×backward, o teste pega.
 *
 * (A paridade TS×SQL completa exige rodar compute_wave_timeline no banco —
 *  coberta por integração com RUN_DB_INTEGRATION; aqui travamos o lado TS.)
 */

// Sem feriados → dias úteis = só pula fim de semana (determinístico).
beforeAll(() => setHolidayCache([]));

// Ficha representativa COM todos os setores prep+sequenciais (sem Expedição, pra
// o round-trip fechar exatamente no deadline = fim do Acabamento).
const sheet = {
  production_sectors: [
    'Corte Palmilha', 'Corte Forração', 'Costura', 'Aviamento',
    'Silk', 'Colagem', 'Montagem', 'Solagem', 'Acabamento',
  ],
  sewing_capacity_per_day: 100,    // Corte Palmilha
  cutting_capacity_per_day: 120,   // Corte Forração
  costura_capacity_per_day: 150,
  mesa_daily_capacity: 90,         // Aviamento (prep mais lento)
  silk_capacity_per_day: 300,
  gluing_capacity_per_day: 200,
  assembly_capacity_per_day: 110,
  soling_capacity_per_day: 130,
  finishing_capacity_per_day: 140,
  requires_sewing: true,
  requires_cutting: true,
};

const QTY = 600;

function minDate(...ds: Date[]): Date {
  return ds.reduce((m, d) => (d.getTime() < m.getTime() ? d : m));
}

describe('motor de cascata — forward × backward (D4)', () => {
  it('round-trip: início mais cedo da cascata reversa, indo pra frente, volta ao deadline', () => {
    const deadline = new Date('2026-09-30T00:00:00');
    const back = computeParallelWindows(sheet, QTY, deadline);

    // Início do job = prep que começa mais cedo (o de maior lead). Costura
    // agora também é prep paralela, então entra no min.
    const earliestStart = minDate(
      back.corte_palmilha.start,
      back.corte_forracao.start,
      back.mesa.start,
      back.costura.start,
    );

    const fwd = computeForwardSchedule(sheet, QTY, earliestStart);
    // A entrega projetada pela cascata direta tem que bater com o deadline original.
    expect(fwd.finishISO).toBe('2026-09-30');
  });

  it('forward: os 3 prep começam JUNTOS na data de início', () => {
    const start = new Date('2026-07-01T00:00:00');
    const fwd = computeForwardSchedule(sheet, QTY, start);
    const prep = fwd.steps.filter((s) => ['corte_palmilha', 'corte_forracao', 'mesa'].includes(s.key));
    expect(prep.length).toBe(3);
    for (const p of prep) expect(p.startISO).toBe('2026-07-01');
  });

  it('forward: Costura roda em PARALELO com a prep; Silk começa na convergência', () => {
    const start = new Date('2026-07-01T00:00:00');
    const fwd = computeForwardSchedule(sheet, QTY, start);
    // Costura é prep — começa JUNTO com os cortes/aviamento.
    const costura = fwd.steps.find((s) => s.key === 'costura')!;
    expect(costura.startISO).toBe('2026-07-01');
    // A cadeia sequencial (Silk) só começa quando o ÚLTIMO prep termina.
    const prepEnds = fwd.steps.filter((s) => ['corte_palmilha', 'corte_forracao', 'mesa', 'costura'].includes(s.key)).map((s) => s.endISO);
    const silk = fwd.steps.find((s) => s.key === 'silk')!;
    const maxPrepEnd = prepEnds.sort().at(-1)!;
    expect(silk.startISO).toBe(maxPrepEnd);
  });

  it('forward: setup em setor SEQUENCIAL soma exatamente ao total', () => {
    const start = new Date('2026-07-06T00:00:00'); // segunda
    const base = computeForwardSchedule(sheet, QTY, start);
    const withSetup = computeForwardSchedule(sheet, QTY, start, { montagem: 2 } as Partial<Record<SectorKey, number>>);
    // montagem é sequencial → +2 dias úteis exatos no total.
    expect(withSetup.totalBusinessDays).toBe(base.totalBusinessDays + 2);
  });

  it('forward: setup no GARGALO do prep (mesa) adia a convergência', () => {
    const start = new Date('2026-07-06T00:00:00');
    const base = computeForwardSchedule(sheet, QTY, start);
    // mesa é o gargalo do prep (lead 7); +3 de setup empurra a convergência e o total.
    const withSetup = computeForwardSchedule(sheet, QTY, start, { mesa: 3 } as Partial<Record<SectorKey, number>>);
    expect(withSetup.totalBusinessDays).toBe(base.totalBusinessDays + 3);
    // já um setup em setor prep NÃO-gargalo (costura lead 4) é no-op no total.
    const noop = computeForwardSchedule(sheet, QTY, start, { costura: 2 } as Partial<Record<SectorKey, number>>);
    expect(noop.totalBusinessDays).toBe(base.totalBusinessDays);
  });

  it('backward: os 4 prep TERMINAM juntos no início da cadeia sequencial (Silk)', () => {
    const deadline = new Date('2026-09-30T00:00:00');
    const back = computeParallelWindows(sheet, QTY, deadline);
    const conv = back.silk.start.getTime();
    expect(back.corte_palmilha.end.getTime()).toBe(conv);
    expect(back.corte_forracao.end.getTime()).toBe(conv);
    expect(back.mesa.end.getTime()).toBe(conv);
    expect(back.costura.end.getTime()).toBe(conv);
  });

  it('backward: Acabamento termina no deadline', () => {
    const deadline = new Date('2026-09-30T00:00:00');
    const back = computeParallelWindows(sheet, QTY, deadline);
    expect(back.acabamento.end.getTime()).toBe(deadline.getTime());
  });

  it('totalBusinessDays é coerente com início→fim', () => {
    const start = new Date('2026-07-06T00:00:00'); // segunda
    const fwd = computeForwardSchedule(sheet, QTY, start);
    expect(fwd.totalBusinessDays).toBe(businessDaysBetween(start, new Date(fwd.finishISO + 'T00:00:00')));
    expect(fwd.totalBusinessDays).toBeGreaterThan(0);
  });
});

// Asserts DIRETOS da fórmula MAX(prep) + Σ(seq) — o round-trip sozinho não pega
// um erro simétrico (se forward E backward somassem o prep, ambos casariam).
describe('motor de cascata — fórmula MAX(prep) + Σ(seq) (auditoria 2026-06-29)', () => {
  const PREP = ['corte_palmilha', 'corte_forracao', 'mesa', 'costura'];
  const SEQ = ['silk', 'colagem', 'montagem', 'solagem', 'acabamento'];

  it('lead total da onda = MAX(leads prep) + soma(leads sequenciais)', () => {
    const start = new Date('2026-07-06T00:00:00'); // segunda
    const fwd = computeForwardSchedule(sheet, QTY, start);
    const prepLeads = fwd.steps.filter((s) => PREP.includes(s.key)).map((s) => s.leadDays);
    const seqLeads = fwd.steps.filter((s) => SEQ.includes(s.key)).map((s) => s.leadDays);

    // QTY=600 / capacidades da ficha:
    //   palmilha=ceil(600/100)=6, forração=ceil(600/120)=5, aviamento=ceil(600/90)=7,
    //   costura=ceil(600/150)=4 → MAX prep = 7 (aviamento é o gargalo).
    //   silk=2, colagem=3, montagem=6, solagem=5, acabamento=5 → Σ seq = 21.
    expect(Math.max(...prepLeads)).toBe(7);
    expect(seqLeads.reduce((a, b) => a + b, 0)).toBe(21);

    const expectedTotal = Math.max(...prepLeads) + seqLeads.reduce((a, b) => a + b, 0);
    expect(expectedTotal).toBe(28);
    expect(fwd.totalBusinessDays).toBe(expectedTotal); // NÃO é a soma de todos (34)
  });

  it('setores ausentes na ficha não entram na cascata (lead 0)', () => {
    // Ficha de palmilha pronta: sem Costura nem Silk.
    const semCosturaSilk = {
      ...sheet,
      production_sectors: ['Corte Palmilha', 'Corte Forração', 'Aviamento', 'Colagem', 'Montagem', 'Solagem', 'Acabamento'],
    };
    const fwd = computeForwardSchedule(semCosturaSilk, QTY, new Date('2026-07-06T00:00:00'));
    expect(fwd.steps.find((s) => s.key === 'costura')).toBeUndefined();
    expect(fwd.steps.find((s) => s.key === 'silk')).toBeUndefined();
    // MAX prep agora = max(palmilha6, forração5, aviamento7) = 7; Σ seq = colagem3+montagem6+solagem5+acab5 = 19.
    expect(fwd.totalBusinessDays).toBe(7 + 19);
  });

  it('B4: Expedição nunca entra no lead da cascata forward (é via pickup)', () => {
    const comExpedicao = {
      ...sheet,
      production_sectors: [...sheet.production_sectors, 'Expedição'],
      expedition_capacity_per_day: 500,
    };
    const fwd = computeForwardSchedule(comExpedicao, QTY, new Date('2026-07-06T00:00:00'));
    expect(fwd.steps.find((s) => s.key === 'expedicao')).toBeUndefined();
    // Total inalterado vs. ficha sem Expedição (mesma cascata, termina no Acabamento).
    const base = computeForwardSchedule(sheet, QTY, new Date('2026-07-06T00:00:00'));
    expect(fwd.totalBusinessDays).toBe(base.totalBusinessDays);
  });
});

import { describe, it, expect, beforeAll } from 'vitest';
import {
  computeParallelWindows,
  computeForwardSchedule,
  setHolidayCache,
  businessDaysBetween,
  type SectorKey,
} from '@/lib/sectorCapacity';

/**
 * Guarda do motor de cascata (D4). O lead time + a topologia vivem em UM lugar
 * (leadTime.ts + sectorCapacity.ts) e são consumidos pela cascata REVERSA
 * (computeParallelWindows, espelho do SQL compute_wave_timeline) e pela DIRETA
 * (computeForwardSchedule). Este teste trava o contrato entre elas: se alguém
 * mexer no motor e quebrar a simetria forward×backward, o teste pega.
 *
 * TOPOLOGIA (fluxo do dono, 2026-10-01):
 *   bloco 1: Corte Palmilha ‖ Corte Forração
 *   bloco 2: Costura Palmilha ‖ Costura Cabedal ‖ Aviamento  (após o bloco 1)
 *   → convergem em Silk → sequencial até Acabamento
 * Antes os 4 (2 cortes + aviamento + costura) começavam JUNTOS, o que
 * adiantava a costura pra antes do corte existir.
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
    'Corte Palmilha', 'Corte Forração', 'Costura Palmilha', 'Costura Cabedal',
    'Aviamento', 'Silk', 'Colagem', 'Montagem', 'Solagem', 'Acabamento',
  ],
  sewing_capacity_per_day: 100,    // Corte Palmilha
  cutting_capacity_per_day: 120,   // Corte Forração
  costura_palmilha_capacity_per_day: 150,
  costura_cabedal_capacity_per_day: 160,
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

/** Espelho matemático dos nove agregadores SQL de compute_wave_timeline. */
function aggregateSectorLeadDays(
  items: Array<{ quantity: number; capacityPerDay?: number | null; legacyLeadDays?: number | null }>,
  fallback: number,
): number {
  let fractionalLoad: number | null = null;
  let maxLegacyLead: number | null = null;

  for (const item of items) {
    const capacity = Number(item.capacityPerDay) || 0;
    if (capacity > 0) {
      fractionalLoad = (fractionalLoad ?? 0) + item.quantity / capacity;
      continue;
    }

    const legacyLead = Number(item.legacyLeadDays) || 0;
    if (legacyLead > 0) {
      maxLegacyLead = Math.max(maxLegacyLead ?? legacyLead, legacyLead);
    }
  }

  // PostgreSQL usa numeric; remove só o ruído binário de somar frações em JS.
  const roundedCapacityDays = fractionalLoad === null
    ? null
    : Math.ceil(fractionalLoad - Number.EPSILON * Math.max(1, fractionalLoad));
  const candidates = [
    roundedCapacityDays,
    maxLegacyLead,
  ].filter((value): value is number => value !== null);

  return candidates.length > 0 ? Math.max(...candidates) : fallback;
}

describe('motor de cascata — forward × backward (D4)', () => {
  it('onda: 10 itens de 100 pares a 100 pares/dia exigem 10 dias', () => {
    expect(aggregateSectorLeadDays(
      Array.from({ length: 10 }, () => ({ quantity: 100, capacityPerDay: 100 })),
      1,
    )).toBe(10);
  });

  it('onda: 20 itens de 5 pares a 100 pares/dia exigem 1 dia, não 20', () => {
    expect(aggregateSectorLeadDays(
      Array.from({ length: 20 }, () => ({ quantity: 5, capacityPerDay: 100 })),
      1,
    )).toBe(1);
  });

  it('onda sem capacidade usa o maior lead legado do setor, não a soma', () => {
    expect(aggregateSectorLeadDays([
      { quantity: 100, legacyLeadDays: 2 },
      { quantity: 100, legacyLeadDays: 5 },
      { quantity: 100, legacyLeadDays: 3 },
    ], 1)).toBe(5);
  });

  it('round-trip: início mais cedo da cascata reversa, indo pra frente, volta ao deadline', () => {
    const deadline = new Date('2026-09-30T00:00:00');
    const back = computeParallelWindows(sheet, QTY, deadline);

    // Início do job = o CORTE que começa mais cedo — os cortes abrem o fluxo.
    const earliestStart = minDate(
      back.corte_palmilha.start,
      back.corte_forracao.start,
    );

    const fwd = computeForwardSchedule(sheet, QTY, earliestStart);
    // A entrega projetada pela cascata direta tem que bater com o deadline original.
    expect(fwd.finishISO).toBe('2026-09-30');
  });

  it('forward: os 2 CORTES começam JUNTOS na data de início', () => {
    const start = new Date('2026-07-01T00:00:00');
    const fwd = computeForwardSchedule(sheet, QTY, start);
    const cortes = fwd.steps.filter((s) => ['corte_palmilha', 'corte_forracao'].includes(s.key));
    expect(cortes.length).toBe(2);
    for (const c of cortes) expect(c.startISO).toBe('2026-07-01');
  });

  it('forward: costuras ‖ aviamento começam quando o ÚLTIMO corte fecha', () => {
    const start = new Date('2026-07-01T00:00:00');
    const fwd = computeForwardSchedule(sheet, QTY, start);
    const fimDosCortes = fwd.steps
      .filter((s) => ['corte_palmilha', 'corte_forracao'].includes(s.key))
      .map((s) => s.endISO).sort().at(-1)!;
    // Bloco 2 inteiro arranca junto, no fim dos cortes — e NÃO antes.
    for (const k of ['costura_palmilha', 'costura_cabedal', 'mesa']) {
      const step = fwd.steps.find((s) => s.key === k)!;
      expect(step.startISO).toBe(fimDosCortes);
    }
    // A cadeia sequencial (Silk) só começa quando o bloco 2 inteiro termina.
    const fimBloco2 = fwd.steps
      .filter((s) => ['costura_palmilha', 'costura_cabedal', 'mesa'].includes(s.key))
      .map((s) => s.endISO).sort().at(-1)!;
    const silk = fwd.steps.find((s) => s.key === 'silk')!;
    expect(silk.startISO).toBe(fimBloco2);
  });

  it('forward: setup days (B3) adiam a entrega', () => {
    const start = new Date('2026-07-01T00:00:00');
    const base = computeForwardSchedule(sheet, QTY, start);
    const withSetup = computeForwardSchedule(sheet, QTY, start, { montagem: 2, costura_palmilha: 1 } as Partial<Record<SectorKey, number>>);
    expect(new Date(withSetup.finishISO).getTime()).toBeGreaterThan(new Date(base.finishISO).getTime());
  });

  it('backward: costuras ‖ aviamento terminam no Silk; os cortes, quando eles começam', () => {
    const deadline = new Date('2026-09-30T00:00:00');
    const back = computeParallelWindows(sheet, QTY, deadline);
    const conv = back.silk.start.getTime();
    // Bloco 2 encosta na cadeia sequencial
    expect(back.costura_palmilha.end.getTime()).toBe(conv);
    expect(back.costura_cabedal.end.getTime()).toBe(conv);
    expect(back.mesa.end.getTime()).toBe(conv);
    // Bloco 1 (cortes) fecha quando o bloco 2 arranca — nunca depois
    const bloco2Start = Math.min(
      back.costura_palmilha.start.getTime(),
      back.costura_cabedal.start.getTime(),
      back.mesa.start.getTime(),
    );
    expect(back.corte_palmilha.end.getTime()).toBe(bloco2Start);
    expect(back.corte_forracao.end.getTime()).toBe(bloco2Start);
    expect(back.corte_palmilha.end.getTime()).toBeLessThanOrEqual(conv);
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

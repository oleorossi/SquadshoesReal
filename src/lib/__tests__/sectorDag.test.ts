import { describe, it, expect } from 'vitest';
import { transitivePredecessors, isPredecessorOf } from '@/lib/sectorDag';

/**
 * Trava o DAG de setores do frontend (usado pelo kanban pra decidir o que
 * concluir ao arrastar). DEVE espelhar o DAG do servidor (guard + advance).
 */
describe('sectorDag — predecessores do DAG real', () => {
  it('os 4 setores prep não têm predecessor (Costura é prep paralela)', () => {
    for (const prep of ['Corte Palmilha', 'Corte Forração', 'Aviamento', 'Costura']) {
      expect(transitivePredecessors(prep).size).toBe(0);
    }
  });

  it('Costura NÃO depende de Corte Forração nem Aviamento (M1 — paralela)', () => {
    expect(isPredecessorOf('Corte Forração', 'Costura')).toBe(false);
    expect(isPredecessorOf('Aviamento', 'Costura')).toBe(false);
  });

  it('Silk gateia em todo o prep (1º setor sequencial)', () => {
    const preds = transitivePredecessors('Silk');
    for (const prep of ['Corte Palmilha', 'Corte Forração', 'Aviamento', 'Costura']) {
      expect(preds.has(prep)).toBe(true);
    }
  });

  it('Colagem depende transitivamente de todo o prep + Silk', () => {
    const preds = transitivePredecessors('Colagem');
    for (const s of ['Silk', 'Corte Palmilha', 'Corte Forração', 'Aviamento', 'Costura']) {
      expect(preds.has(s)).toBe(true);
    }
  });

  it('Acabamento depende da cadeia sequencial inteira', () => {
    const preds = transitivePredecessors('Acabamento');
    for (const s of ['Solagem', 'Montagem', 'Colagem', 'Silk']) {
      expect(preds.has(s)).toBe(true);
    }
  });

  it('arrastar p/ Costura não conclui os cortes (regressão M3)', () => {
    const preds = transitivePredecessors('Costura');
    expect(preds.has('Corte Palmilha')).toBe(false);
    expect(preds.has('Corte Forração')).toBe(false);
    expect(preds.has('Aviamento')).toBe(false);
  });
});

/**
 * Paridade SQL↔TS do DAG (M7 — auditoria 2026-06-29). Encoda os ARRAYS DIRETOS
 * do guard SQL (fn_guard_manual_stage_transition na migration
 * 20260831120000) e verifica que o FECHO TRANSITIVO bate com o sectorDag.ts.
 * Se alguém mexer num lado sem o outro, este teste pega a divergência (antes
 * guard/stamp e advance/frontend usavam topologias diferentes).
 *
 * ⚠ Manter em sincronia com os CASE do guard e do tg_stamp na migration.
 */
const GUARD_DIRECT: Record<string, string[]> = {
  'Corte Palmilha': [],
  'Corte Forração': [],
  'Aviamento': [],
  'Mesa': [],
  'Costura': [],
  'Silk': ['Corte Palmilha', 'Corte Forração', 'Aviamento', 'Mesa', 'Costura'],
  'Colagem': ['Silk', 'Corte Palmilha', 'Corte Forração', 'Aviamento', 'Mesa', 'Costura'],
  'Montagem': ['Colagem'],
  'Solagem': ['Montagem'],
  'Acabamento': ['Solagem'],
  'Expedição': ['Acabamento'],
};

function closureFrom(map: Record<string, string[]>, stage: string): Set<string> {
  const out = new Set<string>();
  const visit = (s: string) => {
    for (const p of map[s] ?? []) if (!out.has(p)) { out.add(p); visit(p); }
  };
  visit(stage);
  return out;
}

describe('sectorDag — paridade com o DAG do guard SQL (M7)', () => {
  it('fecho transitivo do guard SQL == sectorDag.ts pra todos os setores', () => {
    for (const stage of Object.keys(GUARD_DIRECT)) {
      const fromGuard = [...closureFrom(GUARD_DIRECT, stage)].sort();
      const fromTs = [...transitivePredecessors(stage)].sort();
      expect(fromTs, `divergência no setor ${stage}`).toEqual(fromGuard);
    }
  });
});

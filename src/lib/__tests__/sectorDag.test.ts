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

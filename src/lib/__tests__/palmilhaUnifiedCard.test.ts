import { describe, expect, it } from 'vitest';
import {
  canMergePalmilhaCards,
  cardKindMatchesMode,
  classifyPalmilhaCardKind,
  effectiveCardKindForMode,
  isPalmilhaFibraStage,
  isPalmilhaForracaoStage,
  palmilhaCardKey,
  palmilhaCardTitle,
  palmilhaMaçoTitle,
  toggleExclusivePalmilhaSector,
} from '@/lib/palmilhaUnifiedCard';

describe('classifyPalmilhaCardKind', () => {
  it('completo quando precisa dos dois', () => {
    expect(classifyPalmilhaCardKind({ needsFibra: true, needsForracao: true })).toBe('completo');
  });
  it('parcial fibra / forração', () => {
    expect(classifyPalmilhaCardKind({ needsFibra: true, needsForracao: false })).toBe('so_fibra');
    expect(classifyPalmilhaCardKind({ needsFibra: false, needsForracao: true })).toBe('so_forracao');
  });
  it('null quando nenhum lado se aplica', () => {
    expect(classifyPalmilhaCardKind({ needsFibra: false, needsForracao: false })).toBeNull();
  });
});

describe('palmilha titles', () => {
  it('card title só nos parciais', () => {
    expect(palmilhaCardTitle('completo')).toBeNull();
    expect(palmilhaCardTitle('so_fibra')).toBe('Só Fibra');
    expect(palmilhaCardTitle('so_forracao')).toBe('Só Forração');
  });
  it('maço header dinâmico', () => {
    expect(palmilhaMaçoTitle('palmilha')).toBe('PALMILHA');
    expect(palmilhaMaçoTitle('so_fibra')).toBe('PALMILHA · SÓ FIBRA');
    expect(palmilhaMaçoTitle('so_forracao')).toBe('PALMILHA · SÓ FORRAÇÃO');
  });
});

describe('Soft ≠ Madrid não funde (Q16)', () => {
  const base = { soleName: 'INFANTIL', color: 'OFF WHITE', plateGroup: 'PLACA EVA 10MM' };
  it('mesma cor + napas diferentes → keys distintas', () => {
    const soft = palmilhaCardKey({ ...base, liningGroup: 'NAPA SOFT' });
    const madrid = palmilhaCardKey({ ...base, liningGroup: 'NAPA MADRID' });
    expect(soft).not.toBe(madrid);
    expect(canMergePalmilhaCards(
      { ...base, liningGroup: 'NAPA SOFT' },
      { ...base, liningGroup: 'NAPA MADRID' },
    )).toBe(false);
  });
  it('mesma cor + mesma napa + mesma placa → funde (refs agregam)', () => {
    expect(canMergePalmilhaCards(
      { ...base, liningGroup: 'NAPA SOFT' },
      { ...base, liningGroup: 'NAPA SOFT' },
    )).toBe(true);
  });
  it('placa diferente não funde', () => {
    expect(canMergePalmilhaCards(
      { ...base, liningGroup: 'NAPA SOFT', plateGroup: 'PLACA EVA 10MM' },
      { ...base, liningGroup: 'NAPA SOFT', plateGroup: 'PLACA EVA 8MM' },
    )).toBe(false);
  });
});

describe('modos de impressão', () => {
  it('modo palmilha aceita todos os kinds', () => {
    expect(cardKindMatchesMode('completo', 'palmilha')).toBe(true);
    expect(cardKindMatchesMode('so_fibra', 'palmilha')).toBe(true);
    expect(cardKindMatchesMode('so_forracao', 'palmilha')).toBe(true);
  });
  it('só fibra rebaixa completo e exclui só forração', () => {
    expect(cardKindMatchesMode('so_forracao', 'so_fibra')).toBe(false);
    expect(effectiveCardKindForMode('completo', 'so_fibra')).toBe('so_fibra');
  });
  it('só forração rebaixa completo e exclui só fibra', () => {
    expect(cardKindMatchesMode('so_fibra', 'so_forracao')).toBe(false);
    expect(effectiveCardKindForMode('completo', 'so_forracao')).toBe('so_forracao');
  });
});

describe('toggleExclusivePalmilhaSector (Q19)', () => {
  it('marcar Palmilha remove Só Fibra / Só Forração', () => {
    const active = new Set(['Só Fibra', 'Corte Cabedal']);
    const next = toggleExclusivePalmilhaSector(active, 'Palmilha');
    expect(next.has('Palmilha')).toBe(true);
    expect(next.has('Só Fibra')).toBe(false);
    expect(next.has('Corte Cabedal')).toBe(true);
  });
  it('trocar Palmilha → Só Forração', () => {
    const next = toggleExclusivePalmilhaSector(new Set(['Palmilha', 'Silk']), 'Só Forração');
    expect([...next].sort()).toEqual(['Silk', 'Só Forração'].sort());
  });
  it('desmarcar o modo ativo limpa só ele', () => {
    const next = toggleExclusivePalmilhaSector(new Set(['Palmilha', 'Silk']), 'Palmilha');
    expect(next.has('Palmilha')).toBe(false);
    expect(next.has('Silk')).toBe(true);
  });
});

describe('aliases de etapa', () => {
  it('reconhece grafias novas e legadas de fibra', () => {
    expect(isPalmilhaFibraStage('Palmilha · Fibra')).toBe(true);
    expect(isPalmilhaFibraStage('Corte Fibra')).toBe(true);
    expect(isPalmilhaFibraStage('Corte Palmilha')).toBe(true);
  });
  it('reconhece grafias novas e legadas de forração', () => {
    expect(isPalmilhaForracaoStage('Palmilha · Forração')).toBe(true);
    expect(isPalmilhaForracaoStage('Corte Forração')).toBe(true);
  });
});

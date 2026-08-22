import { describe, it, expect } from 'vitest';
import {
  canonicalStageOrder,
  formatOpNumber,
  CANONICAL_STAGE_ORDER,
} from '../stageOrder';

describe('canonicalStageOrder', () => {
  it('returns canonical numbers for known sectors', () => {
    expect(canonicalStageOrder('Corte Fibra')).toBe(1);
    expect(canonicalStageOrder('Corte Palmilha')).toBe(1);
    expect(canonicalStageOrder('Corte Forração')).toBe(2);
    expect(canonicalStageOrder('Costura Palmilha')).toBe(3);
    expect(canonicalStageOrder('Costura')).toBe(3);
    expect(canonicalStageOrder('Costura Cabedal')).toBe(4);
    expect(canonicalStageOrder('Aviamento')).toBe(5);
    expect(canonicalStageOrder('Silk')).toBe(6);
    expect(canonicalStageOrder('Colagem')).toBe(7);
    expect(canonicalStageOrder('Montagem')).toBe(8);
    expect(canonicalStageOrder('Solagem')).toBe(9);
    expect(canonicalStageOrder('Acabamento')).toBe(10);
    expect(canonicalStageOrder('Expedição')).toBe(11);
  });

  it('handles aliases (Mesa = Aviamento, Corte Cabedal/Forracao)', () => {
    expect(canonicalStageOrder('Mesa')).toBe(5);
    expect(canonicalStageOrder('Corte Cabedal')).toBe(2);
    expect(canonicalStageOrder('Corte Forracao')).toBe(2);
    expect(canonicalStageOrder('Expedicao')).toBe(11);
  });

  it('returns 99 (sentinel) for unknown sectors', () => {
    expect(canonicalStageOrder('Inexistente')).toBe(99);
    expect(canonicalStageOrder('')).toBe(99);
  });
});

describe('formatOpNumber', () => {
  it('zero-pads single digits', () => {
    expect(formatOpNumber('Corte Fibra')).toBe('01');
    expect(formatOpNumber('Aviamento')).toBe('05');
  });

  it('does NOT pad double digits', () => {
    expect(formatOpNumber('Acabamento')).toBe('10');
    expect(formatOpNumber('Expedição')).toBe('11');
  });

  it('returns em-dash for unknown sectors', () => {
    expect(formatOpNumber('Inexistente')).toBe('—');
  });

  it('matches SQL canonical_stage_order (mig 20270101005300)', () => {
    expect(CANONICAL_STAGE_ORDER['Corte Fibra']).toBe(1);
    expect(CANONICAL_STAGE_ORDER['Corte Palmilha']).toBe(1);
    expect(CANONICAL_STAGE_ORDER['Costura Palmilha']).toBe(3);
    expect(CANONICAL_STAGE_ORDER['Costura Cabedal']).toBe(4);
    expect(CANONICAL_STAGE_ORDER['Aviamento']).toBe(5);
    expect(CANONICAL_STAGE_ORDER['Expedição']).toBe(11);
  });
});

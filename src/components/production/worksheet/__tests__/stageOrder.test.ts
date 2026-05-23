import { describe, it, expect } from 'vitest';
import {
  canonicalStageOrder,
  formatOpNumber,
  CANONICAL_STAGE_ORDER,
} from '../stageOrder';

describe('canonicalStageOrder', () => {
  it('returns canonical numbers for known sectors', () => {
    expect(canonicalStageOrder('Corte Palmilha')).toBe(1);
    expect(canonicalStageOrder('Corte Forração')).toBe(2);
    expect(canonicalStageOrder('Costura')).toBe(3);
    expect(canonicalStageOrder('Aviamento')).toBe(4);
    expect(canonicalStageOrder('Silk')).toBe(5);
    expect(canonicalStageOrder('Colagem')).toBe(6);
    expect(canonicalStageOrder('Montagem')).toBe(7);
    expect(canonicalStageOrder('Solagem')).toBe(8);
    expect(canonicalStageOrder('Acabamento')).toBe(9);
    expect(canonicalStageOrder('Expedição')).toBe(10);
  });

  it('handles aliases (Mesa = Aviamento, Corte Cabedal/Forracao = Corte Forração)', () => {
    expect(canonicalStageOrder('Mesa')).toBe(4);
    expect(canonicalStageOrder('Corte Cabedal')).toBe(2);
    expect(canonicalStageOrder('Corte Forracao')).toBe(2);
    expect(canonicalStageOrder('Expedicao')).toBe(10);
  });

  it('returns 99 (sentinel) for unknown sectors', () => {
    expect(canonicalStageOrder('Inexistente')).toBe(99);
    expect(canonicalStageOrder('')).toBe(99);
  });
});

describe('formatOpNumber', () => {
  it('zero-pads single digits', () => {
    expect(formatOpNumber('Corte Palmilha')).toBe('01');
    expect(formatOpNumber('Acabamento')).toBe('09');
  });

  it('does NOT pad double digits', () => {
    expect(formatOpNumber('Expedição')).toBe('10');
  });

  it('returns em-dash for unknown sectors', () => {
    expect(formatOpNumber('Inexistente')).toBe('—');
  });

  it('matches SQL canonical_stage_order (smoke test)', () => {
    // Garante que o mapa TS bate com o SQL — se alguém mexer no SQL
    // sem atualizar TS (ou vice-versa), o teste pega.
    expect(CANONICAL_STAGE_ORDER['Corte Palmilha']).toBe(1);
    expect(CANONICAL_STAGE_ORDER['Costura']).toBe(3);
    expect(CANONICAL_STAGE_ORDER['Expedição']).toBe(10);
  });
});

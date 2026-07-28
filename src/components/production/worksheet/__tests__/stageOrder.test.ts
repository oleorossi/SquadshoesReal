import { describe, it, expect } from 'vitest';
import {
  canonicalStageOrder,
  formatOpNumber,
  CANONICAL_STAGE_ORDER,
} from '../stageOrder';

describe('canonicalStageOrder', () => {
  it('returns canonical numbers for known sectors (11 etapas, mig 20261001120000)', () => {
    expect(canonicalStageOrder('Corte Palmilha')).toBe(1);
    expect(canonicalStageOrder('Corte Forração')).toBe(2);
    expect(canonicalStageOrder('Costura Palmilha')).toBe(3);
    expect(canonicalStageOrder('Costura Cabedal')).toBe(4);
    expect(canonicalStageOrder('Aviamento')).toBe(5);
    expect(canonicalStageOrder('Silk')).toBe(6);
    expect(canonicalStageOrder('Colagem')).toBe(7);
    expect(canonicalStageOrder('Montagem')).toBe(8);
    expect(canonicalStageOrder('Solagem')).toBe(9);
    expect(canonicalStageOrder('Acabamento')).toBe(10);
    expect(canonicalStageOrder('Expedição')).toBe(11);
  });

  it('handles aliases (Mesa = Aviamento, Costura legado = Costura Palmilha, Corte Cabedal/Forracao = 2)', () => {
    expect(canonicalStageOrder('Mesa')).toBe(5);
    expect(canonicalStageOrder('Costura')).toBe(3);
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
    expect(formatOpNumber('Corte Palmilha')).toBe('01');
    expect(formatOpNumber('Solagem')).toBe('09');
  });

  it('does NOT pad double digits', () => {
    expect(formatOpNumber('Acabamento')).toBe('10');
    expect(formatOpNumber('Expedição')).toBe('11');
  });

  it('returns em-dash for unknown sectors', () => {
    expect(formatOpNumber('Inexistente')).toBe('—');
  });

  it('matches SQL canonical_stage_order (smoke test, mig 20261001120000)', () => {
    // Garante que o mapa TS bate com o SQL — se alguém mexer no SQL
    // sem atualizar TS (ou vice-versa), o teste pega.
    expect(CANONICAL_STAGE_ORDER['Corte Palmilha']).toBe(1);
    expect(CANONICAL_STAGE_ORDER['Costura']).toBe(3);
    expect(CANONICAL_STAGE_ORDER['Costura Cabedal']).toBe(4);
    expect(CANONICAL_STAGE_ORDER['Expedição']).toBe(11);
  });

  it('OP numbers dos setores de ficha casam com o trilho de 11 posições do WorksheetHeader', () => {
    // FLOW_RAIL_STEPS (WorksheetHeader) indexa por este número — se a
    // numeração divergir, o trilho destaca o passo/cor errados.
    const rail: Record<string, number> = {
      'Corte Palmilha': 1, 'Corte Forração': 2, 'Costura Palmilha': 3,
      'Costura Cabedal': 4, 'Aviamento': 5, 'Silk': 6, 'Colagem': 7,
      'Montagem': 8, 'Solagem': 9, 'Acabamento': 10, 'Expedição': 11,
    };
    for (const [sector, pos] of Object.entries(rail)) {
      expect(canonicalStageOrder(sector)).toBe(pos);
    }
  });
});

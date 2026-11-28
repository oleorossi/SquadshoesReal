import { describe, expect, it } from 'vitest';
import { SECTOR_FLOW } from '@/lib/sectors';
import {
  FLOW_RAIL_COLORS,
  FLOW_RAIL_STEPS,
  flowRailColor,
  flowRailLabel,
  flowRailStep,
} from '../flowRail';

describe('trilho de etapas das fichas', () => {
  it('tem um passo e uma cor para cada setor de SECTOR_FLOW', () => {
    expect(FLOW_RAIL_STEPS).toHaveLength(SECTOR_FLOW.length);
    expect(FLOW_RAIL_COLORS).toHaveLength(SECTOR_FLOW.length);
  });

  it('destaca o passo certo em Corte, Costura e Aviamento (não o vizinho)', () => {
    expect(flowRailStep('Corte Cabedal')).toBe(3);
    expect(flowRailLabel(3)).toBe('C.CAB');

    expect(flowRailStep('Costura Cabedal')).toBe(5);
    expect(flowRailLabel(5)).toBe('CS.CAB');

    expect(flowRailStep('Aviamento')).toBe(6);
    expect(flowRailLabel(6)).toBe('AVIA');
  });

  it('aceita aliases usados no header (Palmilha, Mesa, Expedicao)', () => {
    expect(flowRailStep('Corte Fibra')).toBe(1);
    expect(flowRailStep('Corte Palmilha')).toBe(1);
    expect(flowRailStep('Palmilha · Fibra')).toBe(1);
    expect(flowRailLabel(1)).toBe('C.PLM');

    expect(flowRailStep('Corte Forração')).toBe(2);
    expect(flowRailStep('Palmilha · Forração')).toBe(2);
    expect(flowRailLabel(2)).toBe('C.FOR');

    expect(flowRailStep('Acabamento Palmilha')).toBe(4);
    expect(flowRailStep('Costura Palmilha')).toBe(4);
    expect(flowRailLabel(4)).toBe('CS.PLM');

    expect(flowRailStep('Mesa')).toBe(6);
    expect(flowRailStep('Expedicao')).toBe(12);
    expect(flowRailStep('Expedição')).toBe(12);
    expect(flowRailLabel(12)).toBe('EXP');
  });

  it('mapeia a cadeia inteira na ordem de SECTOR_FLOW', () => {
    const expected = {
      'Palmilha · Fibra': 1,
      'Palmilha · Forração': 2,
      'Corte Cabedal': 3,
      'Acabamento Palmilha': 4,
      'Costura Cabedal': 5,
      Aviamento: 6,
      Silk: 7,
      Colagem: 8,
      Montagem: 9,
      Solagem: 10,
      Acabamento: 11,
      Expedição: 12,
    };
    for (const [name, step] of Object.entries(expected)) {
      expect(flowRailStep(name)).toBe(step);
    }
  });

  it('devolve null para setor desconhecido (sem inventar passo)', () => {
    expect(flowRailStep('Inexistente')).toBeNull();
    expect(flowRailStep('')).toBeNull();
  });

  it('mantém as cores de CS.CAB e AVIA (não desloca a paleta)', () => {
    expect(flowRailColor(5)).toBe('#7c3aed');
    expect(flowRailColor(6)).toBe('#d97706');
    expect(flowRailColor(12)).toBe('#475569');
  });
});

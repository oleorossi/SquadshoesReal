import { describe, expect, it } from 'vitest';
import {
  cabedalPartBadge,
  cabedalPartLabel,
  classifyCabedalPart,
  isCabedalFrenteTraseiroSector,
} from '../cabedalFrenteTraseiro';

describe('isCabedalFrenteTraseiroSector', () => {
  it('vale para os setores de operador de Cabedal', () => {
    expect(isCabedalFrenteTraseiroSector('Corte Cabedal')).toBe(true);
    expect(isCabedalFrenteTraseiroSector('Costura Cabedal')).toBe(true);
    expect(isCabedalFrenteTraseiroSector('Aviamento')).toBe(true);
  });

  it('não vale para Palmilha, Fardo nem demais setores', () => {
    for (const sector of [
      'Corte Forração',
      'Corte Fibra',
      'Corte Palmilha',
      'Acabamento Palmilha',
      'Costura Palmilha',
      'Silk',
      'Montagem',
      'Solagem',
      'Colagem',
      'Acabamento',
      'Expedição',
    ]) {
      expect(isCabedalFrenteTraseiroSector(sector)).toBe(false);
    }
  });

  it('ignora vazio e espaços', () => {
    expect(isCabedalFrenteTraseiroSector('')).toBe(false);
    expect(isCabedalFrenteTraseiroSector('  ')).toBe(false);
    expect(isCabedalFrenteTraseiroSector(null)).toBe(false);
    expect(isCabedalFrenteTraseiroSector(undefined)).toBe(false);
  });
});

describe('classifyCabedalPart', () => {
  it('reconhece Frente e Front', () => {
    expect(classifyCabedalPart('Frente')).toBe('frente');
    expect(classifyCabedalPart('FRENTE')).toBe('frente');
    expect(classifyCabedalPart('TIRA 1 · Frente')).toBe('frente');
    expect(classifyCabedalPart('front strap')).toBe('frente');
  });

  it('reconhece Traseiro / Traseira e sinônimos', () => {
    expect(classifyCabedalPart('Traseiro')).toBe('traseiro');
    expect(classifyCabedalPart('Traseira')).toBe('traseiro');
    expect(classifyCabedalPart('TRASEIRO')).toBe('traseiro');
    expect(classifyCabedalPart('Contraforte do calcanhar')).toBe('traseiro');
    expect(classifyCabedalPart('tira do talão')).toBe('traseiro');
    expect(classifyCabedalPart('heel counter')).toBe('traseiro');
  });

  it('prefers traseiro when both words appear', () => {
    expect(classifyCabedalPart('frente do traseiro')).toBe('traseiro');
  });

  it('deixa indefinido o que não identifica a parte', () => {
    expect(classifyCabedalPart('TIRA 1')).toBeNull();
    expect(classifyCabedalPart('Costura de tiras')).toBeNull();
    expect(classifyCabedalPart('NAPA SOFT')).toBeNull();
    expect(classifyCabedalPart('')).toBeNull();
    expect(classifyCabedalPart(null)).toBeNull();
  });

  it('rótulos curtos do badge', () => {
    expect(cabedalPartLabel('frente')).toBe('Frente');
    expect(cabedalPartLabel('traseiro')).toBe('Traseiro');
    expect(cabedalPartBadge('frente')).toBe('F');
    expect(cabedalPartBadge('traseiro')).toBe('T');
  });
});

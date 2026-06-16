import { describe, it, expect } from 'vitest';
import {
  caixaCollectiveTypeFromName,
  shouldShowCaixaForMode,
  collectiveTypeForMode,
  type CollectiveType,
} from '@/lib/packagingPairsPerBox';

describe('caixaCollectiveTypeFromName', () => {
  it('detecta colmeia / individual / master / fitilho pelo nome', () => {
    expect(caixaCollectiveTypeFromName('CAIXA COLMEIA 11')).toBe('colmeia');
    expect(caixaCollectiveTypeFromName('CAIXA INDIVIDUAL 11')).toBe('individual');
    expect(caixaCollectiveTypeFromName('Caixa Master 18')).toBe('master');
    expect(caixaCollectiveTypeFromName('CAIXA FITILHO')).toBe('fitilho');
  });

  it('aceita acento em colméia', () => {
    expect(caixaCollectiveTypeFromName('Caixa Colméia')).toBe('colmeia');
  });

  it('coletiva vence individual em nomes combinados', () => {
    expect(caixaCollectiveTypeFromName('CAIXA INDIVIDUAL MASTER')).toBe('master');
  });

  it('nome sem tipo reconhecível → null', () => {
    expect(caixaCollectiveTypeFromName('Caixa 11')).toBeNull();
    expect(caixaCollectiveTypeFromName('')).toBeNull();
    expect(caixaCollectiveTypeFromName(null)).toBeNull();
    expect(caixaCollectiveTypeFromName(undefined)).toBeNull();
  });
});

describe('shouldShowCaixaForMode', () => {
  const ambas = new Set<CollectiveType>(['colmeia', 'individual']);

  it('PV colmeia + ficha com colmeia E individual → mostra só colmeia', () => {
    expect(shouldShowCaixaForMode('CAIXA COLMEIA 11', 'colmeia', ambas)).toBe(true);
    expect(shouldShowCaixaForMode('CAIXA INDIVIDUAL 11', 'colmeia', ambas)).toBe(false);
  });

  it('PV individual + ficha com colmeia E individual → mostra só individual', () => {
    expect(shouldShowCaixaForMode('CAIXA INDIVIDUAL 11', 'individual', ambas)).toBe(true);
    expect(shouldShowCaixaForMode('CAIXA COLMEIA 11', 'individual', ambas)).toBe(false);
  });

  it('modos individual_amarrado/fitilho mapeiam pro tipo certo', () => {
    // amarrado → individual
    expect(collectiveTypeForMode('individual_amarrado')).toBe('individual');
    expect(shouldShowCaixaForMode('CAIXA COLMEIA 11', 'individual_amarrado', ambas)).toBe(false);
    expect(shouldShowCaixaForMode('CAIXA INDIVIDUAL 11', 'individual_amarrado', ambas)).toBe(true);
  });

  it('SEM modo → não filtra (mantém tudo)', () => {
    expect(shouldShowCaixaForMode('CAIXA COLMEIA 11', null, ambas)).toBe(true);
    expect(shouldShowCaixaForMode('CAIXA INDIVIDUAL 11', undefined, ambas)).toBe(true);
  });

  it('caixa ÚNICA na ficha (sem alternativa) → não filtra', () => {
    const so = new Set<CollectiveType>(['individual']);
    expect(shouldShowCaixaForMode('CAIXA INDIVIDUAL 11', 'colmeia', so)).toBe(true);
  });

  it('modo escolhido SEM caixa cadastrada na ficha → não filtra (mostra o que há)', () => {
    // PV master, mas a ficha só tem colmeia+individual → mantém ambas (degrada).
    expect(shouldShowCaixaForMode('CAIXA COLMEIA 11', 'individual_master', ambas)).toBe(true);
    expect(shouldShowCaixaForMode('CAIXA INDIVIDUAL 11', 'individual_master', ambas)).toBe(true);
  });

  it('caixa sem tipo reconhecível → não filtra mesmo com modo', () => {
    expect(shouldShowCaixaForMode('Caixa 11', 'colmeia', ambas)).toBe(true);
  });

  it('caso real PV-00141 (colmeia): só CAIXA COLMEIA 11 passa', () => {
    const presentes = new Set<CollectiveType>(['colmeia', 'individual']);
    const bom = ['CAIXA COLMEIA 11', 'CAIXA INDIVIDUAL 11'];
    const visiveis = bom.filter((n) => shouldShowCaixaForMode(n, 'colmeia', presentes));
    expect(visiveis).toEqual(['CAIXA COLMEIA 11']);
  });
});

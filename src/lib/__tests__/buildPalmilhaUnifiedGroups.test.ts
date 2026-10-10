import { describe, expect, it } from 'vitest';
import {
  buildPalmilhaUnifiedGroups,
  normalizePalmilhaPrintSectors,
} from '@/lib/buildPalmilhaUnifiedGroups';

describe('normalizePalmilhaPrintSectors', () => {
  it('legado Corte Palmilha + Corte Forração → Palmilha', () => {
    expect(normalizePalmilhaPrintSectors(['Corte Palmilha', 'Corte Forração', 'Silk']))
      .toEqual(['Palmilha', 'Silk']);
  });
  it('só Corte Palmilha → Só Fibra', () => {
    expect(normalizePalmilhaPrintSectors(['Corte Palmilha'])).toEqual(['Só Fibra']);
  });
});

describe('buildPalmilhaUnifiedGroups Soft≠Madrid', () => {
  it('mesma cor + napas diferentes → dois cards', () => {
    const { groups } = buildPalmilhaUnifiedGroups({
      mode: 'palmilha',
      soleGroups: [{
        soleName: 'INFANTIL',
        totalPairs: 30,
        colorGroups: [{
          color: 'OFF WHITE',
          requiresLiningCut: true,
          combinedGrid: { '34': 10 },
          totalPairs: 30,
          fichas: 2,
          opNumbers: ['OP-A', 'OP-B'],
          pvNumbers: ['PV-1'],
          liningBreakdown: new Map([
            ['NAPA SOFT', {
              material: 'NAPA SOFT',
              combinedGrid: { '34': 20 },
              totalPairs: 20,
              fichas: 1,
              opNumbers: ['OP-A'],
              pvNumbers: ['PV-1'],
            }],
            ['NAPA MADRID', {
              material: 'NAPA MADRID',
              combinedGrid: { '34': 10 },
              totalPairs: 10,
              fichas: 1,
              opNumbers: ['OP-B'],
              pvNumbers: ['PV-1'],
            }],
          ]),
        }],
      }],
      opsNeedFibra: new Set(['OP-A', 'OP-B']),
      opsNeedForracao: new Set(['OP-A', 'OP-B']),
      resolvePlateGroup: () => 'PLACA EVA 10MM',
      consumptionForOps: () => [],
      clientNamesForPvs: () => [],
    });
    expect(groups).toHaveLength(1);
    expect(groups[0].cards).toHaveLength(2);
    const napas = groups[0].cards.map(c => c.liningGroup).sort();
    expect(napas).toEqual(['NAPA MADRID', 'NAPA SOFT']);
    expect(groups[0].cards.every(c => c.kind === 'completo')).toBe(true);
  });
});

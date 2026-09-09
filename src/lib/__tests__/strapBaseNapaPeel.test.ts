import { describe, expect, it } from 'vitest';
import {
  normalizeStrapOrigemPadrao,
  peelStrapBaseGroupId,
  suggestSkuAcabadoOrigemFromName,
} from '@/lib/strapBaseNapaPeel';
import { referenceStrapBaseGroups } from '@/lib/referenceStrapBaseGroups';

const COMPOSITE = 'g-soft-massabox';
const SOFT = 'g-soft';
const MASSABOX = 'g-massabox';

const layers = [
  { composite_group_id: COMPOSITE, component_group_id: SOFT, is_color_source: true },
  { composite_group_id: COMPOSITE, component_group_id: MASSABOX, is_color_source: false },
];

describe('peelStrapBaseGroupId', () => {
  it('mantém grupo simples', () => {
    expect(peelStrapBaseGroupId(SOFT, layers)).toBe(SOFT);
  });

  it('reduz dublado à camada de napa (is_color_source)', () => {
    expect(peelStrapBaseGroupId(COMPOSITE, layers)).toBe(SOFT);
  });

  it('sem camadas devolve o próprio id', () => {
    expect(peelStrapBaseGroupId(COMPOSITE, [])).toBe(COMPOSITE);
  });
});

describe('suggestSkuAcabadoOrigemFromName', () => {
  it('detecta Strass no nome', () => {
    expect(suggestSkuAcabadoOrigemFromName('TIRA STRASS 15MM')).toBe(true);
    expect(suggestSkuAcabadoOrigemFromName('Overlock 5mm')).toBe(false);
  });
});

describe('normalizeStrapOrigemPadrao', () => {
  it('default escolhe_no_pv', () => {
    expect(normalizeStrapOrigemPadrao(null)).toBe('escolhe_no_pv');
    expect(normalizeStrapOrigemPadrao('sempre_fabrica')).toBe('sempre_fabrica');
  });
});

describe('referenceStrapBaseGroups peel', () => {
  it('mostra Soft pura quando o cabedal é Soft+Massabox', () => {
    const result = referenceStrapBaseGroups({
      sheet: { id: 'ref-1', upper_material_group_id: COMPOSITE },
      groups: [
        { id: COMPOSITE, name: 'NAPA SOFT + MASSABOX' },
        { id: SOFT, name: 'NAPA SOFT' },
        { id: MASSABOX, name: 'MASSABOX' },
      ],
      products: [],
      variants: [],
      layers,
    });
    expect(result.map((group) => group.name)).toEqual(['NAPA SOFT']);
    expect(result[0].id).toBe(SOFT);
  });
});

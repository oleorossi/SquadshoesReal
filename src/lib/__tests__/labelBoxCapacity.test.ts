import { describe, expect, it } from 'vitest';
import { resolveLabelBoxCapacity, type SolePackagingCapacity } from '../labelBoxCapacity';

const sole: SolePackagingCapacity = {
  pairs_per_box_individual: 1,
  pairs_per_box_master: 18,
  pairs_per_box_colmeia: 24,
  box_type_id: 'individual',
  box_type_master_id: 'master',
  box_type_colmeia_id: 'colmeia',
};

describe('resolveLabelBoxCapacity', () => {
  it('resolve a capacidade pelo modo no grupo do solado', () => {
    expect(resolveLabelBoxCapacity('individual_master', sole, new Map())).toBe(18);
    expect(resolveLabelBoxCapacity('colmeia', sole, new Map())).toBe(24);
  });

  it('usa o default da caixa vinculada e nunca inventa 12', () => {
    const withoutOwn = { ...sole, pairs_per_box_master: null };
    expect(resolveLabelBoxCapacity('individual_master', withoutOwn, new Map([['master', 16]]))).toBe(16);
    expect(resolveLabelBoxCapacity('individual_master', withoutOwn, new Map())).toBe(0);
  });

  it('modos de caixa individual são um volume por par', () => {
    expect(resolveLabelBoxCapacity('individual_amarrado', undefined, new Map())).toBe(1);
  });
});

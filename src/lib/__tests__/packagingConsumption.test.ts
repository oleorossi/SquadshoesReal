import { describe, expect, it } from 'vitest';
import { resolveCanonicalPackaging } from '@/lib/packagingConsumption';

const group = {
  id: 'sole-11',
  box_type_id: 'box-individual',
  box_type_master_id: 'box-master',
  box_type_colmeia_id: 'box-colmeia',
  box_type_fitilho_id: 'box-fitilho',
  pairs_per_box_individual: 1,
  pairs_per_box_master: 12,
  pairs_per_box_colmeia: 12,
  pairs_per_box_fitilho: 12,
};

const boxes = [
  { id: 'box-individual', nome: 'Individual', tipo: 'individual', quantity: 100, unit_price: 1.6, active: true },
  { id: 'box-master', nome: 'Master', tipo: 'master', quantity: 20, unit_price: 12, active: true },
  { id: 'box-colmeia', nome: 'Colmeia', tipo: 'colmeia', quantity: 10, unit_price: 6.9, active: true },
  {
    id: 'box-fitilho', nome: 'Fitilho', tipo: 'fitilho', quantity: 40, unit_price: 1, active: true,
    metros_per_amarrado_default: 1.5,
  },
];

describe('resolveCanonicalPackaging', () => {
  it('colmeia seleciona exatamente um slot por UUID', () => {
    const rows = resolveCanonicalPackaging({
      mode: 'colmeia', quantity: 24, soleGroup: group, boxTypes: boxes,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      boxTypeId: 'box-colmeia', packagingType: 'colmeia', required: 2,
    });
  });

  it('individual seleciona somente a caixa individual', () => {
    const rows = resolveCanonicalPackaging({
      mode: 'individual', quantity: 12, soleGroup: group, boxTypes: boxes,
    });
    expect(rows.map((row) => row.boxTypeId)).toEqual(['box-individual']);
    expect(rows[0].required).toBe(12);
  });

  it('individual_fitilho seleciona individual + fitilho e mantém metro linear', () => {
    const rows = resolveCanonicalPackaging({
      mode: 'individual_fitilho', quantity: 24, soleGroup: group, boxTypes: boxes,
    });
    expect(rows.map((row) => row.boxTypeId)).toEqual(['box-individual', 'box-fitilho']);
    expect(rows[1]).toMatchObject({ packagingType: 'fitilho', unit: 'm', required: 3 });
  });

  it('usa a regra canônica da caixa de sobra por numeração', () => {
    const rows = resolveCanonicalPackaging({
      mode: 'colmeia',
      quantity: 30,
      grade: { 28: 2, 29: 2, 30: 2, 31: 2, 32: 3, 33: 2, 34: 2 },
      soleGroup: group,
      boxTypes: boxes,
    });
    // CEIL(30/12)=3 seria errado: 2 colmeias + duas sobras mono-numeração.
    expect(rows[0].required).toBe(4);
  });

  it('modo e slot ausentes falham fechado sem escolher pelo nome', () => {
    const invalid = resolveCanonicalPackaging({
      mode: null, quantity: 12, soleGroup: group, boxTypes: boxes,
    });
    expect(invalid[0]).toMatchObject({ boxTypeId: null, required: 0 });
    expect(invalid[0].warning).toContain('Modo de embalagem');

    const missing = resolveCanonicalPackaging({
      mode: 'colmeia', quantity: 12, soleGroup: { id: 'sole' }, boxTypes: boxes,
    });
    expect(missing[0]).toMatchObject({ boxTypeId: null, required: 0 });
    expect(missing[0].warning).toContain('Slot');
  });

  it('slot com box_type de outro tipo falha fechado sem reinterpretar pelo nome', () => {
    const mismatched = resolveCanonicalPackaging({
      mode: 'colmeia',
      quantity: 12,
      soleGroup: group,
      boxTypes: boxes.map((box) => box.id === 'box-colmeia'
        ? { ...box, nome: 'Pode até conter COLMEIA no nome', tipo: 'fitilho' }
        : box),
    });

    expect(mismatched[0]).toMatchObject({
      boxTypeId: 'box-colmeia', packagingType: 'colmeia', required: 0,
    });
    expect(mismatched[0].warning).toContain('tipo incompatível');
  });
});

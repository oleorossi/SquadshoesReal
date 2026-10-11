import { describe, expect, it } from 'vitest';
import {
  itemDefaultNapaId,
  keptStrapNapasMessage,
  orderNapasForItem,
  parseReferenceStrapNapas,
  strapNapaFollowsItemMaterial,
} from '@/lib/referenceStrapNapas';
import { resolveStrapMaterialBaseGroupId, strapChoosesReferenceNapa } from '@/lib/strapMaterialPolicy';

// OB01 medida em 11/10/2026: napa-base NAPA SOFT + variante GLOW METALIC.
const REF = '0b010000-0000-4000-8000-000000000001';
const SOFT = '50f70000-0000-4000-8000-000000000001';
const GLOW = '6c070000-0000-4000-8000-000000000001';
const SUDANI = '5cda0000-0000-4000-8000-000000000001';
const VARIANT_GLOW = 'aaaa0000-0000-4000-8000-000000000001';

const rows = [
  { reference_id: REF, base_group_id: GLOW, base_group_name: 'GLOW METALIC', sort_order: 2, is_sheet_base: false, variant_ids: [VARIANT_GLOW] },
  { reference_id: REF, base_group_id: SOFT, base_group_name: 'NAPA SOFT', sort_order: 1, is_sheet_base: true, variant_ids: [] },
];

describe('napas da referência (tiras multicolor)', () => {
  it('lê o RPC por referência, na ordem do servidor', () => {
    const napas = parseReferenceStrapNapas(rows).get(REF);
    expect(napas?.map((napa) => napa.name)).toEqual(['NAPA SOFT', 'GLOW METALIC']);
    expect(parseReferenceStrapNapas(null).size).toBe(0);
  });

  it('napa do item: a da variante; sem variante, a napa-base da ficha (Q4)', () => {
    const napas = parseReferenceStrapNapas(rows).get(REF);
    expect(itemDefaultNapaId(napas, VARIANT_GLOW)).toBe(GLOW);
    expect(itemDefaultNapaId(napas, null)).toBe(SOFT);
    expect(itemDefaultNapaId(napas, 'variante-desconhecida')).toBeNull();
    expect(itemDefaultNapaId([], null)).toBeNull();
  });

  it('seletor põe a napa do item primeiro (Q3)', () => {
    const napas = parseReferenceStrapNapas(rows).get(REF);
    expect(orderNapasForItem(napas, GLOW).map((napa) => napa.id)).toEqual([GLOW, SOFT]);
    expect(orderNapasForItem(napas, SOFT).map((napa) => napa.id)).toEqual([SOFT, GLOW]);
  });

  it('troca de material: só acompanha quem estava na napa do material antigo (Q5)', () => {
    expect(strapNapaFollowsItemMaterial(null, GLOW)).toBe(true);
    expect(strapNapaFollowsItemMaterial(GLOW, GLOW)).toBe(true);
    expect(strapNapaFollowsItemMaterial(SOFT, GLOW)).toBe(false);
    expect(keptStrapNapasMessage(0)).toBeNull();
    expect(keptStrapNapasMessage(1)).toBe('1 tira manteve a napa escolhida.');
    expect(keptStrapNapasMessage(2)).toBe('2 tiras mantiveram a napa escolhida.');
  });
});

describe('strapChoosesReferenceNapa + resolveStrapMaterialBaseGroupId', () => {
  const multicolor = { identity_basis: 'reference_base' as const, color_mode: 'select_on_order' as const };

  it('só a tira interna com cor no PV e material "segue a referência" escolhe a napa', () => {
    expect(strapChoosesReferenceNapa(multicolor)).toBe(true);
    expect(strapChoosesReferenceNapa({ ...multicolor, material_mode: 'follow_reference' })).toBe(true);
    expect(strapChoosesReferenceNapa({ ...multicolor, color_mode: 'follow_main' })).toBe(false);
    expect(strapChoosesReferenceNapa({ ...multicolor, material_mode: 'fixed_group', material_group_id: SOFT })).toBe(false);
    expect(strapChoosesReferenceNapa({ ...multicolor, material_mode: 'select_on_order', allowed_material_group_ids: [SOFT] })).toBe(false);
    expect(strapChoosesReferenceNapa({ identity_basis: 'finished_product_group', identity_group_id: SOFT, color_mode: 'select_on_order' })).toBe(false);
  });

  it('napa escolhida vence a napa do item; sem escolha segue o item', () => {
    expect(resolveStrapMaterialBaseGroupId(multicolor, { referenceBaseGroupId: GLOW })).toBe(GLOW);
    expect(resolveStrapMaterialBaseGroupId({ ...multicolor, base_group_id: SOFT }, { referenceBaseGroupId: GLOW })).toBe(SOFT);
    expect(resolveStrapMaterialBaseGroupId(multicolor, { referenceBaseGroupId: GLOW, selectedBaseGroupId: SOFT })).toBe(SOFT);
  });

  it('com a lista carregada, napa fora da referência fica sem material (pendência)', () => {
    const referenceNapaGroupIds = [SOFT, GLOW];
    expect(resolveStrapMaterialBaseGroupId({ ...multicolor, base_group_id: SOFT }, { referenceBaseGroupId: GLOW, referenceNapaGroupIds })).toBe(SOFT);
    expect(resolveStrapMaterialBaseGroupId({ ...multicolor, base_group_id: SUDANI }, { referenceBaseGroupId: GLOW, referenceNapaGroupIds })).toBeNull();
  });

  it('tira que segue a cor principal continua ignorando napa gravada', () => {
    const followMain = { identity_basis: 'reference_base' as const, color_mode: 'follow_main' as const, base_group_id: SOFT };
    expect(resolveStrapMaterialBaseGroupId(followMain, { referenceBaseGroupId: GLOW })).toBe(GLOW);
  });
});

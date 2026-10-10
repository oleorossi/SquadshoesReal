import { describe, expect, it } from 'vitest';
import { syncMobileMulticolorStraps } from '../MobileNewOrder';
import type { MobileStrapManifestReference } from '@/lib/mobile/strapOfflineManifest';

// Tiras com cores combinadas no PV mobile (grill 10/10/2026, Q24/Q25).
const LINE_A = '11111111-1111-4111-8111-111111111111';
const LINE_B = '22222222-2222-4222-8222-222222222222';
const GROUP = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PRETO = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OURO = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const CARAMELO = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const shared = {
  identity_basis: 'reference_base' as const,
  identity_group_id: null,
  strap_type_id: '33333333-3333-4333-8333-333333333333',
  measure_id: '44444444-4444-4444-8444-444444444444',
  color_mode: 'select_on_order' as const,
  material_mode: 'follow_reference' as const,
  material_group_id: null,
  allowed_material_group_ids: [],
  consumption: 28,
};
const entry: MobileStrapManifestReference = {
  reference_id: 'ref-1',
  material_variant_id: null,
  lines: [LINE_A, LINE_B].map((id, index) => ({
    ...shared,
    technical_strap_line_id: id,
    label: `TIRA ${index + 1}`,
    position: index + 1,
    base_group_id: GROUP,
    base_group_name: 'NAPA SOFT',
    // CARAMELO só existe para a TIRA 1.
    allowed_colors: index === 0
      ? [{ id: PRETO, name: 'PRETO' }, { id: OURO, name: 'OURO' }, { id: CARAMELO, name: 'CARAMELO' }]
      : [{ id: PRETO, name: 'PRETO' }, { id: OURO, name: 'OURO' }],
    material_options: [],
  })),
};
const draft = (color: string, strapColors: Array<[string, string | null]>) => ({
  reference_id: 'ref-1', reference_name: 'I90I', color, grade: { '34': 2 }, unit_price: 100,
  strap_colors: [LINE_A, LINE_B].map((id, index) => ({
    ...shared,
    id,
    technical_strap_line_id: id,
    label: `TIRA ${index + 1}`,
    color: strapColors[index][0],
    color_id: strapColors[index][1],
  })),
  strap_sourcing: {},
});

describe('PV mobile — tiras multicolor', () => {
  it('pré-preenche as tiras vazias com a cor principal', () => {
    const { item } = syncMobileMulticolorStraps(draft('PRETO', [['', null], ['', null]]), entry);
    expect(item.strap_colors.map((strap) => [strap.color, strap.color_id])).toEqual([
      ['PRETO', PRETO], ['PRETO', PRETO],
    ]);
  });

  it('troca da principal: cor antiga acompanha, a trocada à mão fica, sem cor disponível esvazia', () => {
    // TIRA 1 está na cor antiga (PRETO) e acompanha para CARAMELO.
    const followed = syncMobileMulticolorStraps(
      draft('CARAMELO', [['PRETO', PRETO], ['OURO', OURO]]), entry, 'PRETO',
    );
    expect(followed.item.strap_colors.map((strap) => [strap.color, strap.color_id])).toEqual([
      ['CARAMELO', CARAMELO], ['OURO', OURO],
    ]);
    expect(followed.kept).toBe(1);

    // TIRA 2 não tem CARAMELO: esvazia para o vendedor escolher.
    const cleared = syncMobileMulticolorStraps(
      draft('CARAMELO', [['PRETO', PRETO], ['PRETO', PRETO]]), entry, 'PRETO',
    );
    expect(cleared.item.strap_colors[1]).toMatchObject({ color: '', color_id: null });
    expect(cleared.kept).toBe(0);
  });

  it('sem manifesto não mexe', () => {
    const original = draft('PRETO', [['', null], ['', null]]);
    expect(syncMobileMulticolorStraps(original, null).item).toBe(original);
  });
});

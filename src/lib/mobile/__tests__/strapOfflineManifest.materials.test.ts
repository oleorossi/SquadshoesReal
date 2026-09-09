import { describe, expect, it, vi } from 'vitest';
import {
  mobileStrapMaterialOptions,
  mobileStrapSelectedMaterial,
  mobileTechnicalStrapLinesFromManifest,
  normalizeMobileStrapOfflineManifest,
  type MobileStrapManifestLine,
} from '../strapOfflineManifest';

vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: vi.fn() } }));

const GROUP_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const GROUP_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const COLOR_A = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const COLOR_B = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const LINE_ID = '11111111-1111-4111-8111-111111111111';
const line: MobileStrapManifestLine = {
  technical_strap_line_id: LINE_ID,
  position: 1,
  identity_basis: 'reference_base',
  identity_group_id: null,
  strap_type_id: '22222222-2222-4222-8222-222222222222',
  measure_id: '33333333-3333-4333-8333-333333333333',
  color_mode: 'select_on_order',
  material_mode: 'select_on_order',
  material_group_id: null,
  allowed_material_group_ids: [GROUP_A, GROUP_B],
  base_group_id: null,
  base_group_name: null,
  allowed_colors: [],
  consumption: 28,
  consumption_per_size: { '25': 0, '26': 32 },
  material_options: [{
    base_group_id: GROUP_A,
    base_group_name: 'NAPA SOFT',
    allowed_colors: [{ id: COLOR_A, name: 'PRETO' }],
  }, {
    base_group_id: GROUP_B,
    base_group_name: 'NAPA SOFT + MASSABOX',
    allowed_colors: [{ id: COLOR_B, name: 'DOURADO' }],
  }],
};

const envelope = (rawLine: unknown) => ({
  version: 2,
  generated_at: '2026-09-05T12:00:00Z',
  manifest_hash: 'material-v2',
  references: [{ reference_id: 'ref-1', material_variant_id: null, lines: [rawLine] }],
});

describe('manifesto offline de material por posição', () => {
  it('rejeita v1 sem inventar opções e normaliza v2 sem dados financeiros', () => {
    expect(normalizeMobileStrapOfflineManifest({ ...envelope(line), version: 1 })).toBeNull();
    const result = normalizeMobileStrapOfflineManifest(envelope({
      ...line,
      material_options: line.material_options?.map((option) => ({ ...option, cost: 100, stock: 200 })),
    }));
    expect(result?.version).toBe(2);
    expect(result?.references[0].lines[0].material_options).toEqual(line.material_options);
    expect(JSON.stringify(result)).not.toMatch(/cost|stock/);
  });

  it('resolve cor na base selecionada sem confundir grupo composto com duas bases', () => {
    expect(mobileStrapMaterialOptions(line)).toHaveLength(2);
    expect(mobileStrapSelectedMaterial(line, { base_group_id: GROUP_B })).toEqual(line.material_options?.[1]);
    expect(mobileStrapSelectedMaterial(line, { base_group_id: GROUP_B })?.allowed_colors)
      .not.toContainEqual({ id: COLOR_A, name: 'PRETO' });
    expect(mobileStrapSelectedMaterial(line)).toBeNull();
  });

  it('lista só grupos autorizados e exige opção elegível para material fixo', () => {
    expect(mobileStrapMaterialOptions({ ...line, allowed_material_group_ids: [GROUP_A] }))
      .toEqual([line.material_options?.[0]]);
    expect(mobileStrapSelectedMaterial({ ...line, allowed_material_group_ids: [GROUP_A] }, { base_group_id: GROUP_B }))
      .toBeNull();
    const fixed = { ...line, material_mode: 'fixed_group', material_group_id: GROUP_A, allowed_material_group_ids: [] };
    expect(mobileStrapSelectedMaterial(fixed, { base_group_id: GROUP_B })?.base_group_id).toBe(GROUP_A);
    expect(mobileStrapMaterialOptions({ ...fixed, material_options: [] })).toEqual([]);
  });

  it('base herdada usa a variante atual do manifesto e não a base antiga do draft', () => {
    const inherited = { ...line, material_mode: 'follow_reference', allowed_material_group_ids: [], base_group_id: GROUP_A };
    expect(mobileStrapSelectedMaterial(inherited, { base_group_id: GROUP_B })?.base_group_id).toBe(GROUP_A);
    expect(mobileStrapMaterialOptions(inherited)).toHaveLength(1);
  });

  it.each([
    { material_mode: 'outro' },
    { material_mode: '' },
    { material_mode: 'follow_reference', material_group_id: 123, allowed_material_group_ids: [] },
    { allowed_material_group_ids: 'qualquer' },
    { allowed_material_group_ids: ['não é UUID'] },
  ])('política inválida permanece bloqueada após normalização: %j', (overrides) => {
    const normalized = normalizeMobileStrapOfflineManifest(envelope({ ...line, ...overrides }));
    expect(normalized).not.toBeNull();
    expect(mobileStrapMaterialOptions(normalized?.references[0].lines[0])).toEqual([]);
  });

  it('não aceita matéria-prima independente para produto acabado comprado', () => {
    expect(mobileStrapMaterialOptions({ ...line, identity_basis: 'finished_product_group', identity_group_id: GROUP_A }))
      .toEqual([]);
  });

  it('transporta política por UUID para reconciliação sem alterar consumo ou zeros', () => {
    const [technical] = mobileTechnicalStrapLinesFromManifest({ reference_id: 'ref-1', material_variant_id: null, lines: [line] });
    expect(technical).toMatchObject({
      id: LINE_ID,
      technical_strap_line_id: LINE_ID,
      material_mode: 'select_on_order',
      allowed_material_group_ids: [GROUP_A, GROUP_B],
      consumption: 28,
      consumption_per_size: { '25': 0, '26': 32 },
    });
    expect(technical).not.toHaveProperty('material_options');
  });
});

import { describe, expect, it } from 'vitest';
import {
  buildMobileSaleOrderItemsPayload,
  clearIncompatibleMobileStrapSelections,
  mobileIndependentStrapReviewLines,
  mobileSelectableStrapManifestIssues,
  normalizeMobileDraftStrapSnapshots,
  reconcileMobileDraftItemWithManifest,
  resetMobileStrapsForMaterialChange,
  selectMobileStrapMaterial,
} from '../MobileNewOrder';
import type { MobileStrapManifestReference, MobileStrapOfflineManifest } from '@/lib/mobile/strapOfflineManifest';

const LINE_A = '11111111-1111-4111-8111-111111111111';
const LINE_B = '22222222-2222-4222-8222-222222222222';
const GROUP_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const GROUP_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const COLOR_A = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const COLOR_B = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const shared = {
  identity_basis: 'reference_base' as const,
  identity_group_id: null,
  strap_type_id: '33333333-3333-4333-8333-333333333333',
  measure_id: '44444444-4444-4444-8444-444444444444',
  color_mode: 'select_on_order' as const,
  material_mode: 'select_on_order' as const,
  material_group_id: null,
  allowed_material_group_ids: [GROUP_A, GROUP_B],
  consumption: 28,
  consumption_per_size: { '25': 0, '26': 30 },
};
const entry: MobileStrapManifestReference = {
  reference_id: 'ref-1',
  material_variant_id: null,
  lines: [LINE_A, LINE_B].map((id, index) => ({
    ...shared,
    technical_strap_line_id: id,
    label: `Tira ${index + 1}`,
    position: index + 1,
    base_group_id: null,
    base_group_name: null,
    allowed_colors: [],
    material_options: [{
      base_group_id: GROUP_A,
      base_group_name: 'NAPA SOFT',
      allowed_colors: [{ id: COLOR_A, name: 'PRETO' }],
    }, {
      base_group_id: GROUP_B,
      base_group_name: 'NAPA SOFT + MASSABOX',
      allowed_colors: [{ id: COLOR_B, name: 'DOURADO' }],
    }],
  })),
};
const draft = () => ({
  reference_id: 'ref-1', reference_name: 'I91', color: 'PRETO', grade: { '25': 2, '26': 3 }, unit_price: 100,
  strap_colors: [LINE_A, LINE_B].map((id, index) => ({
    ...shared,
    id,
    technical_strap_line_id: id,
    label: `Tira ${index + 1}`,
    base_group_id: GROUP_A,
    base_group_name: 'NAPA SOFT',
    color: 'PRETO',
    color_id: COLOR_A,
  })),
  strap_sourcing: {
    [LINE_A]: { source_mode: 'internal' as const, recipe_id: 'receita-base-a', base_product_id: 'sku-base-a' },
    [LINE_B]: { source_mode: 'internal' as const, recipe_id: 'receita-base-a', base_product_id: 'sku-base-a' },
  },
});
const manifest = (reference = entry): MobileStrapOfflineManifest => ({
  version: 2, generated_at: '2026-09-05T12:00:00Z', manifest_hash: 'v2', references: [reference],
});

describe('material por posição no pedido mobile', () => {
  it('troca somente a posição escolhida e descarta receita/cor incompatíveis sem alterar consumo', () => {
    const original = draft();
    const next = selectMobileStrapMaterial(original, LINE_B, GROUP_B, entry);
    expect(next.strap_colors?.[0]).toBe(original.strap_colors[0]);
    expect(next.strap_colors?.[1]).toMatchObject({
      technical_strap_line_id: LINE_B,
      base_group_id: GROUP_B,
      base_group_name: 'NAPA SOFT + MASSABOX',
      color: '', color_id: null,
      consumption: 28, consumption_per_size: { '25': 0, '26': 30 },
    });
    expect(next.strap_sourcing).not.toHaveProperty(LINE_B);
    expect(next.strap_sourcing?.[LINE_A]).toEqual(original.strap_sourcing[LINE_A]);
    expect(original.strap_colors[1].base_group_id).toBe(GROUP_A);
  });

  it('não aceita grupo fora da política nem troca material em posição fixa', () => {
    const original = draft();
    expect(selectMobileStrapMaterial(original, LINE_A, COLOR_A, entry)).toBe(original);
    expect(selectMobileStrapMaterial(original, LINE_A, GROUP_B, {
      ...entry, lines: entry.lines.map((line) => ({ ...line, material_mode: 'fixed_group', material_group_id: GROUP_A, allowed_material_group_ids: [] })),
    })).toBe(original);
  });

  it('preserva cor válida no novo material, mas nunca conserva receita da base anterior', () => {
    const bothBlack: MobileStrapManifestReference = {
      ...entry, lines: entry.lines.map((line) => ({
        ...line, material_options: line.material_options?.map((option) => ({ ...option, allowed_colors: [{ id: COLOR_A, name: 'PRETO' }] })),
      })),
    };
    const next = selectMobileStrapMaterial(draft(), LINE_A, GROUP_B, bothBlack);
    expect(next.strap_colors?.[0]).toMatchObject({ base_group_id: GROUP_B, color: 'PRETO', color_id: COLOR_A });
    expect(next.strap_sourcing).not.toHaveProperty(LINE_A);
  });

  it('valida material ausente, material não autorizado e cor pertencente apenas à outra base', () => {
    expect(mobileSelectableStrapManifestIssues(draft(), entry)).toEqual([]);
    for (const baseGroupId of [null, COLOR_A]) {
      const item = draft();
      item.strap_colors[0].base_group_id = baseGroupId;
      expect(mobileSelectableStrapManifestIssues(item, entry)[0]).toContain('selecione um material permitido');
    }
    const item = draft();
    item.strap_colors[0].base_group_id = GROUP_B;
    expect(mobileSelectableStrapManifestIssues(item, entry)[0]).toContain('não pertence ao grupo-base efetivo');
  });

  it('verifica a cor principal na base própria mesmo sem seletor de cor', () => {
    const item = { ...draft(), strap_colors: draft().strap_colors.map((line) => ({ ...line, color_mode: 'follow_main' as const })) };
    const following: MobileStrapManifestReference = { ...entry, lines: entry.lines.map((line) => ({ ...line, color_mode: 'follow_main' })) };
    const next = selectMobileStrapMaterial(item, LINE_A, GROUP_B, following);
    expect(next.strap_colors?.[0]).toMatchObject({ base_group_id: GROUP_B, color: 'PRETO', color_id: null });
    expect(mobileSelectableStrapManifestIssues(next, following)[0]).toContain('cor principal não está disponível');
    expect(mobileIndependentStrapReviewLines(next)[0]).toMatchObject({ material: 'NAPA SOFT + MASSABOX', color: 'PRETO' });
  });

  it('reabre e reordena por UUID conservando material/cor, sem ressuscitar sourcing do draft', () => {
    const item = selectMobileStrapMaterial(draft(), LINE_A, GROUP_B, entry);
    item.strap_colors[0] = { ...item.strap_colors[0], color: 'DOURADO', color_id: COLOR_B };
    const restored = normalizeMobileDraftStrapSnapshots([item])[0];
    const result = reconcileMobileDraftItemWithManifest(restored, manifest({ ...entry, lines: [...entry.lines].reverse() }));
    expect(result.item.strap_colors?.map((line) => [line.technical_strap_line_id, line.base_group_id, line.color_id]))
      .toEqual([[LINE_B, GROUP_A, COLOR_A], [LINE_A, GROUP_B, COLOR_B]]);
    expect(result.item.strap_sourcing).toEqual({});
    expect(reconcileMobileDraftItemWithManifest(result.item, manifest({ ...entry, lines: [...entry.lines].reverse() })).changed).toBe(false);
  });

  it('atualização da allowlist remove base/cor obsoletas e mantém a outra posição', () => {
    const item = selectMobileStrapMaterial(draft(), LINE_A, GROUP_B, entry);
    item.strap_colors[0] = { ...item.strap_colors[0], color: 'DOURADO', color_id: COLOR_B };
    const changedEntry: MobileStrapManifestReference = {
      ...entry, lines: entry.lines.map((line) => ({ ...line, allowed_material_group_ids: [GROUP_A] })),
    };
    const result = reconcileMobileDraftItemWithManifest(item, manifest(changedEntry));
    expect(result.item.strap_colors?.[0]).toMatchObject({ base_group_id: null, color: '', color_id: null });
    expect(result.item.strap_colors?.[1]).toMatchObject({ base_group_id: GROUP_A, color: 'PRETO', color_id: COLOR_A });
    expect(mobileSelectableStrapManifestIssues(result.item, changedEntry)[0]).toContain('selecione um material permitido');
  });

  it('alteração da variante principal não apaga seleções próprias ainda permitidas', () => {
    const item = selectMobileStrapMaterial(draft(), LINE_A, GROUP_B, entry);
    const next = resetMobileStrapsForMaterialChange(item, 'NOVA COR PRINCIPAL');
    expect(next.strap_colors?.map((line) => line.base_group_id)).toEqual([GROUP_B, GROUP_A]);
    expect(next.strap_sourcing).toEqual({});
  });

  it('não colapsa itens de mesma referência/cor com materiais de posição diferentes no payload', () => {
    const first = draft();
    const second = selectMobileStrapMaterial(draft(), LINE_A, GROUP_B, entry);
    const payload = buildMobileSaleOrderItemsPayload([first, second]);
    expect(payload).toHaveLength(2);
    expect(payload.map((item) => item.strap_colors?.[0].base_group_id)).toEqual([GROUP_A, GROUP_B]);
    expect(payload[1].strap_colors?.[0]).toMatchObject({ material_mode: 'select_on_order', allowed_material_group_ids: [GROUP_A, GROUP_B] });
  });

  it('limpa vínculo de material que desapareceu do catálogo sem alterar a sequência', () => {
    const item = draft();
    const result = clearIncompatibleMobileStrapSelections(item, { ...entry, lines: entry.lines.map((line) => ({ ...line, material_options: [] })) });
    expect(result.item.strap_colors?.map((line) => line.technical_strap_line_id)).toEqual([LINE_A, LINE_B]);
    expect(result.item.strap_colors?.[0]).toMatchObject({ base_group_id: null, color: '', color_id: null });
    expect(result.item.strap_sourcing).toEqual({});
  });
});

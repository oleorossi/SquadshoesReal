import { describe, expect, it } from 'vitest';
import {
  buildMobileSaleOrderItemsPayload,
  mobileIndependentStrapReviewLines,
  mobileSelectableStrapManifestIssues,
  normalizeMobileDraftStrapSnapshots,
  reconcileMobileDraftItemWithManifest,
  selectMobileStrapColor,
} from '../MobileNewOrder';
import {
  mobileStrapSelectedMaterial,
  type MobileStrapManifestReference,
  type MobileStrapOfflineManifest,
} from '@/lib/mobile/strapOfflineManifest';

const REF = '2aa04423-4050-4d7d-970e-b879bad536ca';
const VARIANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OVERLOCK = 'a0f38666-88fa-4040-962c-4b58f677240d';
const STRASS = '122d67e3-f9ca-402d-9f1a-e125b3102d2a';
const GLOW = 'e0673b80-546f-467a-9022-b288b7abdcda';
const STRASS_GROUP = 'c45ff936-5ac5-49b5-98c4-4aed5e10e82d';
const COPPER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OFF_WHITE = 'aa38faa7-fd07-42a4-afe3-d2dd94d22d5d';
const BLACK = '2528a440-d82d-43fe-8879-957737577912';
const colors = [
  { id: 'dbeac393-08da-4547-80c9-c10d1d468ea8', name: 'CRISTAL COM FUNDO BRANCO' },
  { id: '62d1709a-d468-43cb-a7bb-7830fb937f5b', name: 'ROSADO COM FUNDO ROSADO' },
];
const originalLines = [
  { id: OVERLOCK, technical_strap_line_id: OVERLOCK, label: 'TIRA 1',
    strap_type_id: 'a69cb531-2d66-4931-9a71-8b06bec56eb0', measure_id: '06500a23-801d-4627-a927-3ce7e5ee2619',
    consumption: 44, consumption_per_size: { '28': 44 }, group_name: 'TIRA OVERLOCK 5MM' },
  { id: STRASS, technical_strap_line_id: STRASS, label: 'TIRA 2',
    strap_type_id: '381eb21d-2170-45f7-ab7c-3601a8857ea9', measure_id: '00f07325-347b-4e65-90e6-fed33f70eacc',
    consumption: 50, consumption_per_size: { '28': 50 }, group_name: 'TIRA STRASS 6MM' },
].map((line) => ({
  ...line, identity_basis: 'reference_base' as const, identity_group_id: null,
  color_mode: 'follow_main' as const, material_mode: 'follow_reference' as const,
  material_group_id: null, allowed_material_group_ids: [],
  base_group_id: GLOW, base_group_name: 'GLOW METALIC', color: 'COBRE', color_id: COPPER,
}));

const draft = () => ({
  reference_id: REF, reference_name: 'I703', material_variant_id: VARIANT,
  color: 'COBRE', grade: { '28': 12 }, unit_price: 100,
  strap_colors: originalLines.map((line) => ({ ...line })),
  strap_sourcing: { [STRASS]: { source_mode: 'internal' as const, recipe_id: 'receita-glow-obsoleta' } },
});

// Manifesto operacional da própria posição/medida: a cor do cabedal só pertence
// à TIRA 1. OFF WHITE/PRETO têm SKU, mas ainda não têm variante comercial completa.
const entry: MobileStrapManifestReference = {
  reference_id: REF, material_variant_id: VARIANT,
  lines: originalLines.map((line, index) => ({
    ...line, position: index + 1,
    ...(index === 1 ? {
      identity_basis: 'finished_product_group' as const,
      identity_group_id: STRASS_GROUP,
      color_mode: 'select_on_order' as const,
      base_group_id: null, base_group_name: null,
      group_id: STRASS_GROUP, internal_production_enabled: false,
      allowed_colors: colors,
      material_options: [{ base_group_id: STRASS_GROUP, base_group_name: 'TIRA STRASS 6MM', allowed_colors: colors }],
    } : { allowed_colors: [{ id: COPPER, name: 'COBRE' }] }),
  })),
};
const manifest: MobileStrapOfflineManifest = {
  version: 2, generated_at: '2026-09-05T12:00:00Z', manifest_hash: 'strass-finished', references: [entry],
};

describe('I703 · Strass 6 mm independente no mobile', () => {
  it('atualiza draft antigo por UUID, limpa Glow/Cobre da Strass e preserva a metragem de cada peça', () => {
    const result = reconcileMobileDraftItemWithManifest(draft(), manifest);
    expect(result.changed).toBe(true);
    expect(result.item.strap_colors[0]).toMatchObject({ technical_strap_line_id: OVERLOCK, color: 'COBRE', consumption: 44 });
    expect(result.item.strap_colors[1]).toMatchObject({
      technical_strap_line_id: STRASS, identity_basis: 'finished_product_group',
      identity_group_id: STRASS_GROUP, color_mode: 'select_on_order',
      color: '', color_id: null, base_group_id: null, base_group_name: null,
      consumption: 50, consumption_per_size: { '28': 50 },
    });
    expect(result.item.strap_sourcing).not.toHaveProperty(STRASS);
    expect(mobileSelectableStrapManifestIssues(result.item, entry)).toEqual([
      'I703: TIRA 2 exige a seleção de uma cor canônica.',
    ]);
    expect(mobileStrapSelectedMaterial(entry.lines[1], result.item.strap_colors[1])?.allowed_colors).toEqual(colors);
    expect(selectMobileStrapColor(result.item, STRASS, COPPER, entry)).toBe(result.item);
    expect(selectMobileStrapColor(result.item, STRASS, OFF_WHITE, entry)).toBe(result.item);
    expect(selectMobileStrapColor(result.item, STRASS, BLACK, entry)).toBe(result.item);
  });

  it.each(colors)('preserva $name da Strass no payload/reabertura sem herdar a cor principal', (color) => {
    const reconciled = reconcileMobileDraftItemWithManifest(draft(), manifest).item;
    const selected = selectMobileStrapColor(reconciled, STRASS, color.id, entry);
    expect(mobileSelectableStrapManifestIssues(selected, entry)).toEqual([]);
    const restored = normalizeMobileDraftStrapSnapshots([{ ...selected, color: 'CHAMPAGNE' }])[0];
    const payload = buildMobileSaleOrderItemsPayload([restored])[0];
    expect(payload.strap_colors[0]).toMatchObject({ color: 'CHAMPAGNE', consumption: 44 });
    expect(payload.strap_colors[1]).toMatchObject({
      technical_strap_line_id: STRASS, identity_basis: 'finished_product_group',
      identity_group_id: STRASS_GROUP, color: color.name, color_id: color.id,
      consumption: 50, consumption_per_size: { '28': 50 },
    });
    expect(mobileIndependentStrapReviewLines(restored)).toEqual([{
      key: STRASS, position: 'TIRA 2', color: color.name, material: 'TIRA STRASS 6MM',
    }]);
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

const migration = read(
  'supabase/migrations/20270101014800_sp124_composite_upper_guards.sql',
);
const variantsTab = read('src/components/technical-sheets/MaterialVariantsTab.tsx');
const helper = read('src/lib/materialVariantColorGroup.ts');
const marginDialog = read('src/components/sale-orders/MarginDialog.tsx');

function functionBody(name: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${name}`;
  const start = migration.indexOf(marker);
  expect(start, `${name} deve existir`).toBeGreaterThanOrEqual(0);
  const terminator = '\n$function$;';
  const end = migration.indexOf(terminator, start + marker.length);
  expect(end, `${name} deve terminar no próprio $function$`).toBeGreaterThan(start);
  return migration.slice(start, end + terminator.length);
}

describe('SP124 — Cabedal composto separado da Forração', () => {
  it('ratifica as duas camadas sem explodir o SKU acabado no estoque', () => {
    const ratifyStart = migration.indexOf('DO $ratify$');
    const ratifyEnd = migration.indexOf('$ratify$;', ratifyStart);
    const ratify = migration.slice(ratifyStart, ratifyEnd);

    expect(migration).toContain("'NAPA SOFT + MASSABOX'");
    expect(migration).toContain("'NAPA SOFT'");
    expect(migration).toContain("'MASSABOX'");
    expect(migration).toContain("'Material externo'");
    expect(migration).toContain("'Base da dublagem'");
    expect(migration).toContain('is_color_source');
    expect(migration).toContain('product_group_layers não participa do consumo');

    expect(ratify).not.toMatch(/INSERT\s+INTO\s+public\.products/i);
    expect(ratify).not.toMatch(
      /(?:INSERT\s+INTO|DELETE\s+FROM)\s+public\.(?:technical_sheet_snapshots|material_reservations|orders|stock_movements|production_consumptions)/i,
    );
    expect(ratify).not.toMatch(
      /UPDATE\s+public\.(?:material_reservations|orders|stock_movements|production_consumptions)/i,
    );
    expect(ratify).toContain('SET outdated_at = v_now');
    expect(ratify).not.toMatch(/SET\s+consumption_snapshot\s*=/i);
  });

  it('é idempotente e só corrige o estado legado com PV-00168 ainda seguro', () => {
    expect(migration).toContain("pg_catalog.hashtextextended('sp124-composite-upper-ratification'");
    expect(migration).toContain('FOR UPDATE;');
    expect(migration).toContain("v_sheet.upper_material = 'NAPA SOFT + MASSABOX'");
    expect(migration).toContain("v_sheet.upper_material = 'NAPA SOFT'");
    expect(migration).toContain("so.order_number = 'PV-00168'");
    expect(migration).toContain("so.status = 'Rascunho'");
    expect(migration).toContain("so.status IN ('Pendente', 'Aprovado', 'Em Produção')");
    expect(migration).toContain('incluindo PV-00162');
    expect(migration).toContain('version = ts.version + 1');
    expect(migration).toContain('ficha preservada sem nova versão');
    expect(migration).toContain("so.order_number <> 'PV-00162'");
    expect(migration).toContain("soi.color = 'OFF WHITE'");
    expect(migration).toContain("soi.color = 'PRETO'");
    expect(migration).toContain("soi.color = 'LIMONCELLO'");
    expect(migration).toContain('reservations_outdated_at');
  });

  it('compara composição física sem usar setor ou nome do grupo como identidade', () => {
    const compatibility = functionBody('product_group_upper_structure_is_compatible');
    expect(compatibility).toContain('l.component_group_id');
    expect(compatibility).toContain('l.component_label');
    expect(compatibility).toContain('l.role');
    expect(compatibility).toContain('l.is_color_source = false');
    expect(compatibility).not.toContain('.sector');
    expect(compatibility).not.toContain('product_groups g');

    expect(helper).toContain('nonColorSourceLayerSignature');
    expect(helper).toContain('resolvePinnedMaterialGroupId');
    expect(helper).not.toMatch(/sector.*compatib/i);
  });

  it('fecha cascata genérica e overrides incompatíveis no frontend e no banco', () => {
    expect(migration).toContain('trg_zz_guard_technical_sheet_composite_upper');
    expect(migration).toContain('trg_zz_guard_reference_variant_composite_upper');
    expect(migration).toContain('trg_guard_composite_upper_layer_changes');
    expect(migration).toContain('Cabedal composto não pode seguir o material principal');
    expect(migration).toContain("hashtextextended('composite-upper-structure-writes'");
    expect(migration).not.toContain("'squad.composite_upper_guard_txid'");

    expect(variantsTab).toContain(".from('product_group_layers')");
    expect(variantsTab).toContain('upperBaseIsComposite');
    expect(variantsTab).toContain('structureBlocked');
    expect(variantsTab).toContain('Cabedal composto protegido');
    expect(variantsTab).toContain('upperStructureCompatibility.compatible');
    expect(variantsTab).toContain('hasVariantComponentPin(formData, products)');
    expect(variantsTab).toContain('const upperStructureFeedbackId = useId()');
    expect(variantsTab.indexOf('id={upperStructureFeedbackId}'))
      .toBeLessThan(variantsTab.indexOf('<details'));
  });

  it('faz grupo composto gerar pendência explícita quando a cor exata não existe', () => {
    const resolver = functionBody('resolve_upper_material_for_variant');
    expect(resolver).toContain('public.is_composite_product_group');
    expect(resolver).toContain("r.matched_by IN ('exact_color', 'color_mismatch')");
    expect(resolver).toContain('public.product_group_upper_structure_is_compatible');
    expect(migration).toContain("'LIMONCELLO'");
    expect(migration).toContain('LIMONCELLO inexistente não virou pendência color_mismatch');
    expect(migration).toContain('zero linhas faria o Cabedal desaparecer silenciosamente');
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.resolve_upper_material_for_variant\(uuid, text, text, numeric, uuid\)[\s\S]*FROM PUBLIC, anon;/,
    );
    expect(resolver).toContain("auth.role(), '') IN ('anon', 'authenticated')");
    expect(resolver).not.toContain("current_setting('request.jwt.claim.role'");
    expect(resolver).toContain('NOT public.is_approved_user()');
    expect(resolver).toMatch(/WHERE p\.id = v_pid\s+AND p\.active = true;\s+IF FOUND THEN/);
    expect(migration).not.toMatch(/INSERT\s+INTO[\s\S]{0,120}LIMONCELLO/i);
  });

  it('não transforma color_mismatch em demanda real em nenhum consumidor vivo', () => {
    expect(migration).toContain('DO $patch_cost_color_mismatch$');
    expect(migration).toContain("''resolution_warning'', ''color_mismatch''");
    expect(migration).toContain('DO $patch_mrp_color_mismatch$');
    expect(migration).toContain("THEN ''material_color_not_registered:''");
    expect(migration).toContain('THEN 0::numeric');
    expect(migration).toContain('DO $patch_report_color_mismatch$');
    expect(migration).toContain('DO $patch_outsource_color_mismatch$');
    expect(migration).toContain('DO $patch_availability_color_mismatch$');
    expect(migration).toContain("''product_id'', NULL");
    expect(migration).toContain("''source'', ''unresolved''");
    expect(migration).toContain('Cabedal sem SKU para');
    expect(migration).toContain('DO $patch_wave_color_mismatch$');
    expect(migration).toContain('Onda bloqueada: existe cor de material sem SKU cadastrado.');
    expect(migration).toContain("'auto_create_wave_from_sale_order'");
    expect(migration).toContain("IF v_seen <> 5 THEN");
    expect(migration).toContain('pendencias_cadastrais');
    expect(marginDialog).toContain('getMissingMaterialColorLabels(sqlWarnings)');
    expect(marginDialog).toMatch(
      /missingMaterialColors\.length > 0[\s\S]{0,400}throw new Error/,
    );
  });

  it('amplia um único gatilho canônico e atualiza somente os custos do PV-00168', () => {
    expect(migration).toContain('DROP TRIGGER IF EXISTS trg_mark_so_costs_dirty_from_upper_variant_drivers');
    expect(migration).not.toContain('CREATE TRIGGER trg_mark_so_costs_dirty_from_upper_variant_drivers');
    expect(migration).toContain('CREATE TRIGGER trg_mark_so_costs_dirty_from_sheet');
    expect(migration).toContain('OLD.variant_drives_upper IS DISTINCT FROM NEW.variant_drives_upper');
    expect(migration).toContain('OLD.variant_drives_fachete IS DISTINCT FROM NEW.variant_drives_fachete');

    expect(migration).toContain('DO $refresh_pv00168_costs$');
    expect(migration).toContain('public.calculate_order_cost_item(v_item.id, true)');
    expect(migration).toContain("so.order_number = 'PV-00168'");
    const refreshStart = migration.indexOf('DO $refresh_pv00168_costs$');
    const refreshEnd = migration.indexOf('$refresh_pv00168_costs$;', refreshStart);
    const refresh = migration.slice(refreshStart, refreshEnd);
    expect(refresh).not.toContain('PV-00162');
    expect(refresh).toContain('p.group_id = v_target_group_id');
  });

  it('ignora pins inativos em todos os leitores de identidade física', () => {
    const commercial = functionBody('material_variant_color_group_id');
    const straps = functionBody('resolve_strap_base_group_id');
    const sync = functionBody('tg_sync_technical_sheet_strap_base_from_lining');
    const validate = functionBody('tg_validate_technical_sheet_strap_base_from_lining');

    expect(commercial.match(/p\.active = true/g)).toHaveLength(2);
    expect(straps.match(/\.active = true/g)?.length).toBeGreaterThanOrEqual(5);
    expect(straps).toContain('sheet_lining_text_group.id');
    expect(sync.match(/\.active = true/g)?.length).toBeGreaterThanOrEqual(2);
    expect(validate.match(/\.active = true/g)?.length).toBeGreaterThanOrEqual(2);
    expect(migration).toContain('trg_refresh_sheet_material_pins_after_product_change');
  });
});

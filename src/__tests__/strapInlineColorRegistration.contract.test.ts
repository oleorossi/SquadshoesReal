import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const previous = readFileSync(resolve(root, 'supabase/migrations/20270101014900_quick_group_color_variant.sql'), 'utf8');
const migration = readFileSync(resolve(root, 'supabase/migrations/20270101016400_cadastro_cor_material_tira_contextual_pv.sql'), 'utf8');
const rehearsal = readFileSync(resolve(root, 'supabase/tests/strap_inline_color_registration_e2e.sql'), 'utf8');
function body(sql: string, qualifiedName: string) {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION ${qualifiedName}(`);
  expect(start).toBeGreaterThanOrEqual(0);
  const from = sql.indexOf('AS $function$', start);
  return sql.slice(from, sql.indexOf('$function$;', from) + '$function$;'.length);
}

describe('cadastro contextual de cor de tira: SQL 164', () => {
  it('preserva integralmente o engine 149, alterando somente o opt-in privado de homogeneidade', () => {
    const original = body(previous, 'public.create_group_color_variant_core_149');
    const current = body(migration, 'private.create_group_color_variant_engine');
    expect(current).toBe(original.replace(
      'IF (\n    SELECT count(DISTINCT identity.material_name) > 1',
      'IF coalesce(p_require_homogeneous_group, true) AND (\n    SELECT count(DISTINCT identity.material_name) > 1',
    ));
    expect(body(migration, 'public.create_group_color_variant_core_149')).toContain('p_request_id, true');
    expect(migration).not.toContain('CREATE TABLE');
    expect(migration).not.toContain('pg_get_functiondef');
  });

  it('revalida ficha, UUID da posicao, material, tipo e medida antes de ler o recibo', () => {
    const rpc = body(migration, 'public.create_sale_order_strap_material_color');
    expect(rpc.indexOf('private.resolve_technical_strap_material(')).toBeLessThan(rpc.indexOf('SELECT * INTO v_receipt'));
    expect(rpc).toContain("coalesce(v_line ->> 'identity_basis', 'reference_base') <> 'reference_base'");
    expect(rpc).toContain("coalesce(v_line ->> 'color_mode', 'follow_main') <> 'select_on_order'");
    expect(rpc).toContain("public.try_parse_uuid(v_line ->> 'strap_type_id') IS DISTINCT FROM p_expected_type_id");
    expect(rpc).toContain("public.try_parse_uuid(v_line ->> 'measure_id') IS DISTINCT FROM p_expected_measure_id");
    expect(rpc).toContain('AND m.active AND t.active FOR SHARE OF m, t');
  });

  it('exige template exato de materia-prima e engenharia previamente aprovada', () => {
    const rpc = body(migration, 'public.create_sale_order_strap_material_color');
    expect(rpc).toContain("v_template.unit <> 'm'");
    expect(rpc).toContain('finished_product_id = p_template_product_id');
    expect(rpc).toContain('right(v_template_name, char_length(v_template_color)) = v_template_color');
    expect(rpc).toContain('v_template_material IS DISTINCT FROM lower(btrim(extensions.unaccent(v_group.name)))');
    expect(rpc).toContain('SELECT * INTO STRICT v_recipe');
    expect(rpc).toContain('abs(v_width - v_recipe.usable_base_width_mm_snapshot) > 0.000001');
    expect(rpc).not.toContain('INSERT INTO public.artisanal_strap_recipes');
  });

  it('fixa saldo zero e vincula replay a todo contexto e ator', () => {
    const rpc = body(migration, 'public.create_sale_order_strap_material_color');
    expect(rpc).toContain('p_base_group_id, p_template_product_id, p_color, 0, p_unit_price, p_request_id, false');
    for (const field of ['operation', 'reference_id', 'material_variant_id', 'technical_strap_line_id', 'type_id', 'measure_id', 'base_group_id', 'template_product_id']) {
      expect(rpc).toContain(`'${field}',`);
    }
    expect(rpc).toContain('v_receipt.actor_id IS DISTINCT FROM v_actor');
    expect(rpc).toContain('v_receipt.request_hash IS DISTINCT FROM v_request_hash');
    expect(rpc).toContain("'quick-group-variant-request:' || p_request_id::text");
    expect(rpc).toContain('public.resolve_strap_canonical_color_id(p.color) = v_input_color_id');
    expect(rpc).toContain('p.id <> v_created.id');
  });

  it('mantem gate de estoque, helpers privados e search_path explicito', () => {
    expect(migration).toContain("ARRAY['admin', 'gerente', 'almoxarifado']");
    expect(migration).toContain('p_require_homogeneous_group boolean DEFAULT true');
    expect(migration).toContain('REVOKE ALL ON FUNCTION private.create_group_color_variant_engine');
    expect(migration).toContain('FROM PUBLIC, anon, authenticated, service_role');
    expect(migration).toContain('TO authenticated;');
    expect((migration.match(/SET search_path TO ''/g) || []).length).toBe(3);
  });

  it('preserva ensaio real com grupo misto, saldo zero, guards, contexto obsoleto e rollback', () => {
    expect(rehearsal).toContain("'FIXTURE NAPA ONCA'");
    expect(rehearsal).toContain('O refactor relaxou a homogeneidade do cadastro generico');
    expect(rehearsal).toContain('Recibo retornou sucesso sem revalidar ficha modificada');
    expect(rehearsal).toContain('wrong_copied_width');
    expect(rehearsal).toContain('PRETO ALIAS');
    expect(rehearsal).toContain('Replay aceitou cor que passou a ter segundo SKU ativo');
    expect(rehearsal).toContain('public.prepare_sale_order_item_internal_straps');
    expect(rehearsal).toContain('public.preview_sale_order_strap_demand_draft');
    expect(rehearsal.trimEnd()).toMatch(/ROLLBACK;$/);
  });
});

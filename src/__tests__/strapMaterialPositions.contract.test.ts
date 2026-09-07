import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const migration = readFileSync(resolve(root,
  'supabase/migrations/20270101016100_materiais_por_posicao_tira.sql'), 'utf8');
const rehearsal = readFileSync(resolve(root,
  'supabase/tests/strap_material_positions_e2e.sql'), 'utf8');
const body = (qualifiedName: string) => {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION ${qualifiedName}(`);
  expect(start).toBeGreaterThanOrEqual(0);
  return migration.slice(start, migration.indexOf('$function$;', start) + '$function$;'.length);
};

describe('material-base por posicao de tira: contrato SQL 161', () => {
  it('valida politica explicita com a mesma elegibilidade do catalogo e bloqueia compra pronta', () => {
    const policy = body('private.validate_strap_material_policy');
    expect(policy).toContain("coalesce(p_line ->> 'material_mode', 'follow_reference')");
    expect(policy).toContain("v_mode NOT IN ('follow_reference', 'fixed_group', 'select_on_order')");
    expect(policy).toContain('public.strap_base_group_is_eligible(v_id)');
    expect(policy).toContain("v_basis = 'finished_product_group' AND v_mode <> 'follow_reference'");
    expect(policy).toContain('v_id = ANY(v_ids)');
    expect(body('public.tg_validate_technical_strap_identity'))
      .toContain('PERFORM private.validate_strap_material_policy(v_line)');
  });

  it('resolve base e pin por UUID, sem levar o pin global para material proprio', () => {
    const resolver = body('private.resolve_technical_strap_material');
    expect(resolver).toContain("line.value ->> 'technical_strap_line_id' = p_line_id::text");
    expect(resolver).toContain("ELSIF v_mode = 'follow_reference' THEN");
    expect(resolver).toContain("IF coalesce(nullif(v_line ->> 'color_mode', ''), 'follow_main') = 'follow_main'");
    expect(resolver).toContain("(v_policy -> 'allowed_material_group_ids') ? p_selected_group_id::text");
    expect(resolver).toContain("'pinned_base_product_id', v_pin");
  });

  it('materializa dentro do loop com locks estaveis e UUIDs independentes', () => {
    const materializer = body('private.ensure_sale_order_internal_strap_materials');
    expect(materializer).toContain("pg_advisory_xact_lock(hashtextextended('strap-pv-auto-intent', 0))");
    expect(materializer).toContain('private.resolve_technical_strap_material(');
    expect(materializer).toContain("nullif(p_selected_groups ->> v_line_id::text, '')::uuid");
    expect(materializer).toContain('v_recipe := NULL;');
    expect(materializer).toContain('v_variant := NULL;');
    expect(materializer).toContain('r.base_group_id = v_base_group_id');
    expect(materializer).toContain('av.base_group_id = v_base_group_id');
    expect(materializer).toContain('public.resolve_artisanal_strap_catalog(');
  });

  it('writer e guard usam a politica da ficha e congelam material por linha', () => {
    const writer = body('public.prepare_sale_order_item_internal_straps');
    expect(writer).toContain("- 'material_mode' - 'material_group_id' - 'allowed_material_group_ids'");
    expect(writer).toContain("'base_group_name', v_material_context -> 'base_group_name'");
    expect(writer).toContain('private.ensure_sale_order_internal_strap_materials(');
    expect(writer).toContain('jsonb_agg(item_line.value ORDER BY sheet_line.ordinality)');
    expect(body('public.tg_validate_sale_order_item_strap_color_alignment'))
      .toContain('private.resolve_technical_strap_material(');
  });

  it('mantem consumo linear da receita e nao introduz conversao de area ou perda', () => {
    const preview = body('public.preview_sale_order_strap_demand_draft_pre_05500');
    expect(preview).toContain("v_gross / nullif((v_catalog ->> 'confirmed_yield_m_per_m')::numeric, 0)");
    expect(migration).not.toContain('consumption_loss_pct');
    expect(migration).not.toContain('waste_pct');
    expect(migration).not.toContain('convertDm2');
  });

  it('manifesto v2 expõe materiais e cores por posicao e falha fechado', () => {
    const manifest = body('public.get_mobile_strap_offline_manifest');
    expect(manifest).toContain("'version', 2");
    expect(manifest).toContain("'material_options', v_material_options");
    expect(manifest).toContain("jsonb_build_object('material_mode', 'invalid')");
    expect(body('private.technical_strap_material_options'))
      .toContain("'base_group_id', v_id, 'base_group_name', v_name, 'allowed_colors', v_colors");
  });

  it('preserva historia sem demanda e valida politica novamente na confirmacao', () => {
    const historical = body('public.preview_sale_order_strap_demand_draft');
    expect(historical).toContain("'material_selection_required'");
    expect(historical).toContain("'material_selection_invalid'");
    expect(historical).toContain("'base_group_name', v_stored_line -> 'base_group_name'");
    const enqueue = body('public.enqueue_sale_order_strap_demands');
    for (const field of ['material_mode', 'material_group_id', 'allowed_material_group_ids']) {
      expect(enqueue.split(`              '${field}',`).length - 1).toBe(2);
    }
  });

  it('inclui ensaio transacional com funcoes reais, adulteracao, atomicidade e ACL', () => {
    expect(rehearsal).toContain('public.prepare_sale_order_item_internal_straps(v_input)');
    expect(rehearsal).toContain('EXECUTE FUNCTION public.tg_validate_sale_order_item_strap_color_alignment()');
    expect(rehearsal).toContain('public.enqueue_sale_order_strap_demands(');
    expect(rehearsal).toContain('has_function_privilege');
    expect(rehearsal).toContain("'Promocao aceitou politica tecnica diferente com mesmo SKU'");
    expect(rehearsal.trimEnd()).toMatch(/ROLLBACK;$/);
  });
});

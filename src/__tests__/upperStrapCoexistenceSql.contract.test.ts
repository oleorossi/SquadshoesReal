import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const migration = readFileSync(resolve(
  ROOT,
  'supabase/migrations/20270101014650_permitir_cabedal_com_tiras_e_somar_materiais_cabedal.sql',
), 'utf8');

describe('SQL — cabedal e tiras independentes', () => {
  it('calcula o material adicional por grade e soma no mesmo produto', () => {
    expect(migration).toContain('public.calculate_component_accessory_required_by_grade(');
    expect(migration).toContain("p_item -> 'consumption_per_size'");
    expect(migration).toContain('public.pick_consumption_for_size(');
    expect(migration).toContain('grade.key');
    expect(migration).not.toContain("split_part(grade.key, '/', 1)");
    expect(migration).toContain('"33":1,"33/34":4');
    expect(migration).toContain('public.merge_consumption_required_by_product(');
    expect(migration).toContain("emitted.line ->> 'product_id' = v_pid::text");
    expect(migration).toContain('v_covered_product_ids := array_append');
    expect(migration).not.toContain('v_conv.waste_pct');
  });

  it('remove o MUTEX dos tres pontos server-side sem expor os writers', () => {
    for (const signature of [
      'public.prepare_sale_order_item_internal_straps(jsonb)',
      'public.tg_validate_sale_order_item_strap_color_alignment()',
      'public.enqueue_sale_order_strap_demands(uuid,text,uuid)',
    ]) {
      expect(migration).toContain(signature);
    }
    expect(migration).toContain('upper_and_straps_coexist_20270101014650');
    expect(migration).toContain('esperava 1 MUTEX');
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION\s+public\.prepare_sale_order_item_internal_straps\(jsonb\)[\s\S]*?FROM PUBLIC, anon, authenticated, service_role/,
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION\s+public\.enqueue_sale_order_strap_demands\(uuid, text, uuid\)[\s\S]*?FROM PUBLIC, anon, authenticated, service_role/,
    );
  });

  it('deriva Corte Cabedal por sinais reais e preserva o modo somente-tiras', () => {
    expect(migration).toContain("ELSIF NEW.construction_type = 'tiras' THEN");
    expect(migration).toContain('upper_and_straps_routing_20270101014650');
    expect(migration).toContain('NEW.requires_cutting_cabedal := (');
    expect(migration).toContain('NEW.upper_consumption_per_size');
    expect(migration).toContain('NEW.components_accessories');
    expect(migration).toContain("position('NEW.has_straps :=' IN v_definition) > 0");
    expect(migration).toMatch(
      /CREATE TRIGGER trg_sync_construction_routing[\s\S]*?UPDATE OF[\s\S]*?upper_material[\s\S]*?upper_consumption_per_size[\s\S]*?components_accessories/,
    );
  });

  it('mantem readiness de cabedal independente de has_straps', () => {
    expect(migration).toContain("v_old_material constant text");
    expect(migration).toContain('COALESCE(ts.requires_cutting_cabedal, false)');
    expect(migration).toContain('ts.upper_material_group_id IS NOT NULL');
    expect(migration).toContain('tiras continuam independentes, governados por has_straps');
    expect(migration).toContain('ALTER VIEW public.v_technical_sheets_audit SET (security_invoker = true)');
  });

  it('instala contratos numericos e preserva fronteiras vivas', () => {
    expect(migration).toContain("case_name := 'extra_cabedal_consumo_por_numeracao'");
    expect(migration).toContain("case_name := 'extra_cabedal_mesmo_produto_soma'");
    expect(migration).toContain("case_name := 'cabedal_e_tiras_coexistem_no_pv'");
    expect(migration).toContain("case_name := 'routing_tiras_preserva_cabedal_real'");
    expect(migration).toContain("WHERE ts.name = 'I701'");
    expect(migration).toContain("'security_invoker=true'");
  });
});

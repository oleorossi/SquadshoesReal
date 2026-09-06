import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const sql = readFileSync(resolve(root, 'supabase/migrations/20270101016600_enforce_strap_measure_catalog_identity.sql'), 'utf8');
const previous = readFileSync(resolve(root, 'supabase/migrations/20270101016100_materiais_por_posicao_tira.sql'), 'utf8');
const guard = sql.split('v_guard text := $guard$')[1].split('$guard$;')[0];
const backfill = sql.split('DO $backfill$')[1];

describe('identidade da medida de tira — migration166', () => {
  it('instala a guarda sobre uma unica ancora conhecida e aceita variante OU receita interna vigente', () => {
    const anchor = sql.split('v_anchor text := $anchor$')[1].split('$anchor$;')[0];
    expect(previous.split(anchor)).toHaveLength(2);
    expect(guard).toContain('IF v_measure_id IS NOT NULL THEN');
    expect(guard).toMatch(/variant\.identity_basis = 'reference_base'[\s\S]*variant\.internal_production_enabled\s*\) OR EXISTS/);
    expect(guard).toContain("recipe.status = 'approved'");
    expect(guard).toContain('recipe.valid_from <= now()');
    expect(guard).toContain('recipe.valid_to IS NULL OR recipe.valid_to > now()');
  });

  it('exige grupo e produto pronto ativos na mesma medida, sem inventar disponibilidade comercial', () => {
    const finished = guard.split("ELSIF v_basis = 'finished_product_group'")[1];
    expect(finished).toContain('variant.measure_id = v_measure_id');
    expect(finished).toContain('variant.base_group_id = v_group_id');
    expect(finished).toContain("variant.status = 'active'");
    expect(finished).toContain('product.id = variant.finished_product_id');
    expect(finished).toContain("product.active AND product.unit = 'm'");
    expect(finished).toContain('product.group_id = variant.base_group_id');
    expect(finished).not.toContain('purchase_enabled');
  });

  it('converte somente identidade inequivoca, preservando UUID, ordem e geometria pelo merge JSON', () => {
    expect(backfill).toContain('HAVING count(DISTINCT variant.base_group_id) = 1');
    expect(backfill).toContain('internal_variant.internal_production_enabled');
    expect(backfill).toContain("recipe.status = 'approved'");
    expect(backfill).toContain('sheet.retired_at IS NULL');
    expect(backfill).toContain("(line.value - 'color_id' - 'base_group_id' - 'base_group_name') || jsonb_build_object(");
    expect(backfill).toContain("'color_mode', 'select_on_order'");
    expect(backfill).toContain("'internal_production_enabled', false");
    expect(backfill).toContain('ELSE line.value END ORDER BY line.ordinality');
    expect(backfill).not.toMatch(/'(?:consumption|consumption_per_size|technical_strap_line_id|id)'\s*,\s*(?:gen_random_uuid|\d)/);
    expect(sql).not.toMatch(/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/i);
  });

  it('nao escreve fatos nem catalogo comercial e restaura somente o trigger suspenso no backfill', () => {
    const targets = [...sql.matchAll(/\b(?:UPDATE|INSERT INTO|DELETE FROM)\s+public\.(\w+)/gi)].map((match) => match[1]);
    expect(targets).toEqual(['technical_sheets']);
    expect(backfill).toContain("to_jsonb(sheet) - 'strap_colors' - 'updated_at'");
    expect(backfill).toContain('DISABLE TRIGGER trg_mark_so_costs_dirty_from_sheet');
    for (const mode of ['', 'ALWAYS ', 'REPLICA ']) {
      expect(backfill).toContain(`ENABLE ${mode}TRIGGER trg_mark_so_costs_dirty_from_sheet`);
    }
    expect(backfill).not.toMatch(/DISABLE TRIGGER (?:ALL|USER)/);
  });
});

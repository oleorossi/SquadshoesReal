import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const MIGRATION = readFileSync(
  resolve(
    ROOT,
    'supabase/migrations/20270101029400_consumo_overlay_stale_recipe_yield.sql',
  ),
  'utf8',
);

/**
 * Overlay de TIPO com metragem de tira igual: o yield pinado da identidade
 * antiga NÃO pode continuar calculando base_required_m.
 * Caso vivo: Costurada 11 mm × GLOW (y=40) vs pin Chata 8 mm (y=70).
 */
describe('consumo overlay invalida receita/yield stale', () => {
  it('detecta pin de recipe_id com measure_id diferente da linha', () => {
    expect(MIGRATION).toContain('consumo_overlay_stale_recipe_yield_294');
    expect(MIGRATION).toContain('recipe_yield_stale_overlay');
    expect(MIGRATION).toContain('v_pinned_measure_id IS DISTINCT FROM v_measure_id');
  });

  it('sem receita do tipo novo limpa base e bloqueia (não reusa yield antigo)', () => {
    expect(MIGRATION).toContain('overlay_recipe_missing');
    expect(MIGRATION).toMatch(/v_resolved\s*-\s*'confirmed_yield_m_per_m'\s*-\s*'base_required_m'/);
  });

  it('reconsulta receita aprovada por medida×napa após invalidar pin', () => {
    expect(MIGRATION).toContain('r.measure_id = v_measure_id');
    expect(MIGRATION).toContain('r.base_group_id = v_base_group_id');
    expect(MIGRATION).toContain("r.status = 'approved'");
  });
});

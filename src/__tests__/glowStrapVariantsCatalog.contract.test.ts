import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const migration = readFileSync(resolve(
  ROOT,
  'supabase/migrations/20270101020500_garantir_variantes_tira_glow_cores.sql',
), 'utf8');

describe('SQL — variantes GLOW METALIC × medida × cor', () => {
  it('cria/reativa variantes reference_base ativas por cor linear', () => {
    expect(migration).toContain("upper(btrim(name)) IN ('GLOW METALIC', 'GLOW METALLIC')");
    expect(migration).toContain("identity_basis = 'reference_base'");
    expect(migration).toContain('internal_production_enabled = true');
    expect(migration).toContain('INSERT INTO public.artisanal_strap_variants');
    expect(migration).toContain('INSERT INTO public.products');
  });

  it('não grava designation oficial (approved_by) nem ON CONFLICT frágil', () => {
    expect(migration).not.toContain('INSERT INTO public.base_material_color_official_products');
    expect(migration).not.toContain('ON CONFLICT DO NOTHING');
    expect(migration).toContain('unico candidato linear');
  });

  it('realinha strap_sourcing de PVs abertos sem demanda vigente', () => {
    expect(migration).toContain('sale_order_strap_demands');
    expect(migration).toContain('strap_sourcing = v_new');
    expect(migration).toContain('strap_variant_id');
    expect(migration).toContain('recipe_id');
    expect(migration).toContain('base_product_id');
  });

  it('pós-condição exige variante ativa para cada receita×cor', () => {
    expect(migration).toContain('v_missing');
    expect(migration).toContain('faltam % variantes ativas GLOW');
  });
});

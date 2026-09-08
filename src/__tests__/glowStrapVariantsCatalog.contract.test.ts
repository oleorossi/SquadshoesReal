import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const migration = readFileSync(resolve(
  ROOT,
  'supabase/migrations/20270101020800_garantir_variantes_tira_glow_cores.sql',
), 'utf8');

describe('SQL — variantes GLOW METALIC × medida × cor', () => {
  it('cria/reativa variantes reference_base ativas por cor linear', () => {
    expect(migration).toContain("upper(btrim(name)) IN ('GLOW METALIC', 'GLOW METALLIC')");
    expect(migration).toContain("identity_basis = 'reference_base'");
    expect(migration).toContain('internal_production_enabled = true');
    expect(migration).toContain('INSERT INTO public.artisanal_strap_variants');
    expect(migration).toContain('INSERT INTO public.products');
  });

  it('designa SKU oficial antes de criar variante reference_base', () => {
    expect(migration).toContain('INSERT INTO public.base_material_color_official_products');
    expect(migration).toContain('approved_by');
    expect(migration).toContain('SKU unico e inequivoco');
    expect(migration).toContain('49371f4d-641f-466d-be26-686ef57743ec');
  });

  it('realinha strap_sourcing de PVs abertos sem demanda vigente', () => {
    expect(migration).toContain('sale_order_strap_demands');
    expect(migration).toContain('strap_sourcing = v_new');
    expect(migration).toContain('strap_variant_id');
    expect(migration).toContain('recipe_id');
    expect(migration).toContain('base_product_id');
  });

  it('não usa min(uuid) — Postgres não tem aggregate min em uuid', () => {
    // PG do projeto quebrou db push em 08/09/2026 com min(p.id).
    expect(migration).not.toMatch(/\bmin\s*\(\s*p\.id\s*\)/i);
    expect(migration).toContain('(array_agg(p.id ORDER BY p.created_at NULLS LAST, p.id))[1]');
  });

  it('pós-condição exige variante ativa GLOW×COBRE', () => {
    expect(migration).toContain('v_missing_cobre');
    expect(migration).toContain('faltam % variantes GLOW×medida×COBRE');
  });
});

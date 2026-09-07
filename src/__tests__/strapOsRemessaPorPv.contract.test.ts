import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const MIGRATION = 'supabase/migrations/20270101018200_strap_os_remessa_por_pv.sql';

describe('strap OS remessa por PV migration contract', () => {
  const sql = readFileSync(MIGRATION, 'utf8');

  it('amarra OS aberta ao sale_order_id (não só ao contractor)', () => {
    expect(sql).toContain('strap-pv-remessa:');
    expect(sql).toContain('so.sale_order_id IS NOT DISTINCT FROM v_sale_order_id');
    expect(sql).toContain('OS de remessa do PV');
  });

  it('precifica linha com MO + frete via helper', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.strap_remessa_unit_price_per_m');
    expect(sql).toContain('preco_prestador_per_m');
    expect(sql).toContain('strap_freight_amount');
    expect(sql).toContain('strap_remessa_unit_price_per_m(v_recipe_id, v_recipe.default_contractor_id)');
  });

  it('expõe ensure_pv_strap_remessa_service_order', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.ensure_pv_strap_remessa_service_order');
    expect(sql).toContain("service_order_domain = 'strap'");
  });
});

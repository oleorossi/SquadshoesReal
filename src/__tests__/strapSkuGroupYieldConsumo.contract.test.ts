/**
 * PV-00239: SKU OVERLOCK sem group_id fazia o consumo cair no yield 70 da
 * receita Hub em vez do 60 canônico em strap_group_napa_yields.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const MIGRATION = readFileSync(
  resolve(ROOT, 'supabase/migrations/20270101045400_strap-sku-group-yield-consumo.sql'),
  'utf8',
);

describe('strap SKU órfão → rendimento do grupo no consumo', () => {
  it('marca a migration e o resolvedor por nome', () => {
    expect(MIGRATION).toContain('strap_sku_group_yield_consumo_454');
    expect(MIGRATION).toContain('private.resolve_artisanal_strap_group_id_from_product');
    expect(MIGRATION).toContain('private.normalize_strap_name_key');
  });

  it('enrich passa a resolver grupo mesmo com products.group_id NULL', () => {
    expect(MIGRATION).toContain('resolve_artisanal_strap_group_id_from_product');
    expect(MIGRATION).toContain('group_yield_preferred');
    expect(MIGRATION).toContain('strap_group_napa_yields');
  });

  it('realinha demandas abertas e trava o caso vivo PV-00239 (60 → 13,44 m)', () => {
    expect(MIGRATION).toContain('yield_realigned_group_454');
    expect(MIGRATION).toContain('24a138cd-3d05-4999-be88-00b27f10290b');
    expect(MIGRATION).toContain('13.44');
    expect(MIGRATION).toContain('712ebcbd-a581-4d42-9706-622788d002db');
    expect(MIGRATION).toContain('168df73d-dc4a-4234-8130-faaf2fe62160');
  });

  it('alinha fallback Hub OVERLOCK 5 mm e SANTORINE do grupo para 60', () => {
    expect(MIGRATION).toContain("sg.name = 'TIRA OVERLOCK 5MM'");
    expect(MIGRATION).toContain("ng.name = 'NAPA SANTORINE'");
    expect(MIGRATION).toContain("t.name = 'TIRA OVERLOCK'");
    expect(MIGRATION).toContain('confirmed_yield_m_per_m');
    expect(MIGRATION).toMatch(/,\s*60,\s*v_old\.executor_type/);
  });
});

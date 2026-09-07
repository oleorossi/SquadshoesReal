import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const MIGRATION = 'supabase/migrations/20270101018100_strap_origem_pv_peel_napa_hub.sql';

describe('strap origem PV + peel napa migration contract', () => {
  const sql = readFileSync(MIGRATION, 'utf8');

  it('cria peel e aplica em resolve_strap_base_group_id', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.peel_strap_base_group_id');
    expect(sql).toContain('is_color_source IS TRUE');
    expect(sql).toContain('SELECT public.peel_strap_base_group_id(raw.group_id) FROM raw');
  });

  it('adiciona origem_padrao e preços na medida + frete no prestador', () => {
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS origem_padrao text NOT NULL DEFAULT 'escolhe_no_pv'");
    expect(sql).toContain('preco_artesanal_per_m');
    expect(sql).toContain('preco_prestador_per_m');
    expect(sql).toContain('strap_freight_amount');
    expect(sql).toContain('strap_freight_per_meters');
  });

  it('sugere Strass como sempre_sku_acabado', () => {
    expect(sql).toContain("origem_padrao = 'sempre_sku_acabado'");
    expect(sql).toContain("%STRASS%");
  });
});

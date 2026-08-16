import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SQL = readFileSync(
  resolve(__dirname, '../../supabase/migrations/20270101002000_regras-cor-solado-pintavel.sql'),
  'utf8',
);

describe('migration de regras de cor do solado', () => {
  it('modela o modo pintável sem sentinela na cor física', () => {
    expect(SQL).toMatch(/resolution_mode text NOT NULL DEFAULT 'fixed'/);
    expect(SQL).toMatch(/resolution_mode IN \('fixed', 'same_as_upper'\)/);
    expect(SQL).toMatch(/resolution_mode = 'same_as_upper' AND palmilha_color IS NULL/);
  });

  it('protege Preto → Preto no dado e no resolvedor', () => {
    expect(SQL).toMatch(/A regra Cabedal Preto → Solado Preto é obrigatória/);
    expect(SQL).toMatch(/IF v_input_key = 'preto' THEN/);
    expect(SQL).toMatch(/v_target_color := 'Preto'/);
  });

  it('propaga a cor para variante, consumo e baixa', () => {
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION public\.resolve_sole_for_variant_color/);
    expect(SQL).toMatch(/resolve_sole_for_variant_color\(p_material_variant_id, p_color\)/);
    expect(SQL).toMatch(/resolve_sole_for_variant_color\(v_variant_id, p_color\)/);
    expect(SQL).toMatch(/IF v_variant_id IS NULL AND v_resolved_product_id IS NULL THEN/);
  });

  it('expõe diagnóstico para variante física ausente', () => {
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION public\.sole_color_integrity_report/);
    expect(SQL).toMatch(/regra pintável usada em PV sem variante física ativa/);
  });
});

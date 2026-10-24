import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIG = readFileSync(
  resolve(__dirname, '../../supabase/migrations/20270101044700_palmilha-pronta-unicolor-padronizado.sql'),
  'utf8',
);

/**
 * Contrato do tipo Palmilha Pronta Unicolor Padronizado (grill 2026-10).
 */
describe('palmilha_pronta_unicolor_padronizado — migration', () => {
  it('adiciona o valor no enum', () => {
    expect(MIG).toMatch(/ADD VALUE IF NOT EXISTS 'palmilha_pronta_unicolor_padronizado'/);
  });

  it('expõe helpers de classificação e sync do kit', () => {
    expect(MIG).toMatch(/is_palmilha_pronta_class/);
    expect(MIG).toMatch(/is_unicolor_padronizado_class/);
    expect(MIG).toMatch(/sync_sheet_unicolor_sole_kit/);
    expect(MIG).toMatch(/kit_desc_covered_by_unicolor_sole/);
  });

  it('cascateia pronta clássica e unicolor; limpa kit só no unicolor', () => {
    expect(MIG).toMatch(/tg_cascade_palmilha_pronta_to_sheets/);
    expect(MIG).toMatch(/cascade_unicolor_kit_to_linked_sheets/);
    expect(MIG).toMatch(/v_entering_unicolor/);
    expect(MIG).toMatch(/v_leaving_unicolor/);
  });

  it('exige CARAMELO e sincroniza ao trocar solado da ficha', () => {
    expect(MIG).toMatch(/trg_require_caramelo_for_unicolor_sole/);
    expect(MIG).toMatch(/trg_sheet_sync_unicolor_sole_kit/);
    expect(MIG).toMatch(/group_has_active_caramelo_sole/);
  });

  it('não aplica Placa fibra/Solado/Forração do kit base quando unicolor', () => {
    expect(MIG).toMatch(/apply_base_material_kit_to_sheet/);
    expect(MIG).toMatch(/kit_desc_covered_by_unicolor_sole\(ki\.description\)/);
    // Não regride a 42100: '' quebra sheet_materials_consumption_sector_check.
    expect(MIG).toMatch(/NULL,\s*-- NUNCA ''/);
  });

  it('injeta resolve de cor CARAMELO no corpo vivo', () => {
    expect(MIG).toMatch(/unicolor_caramelo/);
    expect(MIG).toMatch(/sheet_sole_is_unicolor_padronizado/);
    expect(MIG).toMatch(/pg_get_functiondef/);
  });
});

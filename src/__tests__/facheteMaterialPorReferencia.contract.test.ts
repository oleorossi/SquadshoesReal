import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TECHNICAL_SHEET_CONSUMPTION_COLUMNS } from '@/lib/orderConsumption';

/**
 * Material do fachete é escolha da REFERÊNCIA (mig 20270101035400).
 *
 * Precedência do grupo do fachete, igual nos três motores (SQL by_grade,
 * orderConsumption.ts, bomConsumption.ts):
 *   variante (variant_drives_fachete) > technical_sheets.fachete_material >
 *   products.fachete_material_group_id do solado > lining_material da ficha.
 *
 * Antes a coluna existia mas só os gatilhos de custo a liam; o débito caía
 * calado na forração da ficha (ST15/ST17 debitavam NAPA SOFT sem escolha).
 */
const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const migration = read('supabase/migrations/20270101035400_fachete-material-por-referencia.sql');

describe('Fachete — material por referência', () => {
  it('SQL: ficha é lida antes do grupo do solado', () => {
    expect(migration).toContain("NULLIF(btrim(COALESCE(v_sheet.fachete_material, '''')), '''')");
    expect(migration).toContain('IF v_is_fachetado AND v_fachete_group IS NULL AND v_sole_product_id IS NOT NULL THEN');
    // patch idempotente e que falha alto se o corpo mudar
    expect(migration).toContain('fachete_material_por_referencia_20270101035400');
    expect(migration).toContain('âncora do fachete não encontrada');
  });

  it.each(['src/lib/orderConsumption.ts', 'src/lib/bomConsumption.ts'])(
    '%s: variante > ficha > solado > forração',
    (path) => {
      const src = read(path);
      expect(src).toContain(
        "facheteVariantGroup || facheteSheetGroup || facheteGroupName || (sheet?.lining_material || '')",
      );
      expect(src).toContain("String(sheet?.fachete_material || '').trim()");
      // o grupo escolhido na ficha precisa entrar no escopo de produtos carregados
      expect(src).toContain('addGroupByName(s.fachete_material)');
    },
  );

  it('a ficha de operador / tela de consumo buscam a coluna', () => {
    expect(TECHNICAL_SHEET_CONSUMPTION_COLUMNS).toMatch(/\bfachete_material\b/);
  });
});

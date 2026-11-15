/**
 * A migração de linhas adicionais já foi aplicada no banco. O arquivo no repo
 * precisa conservar o comentário get_effective_bom: o self-test G16 exige que
 * o corpo de calculate_order_consumption_by_grade contenha esse texto.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SQL = readFileSync(
  resolve('supabase/migrations/20270101045900_fix_additional_material_lines_consumption.sql'),
  'utf8',
);

describe('linhas adicionais da ficha — migration 20270101045900', () => {
  it('mantém o marcador G16 (get_effective_bom) no motor por grade', () => {
    expect(SQL).toContain('CREATE OR REPLACE FUNCTION public.sheet_material_lines_required');
    expect(SQL).toContain('public.get_effective_bom(p_sheet_id, p_variant_id)');
    const byGrade = SQL.indexOf('CREATE OR REPLACE FUNCTION public.calculate_order_consumption_by_grade');
    expect(byGrade).toBeGreaterThan(0);
    expect(SQL.slice(byGrade)).toContain('public.get_effective_bom');
    expect(SQL).toContain('FIX-BOM-LINES-20270101045900');
  });
});

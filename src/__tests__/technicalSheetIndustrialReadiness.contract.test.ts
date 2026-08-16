import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pageSource = readFileSync('src/pages/TechnicalSheets.tsx', 'utf8');
const migrationSource = readFileSync(
  'supabase/migrations/20270101004000_technical_sheet_industrial_readiness.sql',
  'utf8',
);

describe('contrato de integração da ficha técnica', () => {
  it('persiste o UUID do solado e usa o payload correto na aplicação em massa', () => {
    expect(pageSource).toContain("updateField('primary_sole_id' as any, productId || null)");
    expect(pageSource).toContain('updateSheet.mutateAsync({ id: target.id, data: patch })');
  });

  it('não oferece um segundo cadastro morto de material de fachete', () => {
    expect(pageSource).not.toContain("onValueChange={v => updateField('fachete_material', v)}");
    expect(pageSource).toContain('O grupo vem do solado principal');
  });

  it('mantém a auditoria alinhada às construções especiais e à unidade de estoque', () => {
    expect(migrationSource).toContain('NOT COALESCE(ts.has_straps, false)');
    expect(migrationSource).toContain('NOT COALESCE(ts.insole_ready_made, false)');
    expect(migrationSource).toContain('sole_color_conjugations');
    expect(migrationSource).toContain('unit_configuration_issue');
    expect(migrationSource).toContain('area_material_width_missing');
  });
});

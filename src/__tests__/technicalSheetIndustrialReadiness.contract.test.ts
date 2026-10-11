import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pageSource = readFileSync('src/pages/TechnicalSheets.tsx', 'utf8');
const migrationSource = readFileSync(
  'supabase/migrations/20270101004000_technical_sheet_industrial_readiness.sql',
  'utf8',
);

describe('contrato de integração da ficha técnica', () => {
  it('persiste o UUID do solado e usa o payload correto na aplicação em massa', () => {
    expect(pageSource).toContain("updateField('primary_sole_id', productId || null)");
    expect(pageSource).toContain('updateSheet.mutateAsync({ id: target.id, data: patch })');
  });

  // Até 11/10/2026 o campo era MORTO (o débito ignorava fachete_material) e
  // este teste proibia oferecê-lo. A mig 20270101035400 fez o motor SQL lê-lo
  // antes do grupo do solado — o campo agora é a escolha da referência e o
  // contrato passa a ser: a ficha edita E o débito lê.
  it('o material do fachete da ficha é editável e é lido pelo débito', () => {
    expect(pageSource).toContain("onChange={v => updateField('fachete_material', v)}");
    const facheteMigration = readFileSync(
      'supabase/migrations/20270101035400_fachete-material-por-referencia.sql',
      'utf8',
    );
    expect(facheteMigration).toContain('v_sheet.fachete_material');
  });

  it('mantém a auditoria alinhada às construções especiais e à unidade de estoque', () => {
    expect(migrationSource).toContain('NOT COALESCE(ts.has_straps, false)');
    expect(migrationSource).toContain('NOT COALESCE(ts.insole_ready_made, false)');
    expect(migrationSource).toContain('sole_color_conjugations');
    expect(migrationSource).toContain('unit_configuration_issue');
    expect(migrationSource).toContain('area_material_width_missing');
  });
});

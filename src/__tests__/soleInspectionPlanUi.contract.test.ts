import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');

describe('Plano de inspeção por família de solado', () => {
  it('migration cria sole_inspection_plan em product_groups', () => {
    const mig = read('supabase/migrations/20270101017100_sole-audit-restore-parity-inspection.sql');
    expect(mig).toContain('ADD COLUMN IF NOT EXISTS sole_inspection_plan jsonb');
    expect(mig).toMatch(/NÃO inventar valores|NÃO inventa/i);
  });

  it('Cadastro do Hub monta SoleInspectionPlanPanel', () => {
    const cadastro = read('src/components/soles-hub/SolesCadastroTab.tsx');
    expect(cadastro).toContain('SoleInspectionPlanPanel');
    expect(cadastro).toContain('soleGroupId={groupId}');
  });

  it('checklist do dono documenta specs + fachete + lab', () => {
    const doc = read('docs/SOLADOS_ACOES_DONO.md');
    expect(doc).toContain('INFANTIL');
    expect(doc).toContain('is_fachetado');
    expect(doc).toContain('Plano de inspeção');
    expect(doc).toContain('não inventa');
  });
});

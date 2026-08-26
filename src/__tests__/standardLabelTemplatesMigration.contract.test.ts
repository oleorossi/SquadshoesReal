import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

const migration = read('supabase/migrations/20270101013050_standardize_l42pro_label_templates.sql');
const generatorTab = read('src/components/label-system/LabelTemplatesTab.tsx');
const productionTab = read('src/components/label-system/LabelProductionTab.tsx');
const analytics = read('src/components/label-system/LabelAnalyticsDashboard.tsx');

describe('Etiquetas L42PRO · contrato de modelos padronizados', () => {
  it('preserva o legado inativo e cria exatamente os dois padrões físicos 50 × 30', () => {
    expect(migration).toContain("'external_box_l42pro'");
    expect(migration).toContain("'individual_package_l42pro'");
    expect(migration.match(/'label_width_mm', 50/g)).toHaveLength(2);
    expect(migration.match(/'label_height_mm', 30/g)).toHaveLength(2);
    expect(migration.match(/'columns', 2/g)).toHaveLength(2);
    expect(migration.match(/'column_gap_mm', 6/g)).toHaveLength(2);
    expect(migration.match(/'page_width_mm', 106/g)).toHaveLength(2);
    expect(migration).toContain('WHERE system_key IS NULL');
    expect(migration).toContain('SET is_active = false');
    expect(migration.match(/'required_fields', jsonb_build_array\('reference', 'color', 'material'\)/g)).toHaveLength(2);
    expect(migration.match(/'position', jsonb_build_object/g)).toHaveLength(6);
    expect(migration.match(/'styling', jsonb_build_object/g)).toHaveLength(6);
    expect(migration).not.toMatch(/DELETE\s+FROM\s+public\.label_templates/i);
  });

  it('remove escrita do cliente, preserva a leitura do histórico e pode recriar a policy', () => {
    expect(migration).toContain('ALTER TABLE public.label_templates ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('REVOKE ALL PRIVILEGES ON TABLE public.label_templates FROM PUBLIC, anon');
    expect(migration).toContain('REVOKE ALL PRIVILEGES ON TABLE public.label_templates FROM authenticated');
    expect(migration).toContain('GRANT SELECT ON TABLE public.label_templates TO authenticated');
    expect(migration).toContain('DROP POLICY IF EXISTS "Approved users can view standard label templates"');
    for (const historicalPolicy of [
      'Public read templates',
      'Public read label_templates',
      'Anyone can view label_templates',
    ]) {
      expect(migration).toContain(`DROP POLICY IF EXISTS "${historicalPolicy}"`);
    }
    expect(migration).toContain('Approved users can view standard label templates');
    expect(migration).toContain('(SELECT public.is_approved_user())');
    expect(migration).toContain("FROM pg_policies");
    expect(migration).toContain("cmd IN ('SELECT', 'ALL')");
    expect(migration).toContain('Política de leitura concorrente encontrada em label_templates');
    expect(migration).toContain("has_table_privilege('authenticated', 'public.label_templates', 'MAINTAIN')");
    expect(migration).toContain("IF v_standard_count <> 2 THEN");
    expect(migration).not.toMatch(/USING\s*\([^;]*system_key IS NOT NULL/is);
  });

  it('não deixa o designer livre nem o renderizador customizado alcançáveis', () => {
    for (const source of [generatorTab, productionTab]) {
      expect(source).not.toContain("@/hooks/useLabelTemplates");
      expect(source).not.toContain("@/lib/templateLabels");
      expect(source).not.toContain('LabelDesigner');
      expect(source).not.toContain('buildTemplateLabelsHtml');
    }
    expect(generatorTab).not.toContain('Novo modelo');
    expect(generatorTab).not.toContain('onValueChange={setSelectedThermalTemplateId}');
    expect(generatorTab).toContain('row.system_key === expectedSystemKey');
    expect(analytics).toContain("value.includes('embalagem individual')");
    for (const retiredPath of [
      'src/components/label-system/LabelDesigner.tsx',
      'src/hooks/useLabelTemplates.ts',
      'src/lib/templateLabels.ts',
      'src/services/label-optimization.ts',
      'src/types/label-system.ts',
    ]) {
      expect(existsSync(resolve(ROOT, retiredPath))).toBe(false);
    }
  });
});

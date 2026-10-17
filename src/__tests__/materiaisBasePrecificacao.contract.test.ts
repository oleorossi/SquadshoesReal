import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(process.cwd());
const MIGRATION = resolve(
  ROOT,
  'supabase/migrations/20270101042000_materiais-base-precificacao-rascunho.sql',
);

describe('Materiais base · precificação rascunho', () => {
  it('migration define kits, sheet_materials draft e portão de publicação', () => {
    expect(existsSync(MIGRATION)).toBe(true);
    const sql = readFileSync(MIGRATION, 'utf8');
    expect(sql).toContain('base_material_kits');
    expect(sql).toContain('base_material_kit_items');
    expect(sql).toContain('ALTER COLUMN product_id DROP NOT NULL');
    expect(sql).toContain('include_in_consumption');
    expect(sql).toContain('tg_block_publish_with_draft_materials');
    expect(sql).toContain('apply_base_material_kit_to_sheet');
    expect(sql).toContain("'Rasteirinha'");
  });

  it('UI e navegação concentram materiais base em Engenharia', () => {
    const nav = readFileSync(resolve(ROOT, 'src/data/navigation.ts'), 'utf8');
    expect(nav).toContain("'/engenharia/materiais-base'");
    expect(nav).toContain('MateriaisBasePage');

    const access = readFileSync(resolve(ROOT, 'src/hooks/useAccessControl.ts'), 'utf8');
    expect(access).toContain("'/engenharia/materiais-base': 'produtos'");

    const app = readFileSync(resolve(ROOT, 'src/App.tsx'), 'utf8');
    expect(app).toContain('engenharia/materiais-base');
    expect(app).toContain('MateriaisBasePage');

    const sheets = readFileSync(resolve(ROOT, 'src/pages/TechnicalSheets.tsx'), 'utf8');
    expect(sheets).toContain('PricingBomGrid');

    const addSheet = readFileSync(resolve(ROOT, 'src/hooks/useTechnicalSheets.ts'), 'utf8');
    expect(addSheet).toContain('applyBaseMaterialKitToSheet');
  });

  it('consumo ignora linhas de kit/ajuste/só-precificação', () => {
    const motor = readFileSync(resolve(ROOT, 'src/lib/orderConsumption.ts'), 'utf8');
    expect(motor).toContain('include_in_consumption !== false');
    expect(motor).toContain("line_kind !== 'ajuste'");
    expect(motor).toContain("cost_mode !== 'fixed_per_pair'");
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20270101043600_elastico-especial-g-width-leaves.sql'),
  'utf8',
);
const sheetSelectors = readFileSync(
  resolve(process.cwd(), 'src/components/technical-sheets/sheetSelectors.tsx'),
  'utf8',
);
const groupEdit = readFileSync(
  resolve(process.cwd(), 'src/components/groups/GroupEditDialog.tsx'),
  'utf8',
);
const groupColors = readFileSync(
  resolve(process.cwd(), 'src/lib/groupColorProducts.ts'),
  'utf8',
);
const createWidth = readFileSync(
  resolve(process.cwd(), 'src/lib/createWidthLeafGroup.ts'),
  'utf8',
);

describe('ELÁSTICO ESPECIAL G — folhas por largura', () => {
  it('migration cria default_unit_price, move SKUs pra 25MM e remapeia ficha', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS default_unit_price');
    expect(migration).toContain("'25MM'");
    expect(migration).toContain("'20MM'");
    expect(migration).toContain("'30MM'");
    expect(migration).toContain('SET group_id = v_leaf_25');
    expect(migration).toContain('is_family = true');
    expect(migration).toContain('upper_material_group_id = v_leaf_25');
    expect(migration).toContain("THEN '25MM'");
  });

  it('seletor da ficha faz cascata família → folha', () => {
    expect(sheetSelectors).toContain('browseFamilyId');
    expect(sheetSelectors).toContain('setBrowseFamilyId');
    expect(sheetSelectors).toContain('Famílias · escolha para ver as larguras');
    expect(sheetSelectors).toContain('Larguras / grupos desta família');
  });

  it('janela do grupo cria largura e persiste default_unit_price', () => {
    expect(groupEdit).toContain('Nova largura');
    expect(groupEdit).toContain('createWidthLeafGroup');
    expect(groupEdit).toContain('default_unit_price');
    expect(groupEdit).toContain("setActiveTab('bulk')");
    expect(createWidth).toContain('dimensions_width: widthMm');
    expect(createWidth).toContain('default_unit_price: defaultPrice');
  });

  it('criação de cor herda default_unit_price da folha', () => {
    expect(groupColors).toContain('default_unit_price');
    expect(groupColors).toContain('Number(group.default_unit_price)');
  });
});

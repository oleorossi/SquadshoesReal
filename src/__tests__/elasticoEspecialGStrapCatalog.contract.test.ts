import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const migration = readFileSync(
  resolve(ROOT, 'supabase/migrations/20270101046800_elastico-especial-g-strap-catalog.sql'),
  'utf8',
);
const policy = readFileSync(
  resolve(ROOT, 'src/lib/technicalStrapSourcePolicy.ts'),
  'utf8',
);
const technicalSheets = readFileSync(
  resolve(ROOT, 'src/pages/TechnicalSheets.tsx'),
  'utf8',
);
const inventorySelection = readFileSync(
  resolve(ROOT, 'src/lib/strapInventorySelection.ts'),
  'utf8',
);

describe('ELÁSTICO ESPECIAL G via grupo de estoque na ficha', () => {
  it('seeda tipo + medidas 20/25/30 buy-ready no catálogo (ponte PV)', () => {
    expect(migration).toContain("'ELÁSTICO ESPECIAL G'");
    expect(migration).toContain("'20 mm'");
    expect(migration).toContain("'25 mm'");
    expect(migration).toContain("'30 mm'");
    expect(migration).toContain("'sempre_sku_acabado'");
    expect(migration).toContain('is_artisanal_strap = true');
  });

  it('a ficha escolhe grupo de estoque, não só o Hub', () => {
    expect(technicalSheets).toContain('Grupo de estoque da tira');
    expect(technicalSheets).toContain('applyStockStrapGroupToLine');
    expect(technicalSheets).toContain('isStrapInventorySelectableGroup');
    expect(technicalSheets).toContain('hasTechnicalStrapLineIdentity');
    expect(technicalSheets).not.toContain('Família e medida canônicas');
    expect(technicalSheets).not.toContain('Gerenciar catálogo de tiras');
  });

  it('a lib aceita folha estreita e resolve medida Hub pela família', () => {
    expect(inventorySelection).toContain('isStrapInventorySelectableGroup');
    expect(inventorySelection).toContain('resolveHubMeasureForStockGroup');
    expect(inventorySelection).toContain('ROLL_WIDTH_FLOOR_MM');
  });

  it('policy libera buy-ready pinado sem exigir medida Hub', () => {
    expect(policy).toContain("strapIdentityBasis(line) === 'finished_product_group' && line.identity_group_id");
    expect(policy).toContain('buyReadyGroupsFromInventory');
  });
});

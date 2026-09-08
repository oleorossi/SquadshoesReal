import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const migration = readFileSync(
  resolve(root, 'supabase/migrations/20270101021100_consumo-sheet-strap-gap-preview.sql'),
  'utf8',
);
const dialog = readFileSync(
  resolve(root, 'src/components/orders/OrderConsumptionDialog.tsx'),
  'utf8',
);

describe('consumo: gap de tira da ficha ausente do snapshot do item', () => {
  it('21100 une strap_colors da ficha no payload do preview do batch', () => {
    expect(migration).toContain('sheet_strap_gap_consumo_211');
    expect(migration).toContain('merge_consumo_strap_colors_with_sheet_gaps');
    expect(migration).toContain('sheet_strap_missing_from_item_snapshot');
    expect(migration).toContain('consumo_sheet_gap');
    expect(migration).toContain('calculate_consumption_report_batch');
    expect(migration).toContain('unresolved_names_ficha_20270101020700');
  });

  it('dialog de OP não esconde Tiras com aviso e quantidade zero', () => {
    expect(dialog).toContain("row.componentType === 'Tiras'");
    expect(dialog).not.toMatch(
      /\.filter\(\(row\) => !\(row\.warning && !\(row\.totalQuantity > 0\)\)\)/,
    );
  });
});

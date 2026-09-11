import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const migration211 = readFileSync(
  resolve(root, 'supabase/migrations/20270101021100_consumo-sheet-strap-gap-preview.sql'),
  'utf8',
);
const migration218 = readFileSync(
  resolve(root, 'supabase/migrations/20270101021800_consumo-committed-draft-sheet-strap-gap.sql'),
  'utf8',
);
const migration231 = readFileSync(
  resolve(
    root,
    'supabase/migrations/20270101023100_consumo-sheet-strap-structure-overlay-draft.sql',
  ),
  'utf8',
);
const dialog = readFileSync(
  resolve(root, 'src/components/orders/OrderConsumptionDialog.tsx'),
  'utf8',
);
const report = readFileSync(
  resolve(root, 'src/lib/materialConsumptionReport.ts'),
  'utf8',
);

describe('consumo: gap de tira da ficha ausente do snapshot do item', () => {
  it('21100 une strap_colors da ficha no payload do preview do batch', () => {
    expect(migration211).toContain('sheet_strap_gap_consumo_211');
    expect(migration211).toContain('merge_consumo_strap_colors_with_sheet_gaps');
    expect(migration211).toContain('sheet_strap_missing_from_item_snapshot');
    expect(migration211).toContain('consumo_sheet_gap');
    expect(migration211).toContain('calculate_consumption_report_batch');
    expect(migration211).toContain('unresolved_names_ficha_20270101020700');
  });

  it('21800 aplica o merge no draft comprometido (senão 21100 vira no-op)', () => {
    expect(migration218).toContain('sheet_strap_gap_committed_draft_217');
    expect(migration218).toContain('merge_consumo_strap_colors_with_sheet_gaps');
    expect(migration218).toContain('sheet_strap_missing_from_item_snapshot');
    expect(migration218).toContain('preview_sale_order_strap_demand_draft');
    expect(migration218).toContain('consumo_sheet_gap');
    // Dois payloads (item + OP) + lookup de v_stored_line.
    expect(migration218).toContain("esperava 2 assignments strap_colors:=v_item");
    expect(migration218).toContain('esperava >=3 chamadas ao merge');
  });

  it('23100 overlay estrutural só em PV não comprometido (NL03 TRASEIRA measure drift)', () => {
    expect(migration231).toContain('sheet_strap_structure_overlay_consumo_231');
    expect(migration231).toContain('consumo_sheet_structure_overlay');
    expect(migration231).toContain('p_overlay_structure');
    expect(migration231).toContain('v_overlay_structure');
    expect(migration231).toContain('is_committed_sale_order_status');
    // batch: overlay = NOT committed (Rascunho/Pendente)
    expect(migration231).toMatch(
      /v_overlay_structure\s*:=\s*NOT\s+private\.is_committed_sale_order_status/,
    );
    // 2-arg (draft comprometido / 218) continua gap-only
    expect(migration231).toMatch(
      /merge_consumo_strap_colors_with_sheet_gaps\(\s*p_item_straps,\s*p_reference_id,\s*false\s*\)/,
    );
    // mesmo technical_strap_line_id: copia measure_id da ficha
    expect(migration231).toContain("'measure_id', v_sheet_line -> 'measure_id'");
    expect(migration231).toContain("'strap_type_id', v_sheet_line -> 'strap_type_id'");
    // preserva escolha comercial do PV
    expect(migration231).toContain("'color', v_item_line -> 'color'");
    expect(migration231).toContain('base_group_id');
  });

  it('dialog de OP não esconde Tiras com aviso e quantidade zero', () => {
    expect(dialog).toContain("row.componentType === 'Tiras'");
    expect(dialog).not.toMatch(
      /\.filter\(\(row\) => !\(row\.warning && !\(row\.totalQuantity > 0\)\)\)/,
    );
  });

  it('PDF deixa claro que STRASS comprada pronta fica em §02, não na napa', () => {
    expect(report).toMatch(/Tira Strass|§02|comprada pronta/i);
    expect(report).toMatch(/STRASS/i);
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const migration = readFileSync(
  resolve(root, 'supabase/migrations/20270101020900_consumo-strass-labels-snapshot-incompleto.sql'),
  'utf8',
);
const parser = readFileSync(
  resolve(root, 'src/lib/canonicalStrapDemandPreview.ts'),
  'utf8',
);

describe('consumo STRASS: labels no snapshot pré-demanda', () => {
  it('migration enriquece resolved incompleto com nome/cor/medida', () => {
    expect(migration).toContain('strap_incomplete_display_labels_203');
    expect(migration).toContain("'strap_product_name'");
    expect(migration).toContain("'strap_color_name'");
    expect(migration).toContain("'measure_name'");
    expect(migration).toContain('v_frozen_finished_product_id');
    expect(migration).toContain("v_stored_line ->> 'group_name'");
    expect(migration).toContain('preview_sale_order_strap_demand_draft(jsonb)');
  });

  it('parser TS lê group_name/label/color quando strap_product_name falta', () => {
    expect(parser).toContain('resolved.group_name');
    expect(parser).toContain('resolved.label');
    expect(parser).toContain('resolved.color');
    expect(parser).toContain('preview.sourceMode !== ok.sourceMode');
  });
});

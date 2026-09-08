import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const migration209 = readFileSync(
  resolve(root, 'supabase/migrations/20270101020900_consumo-strass-labels-snapshot-incompleto.sql'),
  'utf8',
);
const migration210 = readFileSync(
  resolve(root, 'supabase/migrations/20270101021000_consumo-strass-display-labels-sempre.sql'),
  'utf8',
);
const parser = readFileSync(
  resolve(root, 'src/lib/canonicalStrapDemandPreview.ts'),
  'utf8',
);

describe('consumo STRASS: labels no snapshot pré-demanda', () => {
  it('20900 enriquece o ramo incompleto com nome/cor/medida', () => {
    expect(migration209).toContain('strap_incomplete_display_labels_203');
    expect(migration209).toContain("'strap_product_name'");
    expect(migration209).toContain("'strap_color_name'");
    expect(migration209).toContain("'measure_name'");
    expect(migration209).toContain('v_frozen_finished_product_id');
    expect(migration209).toContain("v_stored_line ->> 'group_name'");
    expect(migration209).toContain('preview_sale_order_strap_demand_draft(jsonb)');
  });

  it('21000 backfill SEMPRE antes do RETURN (não só pré-demanda)', () => {
    expect(migration210).toContain('strap_display_labels_210');
    expect(migration210).toContain('RETURN QUERY SELECT');
    expect(migration210).toContain("'strap_product_name'");
    expect(migration210).toContain("'strap_color_name'");
    expect(migration210).toContain("'measure_name'");
    expect(migration210).toContain('v_frozen_finished_product_id');
    expect(migration210).toContain("v_stored_line ->> 'group_name'");
    // Não deve early-return pela marca fraca da 209 — senão o reforço vira no-op.
    expect(migration210).not.toMatch(
      /IF position\('strap_incomplete_display_labels_203' IN v_definition\) > 0 THEN\s*RETURN/s,
    );
  });

  it('parser TS lê group_name/label/color quando strap_product_name falta', () => {
    expect(parser).toContain('resolved.group_name');
    expect(parser).toContain('resolved.label');
    expect(parser).toContain('resolved.color');
    expect(parser).toContain('preview.sourceMode !== ok.sourceMode');
  });
});

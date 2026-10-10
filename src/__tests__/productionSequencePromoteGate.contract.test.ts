import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const mig = readFileSync(
  resolve(__dirname, '../../supabase/migrations/20270101031100_production_sequence_promote_gate.sql'),
  'utf8',
);

describe('production sequence promote gate (contract)', () => {
  it('expõe sale_order_item_factory_gate_block_reason', () => {
    expect(mig).toContain('sale_order_item_factory_gate_block_reason');
    expect(mig).toContain('received_at_factory');
    expect(mig).toContain('atelier_complex_references');
  });

  it('injeta a porta em promote_sale_order_item (skip, não aborta atômico)', () => {
    expect(mig).toContain('promote_sale_order_item');
    expect(mig).toContain("'skipped', true");
    expect(mig).toContain('patch_promote_gate');
  });

  it('release_corte_lookahead usa a mesma função', () => {
    expect(mig).toContain('release_corte_lookahead_items');
    expect(mig).toContain('patch_release_gate');
  });

  it('não reintroduz hard-fail de material (Q#2)', () => {
    expect(mig).toMatch(/Q aberta #2|Q aberta #2/i);
    expect(mig.toLowerCase()).not.toMatch(/waste_pct|consumption_loss/);
  });
});

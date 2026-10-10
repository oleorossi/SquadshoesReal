import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(process.cwd(), 'supabase/migrations');

function read(name: string) {
  return readFileSync(join(ROOT, name), 'utf8');
}

describe('pv material commitments soft pegging (contract)', () => {
  const core = read('20270101030600_pv_material_commitments_core.sql');
  const wire = read('20270101030700_pv_material_commitments_wire.sql');

  it('adds sale_order_id and commit/cover/list RPCs', () => {
    expect(core).toMatch(/ADD COLUMN IF NOT EXISTS sale_order_id/);
    expect(core).toMatch(/commit_sale_order_material_demand/);
    expect(core).toMatch(/cover_open_material_commitments/);
    expect(core).toMatch(/list_material_commitments_by_pv/);
    expect(core).toMatch(/list_material_commitments_by_product/);
    expect(core).toMatch(/commitment_cover_priority/);
  });

  it('excludes Solado and strap products from demand writer', () => {
    expect(core).toMatch(/v_comp = 'Solado'/);
    expect(core).toMatch(/primary_sole',\s*'variant_sole'/);
    expect(core).toMatch(/sale_order_strap_demands/);
  });

  it('wires hybrid adopt + promote commit + atelier adopt + cancel/cover triggers', () => {
    expect(wire).toMatch(/adopted_commitment/);
    expect(wire).toMatch(/commit_sale_order_material_demand/);
    expect(wire).toMatch(/atelier_linked/);
    expect(wire).toMatch(/tg_release_pv_commitments_on_cancel/);
    expect(wire).toMatch(/tg_cover_commitments_on_stock_in/);
    expect(wire).toMatch(/pv_commitment/);
    // Injeta commit DEPOIS do refresh de freeze de tiras — não apaga o marker 23800.
    expect(wire).toContain(
      'PERFORM private.refresh_draft_strap_freeze_for_confirmation(p_sale_order_id);',
    );
    expect(wire).toContain(
      'PERFORM public.commit_sale_order_material_demand(p_sale_order_id);',
    );
  });

  it('consolidates sibling OP soft rows into one pv_commitment', () => {
    expect(core).toMatch(/consolidado em pv_commitment/);
    const patch = read('20270101030800_pv_material_commitments_consolidate_siblings.sql');
    expect(patch).toMatch(/consolidado em pv_commitment/);
  });
});

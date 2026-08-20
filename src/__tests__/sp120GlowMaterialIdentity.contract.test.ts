import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20270101005800_sp120_glow_material_identity.sql'),
  'utf8',
);

describe('SP120 — identidade GLOW METALIC / OURO LIGHT', () => {
  it('cadastra material antes da cor para NAPA SUDANI e GLOW METALIC', () => {
    expect(migration).toContain("upper(btrim(name)) = 'SP120'");
    expect(migration).toContain("'SP120-SUDANI'");
    expect(migration).toContain("'SP120-GLOW'");
    expect(migration).toContain("lining_material_group_id = v_sudani_group_id");
    expect(migration).toContain("lining_material_group_id = v_glow_group_id");
    expect(migration).toContain('variant_drives_lining = true');
  });

  it('desativa o SKU incorreto e redireciona somente a OC sugerida não recebida', () => {
    expect(migration).toContain("sku = 'NAPA-SUDANI-OURO-LIGHT'");
    expect(migration).toMatch(/UPDATE public\.products[\s\S]*SET active = false/);
    expect(migration).toMatch(/UPDATE public\.purchase_order_items[\s\S]*po\.status = 'suggested'/);
    expect(migration).toContain('coalesce(poi.received_quantity, 0) = 0');
    expect(migration).toContain('unit_price = v_glow_product.unit_price');
  });

  it('impede que OURO LIGHT volte a ser cadastrado em NAPA SOFT ou NAPA SUDANI', () => {
    expect(migration).toContain('guard_ouro_light_material_family');
    expect(migration).toContain("v_group_name IN ('NAPA SOFT', 'NAPA SUDANI')");
    expect(migration).toContain("OURO LIGHT pertence ao grupo GLOW METALIC");
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(resolve(
  __dirname,
  '../../supabase/migrations/20270101052400_oc_aberta_abate_falta.sql',
), 'utf8');

describe('Gerar OC abate OC aberta', () => {
  it('desconta o saldo pendente do mesmo pedido e material', () => {
    expect(migration).toContain('open_purchase_pending_qty');
    expect(migration).toContain('oc_aberta_abate_20270101052400');
    expect(migration).toContain('list_pv_material_coverage');
    expect(migration).toContain("so.order_number IS DISTINCT FROM 'PV-00249'");
    expect(migration).toContain('PV-00238');
    expect(migration).toContain('PV-00250');
    expect(migration).not.toContain('auto_motor_enabled = true');
  });
});

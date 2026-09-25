import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIG = resolve(
  __dirname,
  '../../supabase/migrations/20270101028600_pv-tira-pronta-sku-sem-group-id-vira-fabrica.sql',
);

describe('sku_acabado sem group_id vira fábrica no writer (G03)', () => {
  const sql = readFileSync(MIG, 'utf8');

  it('prepare reescreve pv_origem antes do ramo buy_ready', () => {
    expect(sql).toContain('strap_pv_sku_sem_group_id_vira_fabrica_20270101028600');
    expect(sql).toContain("jsonb_build_object('pv_origem', 'fabrica')");
    expect(sql).toContain('prepare_sale_order_item_internal_straps');
  });

  it('guard de alinhamento aplica a mesma coerção', () => {
    expect(sql).toContain('tg_validate_sale_order_item_strap_color_alignment');
    expect(sql).toContain("nullif(v_line ->> 'group_id', '') IS NULL");
    expect(sql).toContain("nullif(v_line ->> 'identity_group_id', '') IS NULL");
  });
});

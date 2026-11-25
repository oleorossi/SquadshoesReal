import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(__dirname, '../../supabase/migrations/20270101054400_outbox_oc_tira_artesanal_coluna_do_grupo.sql'),
  'utf8',
);

describe('outbox: OC semanal lê a flag de tira artesanal do grupo', () => {
  it('troca p.is_artisanal_strap (coluna inexistente em products) por pg.is_artisanal_strap', () => {
    expect(migration).toContain("'AND NOT COALESCE(p.is_artisanal_strap, false)'");
    expect(migration).toContain("'AND NOT COALESCE(pg.is_artisanal_strap, false)'");
    expect(migration).toContain("pg_get_functiondef('public.process_sale_order_purchase_shortages(uuid)'::regprocedure)");
  });

  it('é idempotente e aborta se o join de product_groups sumir', () => {
    expect(migration).toContain('já lê a flag do grupo');
    expect(migration).toContain('LEFT JOIN public.product_groups pg ON pg.id = p.group_id');
  });
});

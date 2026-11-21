import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(resolve(
  __dirname,
  '../../supabase/migrations/20270101050800_finalizado_sem_nf_legado.sql',
), 'utf8');

describe('encerramento Finalizado s/ NF sem efeito', () => {
  it('só mexe nos dois PVs e desliga o gatilho que reescreveria a OP', () => {
    expect(sql).toContain('finalizado_sem_nf_legado_20270101050800');
    expect(sql).toContain("'PV-00236', 'PV-2026-00083'");
    expect(sql).toContain("status = 'Finalizado s/ NF'");
    expect(sql).toContain('trg_finalize_orders_on_sale_order_billed');
    expect(sql).toContain('trg_sale_order_creates_cmv');
    expect(sql).toContain('trg_record_passive_sale_order_command');
    expect(sql).toContain('trg_enqueue_strap_demands_on_sale_order_confirm');
    expect(sql).not.toContain('UPDATE public.orders');
    expect(sql).toContain("NOT IN ('PV-00249', 'PV-00250')");
    expect(sql).toContain('sem efeitos de estoque/financeiro');
  });
});

/**
 * PV em Em Produção sem linha em production_queue (PV-00255).
 * O status do pedido tem de garantir a fila. O backfill não grava o pedido.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(resolve(
  __dirname,
  '../../supabase/migrations/20270101050500_fila_acompanha_em_producao.sql',
), 'utf8');

describe('fila acompanha entrada em produção', () => {
  it('amarra o status do PV na fila com o mesmo predicado da OP', () => {
    expect(migration).toContain('fila_acompanha_em_producao_20270101050500');
    expect(migration).toContain('production_order_is_queue_open');
    expect(migration).toContain('ensure_production_queue_for_sale_order');
    expect(migration).toContain('tg_ensure_production_queue_on_sale_status');
    expect(migration).toContain('AFTER UPDATE OF status ON public.sale_orders');
    expect(migration).toContain("NEW.status NOT IN ('Aprovado', 'Em Produção')");
    expect(migration).toContain('PERFORM public.ensure_production_queue_for_sale_order(NEW.id)');
    expect(migration).toContain('IF public.production_order_is_queue_open(NEW) THEN');
  });

  it('o backfill só insere na fila e deixa o PV-00249 quieto', () => {
    expect(migration).toContain("IS DISTINCT FROM 'PV-00249'");
    expect(migration).toContain('INSERT INTO public.production_queue');
    expect(migration).not.toContain('UPDATE public.sale_orders');
    expect(migration).not.toContain('UPDATE public.orders');
    expect(migration).toContain('em_producao_com_op_sem_fila_numeros');
    expect(migration).toContain('em_producao_sem_op_aberta_numeros');
    expect(migration).toContain('DISABLE TRIGGER tg_queue_recompute');
    expect(migration).toContain('ENABLE TRIGGER tg_queue_recompute');
  });
});

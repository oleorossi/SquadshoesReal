/**
 * Contrato: cancelar PV tira a OP da production_queue.
 *
 * Cadeia viva (não inventar atalho):
 *   1. `tg_cancel_orders_on_pv_cancel` (mig 20261214120000) — PV Cancelado
 *      ⇒ OPs abertas viram 'Cancelada'
 *   2. `tg_sync_production_queue` (corpo canônico em 20270101014500) —
 *      status terminal ⇒ DELETE da production_queue
 *   3. Backfill idempotente `20270101026900` — só órfãos PV morto ∩ fila ∩
 *      zero progresso (espelha 20261216120000); NÃO toca Aprovado+na_fila
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');

const CASCADE_MIG = read(
  'supabase/migrations/20261214120000_cascata-cancelamento-pv-e-metricas-honestas.sql',
);
const QUEUE_SYNC_MIG = read(
  'supabase/migrations/20270101014500_admin_retire_technical_sheet_in_production.sql',
);
const CLEANUP_MIG = read(
  'supabase/migrations/20270101026900_limpar-ops-orfas-pv-morto-na-fila.sql',
);
const PRIOR_CLEANUP_MIG = read(
  'supabase/migrations/20261216120000_limpar-ops-de-pv-morto-na-fila.sql',
);

function sqlFunction(sql: string, name: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${name}(`;
  const start = sql.indexOf(marker);
  expect(start, `${name} ausente`).toBeGreaterThanOrEqual(0);
  const tail = sql.slice(start);
  // Corpos usam $function$…$function$ (14500) ou $$…$$ (14120000)
  const endFn = tail.indexOf('\n$function$;');
  if (endFn >= 0) return tail.slice(0, endFn + '\n$function$;'.length);
  const endDollar = tail.search(/\n\$\$;/);
  expect(endDollar, `${name} sem terminador`).toBeGreaterThanOrEqual(0);
  return tail.slice(0, endDollar + '\n$$;'.length);
}

describe('cancel PV ⇒ OP fora de production_queue', () => {
  const cancelCascade = sqlFunction(CASCADE_MIG, 'tg_cancel_orders_on_pv_cancel');
  const queueSync = sqlFunction(QUEUE_SYNC_MIG, 'tg_sync_production_queue');

  it('cancela OPs abertas quando o PV vira Cancelado', () => {
    expect(cancelCascade).toMatch(
      /lower\(btrim\(COALESCE\(NEW\.status, ''\)\)\) IN \('cancelado', 'cancelada', 'cancelled'\)/,
    );
    expect(cancelCascade).toContain("SET status = 'Cancelada'");
    expect(cancelCascade).toContain('sale_order_id = NEW.id');
    expect(cancelCascade).toMatch(
      /NOT IN[\s\S]*'finalizado'[\s\S]*'cancelada'[\s\S]*'faturado'/,
    );
    expect(CASCADE_MIG).toMatch(
      /CREATE TRIGGER trg_cancel_orders_on_pv_cancel[\s\S]*AFTER UPDATE OF status ON public\.sale_orders/,
    );
  });

  it('tg_sync_production_queue apaga a linha da fila em status Cancelada', () => {
    expect(queueSync).toMatch(/'Cancelada'/);
    expect(queueSync).toContain('DELETE FROM public.production_queue');
    expect(queueSync).toMatch(/queue_row\.order_id = NEW\.id/);
    // Não pode "corrigir" cancelamento virando Finalizado — isso fabricaria
    // quantity_processed (laudo 20261216120000).
    expect(queueSync).not.toMatch(
      /SET status = 'Finalizado'[\s\S]*production_queue/,
    );
  });

  it('cleanup 26900 só cancela órfãos PV morto ∩ fila ∩ zero progresso', () => {
    expect(CLEANUP_MIG).toContain("SET status = 'Cancelada'");
    expect(CLEANUP_MIG).toMatch(
      /lower\(btrim\(COALESCE\(so\.status, ''\)\)\) IN[\s\S]*'cancelado'[\s\S]*'faturado'/,
    );
    expect(CLEANUP_MIG).toContain('FROM public.production_queue pq');
    expect(CLEANUP_MIG).toContain('pq.order_id = o.id');
    expect(CLEANUP_MIG).toMatch(
      /order_stages[\s\S]*quantity_processed[\s\S]*> 0/,
    );
    // Rede de segurança: não mass-cancelar Aprovado / na_fila legítima
    expect(CLEANUP_MIG).not.toMatch(/'aprovado'/i);
    expect(CLEANUP_MIG).not.toContain('DELETE FROM public.production_queue');
    // Espelha o critério do cleanup pontual anterior
    expect(PRIOR_CLEANUP_MIG).toContain("SET status = 'Cancelada'");
    expect(PRIOR_CLEANUP_MIG).toMatch(/tg_orders_sync_production_queue/);
  });
});

/**
 * Contrato: demanda de tira some quando o PV fecha (grill 19–20/10/2026).
 * Fonte: migration 20270101044400_strap-demand-cancel-on-closed-pv.sql
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const MIG = readFileSync(
  resolve(ROOT, 'supabase/migrations/20270101044400_strap-demand-cancel-on-closed-pv.sql'),
  'utf8',
);
const STATE_MACHINE = readFileSync(
  resolve(ROOT, 'src/lib/saleOrderStateMachine.ts'),
  'utf8',
);

describe('demanda de tira some quando o PV fecha', () => {
  it('helper espelha CLOSED_SALE_ORDER_STATUSES (+ Cancelada)', () => {
    expect(MIG).toContain('CREATE OR REPLACE FUNCTION public.is_closed_sale_order_status');
    for (const status of [
      'Faturado',
      'Expedido',
      'Concluído',
      'Finalizado s/ NF',
      'Cancelado',
      'Cancelada',
    ]) {
      expect(MIG).toContain(`'${status}'`);
    }
    expect(STATE_MACHINE).toContain('CLOSED_SALE_ORDER_STATUSES');
    expect(STATE_MACHINE).toContain("SALE_ORDER_STATUS.FATURADO");
    expect(STATE_MACHINE).toContain("SALE_ORDER_STATUS.EXPEDIDO");
  });

  it('trigger enfileira cancelled em qualquer status fechado', () => {
    expect(MIG).toContain('tg_enqueue_strap_demands_on_sale_order_confirm');
    expect(MIG).toContain('public.is_closed_sale_order_status(NEW.status)');
    expect(MIG).toContain("enqueue_sale_order_strap_demands(\n      NEW.id, 'cancelled'");
    // Não só Cancelado/Cancelada.
    expect(MIG).not.toMatch(
      /ELSIF NEW\.status IN \('Cancelado', 'Cancelada'\)\s*\n\s*AND OLD\.status IS DISTINCT FROM NEW\.status THEN\s*\n\s*PERFORM public\.enqueue_sale_order_strap_demands\(\s*\n\s*NEW\.id, 'cancelled'/,
    );
  });

  it('processador no-op quando PV fechado e evento não é cancelled', () => {
    expect(MIG).toContain("'pv_fechado'");
    expect(MIG).toContain('is_closed_sale_order_status((');
    expect(MIG).toContain("SELECT so.status FROM public.sale_orders so WHERE so.id = v_job.source_id");
    // cancelled roda antes da guarda (injeção no corpo vivo via replace).
    const cancelledResult = MIG.indexOf(
      "v_result:=jsonb_build_object('cancelled',true,'variants',to_jsonb(v_affected));",
    );
    const closedGuard = MIG.indexOf('ELSIF public.is_closed_sale_order_status((');
    expect(cancelledResult).toBeGreaterThanOrEqual(0);
    expect(closedGuard).toBeGreaterThan(cancelledResult);
  });

  it('view operacional exclui PV fechado e mantém stock_floor', () => {
    expect(MIG).toContain('CREATE OR REPLACE VIEW public.v_strap_demands_operational');
    expect(MIG).toContain('AND NOT public.is_closed_sale_order_status(so.status)');
    expect(MIG).toContain("'stock_floor'::text");
    expect(MIG).toContain('strap_stock_floor_contributions f');
    // Braço floor não usa o helper de PV fechado.
    const floorStart = MIG.indexOf("'stock_floor'::text");
    const floorBlock = MIG.slice(floorStart, floorStart + 800);
    expect(floorBlock).not.toContain('is_closed_sale_order_status');
  });

  it('backfill soft-cancela saldo restante e enfileira reconcile por variante', () => {
    expect(MIG).toContain('cancelled_m = greatest(0, d.gross_required_m - d.fulfilled_m)');
    expect(MIG).toContain("status = 'cancelled'");
    expect(MIG).toContain("'strap_variant'");
    expect(MIG).toContain('pv_fechado_legado_reconcile');
  });
});

/**
 * Contrato: demanda de tira some quando o PV é soft-deleted.
 * Completa 46000 (parou regen, não cancelou/escondeu). Regra do dono
 * 28/11/2026: pedido encerrado ⇒ demanda encerrada (status fechado via 44400;
 * soft-delete via 66100).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const MIG = readFileSync(
  resolve(ROOT, 'supabase/migrations/20270101066100_strap_demand_cancel_on_soft_delete.sql'),
  'utf8',
);
const CLOSED_MIG = readFileSync(
  resolve(ROOT, 'supabase/migrations/20270101044400_strap-demand-cancel-on-closed-pv.sql'),
  'utf8',
);

describe('demanda de tira some quando o PV é soft-deleted', () => {
  it('mantém o cancelamento por status fechado da 44400', () => {
    expect(CLOSED_MIG).toContain('public.is_closed_sale_order_status(NEW.status)');
    expect(CLOSED_MIG).toContain("enqueue_sale_order_strap_demands(\n      NEW.id, 'cancelled'");
    expect(MIG).toContain('public.is_closed_sale_order_status(NEW.status)');
  });

  it('trigger cancela na transição deleted_at null→set', () => {
    expect(MIG).toContain('NEW.deleted_at IS NOT NULL');
    expect(MIG).toContain('OLD.deleted_at IS NULL');
    expect(MIG).toContain("enqueue_sale_order_strap_demands(\n      NEW.id, 'cancelled'");
    expect(MIG).toContain('AFTER UPDATE OF status, billing_week, delivery_month, delivery_week,\n                  delivery_deadline, deleted_at');
  });

  it('restore reabre demanda se status ainda é operacional', () => {
    expect(MIG).toContain('NEW.deleted_at IS NULL');
    expect(MIG).toContain('OLD.deleted_at IS NOT NULL');
    expect(MIG).toContain("NEW.status IN ('Aprovado', 'Em Produção')");
    expect(MIG).toContain("'direct_production'");
  });

  it('view operacional exclui soft-deleted e status fechado', () => {
    expect(MIG).toContain('CREATE OR REPLACE VIEW public.v_strap_demands_operational');
    expect(MIG).toContain('AND so.deleted_at IS NULL');
    expect(MIG).toContain('AND NOT public.is_closed_sale_order_status(so.status)');
    expect(MIG).toContain("'stock_floor'::text");
  });

  it('backfill soft-cancela demanda aberta de PV na lixeira', () => {
    expect(MIG).toContain('so.deleted_at IS NOT NULL');
    expect(MIG).toContain('cancelled_m = greatest(0, d.gross_required_m - d.fulfilled_m)');
    expect(MIG).toContain("status = 'cancelled'");
    expect(MIG).toContain('pv_soft_deleted_legado_reconcile');
  });
});

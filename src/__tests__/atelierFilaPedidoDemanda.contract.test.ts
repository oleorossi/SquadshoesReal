import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SQL = readFileSync(
  'supabase/migrations/20270101048300_atelier_fila_pedido_da_demanda.sql',
  'utf8',
);

describe('fila do Ateliê lê o PV da demanda', () => {
  it('não derruba o job quando o pedido do job não resolve e prefere o número da demanda', () => {
    expect(SQL).toContain('LEFT JOIN public.sale_orders so ON so.id = j.sale_order_id');
    expect(SQL).toContain('LEFT JOIN public.cabedal_prep_demands dem ON dem.id = j.demand_id');
    expect(SQL).toContain('LEFT JOIN public.sale_orders so_dem ON so_dem.id = dem.sale_order_id');
    expect(SQL).toContain(
      "COALESCE(NULLIF(btrim(so_dem.order_number), ''), NULLIF(btrim(so.order_number), ''))",
    );
    expect(SQL).toContain('COALESCE(dem.sale_order_id, j.sale_order_id)');
    expect(SQL).toContain('LEFT JOIN public.sale_order_items soi ON soi.id = d.sale_order_item_id');
  });

  it('não corta, não envia, não recebe e não reescreve o modo', () => {
    expect(SQL).not.toContain('atelier_confirm_lot_cut');
    expect(SQL).not.toContain('atelier_mark_job_sent');
    expect(SQL).not.toContain('atelier_send_shipment');
    expect(SQL).not.toContain('register_atelier_job_receipt');
    expect(SQL).not.toContain('UPDATE public.cabedal_prep_jobs');
    expect(SQL).toContain("strpos(v_def, 'execution_mode = EXCLUDED') > 0");
    expect(SQL).toContain('sale_order_id = EXCLUDED.sale_order_id');
    expect(SQL).not.toContain('execution_mode = EXCLUDED.execution_mode');
  });
});

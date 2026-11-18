import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SQL = readFileSync(
  'supabase/migrations/20270101048400_atelier_separar_job_lote_proprio.sql',
  'utf8',
);

describe('separar job do Ateliê num lote próprio', () => {
  it('só lote aberto, job aguardando corte, e o agrupamento não reabsorve', () => {
    expect(SQL).toContain('FUNCTION public.atelier_split_job_to_own_lot(p_job_id uuid)');
    expect(SQL).toContain('SECURITY DEFINER');
    expect(SQL).toContain('IF NOT public.is_approved_user()');
    expect(SQL).toContain("pipeline_status <> 'awaiting_cut'");
    expect(SQL).toContain('já foi cortado');
    expect(SQL).toContain('já é o único deste lote');
    expect(SQL).toContain('already_own_lot');
    expect(SQL).toContain('manual_split');
    expect(SQL).toContain('l.manual_split = false');
    expect(SQL).toContain("WHERE status = 'open' AND manual_split = false");
    expect(SQL).toContain("action, resource, resource_id, new_data, success, created_at");
    expect(SQL).toContain('atelier_refresh_lot_kit_gate');
  });

  it('não corta e não aponta para um PV específico', () => {
    expect(SQL).not.toContain('atelier_confirm_lot_cut');
    expect(SQL).not.toContain('atelier_mark_job_sent');
    expect(SQL).not.toContain('atelier_send_shipment');
    expect(SQL).not.toContain('register_atelier_job_receipt');
    expect(SQL).not.toContain('7c5641a2-f7ad-4b71-81e0-cd0548701845');
    expect(SQL).not.toContain('PV-00249');
    expect(SQL).not.toContain('PV-00250');
    expect(SQL).not.toContain('PV-00251');
  });

  it('a RPC não fica aberta para anon', () => {
    expect(SQL).toContain('REVOKE ALL ON FUNCTION public.atelier_split_job_to_own_lot(uuid) FROM PUBLIC, anon');
    expect(SQL).toContain('GRANT EXECUTE ON FUNCTION public.atelier_split_job_to_own_lot(uuid) TO authenticated, service_role');
  });
});

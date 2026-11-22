import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const migration = readFileSync(
  resolve(root, 'supabase/migrations/20270101054100_os_terceirizados_ledger_unico.sql'),
  'utf8',
);
const script = readFileSync(resolve(root, 'scripts/teste-outsourced-pair-ledger.sql'), 'utf8');
const aprovado = readFileSync(resolve(root, 'scripts/teste-aprovado-entra-no-lancamento.sql'), 'utf8');
const hub = readFileSync(resolve(root, 'src/pages/TerceirizadosHub.tsx'), 'utf8');
const plan = readFileSync(resolve(root, 'src/components/contractors/OutsourcingPlanPanel.tsx'), 'utf8');
const launch = readFileSync(resolve(root, 'src/components/atelier/AtelierLancamento.tsx'), 'utf8');

describe('fonte única dos pares terceirizados', () => {
  it('o ledger é a função lida pelas telas e não grava pedido', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.outsourced_pair_ledger');
    expect(migration).toContain('ready_date');
    expect(migration).toContain('resolve_billing_week_for_order');
    expect(migration).not.toContain('UPDATE public.sale_orders');
    expect(migration).not.toContain('UPDATE public.sale_order_items');
    expect(migration).not.toContain('auto_motor_enabled');
    expect(migration).toContain('BEFORE INSERT ON public.cabedal_prep_jobs');
    expect(migration).toContain('sync_atelier_launch_for_order');
    expect(migration).toContain('save_atelier_launch_reservation');
    expect(migration).toContain('list_complex_upper_not_in_launch');
    expect(migration).not.toContain('reapply_atelier_eligibility');
    expect(hub).toContain('useOutsourcedPairLedger');
    expect(plan).toContain('useOutsourcedPairLedger');
    expect(launch).toContain('useOutsourcedPairLedger');
    expect(launch).not.toContain("'Fábrica'");
    expect(launch).toContain('Reservar divisão');
    expect(launch).toContain('!color.canSend');
  });

  it('o teste SQL compara as leituras antigas e desfaz a transação', () => {
    expect(script).toContain('BEGIN;');
    expect(script).toContain('outsourced_pair_ledger');
    expect(script).toContain('list_active_service_order_board');
    expect(script).toContain("RAISE EXCEPTION 'rollback teste ledger terceirizados'");
    expect(script).toContain('PV-00249');
    expect(script).toContain('PV-00250');
    expect(script).toContain('LOTE-00004');
    expect(script).not.toContain('COMMIT');
    expect(script).not.toContain('UPDATE public.sale_orders');
    expect(aprovado).toContain('BEGIN;');
    expect(aprovado).toContain("SET status = 'Aprovado'");
    expect(aprovado).toContain('list_complex_upper_not_in_launch');
    expect(aprovado).toContain("RAISE EXCEPTION 'rollback teste aprovado no lancamento'");
    expect(aprovado).toContain('PV-00249');
    expect(aprovado).not.toContain('COMMIT');
  });
});

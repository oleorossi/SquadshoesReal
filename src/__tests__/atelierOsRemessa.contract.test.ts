import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SQL = readFileSync(
  'supabase/migrations/20270101048000_atelier_os_na_remessa.sql',
  'utf8',
);
const UI = readFileSync('src/components/atelier/AtelierOperacao.tsx', 'utf8');

describe('Ateliê — OS nasce no clique de envio', () => {
  it('uma remessa, um item por job, preço da tarifa', () => {
    expect(SQL).toContain('FUNCTION public.atelier_send_shipment');
    expect(SQL).toContain('atelier_job_id');
    expect(SQL).toContain('get_contractor_rate');
    expect(SQL).toContain("WHEN 'aviamento' THEN 'mesa'");
    expect(SQL).toContain('dispatch_tracked');
    expect(SQL).not.toContain('accounts_payable');
  });

  it('reusa o kit fechado e a liberação idempotente', () => {
    const sent = SQL.slice(SQL.indexOf('FUNCTION public.atelier_mark_job_sent'));
    expect(sent).toContain('atelier_lot_kit_is_closed');
    expect(sent).toContain('PERFORM public.atelier_confirm_lot_release');
    expect(sent).not.toContain('CREATE OR REPLACE FUNCTION public.atelier_confirm_lot_release');
    expect(sent).not.toContain('CREATE OR REPLACE FUNCTION public.atelier_lot_kit_is_closed');
  });

  it('interno não vira OS e o botão espera kit_closed', () => {
    expect(SQL).toContain('Job interno não entra em ordem de serviço');
    expect(UI).toContain('lot.kit_closed === true');
    expect(UI).toContain('sendAtelierShipment');
    expect(UI).toContain('Imprimir remessa');
  });
});

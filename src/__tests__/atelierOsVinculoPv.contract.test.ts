import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SQL = readFileSync(
  'supabase/migrations/20270101048600_atelier_os_vinculo_pv.sql',
  'utf8',
);
const PREVIOUS = readFileSync(
  'supabase/migrations/20270101048000_atelier_os_na_remessa.sql',
  'utf8',
);
const UI = readFileSync('src/components/atelier/AtelierOperacao.tsx', 'utf8');
const REPORT = readFileSync(
  'supabase/migrations/20270101048200_atelier_relatorio_periodo.sql',
  'utf8',
);

function fn(source: string, name: string): string {
  const start = source.indexOf(`FUNCTION public.${name}`);
  expect(start, name).toBeGreaterThanOrEqual(0);
  return source.slice(start);
}

describe('Ateliê — OS da remessa leva o PV', () => {
  it('uma OS por remessa, sem avulsa, com PV singular ou lista', () => {
    const send = fn(SQL, 'atelier_send_shipment');
    expect(send).toContain('is_avulsa');
    expect(send).toContain('false,');
    expect(send).toContain('sale_order_id, source_sale_order_id');
    expect(send).toContain('linked_sale_order_ids');
    expect(send).toContain('cardinality(v_orders) = 1 THEN v_orders[1]');
    expect(send).toContain('Há job sem pedido nesta remessa');
    expect(send).not.toContain('is_avulsa = true');
    expect(send).not.toContain('accounts_payable');
  });

  it('a linha leva o job, o lote e a tarifa pelo nome do serviço', () => {
    const line = fn(SQL, 'atelier_attach_job_line');
    expect(line).toContain('atelier_job_id');
    expect(line).toContain('v_job.sale_order_id');
    expect(line).toContain('lot_number');
    expect(line).toContain('get_contractor_rate');
    expect(line).toContain("'Costura de cabedal'");
    expect(line).toContain("WHEN 'costura' THEN 'Costura de cabedal'");
  });

  it('o patch do envio de um job acha o INSERT que já está no ar', () => {
    const sent = fn(PREVIOUS, 'atelier_mark_job_sent');
    expect(sent).toContain('selected_sale_order_item_ids, linked_sale_order_ids');
    expect(sent).toContain("'{}'::jsonb,\n      CASE WHEN v_job.sale_order_item_id IS NULL THEN NULL");
    expect(SQL).toContain('source_sale_order_id');
    expect(SQL).toContain('atelier_mark_job_sent(uuid, uuid, uuid)');
  });

  it('a volta prevista soma o offset à âncora de corte', () => {
    expect(fn(SQL, 'atelier_job_return_date')).toContain('add_business_days(p_anchor, v_offset)');
    const report = fn(SQL, 'atelier_period_report');
    expect(report).toContain('j.sector,');
    expect(report).toContain('atelier_job_return_date(j.target_end, j.sector)');
    expect(report).not.toContain('j.target_end < CURRENT_DATE');
    expect(REPORT).toContain('j.target_end,\n      j.contractor_id,');
    expect(UI).toContain('atelierReturnDate');
    expect(UI).toContain('Sem tarifa vigente de');
    expect(UI).toContain('formatCurrency(quote)');
  });
});

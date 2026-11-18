import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SQL = readFileSync(
  'supabase/migrations/20270101048700_atelier_despacho_e_pares_inteiros.sql',
  'utf8',
);
const UI = readFileSync('src/components/atelier/AtelierReceiptDialog.tsx', 'utf8');
const LIST = readFileSync('src/pages/Contractors.tsx', 'utf8');

describe('Ateliê — despacho, pares inteiros e detalhe da OS', () => {
  it('o envio grava o despacho e o backfill é só de OS do Ateliê', () => {
    expect(SQL).toContain('INSERT INTO public.service_order_dispatches');
    expect(SQL).toContain("'atelier:' || v_job.id::text");
    expect(SQL).toContain('atelier_record_shipment_dispatch(p_job_id)');
    expect(SQL).toContain('dispatch_signal = NULL');
    expect(SQL).toContain('quoted_deadline = COALESCE(v_due, quoted_deadline)');
    expect(SQL).toContain("atelier_service_number = v_os.order_number");
    expect(SQL).toContain('i.atelier_job_id = j.id');
  });

  it('fração e negativo são recusados, e o título usa só o par bom', () => {
    expect(SQL).toContain('aceita só pares inteiros');
    expect(SQL).toContain('ROUND(v_good * COALESCE(v_line.unit_price, 0), 2)');
    expect(SQL).toContain('Defeito e perda não geram título');
    expect(SQL).toContain("Só admin ou gerência estorna um recebimento");
    expect(SQL).toContain('estorno_recebimento_atelie');
    expect(UI).toContain('atelierWholePairs');
    expect(UI).toContain('inputMode="numeric"');
    expect(LIST).toContain('isAtelierRemessa');
    expect(LIST).toContain('AtelierOsDetailDialog');
  });
});

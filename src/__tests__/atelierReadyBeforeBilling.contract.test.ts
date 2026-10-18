import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const MIG = 'supabase/migrations/20270101043200_atelier_kit_interno_ready_m7.sql';

describe('atelier ready = fatura − 7d + compra pela data do Ateliê', () => {
  const sql = readFileSync(MIG, 'utf8');

  it('settings.ready_before_billing_days default 7', () => {
    expect(sql).toContain('ready_before_billing_days int NOT NULL DEFAULT 7');
    expect(sql).toContain('ready_before_billing_days = 7');
  });

  it('materialize usa ready_before_billing_days, não assembly_days+1', () => {
    expect(sql).toContain('ready_before_billing_days');
    expect(sql).toContain('v_billing_start - v_lead');
    expect(sql).toContain(
      "(SELECT s.ready_before_billing_days FROM public.atelier_settings s WHERE s.id = 1)",
    );
  });

  it('kit candidates = todos os itens da ficha (escolha manual)', () => {
    expect(sql).toContain('atelier_sheet_kit_candidates');
    expect(sql).toContain('nada pré-marcado na UI');
    expect(sql).toContain("p_sector IN ('corte_cabedal', 'costura_cabedal', 'aviamento')");
  });

  it('OS congela sent_kit_lines com qtds debitadas', () => {
    expect(sql).toContain('sent_kit_lines');
    expect(sql).toContain("'kit_lines', v_kit");
  });

  it('OC de falta ancora purchase_by/promised na ready_date do Ateliê', () => {
    expect(sql).toContain('process_cabedal_prep_purchase_shortages_po');
    expect(sql).toContain('purchase_by_date, promised_date');
    expect(sql).toContain('v_need_by');
    expect(sql).toContain('meta pronto');
    expect(sql).toContain('FROM public.cabedal_prep_demands d');
  });
});

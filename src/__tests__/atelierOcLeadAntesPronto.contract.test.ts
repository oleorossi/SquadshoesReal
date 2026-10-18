import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const MIG = 'supabase/migrations/20270101043500_atelier_oc_lead_antes_pronto.sql';

describe('atelier OC: lead + pipeline antes do pronto', () => {
  const sql = readFileSync(MIG, 'utf8');

  it('helper atelier_oc_dates_from_ready existe', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.atelier_oc_dates_from_ready');
    expect(sql).toContain('get_effective_supplier_lead_days');
    expect(sql).toContain('GREATEST');
    expect(sql).toContain('costura_offset_days');
    expect(sql).toContain('aviamento_offset_days');
  });

  it('gerador de OC grava purchase_by antecipado e promised = chegada', () => {
    expect(sql).toContain('process_cabedal_prep_purchase_shortages_po');
    expect(sql).toContain('atelier_oc_dates_from_ready');
    expect(sql).toContain('purchase_by_date, promised_date, eta_days');
    expect(sql).toContain('comprar até');
    expect(sql).toContain('chegar');
  });

  it('recalcula OCs abertas no backfill', () => {
    expect(sql).toContain("po.status IN ('draft', 'suggested', 'pending')");
    expect(sql).toContain('source_type = \'cabedal_prep\'');
  });
});

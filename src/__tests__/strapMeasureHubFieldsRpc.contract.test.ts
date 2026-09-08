import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const MIGRATION = 'supabase/migrations/20270101021400_save-strap-measure-hub-fields.sql';

describe('RPC save_artisanal_strap_measure_hub_fields', () => {
  const sql = readFileSync(MIGRATION, 'utf8');

  it('é SECURITY DEFINER e exige capability de catálogo', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.save_artisanal_strap_measure_hub_fields');
    expect(sql).toContain('SECURITY DEFINER');
    expect(sql).toContain("assert_artisanal_strap_capability('manage_strap_catalog')");
  });

  it('preços passam pelo gate financeiro; payload jsonb só mexe nas chaves presentes', () => {
    expect(sql).toContain('can_see_strap_financial_values()');
    expect(sql).toContain("p_payload ? 'preco_prestador_per_m'");
    expect(sql).toContain("p_payload ? 'preco_artesanal_per_m'");
    expect(sql).toContain("p_payload ? 'origem_padrao'");
    expect(sql).toContain("jsonb_typeof(p_payload->'preco_prestador_per_m') = 'null'");
  });

  it('não concede UPDATE da tabela; só EXECUTE da RPC', () => {
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.save_artisanal_strap_measure_hub_fields(uuid, jsonb, text)',
    );
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.save_artisanal_strap_measure_hub_fields(uuid, jsonb, text)',
    );
    expect(sql).not.toContain('GRANT UPDATE ON TABLE public.artisanal_strap_measures');
  });
});

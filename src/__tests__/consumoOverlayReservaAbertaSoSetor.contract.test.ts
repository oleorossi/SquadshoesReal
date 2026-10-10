import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const MIGRATION = readFileSync(
  resolve(
    ROOT,
    'supabase/migrations/20270101031600_consumo_overlay_reserva_aberta_so_setor.sql',
  ),
  'utf8',
);

const FN = MIGRATION.slice(
  0,
  MIGRATION.indexOf('REVOKE ALL ON FUNCTION private.resolve_report_consumption_sector_context'),
);

describe('contrato — overlay de setor só conflita com dois nomes em reserva aberta', () => {
  it('marca o corpo novo sem reescrever a 16800', () => {
    expect(MIGRATION).toContain('reservation_open_sector_only_20270101031600');
    expect(MIGRATION).toContain('sector_keys_only_20270101016800');
    expect(MIGRATION).toContain('CREATE OR REPLACE FUNCTION private.resolve_report_consumption_sector_context');
    expect(MIGRATION).not.toContain('CREATE OR REPLACE FUNCTION public.calculate_consumption_report_batch');
  });

  it('ignora reserva morta e distingue só o nome de setor', () => {
    expect(FN).toContain("status IN ('reserved', 'pending_reconciliation')");
    expect(FN).toContain(
      "count(DISTINCT NULLIF(pg_catalog.btrim(\n             reservation.metadata ->> 'consumption_sector'), ''))",
    );
    expect(FN).not.toContain("'|' || COALESCE(");
    expect(FN).not.toMatch(
      /\|\| COALESCE\(\s*reservation\.metadata ->> 'consumption_sector_source'/,
    );
  });

  it('bloqueia dois setores reais e não mascara reserva já ambígua', () => {
    expect(MIGRATION).toContain('v_sector_count > 1');
    expect(MIGRATION).toContain('reservation_ambiguous_passthrough_20270101015500');
    expect(MIGRATION).toContain("v_origin = 'ambiguous'");
    expect(FN).toContain('Antes: RETURN v_context');
    expect(FN).not.toMatch(/^\s*RETURN v_context;/m);
  });

  it('guarda o caso vivo PV-00195 / OP-2026-04266', () => {
    expect(MIGRATION).toContain('OP-2026-04266 HOTMELT ainda ambiguous');
    expect(MIGRATION).toContain('OP-2026-04266 EVA 3MM ainda ambiguous');
    expect(MIGRATION).toContain('98fe8b88-ee68-4f21-a4e2-85fa74c0fb5b');
  });
});

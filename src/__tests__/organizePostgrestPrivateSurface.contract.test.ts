import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SQL = readFileSync(
  resolve(
    __dirname,
    '../../supabase/migrations/20270101029600_organize_postgrest_private_surface.sql',
  ),
  'utf8',
);

describe('organize_postgrest_private_surface (20270101029600)', () => {
  it('marca a migration e tira o teto do authenticator pro schema cache', () => {
    expect(SQL).toContain('organize_postgrest_private_surface_20270101029600');
    expect(SQL).toContain("ALTER ROLE authenticator SET statement_timeout = 0");
    expect(SQL).toContain('NOTIFY pgrst, \'reload schema\'');
  });

  it('fecha o schema private para roles de API', () => {
    expect(SQL).toContain('CREATE SCHEMA IF NOT EXISTS private');
    expect(SQL).toContain(
      'REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated, service_role',
    );
  });

  it('só move views orfas com guarda de pg_depend (fail-closed)', () => {
    expect(SQL).toContain('private._org_move_view_if_unreferenced');
    expect(SQL).toContain('pg_depend');
    expect(SQL).toContain('v_demand_forecast');
    expect(SQL).toContain('vw_costura_queue');
    // Nao tocar views que o app ainda le
    expect(SQL).not.toContain("'v_production_sectors'");
    expect(SQL).not.toContain("'v_employee_sector'");
    expect(SQL).not.toContain("'v_service_order_overview'");
    expect(SQL).not.toContain("'v_client_credit_exposure'");
  });

  it('nao move RPCs/cron/impl load-bearing', () => {
    expect(SQL).not.toContain("'apontar_producao_setor_impl'");
    expect(SQL).not.toContain("'trigger_nfe_sync_cron'");
    expect(SQL).not.toContain("'trigger_sync_ar_cron'");
    expect(SQL).not.toContain("'run_consumption_parity_tests'");
    expect(SQL).not.toContain("'run_consumption_integration_tests'");
    expect(SQL).not.toContain("'_calc_required_per_size'");
  });
});

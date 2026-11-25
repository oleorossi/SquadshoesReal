import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(__dirname, '../../supabase/migrations/20270101054500_ledger_terceirizados_coluna_ambigua.sql'),
  'utf8',
);

describe('ledger de terceirizados: service_order_id qualificado', () => {
  it('qualifica service_order_id nos LATERAL de envios e retornos', () => {
    expect(migration).toContain('WHERE sod.service_order_id = os.id');
    expect(migration).toContain('WHERE sor.service_order_id = os.id');
    expect(migration).toContain("pg_get_functiondef('public.outsourced_pair_ledger(text)'::regprocedure)");
  });

  it('é idempotente e aborta se as âncoras sumirem', () => {
    expect(migration).toContain('já qualifica service_order_id');
    expect(migration).toContain('correção abortada');
  });
});

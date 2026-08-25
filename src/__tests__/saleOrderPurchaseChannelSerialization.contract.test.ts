import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const OUTBOX_MIGRATION = readFileSync(resolve(
  ROOT,
  'supabase/migrations/20270101010900_sale_order_outbox_worker.sql',
), 'utf8');
const SERIALIZATION_MIGRATION = readFileSync(resolve(
  ROOT,
  'supabase/migrations/20270101011100_sale_order_purchase_channel_serialization.sql',
), 'utf8');

describe('serialização dos canais de compra por PV', () => {
  it('mantém a assinatura pública e esconde a implementação atômica', () => {
    expect(SERIALIZATION_MIGRATION).toContain(
      'RENAME TO create_per_pv_purchase_orders_atomic_internal',
    );
    expect(SERIALIZATION_MIGRATION).toMatch(
      /REVOKE ALL ON FUNCTION public\.create_per_pv_purchase_orders_atomic_internal\([\s\S]*?FROM PUBLIC, anon, authenticated, service_role/,
    );
    expect(SERIALIZATION_MIGRATION).toContain(
      'CREATE OR REPLACE FUNCTION public.create_per_pv_purchase_orders_atomic(',
    );
    expect(SERIALIZATION_MIGRATION).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.create_per_pv_purchase_orders_atomic\([\s\S]*?TO authenticated, service_role/,
    );
    expect(SERIALIZATION_MIGRATION).toContain(
      'RETURN public.create_per_pv_purchase_orders_atomic_internal(',
    );
  });

  it('normaliza e trava todos os PVs em ordem com a mesma chave da outbox', () => {
    const lockKey = "'sale-order-purchase-shortages:'";
    expect(OUTBOX_MIGRATION).toContain(lockKey);
    expect(SERIALIZATION_MIGRATION).toContain(lockKey);
    expect(SERIALIZATION_MIGRATION).toContain('SELECT DISTINCT u.pv_id');
    expect(SERIALIZATION_MIGRATION).toContain('array_agg(x.pv_id ORDER BY x.pv_id)');
    expect(SERIALIZATION_MIGRATION).toContain('ORDER BY u.pv_id');
    expect(SERIALIZATION_MIGRATION).toContain('pg_advisory_xact_lock(hashtextextended(');
  });

  it('troca o motor pelo netting per-PV e usa shortage_grade escalada para MOQ', () => {
    expect(SERIALIZATION_MIGRATION).toContain(
      "'public.compute_per_pv_purchase_needs(ARRAY[p_sale_order_id])'",
    );
    expect(SERIALIZATION_MIGRATION).toContain(
      'CREATE OR REPLACE FUNCTION public.sale_order_outbox_safe_shortage_grade(',
    );
    expect(SERIALIZATION_MIGRATION).toContain(
      'v_scaled := public.scale_grade_to_total(p_shortage_grade, p_out_qty)',
    );
    expect(SERIALIZATION_MIGRATION).toContain(
      "OR position('''grade'', v.grade' IN v_after) > 0",
    );
    expect(SERIALIZATION_MIGRATION).toContain(
      "'{\"34\": 2, \"35\": 3}'::jsonb",
    );
    expect(SERIALIZATION_MIGRATION).toContain(
      "'{\"34\": 3, \"35\": 5}'::jsonb",
    );
    expect(SERIALIZATION_MIGRATION).toContain("EXCEPTION WHEN SQLSTATE 'PZ211'");
    expect(SERIALIZATION_MIGRATION).toContain('IF v_demand_positive = 0 THEN');
    expect(SERIALIZATION_MIGRATION).toContain(
      "'Napa', '{}'::jsonb, NULL, 12.5, 12.5",
    );
    expect(SERIALIZATION_MIGRATION).toContain(
      "'Forro', '{\"_source\": \"scalar\"}'::jsonb, NULL, 7, 7",
    );
  });

  it('digest protege vínculos e todo preflight que o worker pode limpar', () => {
    for (const protectedField of [
      'source_pv_ids',
      'linked_sale_order_ids',
      'approval_preflight_token',
      'approval_preflight_by',
      'approval_preflight_actor_name',
      'approval_preflight_at',
      'approval_preflight_revision',
      'approval_preflight_digest',
    ]) {
      expect(OUTBOX_MIGRATION).toContain(`'${protectedField}', po.${protectedField}`);
      expect(SERIALIZATION_MIGRATION).toContain(`position('${protectedField}' IN v_digest)`);
    }
  });
});

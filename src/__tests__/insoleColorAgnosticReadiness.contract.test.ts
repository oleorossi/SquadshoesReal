import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const migration = readFileSync(
  resolve(ROOT, 'supabase/migrations/20270101013700_fix_insole_color_agnostic_readiness.sql'),
  'utf8',
);
const liveHistoryMarker = readFileSync(
  resolve(ROOT, 'supabase/migrations/20260828111941_fix_insole_color_agnostic_readiness.sql'),
  'utf8',
);

describe('palmilha sem cor não bloqueia prontidão do PV', () => {
  it('mantém area-first e impede color_mismatch em grupo is_color_agnostic', () => {
    expect(migration).toContain('resolve_insole_material_for_variant');
    expect(migration).toContain('AND NOT COALESCE(pg.is_color_agnostic, false)');
    expect(migration).toContain('v_patched_occurrences = 1');
    expect(migration).toContain("resolved.matched_by = 'color_mismatch'");
    expect(migration).toContain('__readiness_regression_missing_color__');
  });

  it('não altera catálogo nem pedidos para esconder o erro', () => {
    expect(migration).not.toMatch(
      /\b(update|insert into|delete from)\s+public\.(products|product_groups|sale_orders|sale_order_items)\b/i,
    );
  });

  it('mantém o histórico MCP alinhado sem antecipar o patch no replay', () => {
    expect(liveHistoryMarker).toContain('20270101013700_fix_insole_color_agnostic_readiness.sql');
    expect(liveHistoryMarker).not.toContain('resolve_insole_material_for_variant');
  });
});

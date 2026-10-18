import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(process.cwd(), 'supabase/migrations');

/** Última migration que redefine commitment_cover_priority (corpo vivo). */
function livingPriorityMigration(): string {
  const files = readdirSync(ROOT)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const hits = files.filter((f) => {
    const src = readFileSync(join(ROOT, f), 'utf8');
    return /CREATE OR REPLACE FUNCTION public\.commitment_cover_priority\s*\(/.test(src);
  });
  expect(hits.length).toBeGreaterThan(0);
  return hits[hits.length - 1];
}

describe('commitment_cover_priority — faturamento sem bump Ateliê', () => {
  it('a função viva ordena por billing_week e não bumpa Ateliê', () => {
    const file = livingPriorityMigration();
    expect(file).toContain('20270101043000');
    const src = readFileSync(join(ROOT, file), 'utf8');

    expect(src).toContain('resolve_billing_week_for_order');
    expect(src).toContain('delivery_deadline');
    // Não pode haver o bump antigo (Ateliê = 0 / demais = 100000000).
    expect(src).not.toMatch(/v_has_atelier/);
    expect(src).not.toMatch(/THEN 0 ELSE 100000000/);
    expect(src).toMatch(/Sem bump de Ateliê|sem bump de Ateliê/i);
  });
});

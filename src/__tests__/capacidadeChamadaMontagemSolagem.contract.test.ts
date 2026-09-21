import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Fase C: capacidade M+S vem da Chamada — contrato vivo no banco (já sem exclusão de regime por par). */
describe('capacidade medida via Chamada (spec montagem-solagem-produtividade C)', () => {
  it('migração base e review leem ficha_montadores', () => {
    const base = readFileSync(
      resolve(__dirname, '../../supabase/migrations/20260719150100_employee-productivity.sql'),
      'utf8',
    );
    const review = readFileSync(
      resolve(__dirname, '../../supabase/migrations/20260719160000_capacity-review-fixes.sql'),
      'utf8',
    );
    expect(base).toContain('FROM ficha_montadores');
    expect(review).toContain('CREATE OR REPLACE FUNCTION public.sector_measured_capacity');
    // Review remove a exclusão de payment_type=producao — montadores/soladores entram.
    expect(review).not.toMatch(/payment_type.*<>\s*'producao'/);
  });
});

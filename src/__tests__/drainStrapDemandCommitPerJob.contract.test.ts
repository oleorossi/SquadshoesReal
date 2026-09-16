import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const MIGRATION = readFileSync(
  resolve(ROOT, 'supabase/migrations/20270101025300_drain_strap_demand_jobs_commit_per_job.sql'),
  'utf8',
);

describe('drain_strap_demand_jobs — commit por job (anti-deadlock)', () => {
  it('troca a FUNCTION por PROCEDURE com COMMIT entre jobs', () => {
    expect(MIGRATION).toContain('DROP FUNCTION IF EXISTS public.drain_strap_demand_jobs(integer, text)');
    expect(MIGRATION).toContain('CREATE OR REPLACE PROCEDURE public.drain_strap_demand_jobs(');
    expect(MIGRATION).toMatch(/\bCOMMIT\s*;/);
    expect(MIGRATION).toContain("CALL public.drain_strap_demand_jobs(100, 'pg_cron')");
    expect(MIGRATION).not.toContain('SELECT public.drain_strap_demand_jobs');
  });
});

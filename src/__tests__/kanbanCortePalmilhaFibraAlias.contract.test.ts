import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SQL = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20270101024800_kanban_alias_corte_palmilha_fibra.sql'),
  'utf8',
);

const NORM = readFileSync(
  resolve(process.cwd(), 'src/components/production/kanban/kanbanDerive.ts'),
  'utf8',
);

const PLAN = readFileSync(
  resolve(process.cwd(), 'src/components/production/kanban/pointingPlan.ts'),
  'utf8',
);

describe('alias Corte Palmilha → Corte Fibra no kanban e na RPC', () => {
  it('o quadro trata Corte Palmilha como a coluna Corte Fibra', () => {
    expect(NORM).toContain("if (trimmed === 'Corte Palmilha') return 'Corte Fibra'");
    expect(PLAN).toContain('const column = norm(card.column)');
    expect(PLAN).toContain('const wanted = target === null ? null : norm(target)');
  });

  it('a migration realinha estágios, agenda, fichas e o lookup da RPC', () => {
    expect(SQL).toContain("SET stage_name = 'Corte Fibra'");
    expect(SQL).toContain("WHERE os.stage_name = 'Corte Palmilha'");
    expect(SQL).toContain("app.order_stage_command_internal");
    expect(SQL).toContain("SET sector = 'Corte Fibra'");
    expect(SQL).toContain("SET LOCAL session_replication_role = replica");
    expect(SQL).toContain("WHEN elem = 'Corte Palmilha' THEN 'Corte Fibra'");
    expect(SQL).toContain(
      'public.canonical_stage_name(stage_name) = public.canonical_stage_name(p_stage_name)',
    );
    expect(SQL).toContain(
      'SELECT public.canonical_stage_name(os.stage_name) AS sector',
    );
  });
});

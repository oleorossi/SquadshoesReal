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

const RENAME = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20270101029000_palmilha_setor_unificado_rename.sql'),
  'utf8',
);

describe('alias legado Corte Palmilha/Fibra → Palmilha · Fibra no kanban', () => {
  it('o quadro normaliza Corte Palmilha e Corte Fibra para Palmilha · Fibra', () => {
    expect(NORM).toContain(
      "if (trimmed === 'Corte Palmilha' || trimmed === 'Corte Fibra') return 'Palmilha · Fibra'",
    );
    expect(NORM).toContain(
      "if (trimmed === 'Corte Forração' || trimmed === 'Forração') return 'Palmilha · Forração'",
    );
    expect(PLAN).toContain('const column = norm(card.column)');
    expect(PLAN).toContain('const targetNorm = target === null ? null : norm(target)');
  });

  it('a migration intermediária realinhou Corte Palmilha → Corte Fibra', () => {
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

  it('a migration unificada promove Fibra/Forração para Palmilha · *', () => {
    expect(RENAME).toContain("WHEN 'corte fibra'            THEN 'Palmilha · Fibra'");
    expect(RENAME).toContain("WHEN 'corte forração'         THEN 'Palmilha · Forração'");
    expect(RENAME).toContain("SET sector = 'Palmilha · Fibra'");
    expect(RENAME).toContain("SET sector = 'Palmilha · Forração'");
    expect(RENAME).toContain("SET stage_name = public.canonical_stage_name(os.stage_name)");
    expect(RENAME).toContain("AND o.status IS DISTINCT FROM 'Finalizado'");
    expect(RENAME).toContain("SET LOCAL session_replication_role = replica");
  });
});


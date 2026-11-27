import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, 'supabase/migrations');
const FILE = '20270101066300_solagem_parcial_nao_rebaixa.sql';
const MARKER = 'solagem_parcial_nao_rebaixa_663';
const SQL = readFileSync(join(MIGRATIONS, FILE), 'utf8');
const CI = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
const TEST_SQL = readFileSync(join(ROOT, 'scripts/solagem-parcial-nao-rebaixa-test.sql'), 'utf8');

function latestFileWith(needle: string): string {
  const files = readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort();
  let hit: string | null = null;
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
    if (sql.includes(needle)) hit = file;
  }
  if (!hit) throw new Error(`nenhuma migration menciona ${needle}`);
  return hit;
}

describe('migration 66300 — Solagem parcial não rebaixa', () => {
  it('é a autoridade viva do already_debited e do gatilho do pointing', () => {
    expect(latestFileWith(MARKER)).toBe(FILE);
    expect(SQL).toContain('CREATE OR REPLACE FUNCTION public.sole_grade_already_debited_pairs(');
    expect(SQL).toContain('CREATE OR REPLACE FUNCTION public.tg_debit_sole_on_solagem_pointing()');
  });

  it('already_debited lê o movimento físico, não só reserva converted', () => {
    expect(SQL).toContain("sm.movement_type = 'out'");
    expect(SQL).toContain("sm.description LIKE 'Baixa Solagem%'");
    expect(SQL).toContain("metadata->>'kind', '') = 'sole_grade'");
    expect(SQL).not.toMatch(/mr\.status = 'converted'/);
  });

  it('o pointing não soma a qty de novo quando o estágio já inclui este apontamento', () => {
    expect(SQL).toContain('IF v_processed >= NEW.quantity THEN');
    expect(SQL).toContain('v_target := GREATEST(v_processed, v_already)');
    expect(SQL).toContain('v_target := v_already + NEW.quantity');
    expect(SQL).not.toContain(
      'public.sole_grade_already_debited_pairs(NEW.order_id) + NEW.quantity',
    );
  });

  it('o ensaio isolado cobre canônico 30+30=30 e o pointing legado', () => {
    expect(CI).toContain('scripts/solagem-parcial-nao-rebaixa-test.sql');
    expect(TEST_SQL).toContain('canônico parcial rebaixou');
    expect(TEST_SQL).toContain('legado pointing-only deveria baixar 12');
    expect(TEST_SQL).toContain('SET quantity_processed = 30');
  });
});

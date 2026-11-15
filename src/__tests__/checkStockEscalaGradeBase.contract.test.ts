import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const MIGRATIONS = resolve(ROOT, 'supabase/migrations');
const FILE = '20270101046100_check-stock-escala-grade-base.sql';
const MARKER = 'check_stock_escala_grade_base_461';

function latestFileWith(needle: string): string {
  const files = readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort();
  let hit: string | null = null;
  for (const file of files) {
    const sql = readFileSync(resolve(MIGRATIONS, file), 'utf8');
    if (sql.includes(needle)) hit = file;
  }
  if (!hit) throw new Error(`nenhuma migration menciona ${needle}`);
  return hit;
}

describe('check_stock escala grade-base — contrato 46100', () => {
  const sql = readFileSync(resolve(MIGRATIONS, FILE), 'utf8');
  const hook = readFileSync(resolve(ROOT, 'src/hooks/useOrders.ts'), 'utf8');

  it('é a autoridade viva do patch na RPC de disponibilidade', () => {
    expect(latestFileWith(MARKER)).toBe(FILE);
    expect(sql).toContain('resolve_effective_op_grade(p_order_grade, p_order_quantity)');
    expect(sql).toContain('calculate_order_consumption_by_grade(p_reference_id, COALESCE(public.resolve_effective_op_grade');
  });

  it('não reescreve a RPC inteira e aborta se a âncora sumir', () => {
    expect(sql).toContain('âncora by_grade(p_order_grade) não encontrada');
    expect(sql).not.toMatch(/CREATE OR REPLACE FUNCTION public\.check_stock_availability/);
  });

  it('o caller do PV escala a grade-base antes da RPC (paridade com consumptionService)', () => {
    expect(hook).toContain('gradeForStockCheck(grade, quantity)');
    expect(hook).toContain("from '@/lib/scaleGrade'");
  });
});

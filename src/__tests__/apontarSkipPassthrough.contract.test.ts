import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SQL = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20270101008200_apontar-skip-nao-entrega-total.sql'),
  'utf8',
);

const FLOW = readFileSync(
  resolve(process.cwd(), 'src/lib/production/stageFlow.ts'),
  'utf8',
);

describe('pulo de setor não entrega o total da OP', () => {
  it('apontar ignora concluído com 0 e pega o nível anterior que entregou', () => {
    expect(SQL).toContain("WHEN l.status = 'concluido' AND COALESCE(l.quantity_processed, 0) = 0 THEN NULL");
    expect(SQL).toContain('AND lo.delivered IS NOT NULL');
    expect(SQL).toContain('ORDER BY lo.level DESC');
  });

  it('o cliente passa adiante o inbound, não quantity_total', () => {
    expect(FLOW).toContain('export function isStageSkipped');
    expect(FLOW).toContain('export function stageEffectiveOutput');
    expect(FLOW).toMatch(/if \(!isStageSkipped\(s\)\) return processed/);
  });
});

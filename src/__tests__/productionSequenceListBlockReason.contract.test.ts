import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const mig = readFileSync(
  resolve(__dirname, '../../supabase/migrations/20270101031300_production_sequence_list_block_reason.sql'),
  'utf8',
);

describe('production sequence list block_reason (contract)', () => {
  it('recria list_production_sequence com block_reason', () => {
    expect(mig).toContain('DROP FUNCTION IF EXISTS public.list_production_sequence');
    expect(mig).toContain('block_reason text');
    expect(mig).toContain('sale_order_item_factory_gate_block_reason');
  });

  it('pin zera o motivo da porta', () => {
    expect(mig).toContain('WHEN q.pinned_position IS NOT NULL THEN NULL');
  });

  it('hub mostra a coluna Porta', () => {
    const page = readFileSync(resolve(__dirname, '../pages/ProducaoSequencia.tsx'), 'utf8');
    const hook = readFileSync(resolve(__dirname, '../hooks/useProductionSequence.ts'), 'utf8');
    expect(page).toContain('Porta');
    expect(page).toContain('blockReason');
    expect(hook).toContain('blockReason');
    expect(hook).toContain('block_reason');
  });
});

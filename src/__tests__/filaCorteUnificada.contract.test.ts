import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CORTE_LOOKAHEAD_SECTORS, sheetHasCorteSector } from '@/lib/corteLookahead';

const MIG = 'supabase/migrations/20270101044500_fila_corte_unificada.sql';
const SPEC = 'specs/fila-corte-unificada.md';

describe('fila-corte-unificada.contract', () => {
  const sql = readFileSync(MIG, 'utf8');
  const spec = readFileSync(SPEC, 'utf8');

  it('migration traz ledger, trava, peças e RPCs canônicas', () => {
    expect(sql).toContain('corte_ahead_stock_debits');
    expect(sql).toContain('corte_cut_pieces');
    expect(sql).toContain('corte_ahead_unlocked_at');
    expect(sql).toContain('FUNCTION public.confirm_corte_ahead_stage');
    expect(sql).toContain('FUNCTION public.enter_corte_ahead_production');
    expect(sql).toContain('FUNCTION public.allocate_corte_cut_piece');
    expect(sql).toContain('FUNCTION public.list_corte_wip_for_sector');
    expect(sql).toContain('FUNCTION public.trim_corte_ahead_soft_reservations');
    expect(sql).toContain('trg_block_post_cut_while_corte_ahead');
    expect(sql).toContain('nome_fantasia');
  });

  it('spec fecha 3 bancadas e supersede look-ahead', () => {
    expect(spec).toContain('Cabedal · Fibra · Forração');
    expect(spec).toContain('fila-corte-lookahead.md');
    expect(spec).toContain('Entrar em produção');
  });

  it('UI só expõe 3 setores (Fibra absorve Palmilha)', () => {
    expect([...CORTE_LOOKAHEAD_SECTORS]).toEqual([
      'Corte Cabedal',
      'Corte Fibra',
      'Corte Forração',
    ]);
    expect(sheetHasCorteSector(['Corte Palmilha', 'Expedição'], 'Corte Fibra')).toBe(true);
    expect(sheetHasCorteSector(['Palmilha · Fibra'], 'Corte Fibra')).toBe(true);
  });
});

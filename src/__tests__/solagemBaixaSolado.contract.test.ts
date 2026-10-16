import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Baixa de solado no apontamento de Solagem (decisão do dono, 2026-10-16).
 *
 * - Entrada em produção continua soft (não mexer).
 * - Apontar Solagem (qty>0) baixa até a quantidade apontada.
 * - Faturado/settle só tocam status='reserved' → idempotente se Solagem já baixou.
 */
const ROOT = resolve(__dirname, '..', '..');
const MIG = readFileSync(
  resolve(
    ROOT,
    'supabase/migrations/20270101041900_baixa-solado-no-apontamento-solagem.sql',
  ),
  'utf8',
);

const BILLING = readFileSync(
  resolve(
    ROOT,
    'supabase/migrations/20260722120001_pv-f1-billing-converts-reservations.sql',
  ),
  'utf8',
);

describe('migration 41900 — baixa solado no apontamento Solagem', () => {
  it('cria helper de fatia, função de baixa e trigger no ledger', () => {
    expect(MIG).toContain(
      'CREATE OR REPLACE FUNCTION public.sole_grade_take_pairs(',
    );
    expect(MIG).toContain(
      'CREATE OR REPLACE FUNCTION public.debit_sole_grade_for_solagem_pointing(',
    );
    expect(MIG).toContain(
      'CREATE OR REPLACE FUNCTION public.tg_debit_sole_on_solagem_pointing()',
    );
    expect(MIG).toContain(
      'CREATE TRIGGER trg_debit_sole_on_solagem_pointing',
    );
    expect(MIG).toContain('AFTER INSERT ON public.production_pointings');
  });

  it('só dispara em Solagem com quantidade positiva', () => {
    expect(MIG).toContain("canonical_stage_name(NEW.stage_name)");
    expect(MIG).toContain("v_stage IS DISTINCT FROM 'Solagem'");
    expect(MIG).toMatch(/COALESCE\(NEW\.quantity,\s*0\)\s*<=\s*0/);
  });

  it('baixa só reservas sole_grade reserved (idempotente com Faturado)', () => {
    expect(MIG).toContain("mr.status = 'reserved'");
    expect(MIG).toContain("metadata->>'kind', '') = 'sole_grade'");
    expect(MIG).toContain('LEAST(v_available, v_size_qty)');
    expect(MIG).toContain("'pending_reconciliation'");
  });

  it('usa a quantidade apontada como teto da fatia', () => {
    expect(MIG).toContain(
      'sole_grade_take_pairs(v_effective_grade, v_left_to_take)',
    );
    expect(MIG).toContain(
      'PERFORM public.debit_sole_grade_for_solagem_pointing(NEW.order_id, NEW.quantity)',
    );
  });
});

describe('Faturado continua convertendo só reserved (idempotência)', () => {
  it('billing chama convert_reservation_to_out antes de Finalizado', () => {
    expect(BILLING).toMatch(/convert_reservation_to_out/);
    expect(BILLING).toMatch(/Faturado/);
  });
});

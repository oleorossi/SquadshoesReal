import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const MIG = readFileSync(
  join(ROOT, 'supabase/migrations/20270101065000_baixa_solado_ao_passar_solagem.sql'),
  'utf8',
);
const POINTING = readFileSync(
  join(ROOT, 'src/hooks/useOrderStages.ts'),
  'utf8',
);

describe('migration 65000 — baixa solado ao passar pela Solagem', () => {
  it('cria acumulado idempotente e gatilho no avanço da etapa', () => {
    expect(MIG).toContain('CREATE OR REPLACE FUNCTION public.sole_grade_already_debited_pairs(');
    expect(MIG).toContain('CREATE OR REPLACE FUNCTION public.debit_sole_grade_up_to(');
    expect(MIG).toContain('CREATE OR REPLACE FUNCTION public.tg_debit_sole_on_solagem_stage_progress()');
    expect(MIG).toContain('CREATE TRIGGER trg_debit_sole_on_solagem_stage_progress');
    expect(MIG).toContain('AFTER UPDATE OF quantity_processed ON public.order_stages');
  });

  it('não faz backfill — só reage a UPDATE/INSERT novos', () => {
    expect(MIG).toMatch(/SEM backfill/i);
    expect(MIG).not.toMatch(/UPDATE public\.order_stages[\s\S]{0,200}debit_sole_grade_up_to/);
    expect(MIG).not.toMatch(/FROM public\.order_stages[\s\S]{0,200}PERFORM public\.debit_sole_grade_up_to/);
  });

  it('grava previous_grade e new_grade no movimento da baixa', () => {
    expect(MIG).toContain('previous_grade, new_grade');
    expect(MIG).toContain('v_stock_grade');
    expect(MIG).toContain('v_new_grade');
  });

  it('pulo da Solagem no Kanban baixa a quantidade da origem, não 0', () => {
    expect(MIG).toContain("v_skip_canon = 'Solagem'");
    expect(MIG).toContain('sole_grade_already_debited_pairs(p_order_id) + p_quantity');
    expect(POINTING).toContain('skipStageNames');
  });

  it('o teto do débito é o acumulado já convertido — faturamento não baixa de novo', () => {
    expect(MIG).toContain("mr.status = 'converted'");
    expect(MIG).toContain("metadata->>'kind', '') = 'sole_grade'");
    expect(MIG).toContain('p_target_pairs - v_already');
  });
});

const FIX = readFileSync(
  join(ROOT, 'supabase/migrations/20270101066300_baixa_solado_origin_type_movimento.sql'),
  'utf8',
);

describe('migration 66300 — origin_type do movimento da baixa na Solagem', () => {
  it('troca production_pointing por NULL, permitido pelo check de stock_movements', () => {
    expect(FIX).toContain('production_pointing');
    expect(FIX).toContain("'NULL'");
    expect(FIX).toContain('stock_movements_strap_origin_type_ck');
    expect(FIX).toMatch(/SEM backfill|Sem backfill/i);
  });
});

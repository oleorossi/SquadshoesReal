import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * A 42500 reintroduziu movement_reason='atelier_prep' no corte do lote.
 * A 43100 restaura 'consumo_op' (CHECK de stock_movements). Este contrato
 * aponta para a migration que define o estado FINAL — se alguém recriar a
 * função a partir da 42500 sem o fix, o teste da âncora na 43100 continua
 * cobrindo o arquivo; o vivo precisa da 43100 aplicada.
 */
const REGRESSION = 'supabase/migrations/20270101042500_atelier_interno_prestador_kit.sql';
const FIX = 'supabase/migrations/20270101043100_atelier_confirm_lot_cut_consumo_op.sql';

describe('atelier_confirm_lot_cut — movement_reason consumo_op', () => {
  it('42500 é a regressão documentada (INSERT com atelier_prep)', () => {
    const sql = readFileSync(REGRESSION, 'utf8');
    const cut = sql.slice(sql.indexOf('FUNCTION public.atelier_confirm_lot_cut'));
    const body = cut.slice(0, cut.indexOf('\n$$;'));
    expect(body).toMatch(
      /'Ateliê · corte ' \|\| v_lot\.lot_number \|\| ' · ' \|\| v_line\.component,\s*\n\s*'atelier_prep'/,
    );
  });

  it('43100 troca o INSERT do movimento para consumo_op (âncora multilinha)', () => {
    const fix = readFileSync(FIX, 'utf8');
    expect(fix).toContain("'consumo_op'");
    expect(fix).toMatch(/v_lot\.lot_number \|\| ' · ' \|\| v_line\.component,\n\s*'atelier_prep'/);
    expect(fix).toMatch(/v_lot\.lot_number \|\| ' · ' \|\| v_line\.component,\n\s*'consumo_op'/);
    expect(fix).toMatch(/replace\(v_def,\s*v_old,\s*v_new\)/);
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SQL = readFileSync(
  resolve(
    __dirname,
    '../../supabase/migrations/20270101011200_restore_stock_net_ledger_and_debit_guards.sql',
  ),
  'utf8',
);

function sqlFunction(name: string): string {
  const start = SQL.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start, `${name} ausente`).toBeGreaterThanOrEqual(0);
  const tail = SQL.slice(start);
  const terminators = ['\n$function$;', '\n$guard$;'];
  const end = terminators
    .map((terminator) => {
      const index = tail.indexOf(terminator);
      return index < 0 ? Number.POSITIVE_INFINITY : index + terminator.length;
    })
    .reduce((smallest, index) => Math.min(smallest, index), Number.POSITIVE_INFINITY);
  expect(Number.isFinite(end), `${name} sem terminador`).toBe(true);
  return tail.slice(0, end);
}

describe('hotfix de estorno de estoque por OP', () => {
  const soleRestore = sqlFunction('restore_sole_grade_for_order');
  const restore = sqlFunction('restore_product_stocks_for_order');
  const guard = sqlFunction('run_stock_restore_hardening_tests');
  const debitGuard = sqlFunction('run_debit_guard_tests');

  it('calcula somente o débito líquido e registra a entrada compensatória', () => {
    expect(restore).toContain("WHEN sm.movement_type = 'out' THEN sm.quantity");
    expect(restore).toContain("WHEN sm.movement_type = 'in'  THEN -sm.quantity");
    expect(restore).toContain('HAVING COALESCE(SUM(CASE');
    expect(restore).toMatch(/INSERT INTO public\.stock_movements[\s\S]*?'in'/);
  });

  it('serializa por OP antes de ler e alterar o ledger', () => {
    const lock = restore.indexOf('pg_advisory_xact_lock');
    const ledger = restore.indexOf('FROM public.stock_movements');
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(lock).toBeLessThan(ledger);
    expect(restore).toContain("'production-order:' || p_order_id::text");
    expect(restore).toContain('FOR UPDATE');
  });

  it('preserva a separação entre grade, resíduo escalar e caixa', () => {
    for (const token of [
      'sole_restored_at',
      'effective_grade',
      'residuo escalar',
      'public.box_types',
      'restore - caixa',
    ]) {
      expect(restore).toContain(token);
    }
  });

  it('estorna solado pela grade debitada e nunca credita consumo sem saída física', () => {
    expect(soleRestore).toContain("metadata -> 'effective_grade'");
    expect(soleRestore).toContain("WHEN sm.movement_type = 'out' THEN sm.quantity");
    expect(soleRestore).toContain("WHEN sm.movement_type = 'in'  THEN -sm.quantity");
    expect(soleRestore).toContain("'sole_restored_quantity', 0");
    expect(soleRestore).toContain("'sem_debito_fisico_no_ledger'");
    expect(soleRestore).toContain('Reconciliacao manual obrigatoria');
    expect(soleRestore).toContain('INSERT INTO public.stock_movements');
    expect(soleRestore).toContain('sole_restored_at');
  });

  it('neutraliza o overload de cinco argumentos sem reintroduzi-lo após 103/105', () => {
    expect(SQL).toContain(
      "to_regprocedure(\n       'public.hybrid_debit_stock_for_order(uuid,numeric,text,uuid,jsonb)'",
    );
    expect(SQL).toMatch(/p_force_soft\s*=>\s*true/);
    expect(SQL).toMatch(
      /REVOKE ALL ON FUNCTION public\.hybrid_debit_stock_for_order\(uuid,numeric,text,uuid,jsonb\) FROM PUBLIC, anon, authenticated, service_role/,
    );
    expect(SQL).not.toMatch(
      /CREATE OR REPLACE FUNCTION public\.hybrid_debit_stock_for_order\([\s\S]*?p_order_grade jsonb[\s\S]*?\)\s*RETURNS jsonb[\s\S]*?UPDATE public\.products/,
    );
  });

  it('acompanha restore, ACL e motor canônico com guard read-only', () => {
    for (const caseName of [
      'SR1', 'SR2', 'SR3', 'SR4', 'SR5', 'SR6', 'SR7', 'SR8', 'SR9',
    ]) {
      expect(guard).toContain(`'${caseName} `);
    }
    expect(guard).toContain('SECURITY INVOKER');
    expect(guard).toContain('has_function_privilege');
  });

  it('torna os guards antigos wrapper-aware e signature-aware', () => {
    expect(debitGuard).toContain(
      'convert_reservation_to_out_legacy_202701(uuid,uuid)',
    );
    expect(debitGuard).toContain(
      'confirm_picking_reservation_legacy_202701(uuid,text)',
    );
    expect(debitGuard).toContain(
      'hybrid_debit_stock_for_order(uuid,numeric,text,uuid,jsonb,boolean)',
    );
    expect(debitGuard).toContain('G23 quem escreve quantity_consumed');
  });

  it('executa as duas suítes read-only antes do commit', () => {
    const selfTest = SQL.indexOf('DO $self_test$');
    const commit = SQL.lastIndexOf('COMMIT;');
    expect(selfTest).toBeGreaterThanOrEqual(0);
    expect(SQL.slice(selfTest, commit)).toContain('run_stock_restore_hardening_tests');
    expect(SQL.slice(selfTest, commit)).toContain('run_debit_guard_tests');
    expect(selfTest).toBeLessThan(commit);
  });
});

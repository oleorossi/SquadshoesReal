import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATION = '20270101016800_auto-resync-unstarted-ops-on-sheet-save.sql';

const SQL = readFileSync(
  resolve(__dirname, `../../supabase/migrations/${MIGRATION}`),
  'utf8',
);

const HOOK = readFileSync(
  resolve(__dirname, '../hooks/useTechnicalSheets.ts'),
  'utf8',
);

const RESYNC_LIB = readFileSync(
  resolve(__dirname, '../lib/resyncOPs.ts'),
  'utf8',
);

const SOLE_HOOK = readFileSync(
  resolve(__dirname, '../hooks/useSoleGroupStandardConsumption.ts'),
  'utf8',
);

function sqlFunction(name: string): string {
  const start = SQL.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start, `${name} ausente`).toBeGreaterThanOrEqual(0);
  const tail = SQL.slice(start);
  const end = tail.indexOf('\n$$;');
  expect(end, `${name} sem terminador`).toBeGreaterThanOrEqual(0);
  return tail.slice(0, end + 4);
}

describe('auto-resync no save da ficha (PV aprovado sem produção)', () => {
  const sheetFn = sqlFunction('auto_resync_unstarted_ops_for_sheet');
  const soleFn = sqlFunction('auto_resync_unstarted_ops_for_sole_group');

  it('reusa resync_op_atomic e filtra PV Aprovado', () => {
    expect(sheetFn).toContain('resync_op_atomic');
    expect(sheetFn).toContain("so.status = 'Aprovado'");
    expect(sheetFn).toMatch(/'reservado',\s*'em produção',\s*'em producao'/);
  });

  it('trata PZ105 como skip (produção iniciada) sem abortar o lote', () => {
    expect(sheetFn).toContain("WHEN SQLSTATE 'PZ105'");
    expect(sheetFn).toContain('skipped_started');
    expect(sheetFn).toContain('reservations_outdated_at = NULL');
  });

  it('não embute o resync no trigger dirty da ficha', () => {
    expect(SQL).not.toMatch(/CREATE TRIGGER[\s\S]*auto_resync_unstarted/);
    expect(sheetFn).not.toContain('mark_pv_costs_dirty');
  });

  it('solado delega por ficha afetada pelo grupo', () => {
    expect(soleFn).toContain('auto_resync_unstarted_ops_for_sheet');
    expect(soleFn).toContain('sole_group_id');
  });

  it('useUpdateSheet e materiais disparam a RPC após persistir', () => {
    expect(HOOK).toContain('propagateSheetConsumption');
    expect(HOOK).toContain('autoResyncUnstartedOpsForSheet');
    expect(HOOK).toContain('invalidateQueries({ queryKey: [\'pv-consumption\'] })');
    expect(HOOK).not.toMatch(
      /NUNCA\s+reescreve uma OP automaticamente/,
    );
  });

  it('wrapper TS chama as RPCs canônicas', () => {
    expect(RESYNC_LIB).toContain("auto_resync_unstarted_ops_for_sheet");
    expect(RESYNC_LIB).toContain("auto_resync_unstarted_ops_for_sole_group");
    expect(RESYNC_LIB).toContain('toastAutoResyncSummary');
  });

  it('Consumo Padrão do solado também propaga', () => {
    expect(SOLE_HOOK).toContain('propagateSoleGroupConsumption');
    expect(SOLE_HOOK).toContain('autoResyncUnstartedOpsForSoleGroup');
  });
});

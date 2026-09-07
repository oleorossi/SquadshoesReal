import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const MIGRATION = readFileSync(
  resolve(ROOT, 'supabase/migrations/20270101016900_auto-resync-unstarted-ops-on-sheet-save.sql'),
  'utf8',
);
const RESYNC = readFileSync(resolve(ROOT, 'src/lib/resyncOPs.ts'), 'utf8');
const SHEETS = readFileSync(resolve(ROOT, 'src/hooks/useTechnicalSheets.ts'), 'utf8');
const SOLE = readFileSync(resolve(ROOT, 'src/hooks/useSoleGroupStandardConsumption.ts'), 'utf8');

/**
 * Decisão do dono: PV Aprovado + sem fato físico → save da ficha / Consumo
 * Padrão propaga snapshot+reservas sozinho. OPs já iniciadas só sinalizam (PZ105).
 */
describe('auto-resync de OPs sem produção iniciada', () => {
  it('RPC da ficha só toca PV Aprovado e delega a resync_op_atomic com guarda PZ105', () => {
    expect(MIGRATION).toContain('auto_resync_unstarted_ops_for_sheet');
    expect(MIGRATION).toContain("so.status = 'Aprovado'");
    expect(MIGRATION).toContain('resync_op_atomic');
    expect(MIGRATION).toContain("WHEN SQLSTATE 'PZ105'");
    expect(MIGRATION).toMatch(/'reservado'|em produ/i);
  });

  it('RPC do solado propaga por todas as fichas do grupo', () => {
    expect(MIGRATION).toContain('auto_resync_unstarted_ops_for_sole_group');
    expect(MIGRATION).toContain('auto_resync_unstarted_ops_for_sheet(v_sheet)');
    expect(MIGRATION).toContain('sole_group_id = p_sole_group_id');
  });

  it('cliente chama as RPCs após save (fora do trigger dirty)', () => {
    expect(RESYNC).toContain("rpc(\n    'auto_resync_unstarted_ops_for_sheet'");
    expect(RESYNC).toContain("rpc(\n    'auto_resync_unstarted_ops_for_sole_group'");
    expect(SHEETS).toContain('propagateSheetConsumption');
    expect(SHEETS).toContain('autoResyncUnstartedOpsForSheet');
    expect(SHEETS).toContain('useUpdateSheet');
    expect(SOLE).toContain('propagateSoleGroupConsumption');
    expect(SOLE).toContain('autoResyncUnstartedOpsForSoleGroup');
    expect(SOLE).toContain('useSetSoleGroupRole');
    expect(SOLE).toContain('useUpsertSoleGroupItem');
  });

  it('não recoloca o texto antigo de "nunca reescreve OP automaticamente"', () => {
    expect(SHEETS).not.toMatch(/NUNCA\s+reescreve uma OP automaticamente/i);
    expect(SHEETS).toContain('auto_resync_unstarted_ops_for_sheet');
    expect(SHEETS).toContain('propagateSheetConsumption');
  });
});

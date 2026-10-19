import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIG = resolve(
  process.cwd(),
  'supabase/migrations/20270101043700_atelier_kit_componentes_grupo.sql',
);

describe('atelier kit COMPONENTES por grupo (mig 43700)', () => {
  const sql = readFileSync(MIG, 'utf8');

  it('candidatos vêm de direct_components (grupo), não só BOM', () => {
    expect(sql).toContain('atelier_sheet_kit_candidates');
    expect(sql).toContain('direct_components');
    expect(sql).toContain('group_id');
    expect(sql).toContain('kit_group_ids');
  });

  it('corte debita só Cabedal; liberação debita kit/tiras', () => {
    expect(sql).toMatch(/l\.component = 'Cabedal'/);
    expect(sql).toContain('atelier_confirm_lot_release');
    expect(sql).toContain('liberacao_atelier');
    expect(sql).toContain('atelier_lot_release_lines');
  });

  it('Costura força Corte + kit_gate awaiting/ready', () => {
    expect(sql).toContain('tg_atelier_costura_forces_corte');
    expect(sql).toContain('awaiting_components');
    expect(sql).toContain('ready_to_send');
    expect(sql).toContain('atelier_refresh_lot_kit_gate');
  });
});

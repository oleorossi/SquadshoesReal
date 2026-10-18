import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  READY_MADE_CANONICAL_ROUTINGS,
  READY_MADE_STRIPPED_SECTORS,
} from '@/components/technical-sheets/ConstructionConfigPanel';

const MIGRATIONS = resolve(__dirname, '../../supabase/migrations');
const MIG = readFileSync(
  resolve(MIGRATIONS, '20270101042800_palmilha-pronta-strip-etapas-canonicas.sql'),
  'utf8',
);

/**
 * Palmilha Pronta (decisão do dono 2026-10): com insole_ready_made / solado
 * palmilha_pronta a rota perde Palmilha · Fibra, Palmilha · Forração e
 * Acabamento Palmilha. O trigger antigo só stripava nomes pré-rename e
 * restaurava etapas ao desligar a flag.
 */
describe('palmilha pronta — strip canônico de etapas', () => {
  it('define helper com nomes canônicos e aliases (não Costura Cabedal)', () => {
    expect(MIG).toMatch(/private\.ready_made_stripped_sector_names/);
    const helper = MIG.slice(
      MIG.indexOf('ready_made_stripped_sector_names'),
      MIG.indexOf('strip_ready_made_production_sectors'),
    );
    expect(helper).toMatch(/palmilha · fibra/);
    expect(helper).toMatch(/palmilha · forração/);
    expect(helper).toMatch(/acabamento palmilha/);
    expect(helper).toMatch(/corte fibra/);
    expect(helper).toMatch(/costura palmilha/);
    // Exact 'costura' (legado), não o setor vivo Costura Cabedal.
    expect(helper).toMatch(/'costura'/);
    expect(helper).not.toMatch(/'costura cabedal'/);
  });

  it('strip ao insole_ready_made=true e NÃO restaura no true→false', () => {
    expect(MIG).toMatch(/CREATE OR REPLACE FUNCTION public\.tg_strip_cut_sectors_when_ready_made/);
    expect(MIG).toMatch(/private\.strip_ready_made_production_sectors/);
    // O ramo que recolocava Corte Palmilha/Forração/Acabamento sumiu.
    expect(MIG).not.toMatch(/v_required/);
    expect(MIG).not.toMatch(/OLD\.insole_ready_made/);
    expect(MIG).toMatch(/NÃO restaura|Não restaura|não recoloca/i);
  });

  it('cascateia ao classificar o solado como palmilha_pronta', () => {
    expect(MIG).toMatch(/tg_cascade_palmilha_pronta_to_sheets/);
    expect(MIG).toMatch(/AFTER UPDATE OF sole_classification/);
    expect(MIG).toMatch(/sole_group_id = NEW\.group_id/);
    expect(MIG).toMatch(/primary_sole_id = NEW\.id/);
    expect(MIG).toMatch(/insole_ready_made = true/);
    expect(MIG).toMatch(/session_replication_role',\s*'replica'/);
  });

  it('backfill de OP só apaga etapa pendente sem apontamento', () => {
    expect(MIG).toMatch(/DELETE FROM public\.order_stages/);
    expect(MIG).toMatch(/Finalizado.*Cancelado.*Cancelada/s);
    expect(MIG).toMatch(/pendente/);
    expect(MIG).toMatch(/production_pointings/);
    expect(MIG).toMatch(/app\.order_stage_command_internal/);
    expect(MIG).toMatch(/session_replication_role\s*=\s*replica/);
  });

  it('UI Cabedal espelha a mesma lista de strip', () => {
    const stripped = new Set<string>(READY_MADE_STRIPPED_SECTORS);
    expect(stripped.has('Palmilha · Fibra')).toBe(true);
    expect(stripped.has('Palmilha · Forração')).toBe(true);
    expect(stripped.has('Acabamento Palmilha')).toBe(true);
    expect(stripped.has('Costura Cabedal')).toBe(false);
    for (const rota of READY_MADE_CANONICAL_ROUTINGS) {
      for (const setor of rota) expect(stripped.has(setor)).toBe(false);
    }
  });
});

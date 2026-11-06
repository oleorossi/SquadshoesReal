import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Decisão do dono: qualquer alteração de consumo na ficha atualiza consumo
 * dos PVs/OPs abertos — no banco, sem depender do void do cliente.
 */
const ROOT = resolve(__dirname, '../..');
const MIGRATIONS = resolve(ROOT, 'supabase/migrations');
const MARKER = 'ficha_alteracao_atualiza_consumo_457';
const FILE = '20270101045700_ficha-alteracao-atualiza-consumo.sql';

function latestFileWith(needle: string): string {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  let hit: string | null = null;
  for (const file of files) {
    const sql = readFileSync(resolve(MIGRATIONS, file), 'utf8');
    if (sql.includes(needle)) hit = file;
  }
  if (!hit) throw new Error(`nenhuma migration menciona ${needle}`);
  return hit;
}

describe('ficha alteração atualiza consumo — contrato 45700', () => {
  const sql = readFileSync(resolve(MIGRATIONS, FILE), 'utf8');

  it('é a autoridade viva do auto-resync pós-save da ficha', () => {
    expect(latestFileWith(MARKER)).toBe(FILE);
    expect(sql).toContain('private.auto_resync_sheet_consumption_safe');
    expect(sql).toContain('auto_resync_unstarted_ops_for_sheet');
    expect(sql).toContain('trg_zz_auto_resync_consumption_on_sheet_change');
    expect(sql).toContain('trg_aa_mark_so_costs_dirty_from_sheet');
  });

  it('dirty cobre fachete, forro de palmilha, grades por numeração e primary_sole', () => {
    expect(sql).toContain('fachete_consumption');
    expect(sql).toContain('fachete_consumption_per_size');
    expect(sql).toContain('fachete_material');
    expect(sql).toContain('insole_lining_consumption');
    expect(sql).toContain('insole_lining_consumption_per_size');
    expect(sql).toContain('lining_consumption_per_size');
    expect(sql).toContain('insole_consumption_per_size');
    expect(sql).toContain('primary_sole_id');
  });

  it('remove o trigger só-de-tiras (455) e cobre BOM + listas por cor', () => {
    expect(sql).toContain('DROP TRIGGER IF EXISTS trg_propagate_sheet_straps_on_structure_change');
    expect(sql).toContain('trg_zz_auto_resync_consumption_from_bom');
    expect(sql).toContain('trg_zz_auto_resync_consumption_from_component_colors');
    expect(sql).toContain('trg_zz_auto_resync_consumption_from_lining_colors');
    expect(sql).toContain('trg_zz_auto_resync_consumption_from_palmilha_colors');
    expect(sql).toContain('trg_zz_auto_resync_consumption_from_insole_colors');
    expect(sql).toContain('trg_zz_auto_resync_consumption_from_sole_colors');
  });

  it('falha do resync vira WARNING e não aborta o UPDATE da ficha', () => {
    expect(sql).toContain('RAISE WARNING');
    expect(sql).toContain('EXCEPTION WHEN OTHERS THEN');
    expect(sql).toContain("set_config('app.strap_propagate_rpc', '1', true)");
  });

  it('cliente ainda chama auto_resync no save (idempotente com o trigger)', () => {
    const hooks = readFileSync(
      resolve(ROOT, 'src/hooks/useTechnicalSheets.ts'),
      'utf8',
    );
    expect(hooks).toContain('propagateSheetConsumption');
    expect(hooks).toContain('autoResyncUnstartedOpsForSheet');
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const migration = readFileSync(resolve(
  ROOT,
  'supabase/migrations/20270101020300_corrigir_palmilha_sem_material_e_override_fibra.sql',
), 'utf8');

describe('SQL — backfill palmilha sem material + limpa override INFANTIL', () => {
  it('preenche só insole_material vazio em fichas publicadas com consumo', () => {
    expect(migration).toContain("SET insole_material = 'PALMILHA'");
    expect(migration).toContain("COALESCE(btrim(ts.insole_material), '') = ''");
    expect(migration).toContain("status_ficha, '') = 'publicada'");
    expect(migration).toContain('sole_drives_consumption');
    expect(migration).not.toMatch(/UPDATE\s+public\.orders/i);
    expect(migration).not.toMatch(/UPDATE\s+public\.material_reservations/i);
  });

  it('prova resolução da placa PALMILHA nas cores do print', () => {
    expect(migration).toContain('resolve_insole_material_for_variant');
    for (const color of ['CHAMPAGNE', 'COBRE', 'OFF WHITE', 'ROSADO']) {
      expect(migration).toContain(`'${color}'`);
    }
  });

  it('limpa insole_consumption_per_size só no solado INFANTIL', () => {
    expect(migration).toContain("insole_consumption_per_size = '{}'::jsonb");
    expect(migration).toContain('5902f5eb-668a-421e-a0b6-ce0ace9f1a6c');
    expect(migration).toContain('primary_sole_id');
  });

  it('trava pós-condição via audit.missing_insole_material', () => {
    expect(migration).toContain('audit.missing_insole_material');
    expect(migration).toContain('v_still_missing');
    expect(migration).toContain('v_still_override');
  });
});

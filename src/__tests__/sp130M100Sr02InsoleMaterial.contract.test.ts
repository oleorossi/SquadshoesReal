import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const migration = readFileSync(resolve(
  ROOT,
  'supabase/migrations/20270101015200_corrigir_material_palmilha_sp130_m100_sr02.sql',
), 'utf8');

describe('SQL — material da palmilha de SP130, M100 e SR02', () => {
  it('limita o backfill aos três IDs publicados e somente ao valor vazio', () => {
    expect(migration).toContain("'d5079aa8-b4c0-4c04-a8b6-b684f7523928'::uuid");
    expect(migration).toContain("'ca3615f3-2a46-4d8d-938c-2dcddd96801a'::uuid");
    expect(migration).toContain("'30a08111-a84c-4050-9b58-2d1e084d0a0c'::uuid");
    expect(migration).toContain('v_target_count <> 3');
    expect(migration).toContain("SET insole_material = 'PALMILHA'");
    expect(migration).toContain("COALESCE(btrim(insole_material), '') = ''");
    expect(migration).not.toMatch(/UPDATE\s+public\.orders/i);
    expect(migration).not.toMatch(/UPDATE\s+public\.material_reservations/i);
  });

  it('tolera banco de teste vazio, mas não uma fixture parcial', () => {
    expect(migration).toContain('IF v_target_count = 0 THEN');
    expect(migration).toContain('backfill operacional ignorado');
    expect(migration).toContain('ELSIF v_target_count <> 3 THEN');
  });

  it('usa SP124 e a geometria 34–40 como prova de identidade técnica', () => {
    expect(migration).toContain("template.name = 'SP124'");
    expect(migration).toContain('template.insole_consumption = 4.4343');
    for (const size of ['34', '35', '36', '37', '38', '39', '40']) {
      expect(migration).toContain(`"${size}"`);
    }
  });

  it('prova a resolução da placa sem esconder resolver que retorna zero linhas', () => {
    expect(migration).toContain('resolve_insole_material_for_variant');
    for (const color of ['NEW WHISKY', 'TÂMARA', 'CHAMPAGNE', 'OFF WHITE', 'ROSADO']) {
      expect(migration).toContain(`'${color}'`);
    }
    expect(migration).toContain('WHERE NOT EXISTS');
    expect(migration).not.toContain('CROSS JOIN LATERAL public.resolve_insole_material_for_variant');
    expect(migration).toContain("'caa8afb2-edd9-49b3-ae08-cc43c74f20a3'::uuid");
  });

  it('trava readiness e emissão positiva do motor inclusive na variante real', () => {
    expect(migration).toContain('audit.missing_insole_material');
    expect(migration).toContain('audit.missing_insole_consumption');
    expect(migration).toContain('calculate_order_consumption_by_grade');
    expect(migration).toContain("'53d056b5-3e55-4256-acb1-700c5dde863c'::uuid");
    expect(migration).toContain("'SP130/CHAMPAGNE'");
    expect(migration).toContain("line.value ->> 'component' = 'Palmilha'");
    expect(migration).toContain("line.value ->> 'unit' = 'dm²'");
  });
});

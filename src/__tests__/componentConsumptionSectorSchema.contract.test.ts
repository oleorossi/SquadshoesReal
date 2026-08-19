import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

const migration = read(
  'supabase/migrations/20270101005600_restore_component_consumption_sector_schema.sql',
);
const hook = read('src/hooks/useTechnicalSheets.ts');
const page = read('src/pages/TechnicalSheets.tsx');

describe('Ficha técnica — schema dos setores de consumo', () => {
  it('restaura as três colunas exigidas pelo frontend com defaults compatíveis', () => {
    expect(migration).toMatch(
      /ALTER TABLE public\.technical_sheets[\s\S]*ADD COLUMN IF NOT EXISTS component_consumption_sectors jsonb NOT NULL DEFAULT/,
    );
    expect(migration).toMatch(
      /ADD COLUMN IF NOT EXISTS consumption_routing_required boolean NOT NULL DEFAULT false/,
    );
    expect(migration).toMatch(
      /ALTER TABLE public\.sheet_materials[\s\S]*ADD COLUMN IF NOT EXISTS consumption_sector text/,
    );
    expect(migration).toContain('"fibra":"Corte Fibra"');
    expect(migration).toContain('"forracao_palmilha":"Corte Forração"');
    expect(migration).toContain('"cabedal":"Corte Cabedal"');
    expect(migration).toContain('"solado":"Solagem"');
  });

  it('recarrega o schema do PostgREST e verifica as colunas antes do commit', () => {
    expect(migration).toContain("NOTIFY pgrst, 'reload schema';");
    expect(migration).toContain('information_schema.columns');
    expect(migration).toContain('Falha ao restaurar colunas de consumo por setor');
  });

  it('não reescreve dados operacionais durante o reparo de schema', () => {
    expect(migration).not.toMatch(/\b(?:UPDATE|INSERT INTO|DELETE FROM)\s+public\./i);
  });

  it('mantém o campo no formulário e no contrato do hook', () => {
    expect(hook).toContain('component_consumption_sectors?: Record<string, string>;');
    expect(page).toContain("updateField('component_consumption_sectors'");
  });
});

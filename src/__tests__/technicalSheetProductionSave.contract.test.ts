import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

const migration = read(
  'supabase/migrations/20270101005200_fix_min_billing_generation_safe_update.sql',
);
const originalCacheMigration = read(
  'supabase/migrations/20261115120000_pv-min-billing-cache.sql',
);
const routingMigration = read(
  'supabase/migrations/20270101005300_fix_corte_fibra_routing_normalization.sql',
);
const technicalSheets = read('src/pages/TechnicalSheets.tsx');

function section(startMarker: string, endMarker: string): string {
  const start = technicalSheets.indexOf(startMarker);
  const end = technicalSheets.indexOf(endMarker, start + startMarker.length);
  expect(start, `${startMarker} deve existir`).toBeGreaterThanOrEqual(0);
  expect(end, `${endMarker} deve existir depois de ${startMarker}`).toBeGreaterThan(start);
  return technicalSheets.slice(start, end);
}

describe('salvamento da rota de produção da ficha técnica', () => {
  it('invalida o cache singleton com predicado compatível com pg_safeupdate', () => {
    expect(originalCacheMigration).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.min_billing_cache_meta[\s\S]*id\s+boolean PRIMARY KEY DEFAULT true CHECK \(id\)/,
    );
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.tg_min_billing_bump_generation()',
    );
    expect(migration).toMatch(
      /UPDATE public\.min_billing_cache_meta[\s\S]*SET generation = generation \+ 1,[\s\S]*WHERE id = true;/,
    );
  });

  it('envia setores e etapas de Aviamento em uma única mutation', () => {
    const usage = section('<ProductionSectorsTab', '<Separator />');
    const component = section(
      'function ProductionSectorsTab(',
      '/* ===== SHEET IMAGE UPLOAD ===== */',
    );

    expect(usage.match(/updateSheet\.mutate\(/g)).toHaveLength(1);
    expect(usage).toContain('production_sectors: sectors');
    expect(usage).toContain("sectors.includes('Aviamento') ? { aviamento_steps: steps } : {}");
    expect(usage).toContain('saving={updateSheet.isPending}');
    expect(component).toContain('onSave(localSectors, localSteps)');
    expect(component).toContain('disabled={saving}');
    expect(component).not.toContain('onChangeAviamentoSteps');
  });

  it('persiste Corte Fibra e mantém Corte Palmilha apenas como alias histórico', () => {
    expect(routingMigration).toContain("SET sector = 'Corte Fibra'");
    expect(routingMigration).toContain("WHERE sector = 'Corte Palmilha'");
    expect(routingMigration).toContain("WHEN 'corte palmilha'   THEN 'Corte Fibra'");
    expect(routingMigration).toContain("WHEN 'corte fibra'      THEN 'Corte Fibra'");
    expect(routingMigration).toContain("'Corte Fibra', 'Corte Forração', 'Corte Cabedal'");
    expect(routingMigration).toContain(
      "WHEN x IN ('Corte', 'Corte Palmilha') THEN 'Corte Fibra'",
    );
    expect(routingMigration).toContain(
      "WHEN 'Corte Fibra'      THEN 'corte_palmilha'::public.production_stage_enum",
    );
  });
});

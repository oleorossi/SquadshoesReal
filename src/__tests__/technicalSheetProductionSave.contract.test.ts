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
const saveOptimizationMigration = read(
  'supabase/migrations/20270101014200_otimizar_save_ficha_tecnica.sql',
);
const technicalSheets = read('src/pages/TechnicalSheets.tsx');
const operationsTab = read('src/components/technical-sheets/OperationsTab.tsx');

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

  it('salva capacidade por uma única mutation aguardada pelo componente pai', () => {
    const handlerStart = operationsTab.indexOf('const handleSaveProductionFields = async () => {');
    const handlerEnd = operationsTab.indexOf('\n  const handleAdd =', handlerStart);
    const handler = operationsTab.slice(handlerStart, handlerEnd);
    const usage = section('<OperationsTab', '</TabsContent>');

    expect(handlerStart).toBeGreaterThanOrEqual(0);
    expect(handlerEnd).toBeGreaterThan(handlerStart);
    expect(handler).toContain('await onUpdateSheet(payload)');
    expect(handler).not.toContain(".from('technical_sheets')");
    expect(handler).not.toContain('onUpdateSheet?.(');
    expect(usage).toContain(
      'await updateSheet.mutateAsync({ id: sheet.id, data: data as Partial<SheetFormData> })',
    );
    expect(usage).not.toContain('data as any');
    expect(usage).not.toContain('updateSheet.mutate(');
  });

  it('o save geral persiste somente o patch e não emite mutation para patch vazio', () => {
    const saveAll = section('const saveAll = async () => {', 'const formatCurrency =');

    expect(saveAll).toContain('const patch = buildTechnicalSheetPatch(');
    expect(saveAll).toContain("['production_sectors', 'aviamento_steps']");
    expect(saveAll).toContain('if (Object.keys(patch).length === 0)');
    expect(saveAll).toMatch(
      /if \(Object\.keys\(patch\)\.length === 0\) \{[\s\S]*?return;[\s\S]*?updateSheet\.mutateAsync\(\{ id: sheet\.id, data: patch \}\)/,
    );
    expect(saveAll).toContain(
      "void queryClient.invalidateQueries({ queryKey: ['sheet_variant_cascade', sheet.id] })",
    );
    expect(saveAll).not.toContain(
      "await queryClient.invalidateQueries({ queryKey: ['sheet_variant_cascade', sheet.id] })",
    );
    expect(saveAll).not.toContain('data: payload });');
  });

  it('protege no banco contra target list completa sem mudança real', () => {
    expect(saveOptimizationMigration).toMatch(
      /CREATE CONSTRAINT TRIGGER tg_ficha_recompute[\s\S]*?WHEN \([\s\S]*?OLD\.production_sectors IS DISTINCT FROM NEW\.production_sectors/,
    );
    expect(saveOptimizationMigration).toMatch(
      /CREATE TRIGGER trg_mark_so_costs_dirty_from_sheet[\s\S]*?WHEN \([\s\S]*?OLD\.upper_material IS DISTINCT FROM NEW\.upper_material/,
    );
    expect(saveOptimizationMigration).toContain('reservations_outdated_at = CASE');
    expect(saveOptimizationMigration).toContain(
      "pg_catalog.pg_current_xact_id()::text",
    );
    expect(saveOptimizationMigration).toContain(
      "'production_schedule_changed:%s:%s'",
    );
    expect(saveOptimizationMigration).not.toContain('xmin::text::bigint');
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

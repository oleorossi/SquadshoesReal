import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

const READINESS_MIGRATION =
  'supabase/migrations/20270101020200_pv-editor-strap-readiness-batch.sql';
const PREVIEW_MIGRATION =
  'supabase/migrations/20270101021300_pv-editor-strap-preview-batch.sql';
const readinessMigration = read(READINESS_MIGRATION);
const previewMigration = read(PREVIEW_MIGRATION);
const readinessHook = read('src/hooks/useInternalStrapReadiness.ts');
const strapStockHook = read('src/hooks/useStrapStockLines.ts');
const itemForm = read('src/components/sale-orders/SaleOrderItemForm.tsx');
const panel = read('src/components/sale-orders/SaleOrderFormPanel.tsx');
const saleOrderForm = read('src/pages/SaleOrderForm.tsx');
const sheetsHook = read('src/hooks/useTechnicalSheets.ts');
const minBilling = read('src/lib/minBillingDate.ts');
const app = read('src/App.tsx');

function sqlFunction(source: string, name: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${name}`;
  const start = source.lastIndexOf(marker);
  expect(start, `${name} deve existir`).toBeGreaterThanOrEqual(0);
  const tail = source.slice(start);
  const end = tail.search(/\n\$(function\$|\$);/);
  expect(end, `${name} deve terminar com $function$;`).toBeGreaterThanOrEqual(0);
  return tail.slice(0, end + 12);
}

describe('PV editor — carga otimizada', () => {
  it('batch de readiness reusa o diagnose unitario e tem grants corretos', () => {
    const fn = sqlFunction(readinessMigration, 'diagnose_sale_order_internal_strap_readiness_batch');
    expect(fn).toContain('STABLE');
    expect(fn).toContain('SECURITY DEFINER');
    expect(fn).toContain('public.diagnose_sale_order_internal_strap_readiness(');
    expect(fn).not.toMatch(/\bINSERT INTO\b/);
    expect(fn).not.toMatch(/\bUPDATE public\./);
    expect(readinessMigration).toMatch(
      /GRANT EXECUTE ON FUNCTION\s+public\.diagnose_sale_order_internal_strap_readiness_batch\(jsonb\)\s+TO authenticated, service_role/,
    );
    expect(readinessMigration).toMatch(
      /REVOKE ALL ON FUNCTION\s+public\.diagnose_sale_order_internal_strap_readiness_batch\(jsonb\)\s+FROM PUBLIC, anon/,
    );
  });

  it('o painel bate readiness em lote e o item nao chama o RPC unitario no mount', () => {
    expect(readinessHook).toContain('useInternalStrapReadinessBatch');
    expect(readinessHook).toContain('diagnose_sale_order_internal_strap_readiness_batch');
    expect(panel).toContain('useInternalStrapReadinessBatch');
    expect(panel).toContain('sharedInternalStrapReadinessByKey');
    expect(itemForm).toContain('sharedInternalStrapReadiness');
    expect(itemForm).not.toMatch(/useInternalStrapReadiness\s*\(/);
  });

  it('batch de preview de tiras reusa o preview unitario e tem grants corretos', () => {
    const fn = sqlFunction(previewMigration, 'preview_sale_order_strap_demand_draft_batch');
    expect(fn).toContain('STABLE');
    expect(fn).toContain('SECURITY DEFINER');
    expect(fn).toContain('public.preview_sale_order_strap_demand_draft(');
    expect(fn).not.toMatch(/\bINSERT INTO\b/);
    expect(fn).not.toMatch(/\bUPDATE public\./);
    expect(previewMigration).toMatch(
      /GRANT EXECUTE ON FUNCTION\s+public\.preview_sale_order_strap_demand_draft_batch\(jsonb\)\s+TO authenticated, service_role/,
    );
    expect(previewMigration).toMatch(
      /REVOKE ALL ON FUNCTION\s+public\.preview_sale_order_strap_demand_draft_batch\(jsonb\)\s+FROM PUBLIC, anon/,
    );
  });

  it('agenda do preview e hoisted fora do loop de linhas', () => {
    const fn = sqlFunction(previewMigration, 'preview_sale_order_strap_demand_draft_pre_05500');
    const forPos = fn.indexOf('FOR v_line IN');
    expect(forPos).toBeGreaterThan(0);
    expect(fn.slice(0, forPos)).toContain('FROM public.resolve_sale_order_main_production_start');
    expect(fn.slice(forPos)).not.toContain('FROM public.resolve_sale_order_main_production_start');
    expect(fn).toContain('v_item_main_start');
  });

  it('o painel bate preview de tiras em lote e o item nao dispara o unitario no mount', () => {
    expect(strapStockHook).toContain('useStrapStockLinesBatch');
    expect(strapStockHook).toContain('preview_sale_order_strap_demand_draft_batch');
    expect(strapStockHook).toContain("meta: { silentError: true }");
    expect(panel).toContain('useStrapStockLinesBatch');
    expect(panel).toContain('sharedStrapStockLinesByKey');
    expect(itemForm).toContain('sharedStrapStockLines');
    expect(itemForm).toContain('usesSharedStrapStockLines');
    // Unitário só com enabled=false quando o painel fornece o mapa.
    expect(itemForm).toMatch(/hasStrapsEffective && !usesSharedStrapStockLines/);
  });

  it('editor usa fichas enxutas e snapshot em paralelo', () => {
    expect(sheetsHook).toContain('TECHNICAL_SHEET_EDITOR_COLUMNS');
    expect(sheetsHook).toContain('useTechnicalSheetsEditor');
    expect(saleOrderForm).toContain('useTechnicalSheetsEditor');
    expect(saleOrderForm).not.toMatch(/useTechnicalSheets\s*\(\s*\)/);
    expect(saleOrderForm).toContain('snapshotFetched');
    expect(saleOrderForm).toContain('get_sale_order_editor_snapshot');
    // Snapshot nao espera referencesLoading pra iniciar.
    expect(saleOrderForm).toMatch(
      /if \(!id \|\| orderLoaded \|\| referencesFailed \|\| snapshotFetched\) return/,
    );

    // Colunas dropadas em 20260512210000 — nunca reintroduzir no select do editor.
    const editorColumnsMatch = sheetsHook.match(
      /export const TECHNICAL_SHEET_EDITOR_COLUMNS = \[([\s\S]*?)\]\.join/,
    );
    expect(editorColumnsMatch, 'TECHNICAL_SHEET_EDITOR_COLUMNS deve existir').toBeTruthy();
    const editorColumns = (editorColumnsMatch![1].match(/'([^']+)'/g) ?? []).map((s) =>
      s.slice(1, -1),
    );
    for (const dropped of [
      'suggested_price',
      'barcode',
      'assembly_steps',
      'cor_palmilha_id',
      'cor_tiras_id',
    ]) {
      expect(editorColumns, `coluna dropada ${dropped}`).not.toContain(dropped);
    }
    expect(itemForm).not.toMatch(/selectedRef\?\.suggested_price/);
  });

  it('edit open usa cache de min-billing; live so apos edicao', () => {
    expect(minBilling).toContain('fetchMinBillingDateCached');
    expect(minBilling).toContain('get_min_billing_cached');
    expect(saleOrderForm).toContain('fetchMinBillingDateCached');
    expect(saleOrderForm).toContain('useCache');
  });

  it('toast global respeita meta.silentError e nao retenta statement timeout', () => {
    expect(app).toContain('silentError');
    expect(readinessHook).toContain("meta: { silentError: true }");
    expect(strapStockHook).toContain("meta: { silentError: true }");
    expect(app).toMatch(/statement timeout/i);
  });

  it('item mostra erro local em vez de spinner eterno no preview', () => {
    expect(itemForm).toContain('Não foi possível resolver estoque/consumo das tiras');
    expect(itemForm).toContain('strapLinesError');
  });
});

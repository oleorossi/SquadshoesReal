import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

const MIGRATION =
  'supabase/migrations/20270101020200_pv-editor-strap-readiness-batch.sql';
const migration = read(MIGRATION);
const readinessHook = read('src/hooks/useInternalStrapReadiness.ts');
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
    const fn = sqlFunction(migration, 'diagnose_sale_order_internal_strap_readiness_batch');
    expect(fn).toContain('STABLE');
    expect(fn).toContain('SECURITY DEFINER');
    expect(fn).toContain('public.diagnose_sale_order_internal_strap_readiness(');
    expect(fn).not.toMatch(/\bINSERT INTO\b/);
    expect(fn).not.toMatch(/\bUPDATE public\./);
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION\s+public\.diagnose_sale_order_internal_strap_readiness_batch\(jsonb\)\s+TO authenticated, service_role/,
    );
    expect(migration).toMatch(
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
  });

  it('edit open usa cache de min-billing; live so apos edicao', () => {
    expect(minBilling).toContain('fetchMinBillingDateCached');
    expect(minBilling).toContain('get_min_billing_cached');
    expect(saleOrderForm).toContain('fetchMinBillingDateCached');
    expect(saleOrderForm).toContain('useCache');
  });

  it('toast global respeita meta.silentError', () => {
    expect(app).toContain('silentError');
    expect(readinessHook).toContain("meta: { silentError: true }");
  });
});

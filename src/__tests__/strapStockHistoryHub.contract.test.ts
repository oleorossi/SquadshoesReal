import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

const stockHistory = read('src/components/inventory/tabs/StrapStockLogTab.tsx');
const hub = read('src/pages/ArtisanalStraps.tsx');
const inventory = read('src/pages/Index.tsx');
const summaryDialogPath = resolve(ROOT, 'src/components/inventory/StrapSummaryDialog.tsx');
const unifiedAuditPath = resolve(ROOT, 'src/components/inventory/UnifiedAuditLog.tsx');

describe('Histórico de estoque de tiras no hub canônico', () => {
  it('resolve produtos por identidade estruturada e conserva apenas o fallback legado explícito', () => {
    expect(stockHistory).toContain(".from('artisanal_strap_variants')");
    expect(stockHistory).toContain(".select('finished_product_id')");
    expect(stockHistory).toContain(".eq('is_artisanal', true)");
    expect(stockHistory).toContain("'strap_variant_id.not.is.null'");
    expect(stockHistory).toContain("'sale_order_strap_demand_id.not.is.null'");
    expect(stockHistory).toContain("'strap_batch_item_id.not.is.null'");
    expect(stockHistory).toContain(".or(identityFilters.join(','))");
    expect(stockHistory).toContain('products(name, sku, unit, color)');
    expect(stockHistory).toContain("'finished' as const : 'base' as const");
    expect(stockHistory).toContain("'Tira pronta' : 'Material-base'");
    expect(stockHistory).toContain('STRAP_STOCK_HISTORY_DAYS = 180');
    expect(stockHistory).not.toMatch(/%tira%/i);
    expect(stockHistory).not.toMatch(/\.ilike\(\s*['"](?:name|description)['"]/i);
  });

  it('remove a projeção e os invólucros legados sem criar uma segunda superfície', () => {
    expect(stockHistory).not.toContain('StrapSummaryDialog');
    expect(stockHistory).not.toContain('Resumo Semanal');
    expect(stockHistory).not.toContain('strap_projection_orders');
    expect(existsSync(summaryDialogPath)).toBe(false);
    expect(existsSync(unifiedAuditPath)).toBe(false);
  });

  it('expõe o histórico no hub somente para administrador', () => {
    expect(hub).toContain("'historico-estoque': 'controle'");
    expect(hub).toContain("activeTab === 'historico-estoque' && isAdmin");
    expect(hub).toMatch(/isAdmin \? \[\{[\s\S]*label: 'Histórico de estoque'/);
    expect(hub).toMatch(/controlView === 'historico-estoque'[\s\S]*<StrapStockLogTab \/>/);
    expect(stockHistory).toContain('enabled: isAdmin');
    expect(stockHistory).toContain('if (!isAdmin) return null');
    expect(stockHistory).toContain('Não foi possível carregar o histórico de tiras');
  });

  it('retira Corte Tiras do Estoque e preserva o deep link como redirecionamento', () => {
    expect(inventory).not.toContain('Corte Tiras');
    expect(inventory).not.toContain('StrapStockLogTab');
    expect(inventory).not.toContain('value="strap-stock"');
    expect(inventory).toContain("navigate('/tiras-artesanais?tab=historico-estoque', { replace: true })");
  });
});

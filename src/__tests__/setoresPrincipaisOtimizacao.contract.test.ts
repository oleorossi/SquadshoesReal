import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { paginateInMemory, PAGE_SIZE, PAGER_THRESHOLD } from '@/lib/pagination';
import {
  productsKeys,
  technicalSheetsKeys,
  saleOrdersKeys,
  invalidateProducts,
  invalidateTechnicalSheets,
  invalidateSaleOrders,
} from '@/lib/queryKeys';

const ROOT = resolve(__dirname, '..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

const sheetsHook = read('hooks/useTechnicalSheets.ts');
const sheetsPage = read('pages/TechnicalSheets.tsx');
const estoquePage = read('pages/Index.tsx');
const materialsTab = read('components/inventory/tabs/MaterialsTab.tsx');
const saleOrdersPage = read('pages/SaleOrders.tsx');
const productsHook = read('hooks/useProducts.ts');
const saleOrdersHook = read('hooks/useSaleOrders.ts');
const queryKeysSrc = read('lib/queryKeys.ts');

describe('Fase 1 — otimização setores principais', () => {
  it('ficha: catálogo tem colunas explícitas e detail separado', () => {
    expect(sheetsHook).toContain('TECHNICAL_SHEET_CATALOG_COLUMNS');
    expect(sheetsHook).toContain('export function useTechnicalSheetsCatalog');
    expect(sheetsHook).toContain('export function useTechnicalSheetDetail');
    expect(sheetsHook).toContain('technicalSheetsKeys.catalog');
    expect(sheetsHook).toContain('technicalSheetsKeys.detail(id)');

    const catalogStart = sheetsHook.indexOf('export function useTechnicalSheetsCatalog');
    const catalogEnd = sheetsHook.indexOf('export function useTechnicalSheetDetail', catalogStart);
    const catalogBody = sheetsHook.slice(catalogStart, catalogEnd);
    expect(catalogBody).toContain('.select(TECHNICAL_SHEET_CATALOG_COLUMNS');
    expect(catalogBody).not.toMatch(/\.select\('\*'\)/);

    expect(sheetsPage).toContain('useTechnicalSheetsCatalog');
    expect(sheetsPage).toContain('useTechnicalSheetDetail');
    expect(sheetsPage).toContain('TechnicalSheetExpandedPanel');
  });

  it('ficha: catálogo cobre campos load-bearing da lista/autofill', () => {
    for (const col of [
      'id', 'code', 'name', 'shoe_category', 'retired_at', 'status_ficha',
      'images', 'sole_material', 'upper_material', 'sale_price',
      'upper_consumption', 'lining_consumption', 'insole_consumption',
      'components_accessories', 'primary_sole_id', 'updated_at',
    ]) {
      expect(sheetsHook).toContain(col);
    }
  });

  it('estoque: hub lazy-carrega abas fora de Materiais', () => {
    expect(estoquePage).toContain('lazy(() =>');
    expect(estoquePage).toContain("import('@/components/inventory/tabs/ReportTab')");
    expect(estoquePage).toContain("import('./StockHistory')");
    // Materiais permanece eager (primeira aba útil).
    expect(estoquePage).toMatch(/import \{ MaterialsTab \}/);
    expect(estoquePage).toContain('<Suspense');
  });

  it('estoque: MaterialsTab não dispara useProducts antes da página útil', () => {
    expect(materialsTab).toContain('useProducts({ enabled: pageFetched })');
    expect(materialsTab).toContain('isFetched: pageFetched');
    expect(materialsTab).toContain('PRODUCT_LIST_SELECT');
  });

  it('PV: um layout por viewport + paginação in-memory', () => {
    expect(saleOrdersPage).toContain('useIsMobile');
    expect(saleOrdersPage).toContain('paginateInMemory');
    expect(saleOrdersPage).toContain('ListPagination');
    expect(saleOrdersPage).toContain('visibleOrders.map');
    expect(saleOrdersPage).toContain('{isMobile ? (');
    expect(saleOrdersPage).not.toContain('md:hidden');
    expect(saleOrdersPage).not.toContain('hidden md:block');
  });
  it('useUpdateSheet patcha catalog + detail + lite + editor', () => {
    const updateStart = sheetsHook.indexOf('export function useUpdateSheet');
    const updateBody = sheetsHook.slice(updateStart, updateStart + 4500);
    expect(updateBody).toContain('technicalSheetsKeys.catalog');
    expect(updateBody).toContain('technicalSheetsKeys.detail(updatedSheet.id)');
    expect(updateBody).toContain('technicalSheetsKeys.lite');
    expect(updateBody).toContain('technicalSheetsKeys.editor');
  });
});

describe('Fase 2 — modularização setores principais', () => {
  it('2.1 ficha: abas extraídas para components/technical-sheets', () => {
    expect(sheetsPage).toContain("from '@/components/technical-sheets/PhotosByColorTab'");
    expect(sheetsPage).toContain("from '@/components/technical-sheets/ProductionSectorsTab'");
    expect(sheetsPage).toContain("import('@/components/technical-sheets/SheetBOM')");
    expect(sheetsPage).toContain("import('@/components/technical-sheets/CostsAnalysisTab')");
    expect(sheetsPage).toContain("from '@/components/technical-sheets/SheetImageUpload'");
    expect(sheetsPage).toContain("from '@/lib/technicalSheetSizes'");
    const bom = read('components/technical-sheets/SheetBOM.tsx');
    expect(bom).toContain("from '@/lib/componentCategories'");
    // Página não redefine o monólito inline.
    expect(sheetsPage).not.toMatch(/function SheetBOM\(/);
    expect(sheetsPage).not.toMatch(/function PhotosByColorTab\(/);
    expect(sheetsPage).not.toMatch(/function CostsAnalysisTab\(/);
  });

  it('2.2 PV: lista usa constantes/card/sort extraídos', () => {
    expect(saleOrdersPage).toContain("from '@/components/sale-orders/saleOrderListConstants'");
    expect(saleOrdersPage).toContain("from '@/components/sale-orders/SaleOrderSortHead'");
    expect(saleOrdersPage).toContain("from '@/components/sale-orders/SaleOrderMobileCard'");
    expect(saleOrdersPage).toContain("from '@/hooks/useMinBillingMap'");
    expect(saleOrdersPage).not.toMatch(/function SaleOrderSortHead\(/);
    expect(saleOrdersPage).not.toMatch(/function SaleOrderMobileCard\(/);
  });

  it('2.3 keys canônicas via helpers + invalidadores', () => {
    expect(queryKeysSrc).toContain('export const productsKeys');
    expect(queryKeysSrc).toContain('export const technicalSheetsKeys');
    expect(queryKeysSrc).toContain('export const saleOrdersKeys');
    expect(queryKeysSrc).toContain('export function invalidateProducts');
    expect(queryKeysSrc).toContain('export function invalidateTechnicalSheets');
    expect(queryKeysSrc).toContain('export function invalidateSaleOrders');

    expect(productsHook).toContain("from '@/lib/queryKeys'");
    expect(productsHook).toContain('queryKey: productsKeys.all');
    expect(productsHook).toContain('invalidateProducts(');

    expect(sheetsHook).toContain('queryKey: technicalSheetsKeys.all');
    expect(sheetsHook).toContain('invalidateTechnicalSheets(');

    expect(saleOrdersHook).toContain('queryKey: saleOrdersKeys.all');
    expect(saleOrdersHook).toContain('invalidateSaleOrders(');

    // Helpers batem no prefixo esperado (contrato runtime leve).
    expect(productsKeys.all).toEqual(['products']);
    expect(technicalSheetsKeys.catalog).toEqual(['technical_sheets', 'catalog']);
    expect(saleOrdersKeys.items('x')).toEqual(['sale_order_items', 'x']);
    expect(typeof invalidateProducts).toBe('function');
    expect(typeof invalidateTechnicalSheets).toBe('function');
    expect(typeof invalidateSaleOrders).toBe('function');
  });
});

describe('Fase 3 — UX de fluxo', () => {
  it('3.1 listagens distinguem isError de vazio', () => {
    expect(sheetsPage).toContain('isError');
    expect(sheetsPage).toContain('Erro ao carregar fichas técnicas');
    expect(sheetsPage).toContain('Erro ao carregar a ficha');
    expect(saleOrdersPage).toContain('if (isError)');
    expect(saleOrdersPage).toContain('Erro ao carregar pedidos');
    expect(materialsTab).toContain('isPaginatedError');
    expect(materialsTab).toContain('Erro ao carregar materiais');
  });

  it('3.3 ficha defere BOM/custos na Engenharia', () => {
    expect(sheetsPage).toContain('DeferredMount');
    expect(sheetsPage).toContain("import('@/components/technical-sheets/SheetBOM')");
    expect(read('components/technical-sheets/DeferredMount.tsx')).toContain('requestIdleCallback');
  });

  it('3.4 PV preserva deep-links de view', () => {
    // Consumo: view lida uma vez e reusada (não recria ids a cada ?item=).
    expect(saleOrdersPage).toContain("searchParams.get('view')");
    expect(saleOrdersPage).toMatch(/consumptionViewParam\s*===\s*'consumo'|searchParams\.get\('view'\)\s*===\s*'consumo'/);
    expect(saleOrdersPage).toContain("searchParams.get('view') === 'pendencias'");
    expect(sheetsPage).toContain("searchParams.get('ref')");
    expect(sheetsPage).toContain('useUrlTabState');
  });

  it('3.2/3.5 dirty-guard material + toast estruturado no ajuste', () => {
    const productForm = read('components/inventory/ProductFormDialog.tsx');
    expect(productForm).toContain('confirmCloseOpen');
    expect(productForm).toContain('Descartar alterações?');
    expect(productForm).toContain('requestClose');
    const adjust = read('pages/StockAdjustmentPage.tsx');
    expect(adjust).toMatch(/from ['"]@\/lib\/toast-messages['"]/);
    expect(adjust).toContain("toastError(err, 'salvar ajuste de estoque'");
  });
});

describe('Fase 4 — guarda do programa', () => {
  it('4.1 lite ⊆ catalog; catalog/detail/list selects corretos', () => {
    expect(sheetsHook).toContain('TECHNICAL_SHEET_CATALOG_COLUMNS');
    expect(sheetsHook).toContain('TECHNICAL_SHEET_LITE_COLUMNS');

    const catalogMatch = sheetsHook.match(
      /export const TECHNICAL_SHEET_CATALOG_COLUMNS = \[([\s\S]*?)\]\.join/,
    );
    expect(catalogMatch).toBeTruthy();
    const catalogCols = catalogMatch![1]
      .split(',')
      .map((c) => c.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);

    const liteMatch = sheetsHook.match(
      /export const TECHNICAL_SHEET_LITE_COLUMNS = '([^']+)'/,
    );
    expect(liteMatch).toBeTruthy();
    const liteCols = liteMatch![1].split(', ').map((c) => c.trim());
    for (const col of liteCols) {
      expect(catalogCols).toContain(col);
    }

    const catalogFn = sheetsHook.slice(
      sheetsHook.indexOf('export function useTechnicalSheetsCatalog'),
      sheetsHook.indexOf('export function useTechnicalSheetDetail'),
    );
    expect(catalogFn).toContain('.select(TECHNICAL_SHEET_CATALOG_COLUMNS');
    expect(catalogFn).not.toMatch(/\.select\('\*'\)/);

    const detailFn = sheetsHook.slice(
      sheetsHook.indexOf('export function useTechnicalSheetDetail'),
      sheetsHook.indexOf('TECHNICAL_SHEET_LITE_COLUMNS'),
    );
    expect(detailFn).toMatch(/\.select\('\*'\)/);

    // Listas lean dos outros dois setores (cross-check com listSelectOverfetch).
    expect(productsHook).toContain('PRODUCT_LIST_SELECT');
    expect(saleOrdersHook).toContain('SALE_ORDER_LIST_SELECT');
  });

  it('4.1 hooks principais não invalidam products/sheets/orders com string solta', () => {
    // Após Fase 2.3, o caminho feliz usa helpers. Strings soltas nestes hooks
    // pra a chave canônica principal são regressão.
    expect(productsHook).not.toMatch(/invalidateQueries\(\{\s*queryKey:\s*\['products'\]/);
    expect(sheetsHook).not.toMatch(/invalidateQueries\(\{\s*queryKey:\s*\['technical_sheets'\]\s*\}/);
    expect(saleOrdersHook).not.toMatch(/invalidateQueries\(\{\s*queryKey:\s*\['sale_orders'\]\s*\}/);
    expect(productsHook).toContain('invalidateProducts(');
    expect(sheetsHook).toContain('invalidateTechnicalSheets(');
    expect(saleOrdersHook).toContain('invalidateSaleOrders(');
  });

  it('4.3 guias documentam o padrão load-bearing', () => {
    const agents = readFileSync(resolve(ROOT, '../AGENTS.md'), 'utf8');
    const claude = readFileSync(resolve(ROOT, '../CLAUDE.md'), 'utf8');
    for (const doc of [agents, claude]) {
      expect(doc).toContain('useTechnicalSheetsCatalog');
      expect(doc).toContain('@/lib/queryKeys');
      expect(doc).toContain('isError');
    }
  });
});

describe('paginateInMemory', () => {
  it('abaixo do limiar devolve tudo sem pager', () => {
    const items = Array.from({ length: PAGER_THRESHOLD }, (_, i) => i);
    const page = paginateInMemory(items, { page: 1 });
    expect(page.showPager).toBe(false);
    expect(page.items).toHaveLength(PAGER_THRESHOLD);
    expect(page.isComplete).toBe(true);
  });

  it('acima do limiar pagina em PAGE_SIZE', () => {
    const items = Array.from({ length: PAGER_THRESHOLD + 1 }, (_, i) => i);
    const page1 = paginateInMemory(items, { page: 1 });
    expect(page1.showPager).toBe(true);
    expect(page1.items).toHaveLength(PAGE_SIZE);
    expect(page1.total).toBe(PAGER_THRESHOLD + 1);
    const page2 = paginateInMemory(items, { page: 2 });
    expect(page2.items[0]).toBe(PAGE_SIZE);
  });
});

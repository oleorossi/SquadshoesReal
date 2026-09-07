import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { paginateInMemory, PAGE_SIZE, PAGER_THRESHOLD } from '@/lib/pagination';

const ROOT = resolve(__dirname, '..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

const sheetsHook = read('hooks/useTechnicalSheets.ts');
const sheetsPage = read('pages/TechnicalSheets.tsx');
const estoquePage = read('pages/Index.tsx');
const materialsTab = read('components/inventory/tabs/MaterialsTab.tsx');
const saleOrdersPage = read('pages/SaleOrders.tsx');

describe('Fase 1 — otimização setores principais', () => {
  it('ficha: catálogo tem colunas explícitas e detail separado', () => {
    expect(sheetsHook).toContain('TECHNICAL_SHEET_CATALOG_COLUMNS');
    expect(sheetsHook).toContain('export function useTechnicalSheetsCatalog');
    expect(sheetsHook).toContain('export function useTechnicalSheetDetail');
    expect(sheetsHook).toContain("queryKey: ['technical_sheets', 'catalog']");
    expect(sheetsHook).toContain("queryKey: ['technical_sheets', 'detail', id]");

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
    expect(updateBody).toContain("['technical_sheets', 'catalog']");
    expect(updateBody).toContain("['technical_sheets', 'detail', updatedSheet.id]");
    expect(updateBody).toContain("['technical_sheets', 'lite']");
    expect(updateBody).toContain("['technical_sheets', 'editor']");
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

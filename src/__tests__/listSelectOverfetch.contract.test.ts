import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

const saleOrdersHook = read('hooks/useSaleOrders.ts');
const productsHook = read('hooks/useProducts.ts');
const productDetailPage = read('pages/ProductDetail.tsx');

describe('P1.3/P1.4 — selects lean em listas (overfetch)', () => {
  it('useSaleOrders lista colunas explícitas, não select(*)', () => {
    expect(saleOrdersHook).toContain('SALE_ORDER_LIST_SELECT');
    expect(saleOrdersHook).toContain('SALE_ORDERS_QUERY_LIMIT');
    expect(saleOrdersHook).toContain('.select(SALE_ORDER_LIST_SELECT)');
    expect(saleOrdersHook).toContain('.limit(SALE_ORDERS_QUERY_LIMIT)');
    // O select('*') da lista não pode voltar — edição usa snapshot próprio.
    const listFnStart = saleOrdersHook.indexOf('export function useSaleOrders()');
    const listFnEnd = saleOrdersHook.indexOf('export function useSaleOrderItems', listFnStart);
    const listBody = saleOrdersHook.slice(listFnStart, listFnEnd);
    expect(listBody).not.toContain(".select('*, clients(client_number)')");
    expect(listBody).not.toContain('.select("*")');
    // order_version é load-bearing pro "Forçar Produção" na lista.
    expect(saleOrdersHook).toMatch(/SALE_ORDER_LIST_SELECT[\s\S]*order_version/);
  });

  it('useSaleOrderAllItems tem teto explícito + warn em DEV', () => {
    expect(saleOrdersHook).toContain('SALE_ORDER_ITEMS_ALL_QUERY_LIMIT');
    const allStart = saleOrdersHook.indexOf('export function useSaleOrderAllItems()');
    const allEnd = saleOrdersHook.indexOf('export function useCreateSaleOrder', allStart);
    const body = saleOrdersHook.slice(allStart, allEnd);
    expect(body).toContain('.limit(SALE_ORDER_ITEMS_ALL_QUERY_LIMIT)');
    expect(body).toContain('import.meta.env.DEV');
    expect(body).toContain('hit ${SALE_ORDER_ITEMS_ALL_QUERY_LIMIT}-row ceiling');
  });

  it('useProducts catálogo usa PRODUCT_LIST_SELECT; detalhe busca row completa', () => {
    expect(productsHook).toContain('PRODUCT_LIST_SELECT');
    expect(productsHook).toContain('export function useProductDetail');
    const listStart = productsHook.indexOf('export function useProducts()');
    const listEnd = productsHook.indexOf('export function useProductDetail', listStart);
    const listBody = productsHook.slice(listStart, listEnd);
    expect(listBody).toContain('.select(PRODUCT_LIST_SELECT)');
    expect(listBody).not.toContain(".select('*, product_groups");

    const detailStart = productsHook.indexOf('export function useProductDetail');
    const detailEnd = productsHook.indexOf('export function useAddProduct', detailStart);
    const detailBody = productsHook.slice(detailStart, detailEnd);
    expect(detailBody).toContain(".select('*, product_groups!products_group_id_fkey");

    // Página de edição usa o hook de detalhe, não o catálogo lean como * .
    expect(productDetailPage).toContain('useProductDetail');
    expect(productDetailPage).not.toContain(".from('products').select('*')");
  });

  it('PRODUCT_LIST_SELECT cobre colunas load-bearing do MaterialsTab/NF', () => {
    for (const col of [
      'id',
      'name',
      'sku',
      'color',
      'quantity',
      'reserved_stock',
      'stock_grade',
      'group_id',
      'unit',
      'category',
      'active',
      'purchase_unit',
      'conversion_rate',
      'dimensions_width',
      'package_weight_kg',
      'consumption_unit',
    ]) {
      expect(productsHook).toContain(col);
    }
  });
});

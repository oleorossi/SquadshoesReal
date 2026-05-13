/**
 * Testes da REPLICAÇÃO de consumo base por modelo de solado.
 *
 * Premissa industrial: cor de solado é IRRELEVANTE para o consumo dos itens
 * compartilhados (cola, palmilha, forro, linha, EVA…). Logo, ao salvar
 * consumo para uma variante, o sistema DEVE replicar para todas as outras
 * variantes do mesmo modelo (mesmo nome normalizado).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const productsByIdSingle = vi.fn();
const productsListSelect = vi.fn();
const upsertSpy = vi.fn();
const deleteInSpy = vi.fn();

vi.mock('@/integrations/supabase/client', () => {
  const fromProducts = () => ({
    select: (..._args: unknown[]) => {
      // Listagem via `.in('category', [...])` ou via await direto retornam
      // a mesma fonte mockada (productsListSelect). `.eq().maybeSingle()`
      // continua sendo o fetch individual.
      const listThenable = {
        then: (resolve: (v: { data: any[] }) => void) =>
          productsListSelect().then(resolve),
      };
      const sub: any = {
        eq: (_col: string, val: string) => ({
          maybeSingle: () => productsByIdSingle(val),
        }),
        in: (_col: string, _vals: string[]) => listThenable,
        ...listThenable,
      };
      return sub;
    },
  });

  const fromConsumption = () => ({
    upsert: (rows: any[], opts: any) => {
      upsertSpy(rows, opts);
      return Promise.resolve({ error: null });
    },
    delete: () => ({
      in: (_col: string, ids: string[]) => ({
        eq: (_c: string, sid: string) => {
          deleteInSpy(ids, sid);
          return Promise.resolve({ error: null });
        },
      }),
    }),
  });

  return {
    supabase: {
      from: (table: string) => {
        if (table === 'products') return fromProducts();
        if (table === 'sole_standard_items_consumption') return fromConsumption();
        return {
          select: () => ({
            eq: () => ({ order: () => Promise.resolve({ data: [] }) }),
          }),
        };
      },
    },
  };
});

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import {
  useUpsertSoleStandardItem,
  useRemoveSoleStandardItem,
} from '../useSoleStandardItems';

const ALL_PRODUCTS = [
  { id: 'X-cara', name: 'Solado X Caramelo', category: 'solado' },
  { id: 'X-pret', name: 'Solado X Preto', category: 'solado' },
  { id: 'X-mar', name: 'Solado X Marrom', category: 'solado' },
  { id: 'Y-cara', name: 'Solado Y Caramelo', category: 'solado' },
  { id: 'Y-pret', name: 'Solado Y Preto', category: 'solado' },
  { id: 'Z-pret', name: 'Solado Z Preto', category: 'solado' },
  { id: 'NAO', name: 'Cola PVC', category: 'químico' },
];

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => {
  upsertSpy.mockReset();
  deleteInSpy.mockReset();
  productsByIdSingle.mockReset();
  productsListSelect.mockReset();
  productsByIdSingle.mockImplementation((id: string) =>
    Promise.resolve({ data: ALL_PRODUCTS.find((p) => p.id === id) ?? null }),
  );
  productsListSelect.mockResolvedValue({ data: ALL_PRODUCTS });
});

describe('useSoleStandardItems — replicação por modelo', () => {
  it('upsert em UMA variante propaga para TODAS as 3 variantes do modelo X', async () => {
    const { result } = renderHook(() => useUpsertSoleStandardItem(), { wrapper });

    await result.current.mutateAsync({
      sole_product_id: 'X-cara',
      standard_item_id: 'item-cola',
      unit: 'g',
      values: { 37: 10, 38: 11, 39: 12 },
    });

    expect(upsertSpy).toHaveBeenCalledTimes(1);
    const [rows] = upsertSpy.mock.calls[0];

    expect(rows).toHaveLength(9); // 3 variantes × 3 tamanhos
    const ids = new Set(rows.map((r: any) => r.sole_product_id));
    expect(ids).toEqual(new Set(['X-cara', 'X-pret', 'X-mar']));
    expect(ids.has('Y-cara')).toBe(false);
    expect(ids.has('Z-pret')).toBe(false);
  });

  it('upsert em modelo com 1 só variante (Z) NÃO inflaciona', async () => {
    const { result } = renderHook(() => useUpsertSoleStandardItem(), { wrapper });

    await result.current.mutateAsync({
      sole_product_id: 'Z-pret',
      standard_item_id: 'item-linha',
      unit: 'm',
      values: { 37: 1.5, 38: 1.6 },
    });

    const [rows] = upsertSpy.mock.calls[0];
    expect(rows).toHaveLength(2);
    expect(rows[0].sole_product_id).toBe('Z-pret');
  });

  it('upsert em Y-pret propaga para Y-cara (e SÓ Y)', async () => {
    const { result } = renderHook(() => useUpsertSoleStandardItem(), { wrapper });

    await result.current.mutateAsync({
      sole_product_id: 'Y-pret',
      standard_item_id: 'item-eva',
      unit: 'dm²',
      values: { 37: 5 },
    });

    const [rows] = upsertSpy.mock.calls[0];
    const ids = new Set(rows.map((r: any) => r.sole_product_id));
    expect(ids).toEqual(new Set(['Y-cara', 'Y-pret']));
    expect(rows).toHaveLength(2);
  });

  it('REMOÇÃO propaga para todas as variantes do modelo', async () => {
    const { result } = renderHook(() => useRemoveSoleStandardItem(), { wrapper });

    await result.current.mutateAsync({
      sole_product_id: 'X-mar',
      standard_item_id: 'item-cola',
    });

    expect(deleteInSpy).toHaveBeenCalledTimes(1);
    const [ids, standardItemId] = deleteInSpy.mock.calls[0];
    expect(new Set(ids)).toEqual(new Set(['X-cara', 'X-pret', 'X-mar']));
    expect(standardItemId).toBe('item-cola');
  });

  it('não-solado opera só no próprio id', async () => {
    const { result } = renderHook(() => useUpsertSoleStandardItem(), { wrapper });

    await result.current.mutateAsync({
      sole_product_id: 'NAO',
      standard_item_id: 'item-x',
      unit: 'g',
      values: { 37: 1 },
    });

    const [rows] = upsertSpy.mock.calls[0];
    expect(rows).toHaveLength(1);
    expect(rows[0].sole_product_id).toBe('NAO');
  });
});

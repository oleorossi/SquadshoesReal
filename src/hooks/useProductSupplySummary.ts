import { useMemo } from 'react';
import { useQuery, type QueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { GROUP_STOCK_TRACKING_KEY } from '@/hooks/useGroupStockTracking';
import {
  orderSectorMaterialShortagesRoot,
  saleOrderMaterialShortagesRoot,
} from '@/hooks/useSaleOrderMaterialShortages';

/**
 * Falta de PV e compra em aberto por produto — `product_supply_summary`
 * (spec `specs/integracao-estoque-pv-compras.md`, Q2/Q11).
 *
 * O físico continua sendo `products.quantity` (solado: soma de `stock_grade`) e
 * nunca fica negativo. O que o PV pediu e não havia em estoque vive à parte,
 * como FALTA por PV; esta RPC devolve a soma dela por produto, junto com o que
 * já está em ordem de compra aberta.
 *
 *   Projetado = físico − reserved_stock − falta + em compra
 *
 * ⚠ DEGRADA EM SILÊNCIO. A RPC chega ao banco numa migration separada da tela:
 * enquanto ela não existir (ou falhar), o hook devolve um Map VAZIO — a lista de
 * estoque segue exatamente como era, sem coluna, sem chip e sem toast de erro.
 * Por isso `retry: false` e `meta: { silentError: true }`: o `throw` do queryFn
 * só serve para a query cair em `isError` (→ `available: false`); sem a meta o
 * `QueryCache.onError` global (App.tsx) tostaria "Falha ao carregar dados" a
 * cada montagem enquanto a RPC não existir (PGRST202).
 */

export interface ProductSupply {
  /** Soma da falta aberta dos PVs, na unidade do produto. */
  falta: number;
  /** Saldo ainda não recebido das OCs abertas, convertido à unidade do produto. */
  emCompra: number;
  /** Solado: falta por numeração/balde (`{"35":6,"33/34":4}`). Null fora de solado. */
  faltaGrade: Record<string, number> | null;
}

export type ProductSupplyMap = ReadonlyMap<string, ProductSupply>;

/** Raiz da query key — quem dá entrada de estoque / edita rateio invalida por ela. */
export const PRODUCT_SUPPLY_SUMMARY_KEY = 'product-supply-summary';

/**
 * Invalida tudo que deriva da falta de PV / compra em aberto: o resumo por
 * produto (Falta / Em compra / Projetado), o selo de material dos PVs (lista de
 * vendas e Kanban), a falta por SETOR da confirmação de apontamento e o
 * rastreio de entradas do grupo. Chamar junto com o invalidate de `['products']`
 * em todo fluxo que dá entrada, ajusta saldo ou edita rateio — senão o físico
 * atualiza na hora e a falta fica velha, e o Projetado desconta duas vezes o
 * que a entrada acabou de quitar.
 *
 * ⚠ A falta por setor entra aqui porque ela porteia uma ESCRITA no ledger (a
 * nota "ciente da falta" do apontamento): sem este invalidate o selo do card
 * virava "Material completo" e o diálogo da mesma tela seguia perguntando pela
 * napa que o almoxarifado acabou de dar entrada.
 */
export function invalidateProductSupply(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: [PRODUCT_SUPPLY_SUMMARY_KEY] });
  qc.invalidateQueries({ queryKey: [...saleOrderMaterialShortagesRoot] });
  qc.invalidateQueries({ queryKey: [...orderSectorMaterialShortagesRoot] });
  qc.invalidateQueries({ queryKey: [GROUP_STOCK_TRACKING_KEY] });
}

const EMPTY_SUPPLY: ProductSupplyMap = new Map();

interface SupplyRow {
  product_id: string;
  falta: number | string | null;
  em_compra: number | string | null;
  falta_grade: Record<string, unknown> | null;
}

function parseGrade(raw: Record<string, unknown> | null | undefined): Record<string, number> | null {
  if (!raw || typeof raw !== 'object') return null;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k.startsWith('_')) continue;
    const n = Number(v) || 0;
    if (n > 0) out[k] = n;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Versão completa: devolve também `available` — true só quando a RPC respondeu.
 * Use quando a UI precisa decidir se mostra um controle que depende do dado
 * (ex.: o chip "Falta p/ pedidos" some enquanto a RPC não existe no banco).
 */
export function useProductSupplySummaryQuery(productIds: ReadonlyArray<string | null | undefined>) {
  // Ordenado + sem repetição: duas telas que pedem o mesmo conjunto em ordens
  // diferentes compartilham UM cache (e uma chamada só).
  const ids = useMemo(
    () => [...new Set(productIds.filter((id): id is string => !!id))].sort(),
    [productIds],
  );

  const query = useQuery({
    queryKey: [PRODUCT_SUPPLY_SUMMARY_KEY, ids],
    enabled: ids.length > 0,
    retry: false,
    // RPC ausente/erro não vira toast global — ver docblock.
    meta: { silentError: true },
    staleTime: 30_000,
    gcTime: 5 * 60 * 1000,
    queryFn: async (): Promise<ProductSupplyMap> => {
      const { data, error } = await supabase.rpc(
        'product_supply_summary' as never,
        { p_product_ids: ids } as never,
      );
      if (error) throw error;
      const map = new Map<string, ProductSupply>();
      for (const row of ((data as unknown as SupplyRow[] | null) ?? [])) {
        if (!row?.product_id) continue;
        map.set(row.product_id, {
          falta: Math.max(0, Number(row.falta) || 0),
          emCompra: Math.max(0, Number(row.em_compra) || 0),
          faltaGrade: parseGrade(row.falta_grade),
        });
      }
      return map;
    },
  });

  const supply = query.isError ? EMPTY_SUPPLY : (query.data ?? EMPTY_SUPPLY);
  return {
    supply,
    /** A RPC respondeu (com ou sem falta). False = carregando, sem ids ou indisponível. */
    available: query.isSuccess,
    isLoading: query.isLoading,
  };
}

/**
 * Map<productId, { falta, emCompra, faltaGrade }>. Em erro (RPC ausente,
 * permissão, rede) devolve Map vazio — nunca lança para a tela.
 */
export function useProductSupplySummary(productIds: ReadonlyArray<string | null | undefined>): ProductSupplyMap {
  return useProductSupplySummaryQuery(productIds).supply;
}

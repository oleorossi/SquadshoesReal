/**
 * Matriz de estoque de solado por numeração + pedidos que consomem.
 *
 * Spec: specs/estoque-solado-por-numeracao.md.
 *
 * Duas RPCs de LEITURA (migration 20270101041600):
 *   - sole_stock_matrix(uuid)  → uma linha por numeração
 *   - sole_stock_orders(uuid)  → uma linha por (PV, numeração)
 *
 * ⚠ Os dois blocos fecham entre si por construção: a lista de pedidos vem da
 *   MESMA reserva que alimenta `Empenhado`/`Falta` da matriz, então
 *   `Σ consumo − Estoque = Projetado`. A tela exibe essa conta; se um dia
 *   divergir, o problema está na fonte, não na soma.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface SoleStockMatrixRow {
  size_key: string;
  size_ord: number | null;
  estoque: number;
  empenhado: number;
  livre: number;
  falta: number;
  em_compra: number;
  projetado: number;
  projetado_carteira: number;
  a_pedir: number;
}

export interface SoleStockOrderRow {
  sale_order_id: string;
  order_number: string | null;
  client_name: string | null;
  pv_status: string | null;
  billing_monday: string | null;
  priority: number | null;
  size_key: string;
  size_ord: number | null;
  consumo: number;
  falta: number;
}

export const soleStockMatrixKey = (productId: string | null) =>
  ['sole-stock-matrix', productId] as const;
export const soleStockOrdersKey = (productId: string | null) =>
  ['sole-stock-orders', productId] as const;

const num = (v: unknown) => Number(v) || 0;

export function useSoleStockMatrix(productId: string | null) {
  return useQuery({
    queryKey: soleStockMatrixKey(productId),
    enabled: !!productId,
    queryFn: async (): Promise<SoleStockMatrixRow[]> => {
      const { data, error } = await supabase.rpc(
        'sole_stock_matrix' as never,
        { p_product_id: productId } as never,
      );
      if (error) throw error;
      return ((data ?? []) as SoleStockMatrixRow[]).map(r => ({
        ...r,
        estoque: num(r.estoque),
        empenhado: num(r.empenhado),
        livre: num(r.livre),
        falta: num(r.falta),
        em_compra: num(r.em_compra),
        projetado: num(r.projetado),
        projetado_carteira: num(r.projetado_carteira),
        a_pedir: num(r.a_pedir),
      }));
    },
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });
}

export function useSoleStockOrders(productId: string | null) {
  return useQuery({
    queryKey: soleStockOrdersKey(productId),
    enabled: !!productId,
    queryFn: async (): Promise<SoleStockOrderRow[]> => {
      const { data, error } = await supabase.rpc(
        'sole_stock_orders' as never,
        { p_product_id: productId } as never,
      );
      if (error) throw error;
      return ((data ?? []) as SoleStockOrderRow[]).map(r => ({
        ...r,
        consumo: num(r.consumo),
        falta: num(r.falta),
      }));
    },
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });
}

/** Agrupa as linhas de (PV, numeração) por pedido, preservando a ordem de prioridade. */
export interface SoleStockOrderGroup {
  saleOrderId: string;
  orderNumber: string;
  clientName: string;
  pvStatus: string;
  billingMonday: string | null;
  porNumero: Record<string, { consumo: number; falta: number }>;
  consumoTotal: number;
  faltaTotal: number;
}

export function groupSoleStockOrders(rows: SoleStockOrderRow[]): SoleStockOrderGroup[] {
  const out: SoleStockOrderGroup[] = [];
  const byId = new Map<string, SoleStockOrderGroup>();
  for (const r of rows) {
    let g = byId.get(r.sale_order_id);
    if (!g) {
      g = {
        saleOrderId: r.sale_order_id,
        orderNumber: r.order_number ?? '—',
        clientName: r.client_name ?? '—',
        pvStatus: r.pv_status ?? '—',
        billingMonday: r.billing_monday,
        porNumero: {},
        consumoTotal: 0,
        faltaTotal: 0,
      };
      byId.set(r.sale_order_id, g);
      // A ordem de chegada já é a da prioridade (ORDER BY na RPC) — preservar.
      out.push(g);
    }
    const cell = g.porNumero[r.size_key] ?? { consumo: 0, falta: 0 };
    cell.consumo += r.consumo;
    cell.falta += r.falta;
    g.porNumero[r.size_key] = cell;
    g.consumoTotal += r.consumo;
    g.faltaTotal += r.falta;
  }
  return out;
}

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

/**
 * Qualidade de estoque — paridade Tutor32 (estoque #1).
 * Quarentena/bloqueio operável (RPC move_stock_status) + recall de lote
 * (RPC recall_lot_buyers, antes morta no front).
 */

export type StockBucket = 'disponivel' | 'quarentena' | 'bloqueado' | 'descarte';

export interface HeldProduct {
  id: string; name: string; sku: string | null;
  quantity: number; quarantine_qty: number; blocked_qty: number;
}

export interface ProductSearchRow { id: string; name: string; sku: string | null; quantity: number; quarantine_qty: number; blocked_qty: number; }

export interface QuarantineAudit {
  id: string; product_id: string; quantity: number; reason: string; status: string;
  resolution_notes: string | null; created_at: string;
  products?: { name: string; sku: string | null } | null;
}

export interface RecallBuyer {
  sale_order_id: string; sale_order_number: string; client_name: string;
  client_cnpj: string; pairs_received: number; nfe_number: string; delivery_date: string;
}

export interface LotRow { id: string; lot_number: string; status: string; quantity_available: number; products?: { name: string } | null; }

/** Produtos com saldo em quarentena ou bloqueado. */
export function useHeldStock() {
  return useQuery({
    queryKey: ['held_stock'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, name, sku, quantity, quarantine_qty, blocked_qty')
        .or('quarantine_qty.gt.0,blocked_qty.gt.0')
        .order('name');
      if (error) throw error;
      return (data ?? []) as HeldProduct[];
    },
  });
}

/** Busca de produtos para a ação de mover (ilike nome/sku). */
export function useProductSearch(term: string) {
  return useQuery({
    queryKey: ['product_search_quality', term],
    enabled: term.trim().length >= 2,
    queryFn: async () => {
      const t = `%${term.trim()}%`;
      const { data, error } = await supabase
        .from('products')
        .select('id, name, sku, quantity, quarantine_qty, blocked_qty')
        .or(`name.ilike.${t},sku.ilike.${t}`)
        .order('name')
        .limit(20);
      if (error) throw error;
      return (data ?? []) as ProductSearchRow[];
    },
  });
}

export function useQuarantineHistory() {
  return useQuery({
    queryKey: ['quarantine_history'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('quarantine_stock')
        .select('id, product_id, quantity, reason, status, resolution_notes, created_at, products(name, sku)')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as unknown as QuarantineAudit[];
    },
  });
}

export function useMoveStockStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { productId: string; qty: number; from: StockBucket; to: StockBucket; reason: string }) => {
      const { error } = await supabase.rpc('move_stock_status' as any, {
        p_product_id: p.productId, p_qty: p.qty, p_from: p.from, p_to: p.to, p_reason: p.reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['held_stock'] });
      qc.invalidateQueries({ queryKey: ['quarantine_history'] });
      qc.invalidateQueries({ queryKey: ['product_search_quality'] });
      // `move_stock_status` mexe no saldo do produto e gera movimento — sem
      // invalidar estes dois, as telas de estoque seguiam com saldo velho até o
      // staleTime expirar. É o mesmo par que as demais mutations de estoque já
      // invalidam (o prefixo 'products' cobre ['products','paginated',…]).
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['stock_movements'] });
      toast.success('Movimentação de estoque registrada.');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

/** Lotes para o recall (lot_tracking). */
export function useLotsForRecall() {
  return useQuery({
    queryKey: ['lots_for_recall'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('lot_tracking')
        .select('id, lot_number, status, quantity_available, products(name)')
        .order('received_date', { ascending: false })
        .limit(300);
      if (error) throw error;
      return (data ?? []) as unknown as LotRow[];
    },
  });
}

export function useRecallLot() {
  return useMutation({
    mutationFn: async (lotId: string): Promise<RecallBuyer[]> => {
      const { data, error } = await supabase.rpc('recall_lot_buyers' as any, { p_lot_id: lotId });
      if (error) throw error;
      return (data ?? []) as unknown as RecallBuyer[];
    },
    onError: (err: Error) => toast.error(`Erro no recall: ${err.message}`),
  });
}

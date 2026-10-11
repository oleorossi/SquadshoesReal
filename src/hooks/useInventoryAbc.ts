import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { inboundEntrySince, openInboundAllocationReview } from '@/lib/inboundAllocationReviewStore';

/**
 * Inventário cíclico + curva ABC — paridade Tutor32 (estoque #4).
 * Classificação ABC por valor de estoque (view v_product_abc) e sessões de
 * contagem cíclica que reconciliam o saldo (RPCs open/apply_inventory_count).
 */

export interface AbcRow {
  product_id: string; name: string; sku: string | null; quantity: number;
  unit_price: number; stock_value: number; abc_class: 'A' | 'B' | 'C';
  pct_of_total: number; cumulative_pct: number;
}
export interface InventoryCount {
  id: string; count_number: string; scope: string; status: string; run_date: string;
  total_products: number; counted_products: number; divergences_count: number;
  total_divergence_value: number; completed_at: string | null; created_at: string;
}
export interface CountItem {
  id: string; count_id: string; product_id: string; abc_class: string | null;
  expected_qty: number; counted_qty: number | null; unit_price: number;
  divergence: number | null; adjusted: boolean;
  products?: { name: string; sku: string | null } | null;
}

export type Scope = 'A' | 'B' | 'C' | 'all';

export function useAbcClassification() {
  return useQuery({
    queryKey: ['v_product_abc'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_product_abc' as any).select('*').order('stock_value', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as AbcRow[];
    },
  });
}

export function useInventoryCounts() {
  return useQuery({
    queryKey: ['inventory_counts'],
    queryFn: async () => {
      const { data, error } = await supabase.from('inventory_counts' as any).select('*').order('created_at', { ascending: false }).limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as InventoryCount[];
    },
  });
}

export function useCountItems(countId: string | null) {
  return useQuery({
    queryKey: ['inventory_count_items', countId],
    enabled: !!countId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory_count_items' as any)
        .select('id, count_id, product_id, abc_class, expected_qty, counted_qty, unit_price, divergence, adjusted, products(name, sku)')
        .eq('count_id', countId!)
        .order('abc_class');
      if (error) throw error;
      return (data ?? []) as unknown as CountItem[];
    },
  });
}

export function useOpenInventoryCount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (scope: Scope): Promise<string> => {
      const { data, error } = await supabase.rpc('open_inventory_count' as any, { p_scope: scope });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['inventory_counts'] }); toast.success('Contagem aberta.'); },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useUpdateCountItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { id: string; countId: string; counted_qty: number | null }) => {
      const { error } = await supabase.from('inventory_count_items' as any).update({ counted_qty: p.counted_qty } as any).eq('id', p.id);
      if (error) throw error;
    },
    onSuccess: (_d, p) => qc.invalidateQueries({ queryKey: ['inventory_count_items', p.countId] }),
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useApplyInventoryCount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (countId: string) => {
      // Janela do rateio da entrada: sobra de contagem pode quitar falta de PV.
      const inboundSince = inboundEntrySince();
      const { data, error } = await supabase.rpc('apply_inventory_count' as any, { p_count_id: countId });
      if (error) throw error;
      return { ...(data as { counted: number; divergences: number; divergence_value: number }), inboundSince };
    },
    onSuccess: (res, countId) => {
      qc.invalidateQueries({ queryKey: ['inventory_counts'] });
      qc.invalidateQueries({ queryKey: ['v_product_abc'] });
      toast.success(`Contagem aplicada — ${res.divergences} divergência(s) reconciliada(s).`);
      void openInventoryCountReview(countId, res.inboundSince);
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

/**
 * Produtos contados → revisão do rateio (silencioso em erro). Manda os que
 * tiveram divergência — só esses `apply_inventory_count` regrava (e só a sobra
 * vira entrada; o servidor devolve apenas o que de fato quitou falta). Item sem
 * divergência não é tocado, e mandá-lo deixaria a âncora da janela
 * (`products.updated_at`) cair numa gravação anterior de outra operação.
 */
async function openInventoryCountReview(countId: string, since: string) {
  try {
    const { data, error } = await supabase
      .from('inventory_count_items')
      .select('product_id, counted_qty, divergence')
      .eq('count_id', countId)
      .not('counted_qty', 'is', null);
    if (error) return;
    const productIds = ((data ?? []) as unknown as Array<{ product_id: string; divergence: number | null }>)
      .filter((i) => (Number(i.divergence) || 0) !== 0)
      .map((i) => i.product_id);
    if (productIds.length > 0) await openInboundAllocationReview({ productIds, since });
  } catch {
    // Revisão do rateio é acessória — nunca atrapalha a aplicação da contagem.
  }
}

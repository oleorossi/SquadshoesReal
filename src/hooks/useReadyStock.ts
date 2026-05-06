import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export type ReadyStockItem = {
  id: string;
  reference_id: string;
  color: string;
  size: string;
  quantity: number;
  location: string;
  notes: string;
  created_at: string;
  updated_at: string;
  technical_sheets?: {
    name: string;
    code: string;
    shoe_category: string | null;
    sale_price: number;
    cost_price: number;
    colors: string | null;
    sizes: string | null;
    image_url: string | null;
    color_images: any[] | null;
    cor_predominante_id: string | null;
    brand: string | null;
  } | null;
};

export function useReadyStock() {
  return useQuery({
    queryKey: ['ready_stock'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ready_stock')
        .select('*, technical_sheets(name, code, shoe_category, sale_price, cost_price, colors, sizes, image_url, color_images, cor_predominante_id, brand)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as ReadyStockItem[];
    },
    staleTime: 30_000,
    gcTime: 120_000,
  });
}

export function useUpsertReadyStock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (item: { reference_id: string; color: string; size: string; quantity: number; location?: string; notes?: string }) => {
      const { error } = await supabase.rpc('upsert_ready_stock_atomic', {
        p_reference_id: item.reference_id,
        p_color: item.color,
        p_size: item.size,
        p_qty_delta: item.quantity,
        p_location: item.location ?? null,
        p_notes: item.notes ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ready_stock'] });
      toast.success('Estoque atualizado!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useBatchUpsertReadyStock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (items: { reference_id: string; color: string; size: string; quantity: number; location?: string; notes?: string }[]) => {
      const applied: typeof items = [];
      try {
        for (const item of items) {
          const { error } = await supabase.rpc('upsert_ready_stock_atomic', {
            p_reference_id: item.reference_id,
            p_color: item.color,
            p_size: item.size,
            p_qty_delta: item.quantity,
            p_location: item.location ?? null,
            p_notes: item.notes ?? null,
          });
          if (error) throw error;
          applied.push(item);
        }
      } catch (err) {
        // Best-effort reverse-delta: undo items already applied so the batch
        // is all-or-nothing from the operator's perspective. A network error
        // mid-rollback can still leave partial state — a server-side atomic
        // batch RPC is the only durable fix.
        const failedRollbacks: string[] = [];
        for (const item of applied.slice().reverse()) {
          const { error: rollErr } = await supabase.rpc('upsert_ready_stock_atomic', {
            p_reference_id: item.reference_id,
            p_color: item.color,
            p_size: item.size,
            p_qty_delta: -item.quantity,
            p_location: null,
            p_notes: null,
          });
          if (rollErr) failedRollbacks.push(`${item.reference_id}/${item.color}/${item.size}: ${rollErr.message}`);
        }
        if (failedRollbacks.length > 0) {
          throw new Error(
            `Erro original: ${(err as Error).message}. ` +
            `Atenção: ${failedRollbacks.length} reversão(ões) falharam — estoque pode estar inconsistente: ${failedRollbacks.join('; ')}`
          );
        }
        throw err;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ready_stock'] });
      toast.success('Lançamento em lote concluído!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useUpdateReadyStock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, quantity, location, notes, expectedQuantity }: {
      id: string;
      quantity: number;
      location?: string;
      notes?: string;
      expectedQuantity?: number;
    }) => {
      const update: any = { quantity };
      if (location !== undefined) update.location = location;
      if (notes !== undefined) update.notes = notes;
      let query = supabase.from('ready_stock').update(update).eq('id', id);
      if (expectedQuantity !== undefined) {
        // Optimistic concurrency: refuse if another tab already changed the quantity.
        const { data: claimed, error } = await query.eq('quantity', expectedQuantity).select('id');
        if (error) throw error;
        if (!claimed || claimed.length === 0) {
          throw new Error('Quantidade foi alterada por outro usuário — recarregue e tente novamente.');
        }
        return;
      }
      const { error } = await query;
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ready_stock'] });
      toast.success('Quantidade atualizada!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useDeleteReadyStock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('ready_stock').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ready_stock'] });
      toast.success('Item removido!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

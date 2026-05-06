import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export function usePickingLists() {
  return useQuery({
    queryKey: ['picking_lists'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('picking_lists')
        .select('*, picking_list_items(*, products(name, sku, color, unit, location))')
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
    staleTime: 2 * 60 * 1000,
  });
}

export function useCreatePickingList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ orderId, items }: { orderId: string; items: Array<{ product_id: string; quantity_required: number; location?: string; reservation_id?: string }> }) => {
      // Preflight: refuse picking list creation when the OP is already
      // Cancelada or Finalizado — the list would linger in 'pending' forever
      // and inflate the picking_lists KPI.
      const { data: op, error: opErr } = await supabase
        .from('orders')
        .select('status')
        .eq('id', orderId)
        .single();
      if (opErr) throw new Error(`Falha ao carregar OP: ${opErr.message}`);
      if (op && ['Cancelada', 'Finalizado'].includes(op.status)) {
        throw new Error(`OP com status "${op.status}" não aceita nova lista de picking.`);
      }
      const { data: pl, error: plErr } = await supabase
        .from('picking_lists')
        .insert({ order_id: orderId } as any)
        .select()
        .single();
      if (plErr) throw plErr;

      if (items.length > 0) {
        const rows = items.map(it => ({
          picking_list_id: pl.id,
          product_id: it.product_id,
          quantity_required: it.quantity_required,
          location: it.location || '',
          reservation_id: it.reservation_id || null,
        }));
        const { error: itemErr } = await supabase.from('picking_list_items').insert(rows as any);
        if (itemErr) {
          const { error: cleanupErr } = await supabase.from('picking_lists').delete().eq('id', pl.id);
          if (cleanupErr) {
            throw new Error(
              `Falha ao inserir itens (${itemErr.message}) e ao limpar lista órfã (${cleanupErr.message}). ` +
              `Verifique a lista ${pl.id} manualmente.`
            );
          }
          throw itemErr;
        }
      }
      return pl;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['picking_lists'] });
      toast.success('Lista de picking criada!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useUpdatePickingStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status, completedBy }: { id: string; status: string; completedBy?: string }) => {
      const updates: any = { status, updated_at: new Date().toISOString() };
      if (status === 'in_progress') updates.started_at = new Date().toISOString();
      if (status === 'completed') {
        updates.completed_at = new Date().toISOString();
        updates.completed_by = completedBy || '';
      }
      // Atomic predecessor guard: prevents two operators double-completing the
      // same list (overwrites completed_at/completed_by) or concurrent skips.
      let q = supabase.from('picking_lists').update(updates).eq('id', id);
      if (status === 'in_progress') q = (q as any).eq('status', 'pending');
      else if (status === 'completed') q = (q as any).eq('status', 'in_progress');
      const { data, error } = await (q as any).select('id');
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error('A lista já mudou de status — atualize e tente novamente.');
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['picking_lists'] });
      toast.success('Status do picking atualizado!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

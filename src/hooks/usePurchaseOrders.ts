import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export type PurchaseOrder = {
  id: string;
  order_number: string;
  status: string;
  supplier_id: string | null;
  supplier_name: string;
  total_value: number;
  notes: string;
  auto_generated: boolean;
  promised_date: string | null;
  received_date: string | null;
  created_at: string;
  updated_at: string;
};

export type PurchaseOrderItem = {
  id: string;
  purchase_order_id: string;
  product_id: string;
  current_stock: number;
  min_stock: number;
  max_stock: number;
  suggested_quantity: number;
  quantity: number;
  unit_price: number;
  unit: string;
  created_at: string;
  grade?: Record<string, number> | null;
  color?: string | null;
  product?: { name: string; sku: string; category: string; color?: string | null };
};

export function usePurchaseOrders() {
  return useQuery({
    queryKey: ['purchase_orders'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('purchase_orders')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as PurchaseOrder[];
    },
  });
}

export function usePurchaseOrderItems(orderId: string | null) {
  return useQuery({
    queryKey: ['purchase_order_items', orderId],
    enabled: !!orderId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('purchase_order_items')
        .select('*, products(id, name, sku, category, color)')
        .eq('purchase_order_id', orderId!);
      if (error) throw error;
      return (data || []).map((item: any) => ({
        ...item,
        product: item.products || { name: '?', sku: '?', category: '?', color: null },
        products: undefined,
      })) as PurchaseOrderItem[];
    },
  });
}

export function useUpdatePurchaseOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<PurchaseOrder> }) => {
      // Refuse updates on finalized POs (same guard as useDeletePurchaseOrder/
      // useUpdatePurchaseOrderItem). Prevents supplier/total/dates from being
      // mutated on received OCs and distorting supplier-spend reports.
      const { data: updated, error } = await supabase
        .from('purchase_orders')
        .update(data)
        .eq('id', id)
        .not('status', 'in', '("received","receiving","cancelled")')
        .select('id');
      if (error) throw error;
      if (!updated || updated.length === 0) {
        throw new Error('OC já recebida ou cancelada — não pode ser alterada. Crie uma nova OC se necessário.');
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchase_orders'] });
      toast.success('Ordem de compra atualizada!');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdatePurchaseOrderItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: { quantity: number; unit_price: number } }) => {
      if (!Number.isFinite(data.quantity) || data.quantity <= 0) throw new Error('Quantidade inválida em item da OC.');
      if (!Number.isFinite(data.unit_price) || data.unit_price < 0) throw new Error('Preço unitário inválido em item da OC.');
      const { data: item, error: itemFetchErr } = await supabase
        .from('purchase_order_items')
        .select('purchase_order_id')
        .eq('id', id)
        .single();
      if (itemFetchErr || !item) throw new Error('Item de OC não encontrado.');
      const { data: po, error: poFetchErr } = await supabase
        .from('purchase_orders')
        .select('status')
        .eq('id', item.purchase_order_id)
        .single();
      if (poFetchErr) throw poFetchErr;
      if (po && ['received', 'receiving', 'cancelled'].includes(po.status)) {
        throw new Error('Não é possível editar itens de uma OC já recebida, em recebimento ou cancelada.');
      }
      const { error } = await supabase.from('purchase_order_items').update(data).eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['purchase_order_items'] });
      qc.invalidateQueries({ queryKey: ['purchase_orders'] });
      toast.success('Item atualizado!');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeletePurchaseOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // Atomic conditional DELETE: only deletes when status is not 'received' or
      // 'receiving', closing the race window between the old SELECT-then-DELETE
      // pattern and a concurrent receive flow.
      const { data: deleted, error } = await supabase
        .from('purchase_orders')
        .delete()
        .eq('id', id)
        .not('status', 'in', '("received","receiving")')
        .select('id');
      if (error) throw error;
      if (!deleted || deleted.length === 0) {
        throw new Error('OC já recebida ou em recebimento não pode ser excluída. Cancele-a se necessário.');
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchase_orders'] });
      toast.success('Ordem de compra excluída!');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useCreatePurchaseOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { supplier_name: string; supplier_id?: string | null; notes?: string; items: { product_id: string; quantity: number; unit_price: number; unit: string; current_stock: number; min_stock: number; max_stock: number; grade?: Record<string, number> | null; color?: string | null }[] }) => {
      for (const it of data.items) {
        if (!Number.isFinite(it.quantity) || it.quantity <= 0) throw new Error('Quantidade inválida em item da OC.');
        if (!Number.isFinite(it.unit_price) || it.unit_price < 0) throw new Error('Preço unitário inválido em item da OC.');
      }
      const total = data.items.reduce((s, i) => s + i.quantity * i.unit_price, 0);
      if (!Number.isFinite(total) || total > 1e12) throw new Error('Total da OC fora de limite.');
      const { data: po, error } = await supabase.from('purchase_orders').insert({
        supplier_name: data.supplier_name,
        supplier_id: data.supplier_id || null,
        notes: data.notes || '',
        total_value: total,
        auto_generated: false,
      }).select().single();
      if (error) throw error;

      const items = data.items.map(i => ({
        purchase_order_id: po.id,
        product_id: i.product_id,
        quantity: i.quantity,
        suggested_quantity: i.quantity,
        unit_price: i.unit_price,
        unit: i.unit,
        current_stock: i.current_stock,
        min_stock: i.min_stock,
        max_stock: i.max_stock,
        grade: i.grade ?? null,
        color: i.color ?? null,
      }));
      const { error: e2 } = await supabase.from('purchase_order_items').insert(items);
      if (e2) {
        // Compensating delete — if items insert failed, the parent PO would be orphaned.
        // Filter by status='pending' to avoid deleting a PO that was concurrently advanced.
        const { error: cleanupErr } = await supabase.from('purchase_orders').delete().eq('id', po.id).eq('status', 'pending');
        if (cleanupErr) {
          throw new Error(
            `Falha ao inserir itens (${e2.message}) e ao limpar OC órfã (${cleanupErr.message}). ` +
            `Verifique a OC ${po.id} manualmente.`
          );
        }
        throw e2;
      }
      return po;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchase_orders'] });
      toast.success('Ordem de compra criada!');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}


export function useCapacityDrivenLeadTimes() {
   return useQuery({
     queryKey: ['capacity_driven_lead_times'],
     queryFn: async () => {
       const { data, error } = await supabase
         .from('v_capacity_driven_lead_times' as any)
         .select('*');
       if (error) throw error;
       return (data || []) as unknown as DynamicLeadTime[];
     },
   });
 }

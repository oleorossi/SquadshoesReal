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
      // Soft-cancel em vez de DELETE preserva audit trail (quem cancelou, quando,
      // valor original, fornecedor). Hard delete perdia toda a história e deixava
      // accounts_payable órfão. O guard contra status received/receiving permanece.
      const { data: cancelled, error } = await supabase
        .from('purchase_orders')
        .update({
          status: 'cancelled',
          cancelled_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as any)
        .eq('id', id)
        .not('status', 'in', '("received","receiving","cancelled")')
        .select('id');
      if (error) throw error;
      if (!cancelled || cancelled.length === 0) {
        throw new Error('OC já recebida, em recebimento ou já cancelada não pode ser cancelada novamente.');
      }

      // Cancela também qualquer accounts_payable pendente vinculado a esta OC,
      // para que a OC cancelada não fique inflando o aging financeiro. Entries
      // já pagas (paid) são preservadas para audit trail.
      await supabase
        .from('accounts_payable')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() } as any)
        .eq('purchase_order_id', id)
        .in('status', ['pending', 'partial']);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchase_orders'] });
      qc.invalidateQueries({ queryKey: ['accounts_payable'] });
      toast.success('Ordem de compra cancelada!');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// Anti-double-click: token computado pelo conteúdo do payload. Se a mesma
// OC for submetida 2× rapidamente (race entre cliques antes do isPending
// virar true, ou retry de Promise), o segundo POST é deduplicado. TTL de
// 30s — depois disso, considera-se que o usuário realmente quer 2 POs.
const recentPurchaseOrders = new Map<string, number>();
function purchaseOrderIdempotencyKey(data: {
  supplier_name: string;
  supplier_id?: string | null;
  items: { product_id: string; quantity: number; unit_price: number }[];
}): string {
  const itemsKey = data.items
    .map(i => `${i.product_id}:${i.quantity}:${i.unit_price}`)
    .sort()
    .join('|');
  return `${data.supplier_id || data.supplier_name}::${itemsKey}`;
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

      // ── Idempotência client-side ──
      const idemKey = purchaseOrderIdempotencyKey(data);
      const lastSubmittedAt = recentPurchaseOrders.get(idemKey);
      const now = Date.now();
      if (lastSubmittedAt && now - lastSubmittedAt < 30_000) {
        throw new Error(
          'Esta OC foi submetida há menos de 30s — provavelmente já existe. ' +
          'Verifique a aba de OCs antes de criar de novo.'
        );
      }
      recentPurchaseOrders.set(idemKey, now);
      // Cleanup tokens velhos (>30s)
      for (const [k, t] of recentPurchaseOrders.entries()) {
        if (now - t > 30_000) recentPurchaseOrders.delete(k);
      }

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

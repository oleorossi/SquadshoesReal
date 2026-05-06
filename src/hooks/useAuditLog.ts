import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export type AuditLogEntry = {
  id: string;
  product_id: string | null;
  product_name: string;
  product_sku: string | null;
  action: string;
  changes: Record<string, { old: any; new: any }> | null;
  quantity_change: number | null;
  previous_stock: number | null;
  new_stock: number | null;
  user_id: string | null;
  user_email: string | null;
  reversed: boolean;
  reversed_at: string | null;
  reversed_by: string | null;
  created_at: string;
};

export function useAuditLog(search?: string, enabled = true) {
  return useQuery({
    queryKey: ['material_audit_log', search],
    enabled,
    queryFn: async () => {
      let query = supabase
        .from('material_audit_log' as any)
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500);

      const { data, error } = await query;
      if (error) throw error;

      let results = (data || []) as unknown as AuditLogEntry[];

      if (search && search.trim()) {
        const q = search.toLowerCase();
        results = results.filter(
          (r) =>
            r.product_name?.toLowerCase().includes(q) ||
            r.product_sku?.toLowerCase().includes(q) ||
            r.user_email?.toLowerCase().includes(q)
        );
      }

      return results;
    },
  });
}

// Only these fields may be reverted — prevents overwriting system/audit fields via replay attack
const REVERTIBLE_PRODUCT_FIELDS = new Set([
  'name', 'sku', 'description', 'unit_price', 'unit',
  'min_stock', 'max_stock', 'quantity', 'color', 'category',
  'location', 'notes', 'group_id', 'supplier_id',
]);

export function useRevertAuditEntry() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (entry: AuditLogEntry) => {
      // Get current user email for reversed_by
      const { data: { user } } = await supabase.auth.getUser();
      const userEmail = user?.email || 'unknown';

      if (entry.action === 'updated' && entry.changes && entry.product_id) {
        // Revert each changed field to old value — only whitelisted fields
        const updates: Record<string, any> = {};
        for (const [field, val] of Object.entries(entry.changes)) {
          if (REVERTIBLE_PRODUCT_FIELDS.has(field)) {
            updates[field] = val.old;
          }
        }
        if (Object.keys(updates).length === 0) return;
        const { error } = await supabase
          .from('products')
          .update(updates)
          .eq('id', entry.product_id);
        if (error) throw error;
      } else if (entry.action === 'created' && entry.product_id) {
        // Deactivate the product
        const { error } = await supabase
          .from('products')
          .update({ active: false })
          .eq('id', entry.product_id);
        if (error) throw error;
      } else if (entry.action === 'deleted' && entry.product_id) {
        // Reactivate the product
        const { error } = await supabase
          .from('products')
          .update({ active: true })
          .eq('id', entry.product_id);
        if (error) throw error;
      }

      // Mark as reversed
      const { error: markError } = await supabase
        .from('material_audit_log' as any)
        .update({
          reversed: true,
          reversed_at: new Date().toISOString(),
          reversed_by: userEmail,
        } as any)
        .eq('id', entry.id);
      if (markError) throw markError;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['material_audit_log'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      toast.success('Ação revertida com sucesso!');
    },
    onError: (err: Error) => toast.error(`Erro ao reverter: ${err.message}`),
  });
}

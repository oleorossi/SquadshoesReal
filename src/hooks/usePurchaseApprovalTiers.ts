import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

/**
 * Alçadas de aprovação de compras — paridade Tutor32 (compras #2).
 * Faixas de valor → perfil exigido para aprovar a OC. Enforcement por trigger
 * (tg_enforce_po_alcada): bloqueia usuário sem o perfil; admin sempre aprova;
 * fluxos de sistema (auth.uid nulo) não são bloqueados.
 */

export interface ApprovalTier {
  id: string; name: string; min_value: number; max_value: number | null;
  required_role: string; active: boolean; notes: string;
}
export type ApprovalTierForm = Omit<ApprovalTier, 'id'>;

export interface ApprovalAudit {
  id: string; purchase_order_id: string; required_role: string; approved_by: string | null;
  approved_at: string | null; status: string; tier_name: string | null; total_value: number | null;
  created_at: string;
  purchase_orders?: { order_number: string; supplier_name: string | null } | null;
}

export const APPROVER_ROLES = ['gerente', 'admin', 'comercial'];

export const emptyTier = (): ApprovalTierForm => ({
  name: '', min_value: 0, max_value: null, required_role: 'gerente', active: true, notes: '',
});

export function useApprovalTiers() {
  return useQuery({
    queryKey: ['purchase_approval_tiers'],
    queryFn: async () => {
      const { data, error } = await supabase.from('purchase_approval_tiers' as any).select('*').order('min_value');
      if (error) throw error;
      return (data ?? []) as unknown as ApprovalTier[];
    },
  });
}

export function useApprovalHistory() {
  return useQuery({
    queryKey: ['purchase_order_approvals'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('purchase_order_approvals' as any)
        .select('id, purchase_order_id, required_role, approved_by, approved_at, status, tier_name, total_value, created_at, purchase_orders(order_number, supplier_name)')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as unknown as ApprovalAudit[];
    },
  });
}

function validate(d: ApprovalTierForm) {
  if (!d.name.trim()) throw new Error('Nome da alçada obrigatório.');
  if (!Number.isFinite(d.min_value) || d.min_value < 0) throw new Error('Início da faixa deve ser ≥ 0.');
  if (d.max_value != null && (!Number.isFinite(d.max_value) || d.max_value <= d.min_value))
    throw new Error('Fim da faixa deve ser maior que o início (ou vazio para "sem teto").');
  if (!d.required_role.trim()) throw new Error('Perfil exigido obrigatório.');
}

export function useSaveApprovalTier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id?: string; data: ApprovalTierForm }) => {
      validate(data);
      const row = { ...data, max_value: data.max_value === null ? null : Number(data.max_value) };
      if (id) {
        const { error } = await supabase.from('purchase_approval_tiers' as any).update(row as any).eq('id', id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('purchase_approval_tiers' as any).insert(row as any);
        if (error) throw error;
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['purchase_approval_tiers'] }); toast.success('Alçada salva!'); },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useDeleteApprovalTier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('purchase_approval_tiers' as any).delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['purchase_approval_tiers'] }); toast.success('Alçada removida!'); },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

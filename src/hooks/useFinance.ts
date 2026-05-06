import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { sanitizeUuidFields } from '@/lib/utils';

export type AccountPayable = {
  id: string;
  description: string;
  supplier_id: string | null;
  invoice_id: string | null;
  category: string;
  due_date: string;
  amount: number;
  amount_paid: number;
  status: string;
  payment_date: string | null;
  payment_method: string | null;
  bank_name: string | null;
  barcode: string | null;
  boleto_number: string | null;
  installment_number: number;
  total_installments: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
  suppliers?: { name: string; cnpj?: string | null } | null;
};

export type AccountReceivable = {
  id: string;
  description: string;
  client_name: string;
  client_cnpj: string | null;
  sale_order_id: string | null;
  category: string;
  due_date: string;
  amount: number;
  amount_received: number;
  status: string;
  payment_date: string | null;
  payment_method: string | null;
  installment_number: number;
  total_installments: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
  sale_orders?: { order_number: string; client_name: string } | null;
};

export function useAccountsPayable() {
  return useQuery({
    queryKey: ['accounts_payable'],
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('accounts_payable')
        .select('*, suppliers(name, cnpj)')
        .order('due_date', { ascending: true })
        .limit(2000);
      if (error) throw error;
      return data as AccountPayable[];
    },
  });
}

export function useAccountsReceivable() {
  return useQuery({
    queryKey: ['accounts_receivable'],
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('accounts_receivable')
        .select('*, sale_orders(order_number, client_name)')
        .order('due_date', { ascending: true })
        .limit(2000);
      if (error) throw error;
      return data as AccountReceivable[];
    },
  });
}

export function useCreateAccountPayable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (account: Omit<AccountPayable, 'id' | 'created_at' | 'updated_at' | 'suppliers'>) => {
      if (!Number.isFinite(account.amount) || account.amount <= 0) throw new Error('Valor deve ser um número positivo.');
      const { error } = await supabase.from('accounts_payable').insert(sanitizeUuidFields(account) as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts_payable'] });
      toast.success('Conta a pagar criada!');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useCreateAccountReceivable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (account: Omit<AccountReceivable, 'id' | 'created_at' | 'updated_at' | 'sale_orders'>) => {
      if (!Number.isFinite(account.amount) || account.amount <= 0) throw new Error('Valor deve ser um número positivo.');
      const { error } = await supabase.from('accounts_receivable').insert(sanitizeUuidFields(account) as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts_receivable'] });
      toast.success('Conta a receber criada!');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateAccountPayable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...data }: Partial<AccountPayable> & { id: string }) => {
      const { suppliers, ...cleanData } = data as any;
      // Guard: prevent amount/status edits on already-paid rows to preserve audit trail.
      // Uses a conditional UPDATE (.neq) instead of SELECT-then-UPDATE to avoid a race
      // where a concurrent payment flips status between our SELECT and UPDATE.
      if (cleanData.amount !== undefined || cleanData.status !== undefined) {
        const { data: updated, error } = await supabase
          .from('accounts_payable')
          .update(sanitizeUuidFields(cleanData) as any)
          .eq('id', id)
          .not('status', 'in', '("paid","cancelled")')
          .select('id');
        if (error) throw error;
        if (!updated || updated.length === 0) throw new Error('Conta já paga ou cancelada — não é possível editar.');
        return;
      }
      const { error } = await supabase.from('accounts_payable').update(sanitizeUuidFields(cleanData) as any).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts_payable'] });
      toast.success('Conta atualizada!');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateAccountReceivable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...data }: Partial<AccountReceivable> & { id: string }) => {
      const { sale_orders, ...cleanData } = data as any;
      // Guard: prevent amount/status edits on already-received rows to preserve audit trail.
      // Uses a conditional UPDATE (.neq) instead of SELECT-then-UPDATE to avoid a race
      // where a concurrent payment flips status between our SELECT and UPDATE.
      if (cleanData.amount !== undefined || cleanData.status !== undefined) {
        const { data: updated, error } = await supabase
          .from('accounts_receivable')
          .update(sanitizeUuidFields(cleanData) as any)
          .eq('id', id)
          .not('status', 'in', '("received","cancelled")')
          .select('id');
        if (error) throw error;
        if (!updated || updated.length === 0) throw new Error('Conta já recebida ou cancelada — não é possível editar.');
        return;
      }
      const { error } = await supabase.from('accounts_receivable').update(sanitizeUuidFields(cleanData) as any).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts_receivable'] });
      toast.success('Conta atualizada!');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteAccountPayable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // Refuse to hard-delete paid AP rows to preserve the audit trail.
      const { data, error } = await supabase
        .from('accounts_payable')
        .delete()
        .eq('id', id)
        .neq('status', 'paid')
        .select('id');
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('Conta já paga não pode ser excluída. Cancele-a se necessário.');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts_payable'] });
      toast.success('Conta excluída!');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteAccountReceivable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // Refuse to hard-delete received/cancelled AR rows to preserve the audit trail.
      const { data, error } = await supabase
        .from('accounts_receivable')
        .delete()
        .eq('id', id)
        .not('status', 'in', '("received","cancelled")')
        .select('id');
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('Conta já recebida ou cancelada não pode ser excluída.');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts_receivable'] });
      toast.success('Conta excluída!');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

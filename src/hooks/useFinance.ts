import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { sanitizeUuidFields } from '@/lib/utils';
import { invalidateFinanceDerivedQueries } from '@/lib/financeQueryInvalidation';
import { fetchFinancialRows } from '@/lib/financialPagination';
import type { Database } from '@/integrations/supabase/types';

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

function assertNoDirectCashWrite(data: Record<string, unknown>, creating = false) {
  for (const field of ['amount_paid', 'amount_received']) {
    if (data[field] !== undefined && (!creating || Number(data[field]) !== 0)) {
      throw new Error('Registre pagamentos e recebimentos pelo comando de baixa, não pela edição do título.');
    }
  }
  if (data.payment_date !== undefined && (!creating || data.payment_date !== null)) {
    throw new Error('A data do movimento pertence ao histórico de baixas.');
  }
  if (data.status !== undefined && (!creating || data.status !== 'pending')) {
    throw new Error('A situação financeira é calculada a partir das baixas.');
  }
}

export function useAccountsPayable(enabled = true) {
  return useQuery({
    queryKey: ['accounts_payable'],
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    enabled,
    queryFn: async () => {
      const rows = await fetchFinancialRows<AccountPayable>((from, to) => supabase
        .from('accounts_payable')
        .select('*, suppliers(name, cnpj)', { count: 'exact' })
        .order('id', { ascending: true })
        .range(from, to));
      return rows.sort((a, b) => a.due_date.localeCompare(b.due_date) || a.id.localeCompare(b.id));
    },
  });
}

export function useAccountsReceivable(enabled = true) {
  return useQuery({
    queryKey: ['accounts_receivable'],
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    enabled,
    queryFn: async () => {
      const rows = await fetchFinancialRows<AccountReceivable>((from, to) => supabase
        .from('accounts_receivable')
        .select('*, sale_orders(order_number, client_name)', { count: 'exact' })
        .order('id', { ascending: true })
        .range(from, to));
      return rows.sort((a, b) => a.due_date.localeCompare(b.due_date) || a.id.localeCompare(b.id));
    },
  });
}

export function useCreateAccountPayable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (account: Database['public']['Tables']['accounts_payable']['Insert']) => {
      if (!Number.isFinite(account.amount) || account.amount <= 0) throw new Error('Valor deve ser um número positivo.');
      assertNoDirectCashWrite(account, true);
      const { error } = await supabase.from('accounts_payable').insert(sanitizeUuidFields(account) as Database['public']['Tables']['accounts_payable']['Insert']);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts_payable'] });
      invalidateFinanceDerivedQueries(qc);
      toast.success('Conta a pagar criada!');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useCreateAccountReceivable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (account: Database['public']['Tables']['accounts_receivable']['Insert']) => {
      if (!Number.isFinite(account.amount) || account.amount <= 0) throw new Error('Valor deve ser um número positivo.');
      assertNoDirectCashWrite(account, true);
      const { error } = await supabase.from('accounts_receivable').insert(sanitizeUuidFields(account) as Database['public']['Tables']['accounts_receivable']['Insert']);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts_receivable'] });
      invalidateFinanceDerivedQueries(qc);
      toast.success('Conta a receber criada!');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateAccountPayable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...data }: Partial<AccountPayable> & { id: string }) => {
      const { suppliers, ...cleanData } = data;
      assertNoDirectCashWrite(cleanData);
      // A trava definitiva é transacional no banco, inclusive contra concorrência
      // com baixas e alterações incompatíveis com a origem fiscal/compra.
      const { data: updated, error } = await supabase.from('accounts_payable').update(sanitizeUuidFields(cleanData)).eq('id', id).select('id');
      if (error) throw error;
      if (!updated?.length) throw new Error('Conta não encontrada ou sem permissão para editar.');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts_payable'] });
      invalidateFinanceDerivedQueries(qc);
      toast.success('Conta atualizada!');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateAccountReceivable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...data }: Partial<AccountReceivable> & { id: string }) => {
      const { sale_orders, ...cleanData } = data;
      assertNoDirectCashWrite(cleanData);
      const { data: updated, error } = await supabase.from('accounts_receivable').update(sanitizeUuidFields(cleanData)).eq('id', id).select('id');
      if (error) throw error;
      if (!updated?.length) throw new Error('Conta não encontrada ou sem permissão para editar.');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts_receivable'] });
      invalidateFinanceDerivedQueries(qc);
      toast.success('Conta atualizada!');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteAccountPayable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // O banco também recusa título com qualquer evento, mesmo já estornado.
      const { data, error } = await supabase
        .from('accounts_payable')
        .delete()
        .eq('id', id)
        .neq('status', 'paid')
        .eq('amount_paid', 0)
        .select('id');
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('Conta com pagamento não pode ser excluída. O histórico deve ser preservado.');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts_payable'] });
      invalidateFinanceDerivedQueries(qc);
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
        .eq('amount_received', 0)
        .select('id');
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('Conta recebida ou cancelada não pode ser excluída. O histórico deve ser preservado.');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts_receivable'] });
      invalidateFinanceDerivedQueries(qc);
      toast.success('Conta excluída!');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { sanitizeUuidFields } from '@/lib/utils';
import { invalidateFinanceDerivedQueries } from '@/lib/financeQueryInvalidation';

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

export function useAccountsPayable(enabled = true) {
  return useQuery({
    queryKey: ['accounts_payable'],
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    enabled,
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

export function useAccountsReceivable(enabled = true) {
  return useQuery({
    queryKey: ['accounts_receivable'],
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    enabled,
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
      invalidateFinanceDerivedQueries(qc);
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
      // Refuse to hard-delete paid AP rows to preserve the audit trail.
      const { data, error } = await supabase
        .from('accounts_payable')
        .delete()
        .eq('id', id)
        .neq('status', 'paid')
        .select('id');
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('Conta já paga não pode ser excluída. Estorne o pagamento antes de excluir.');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts_payable'] });
      invalidateFinanceDerivedQueries(qc);
      toast.success('Conta excluída!');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/**
 * Estorno de pagamento — a ÚNICA saída para uma AP marcada como paga por engano.
 * Sem ele a linha ficava congelada para sempre: `useDeleteAccountPayable` recusa
 * `status='paid'` e `useUpdateAccountPayable` recusa edição de amount/status, e
 * não existia nenhuma ação de cancelar na UI. O estorno devolve a conta para
 * 'pending', de onde ela pode ser editada, excluída ou paga de novo.
 *
 * ⚠ `amount_paid` TEM que ir a zero no MESMO update. O trigger `trg_auto_close_ap`
 * (BEFORE UPDATE OF amount_paid, amount) reabre a conta como 'paid' sempre que
 * `amount_paid >= amount` — mexer só no status devolveria 'paid' na mesma
 * transação, silenciosamente. Vale para pagamento parcial também.
 *
 * Predicado atômico `.eq('status','paid')` (mesmo padrão do markPaid): dois
 * estornos concorrentes → o segundo não casa linha e falha explícito, em vez de
 * zerar um pagamento que outra sessão acabou de registrar.
 */
export function useReverseAccountPayable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from('accounts_payable')
        .update({ status: 'pending', amount_paid: 0, payment_date: null })
        .eq('id', id)
        .eq('status', 'paid')
        .select('id');
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('Conta não está paga — nada a estornar.');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts_payable'] });
      invalidateFinanceDerivedQueries(qc);
      toast.success('Pagamento estornado. A conta voltou para "À Vencer".');
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
      if (!data || data.length === 0) throw new Error('Conta já recebida ou cancelada não pode ser excluída. Estorne o recebimento antes de excluir.');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts_receivable'] });
      invalidateFinanceDerivedQueries(qc);
      toast.success('Conta excluída!');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/**
 * Espelho de `useReverseAccountPayable` para o lado a receber — mesmo beco sem
 * saída (delete e update recusam `status='received'`), mesma trava do trigger
 * `trg_auto_close_ar`, que reabre como 'received' se `amount_received >= amount`.
 *
 * Colateral esperado: `trg_ar_recompute_cmv` dispara em UPDATE OF status /
 * amount_received / payment_date e recalcula o reconhecimento de CMV do PV
 * vinculado. Isso é o comportamento correto de um estorno — o CMV reconhecido
 * some junto com o recebimento —, não um efeito a suprimir.
 */
export function useReverseAccountReceivable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from('accounts_receivable')
        .update({ status: 'pending', amount_received: 0, payment_date: null })
        .eq('id', id)
        .eq('status', 'received')
        .select('id');
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('Conta não está recebida — nada a estornar.');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts_receivable'] });
      invalidateFinanceDerivedQueries(qc);
      toast.success('Recebimento estornado. A conta voltou para "À Vencer".');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

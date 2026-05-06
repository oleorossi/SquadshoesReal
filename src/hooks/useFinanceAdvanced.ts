import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

// ─── Chart of Accounts ───
export function useChartOfAccounts() {
  return useQuery({
    queryKey: ['chart_of_accounts'],
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('chart_of_accounts')
        .select('*')
        .order('code', { ascending: true });
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateChartAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (account: any) => {
      const { error } = await supabase.from('chart_of_accounts').insert(account);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['chart_of_accounts'] }); toast.success('Conta criada!'); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateChartAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...data }: any) => {
      // Block structural mutations (type, parent_id) when the account has
      // confirmed/posted FEs — re-typing silently re-classifies historical DRE entries.
      if (data.type !== undefined || data.parent_id !== undefined) {
        const { count, error: cntErr } = await supabase
          .from('financial_entries')
          .select('id', { count: 'exact', head: true })
          .eq('account_id', id)
          .in('status', ['posted', 'paid', 'reconciled', 'confirmed']);
        // CRITICAL: capture the count error. Silent failures (RLS / network) made
        // count===null map to 0, letting the structural mutation through and
        // silently re-classifying historical DRE entries.
        if (cntErr) throw new Error(`Falha ao verificar lançamentos vinculados: ${cntErr.message}`);
        if ((count ?? 0) > 0) {
          throw new Error('Conta tem lançamentos confirmados — não é possível alterar tipo ou conta pai. Altere apenas o nome ou descrição.');
        }
      }
      const { error } = await supabase.from('chart_of_accounts').update(data).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['chart_of_accounts'] }); toast.success('Conta atualizada!'); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteChartAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // FK is ON DELETE SET NULL — deletion silently nulls account_id on all linked
      // financial_entries/AR/AP. Block when any posted/confirmed rows reference this account.
      const { count: feCount, error: feErr } = await supabase
        .from('financial_entries')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', id)
        .in('status', ['posted', 'paid', 'reconciled', 'confirmed']);
      // CRITICAL: capture errors. Silent failure → count null → guard bypassed →
      // posted entries lose their account_id (corrupting DRE).
      if (feErr) throw new Error(`Falha ao verificar lançamentos vinculados: ${feErr.message}`);
      if ((feCount ?? 0) > 0) {
        throw new Error('Conta tem lançamentos confirmados vinculados — não é possível excluir. Desative-a em vez disso.');
      }
      const { error } = await supabase.from('chart_of_accounts').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['chart_of_accounts'] }); toast.success('Conta excluída!'); },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ─── Cost Centers ───
export function useCostCenters() {
  return useQuery({
    queryKey: ['cost_centers'],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cost_centers')
        .select('*')
        .order('code', { ascending: true });
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateCostCenter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (cc: any) => {
      const { error } = await supabase.from('cost_centers').insert(cc);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['cost_centers'] }); toast.success('Centro de custo criado!'); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateCostCenter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...data }: any) => {
      const { error } = await supabase.from('cost_centers').update(data).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['cost_centers'] }); toast.success('Centro de custo atualizado!'); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteCostCenter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // Preflight: refuse delete when cost center is referenced by posted/confirmed
      // financial entries. FK is ON DELETE SET NULL by default — silently dropping
      // the cost-center linkage corrupts DRE and rateios. Active labor_costs and
      // overhead_allocations are blocked too.
      const [feRes, lcRes, ohRes, budRes] = await Promise.all([
        supabase.from('financial_entries').select('id', { count: 'exact', head: true })
          .eq('cost_center_id', id).in('status', ['posted', 'paid', 'reconciled', 'confirmed']),
        supabase.from('labor_costs').select('id', { count: 'exact', head: true }).eq('cost_center_id', id),
        supabase.from('overhead_allocations').select('id', { count: 'exact', head: true }).eq('cost_center_id', id),
        supabase.from('budgets').select('id', { count: 'exact', head: true }).eq('cost_center_id', id),
      ]);
      if (feRes.error) throw new Error(`Falha ao verificar lançamentos: ${feRes.error.message}`);
      if (lcRes.error) throw new Error(`Falha ao verificar custos de mão de obra: ${lcRes.error.message}`);
      if (ohRes.error) throw new Error(`Falha ao verificar rateios: ${ohRes.error.message}`);
      if (budRes.error) throw new Error(`Falha ao verificar orçamentos: ${budRes.error.message}`);
      const blockers: string[] = [];
      if ((feRes.count ?? 0) > 0) blockers.push(`${feRes.count} lançamento(s) confirmado(s)`);
      if ((lcRes.count ?? 0) > 0) blockers.push(`${lcRes.count} custo(s) de MOD`);
      if ((ohRes.count ?? 0) > 0) blockers.push(`${ohRes.count} rateio(s)`);
      if ((budRes.count ?? 0) > 0) blockers.push(`${budRes.count} orçamento(s)`);
      if (blockers.length > 0) {
        throw new Error(`Centro de custo vinculado a ${blockers.join(', ')}. Desative-o em vez de excluir.`);
      }
      const { error } = await supabase.from('cost_centers').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['cost_centers'] }); toast.success('Centro de custo excluído!'); },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ─── Bank Accounts ───
export function useBankAccounts() {
  return useQuery({
    queryKey: ['bank_accounts'],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bank_accounts')
        .select('*')
        .order('name', { ascending: true });
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateBankAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ba: any) => {
      const { error } = await supabase.from('bank_accounts').insert(ba);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bank_accounts'] }); toast.success('Conta bancária criada!'); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateBankAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...data }: any) => {
      const { error } = await supabase.from('bank_accounts').update(data).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bank_accounts'] }); toast.success('Conta bancária atualizada!'); },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ─── Financial Entries ───
export function useFinancialEntries(filters?: { period?: string; type?: string; costCenterId?: string }) {
  return useQuery({
    queryKey: ['financial_entries', filters],
    staleTime: 60 * 1000,
    queryFn: async () => {
      let query = supabase
        .from('financial_entries')
        .select('*, chart_of_accounts(name, code), cost_centers(name), bank_accounts(name)')
        .order('entry_date', { ascending: false });
      if (filters?.type && filters.type !== 'all') query = query.eq('type', filters.type);
      if (filters?.costCenterId) query = query.eq('cost_center_id', filters.costCenterId);
      if (!filters?.period) query = query.limit(5000);
      if (filters?.period) {
        const [y, m] = filters.period.split('-').map(Number);
        const lastDay = new Date(y, m, 0).getDate();
        query = query
          .gte('entry_date', `${filters.period}-01`)
          .lte('entry_date', `${filters.period}-${String(lastDay).padStart(2, '0')}`);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateFinancialEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (entry: any) => {
      if (!Number.isFinite(entry?.amount) || entry.amount <= 0) throw new Error('Valor do lançamento deve ser um número positivo.');
      const VALID_TYPES = ['receita', 'despesa', 'transferencia', 'ajuste'];
      if (entry?.type && !VALID_TYPES.includes(entry.type)) throw new Error(`Tipo de lançamento inválido: ${entry.type}`);
      const { error } = await supabase.from('financial_entries').insert(entry);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['financial_entries'] }); toast.success('Lançamento criado!'); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateFinancialEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...data }: any) => {
      const { chart_of_accounts, cost_centers, bank_accounts, ...clean } = data;
      // Same guard as useDeleteFinancialEntry: confirmed entries that mirror a
      // sale_order/PO/OS must not be silently mutated (would corrupt DRE/cashflow).
      // Block all terminal statuses: 'confirmed' (source-doc linked),
      // 'posted'/'paid'/'reconciled' (closed-period / bank-recon entries).
      // cancel-nfe treats these same statuses as immutable; align here.
      const { data: updated, error } = await supabase
        .from('financial_entries')
        .update(clean)
        .eq('id', id)
        .not('status', 'in', '(confirmed,posted,paid,reconciled)')
        .select('id');
      if (error) throw error;
      if (!updated || updated.length === 0) {
        throw new Error('Lançamento confirmado/lançado — cancele a fonte (PV/OS/OC) antes de editar.');
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['financial_entries'] }); toast.success('Lançamento atualizado!'); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteFinancialEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // Block all terminal statuses: confirmed, posted, paid, reconciled.
      // A 0-row result means the entry is in one of those states or doesn't exist.
      const { data: deleted, error } = await supabase
        .from('financial_entries')
        .delete()
        .eq('id', id)
        .not('status', 'in', '(confirmed,posted,paid,reconciled)')
        .select('id');
      if (error) throw error;
      if (!deleted || deleted.length === 0) {
        throw new Error('Lançamento confirmado/lançado — cancele a fonte (PV/OS/OC) antes de excluir.');
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['financial_entries'] }); toast.success('Lançamento excluído!'); },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ─── Labor Costs ───
export function useLaborCosts() {
  return useQuery({
    queryKey: ['labor_costs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('labor_costs')
        .select('*, cost_centers(name)')
        .order('operation_name', { ascending: true });
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateLaborCost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (lc: any) => {
      if (lc?.amount !== undefined && (!Number.isFinite(lc.amount) || lc.amount < 0)) throw new Error('Valor deve ser um número não-negativo.');
      const { error } = await supabase.from('labor_costs').insert(lc);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['labor_costs'] }); toast.success('Custo de mão de obra criado!'); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateLaborCost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...data }: any) => {
      const { cost_centers, ...clean } = data;
      const { error } = await supabase.from('labor_costs').update(clean).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['labor_costs'] }); toast.success('Custo atualizado!'); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteLaborCost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('labor_costs').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['labor_costs'] }); toast.success('Custo excluído!'); },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ─── Overhead Allocations ───
export function useOverheadAllocations(period?: string) {
  return useQuery({
    queryKey: ['overhead_allocations', period],
    queryFn: async () => {
      let query = supabase.from('overhead_allocations').select('*, cost_centers(name)').order('created_at', { ascending: false });
      if (period) query = query.eq('period', period);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateOverhead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (oh: any) => {
      if (oh?.amount !== undefined && (!Number.isFinite(oh.amount) || oh.amount < 0)) throw new Error('Valor deve ser um número não-negativo.');
      const { error } = await supabase.from('overhead_allocations').insert(oh);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['overhead_allocations'] }); toast.success('Rateio criado!'); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteOverhead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('overhead_allocations').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['overhead_allocations'] }); toast.success('Rateio excluído!'); },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ─── Budgets ───
export function useBudgets(period?: string) {
  return useQuery({
    queryKey: ['budgets', period],
    queryFn: async () => {
      let query = supabase.from('budgets').select('*, cost_centers(name), chart_of_accounts(name, code)').order('created_at', { ascending: false });
      if (period) query = query.eq('period', period);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (b: any) => {
      if (b?.amount !== undefined && (!Number.isFinite(b.amount) || b.amount < 0)) throw new Error('Valor deve ser um número não-negativo.');
      const { error } = await supabase.from('budgets').insert(b);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['budgets'] }); toast.success('Orçamento criado!'); },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ─── Production Cost Calculation ───
export function useProductionCosts() {
  return useQuery({
    queryKey: ['production_costs'],
    queryFn: async () => {
      const { data: orders, error } = await supabase
        .from('orders')
        .select('*, technical_sheets(name, code, sale_price)')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return orders;
    },
  });
}

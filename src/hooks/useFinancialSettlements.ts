import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { todayISO } from '@/lib/date';
import { invalidateFinanceDerivedQueries } from '@/lib/financeQueryInvalidation';
import {
  FinancialSettlementCommandRunner,
  type FinancialSettlementIntent,
  type SettlementKind,
} from '@/lib/financialSettlement';

let runner: FinancialSettlementCommandRunner | undefined;
const settlementApi = supabase as unknown as {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
};

function getRunner() {
  if (!runner) {
    runner = new FinancialSettlementCommandRunner(
      window.sessionStorage,
      args => settlementApi.rpc('execute_financial_settlement', args),
    );
  }
  return runner;
}

export interface FinancialSettlementEvent {
  id: string;
  event_type: 'settlement' | 'reversal';
  amount: number;
  effective_on: string;
  method: string;
  bank_account_id: string | null;
  reference: string | null;
  notes: string | null;
  source_type: string;
  reverses_event_id: string | null;
  actor_id: string | null;
  created_at: string;
}

export interface FinancialSettlementHistory {
  head: { opening_amount: number; opening_payment_date: string | null; opening_history_warning: string | null };
  events: FinancialSettlementEvent[];
}

export function useFinancialSettlementHistory(kind: SettlementKind | undefined, accountId: string | undefined) {
  return useQuery({
    queryKey: ['financial-settlement-history', kind, accountId],
    enabled: !!kind && !!accountId,
    queryFn: async (): Promise<FinancialSettlementHistory> => {
      const { data, error } = await settlementApi.rpc('get_financial_settlement_history', { p_kind: kind, p_account_id: accountId });
      if (error) throw error;
      const result = data as FinancialSettlementHistory | null;
      if (!result?.head || !Array.isArray(result.events)) throw new Error('O histórico não foi retornado por completo. Atualize antes de estornar.');
      return result;
    },
  });
}

/** A mesma fila atende baixa, lote e estorno. Não escreve nos acumulados do título. */
export function useFinancialSettlementCommand() {
  const qc = useQueryClient();
  const { user, loading: authLoading } = useAuth();
  const pendingQuery = useQuery({
    queryKey: ['financial-settlement-pending', user?.id],
    enabled: !!user,
    retry: false,
    queryFn: () => getRunner().pending(user!.id),
  });
  const mutation = useMutation({
    retry: false,
    mutationFn: async (intent: FinancialSettlementIntent | null) => {
      const { data, error } = await supabase.auth.getUser();
      if (error) throw error;
      if (!data.user || data.user.id !== user?.id) throw new Error('A sessão mudou. Atualize a página antes de registrar o movimento.');
      return getRunner().execute(data.user.id, intent, todayISO());
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts_payable'] });
      qc.invalidateQueries({ queryKey: ['accounts_receivable'] });
      qc.invalidateQueries({ queryKey: ['financial-settlement-history'] });
      qc.invalidateQueries({ queryKey: ['financial-cash-events'] });
      qc.invalidateQueries({ queryKey: ['bank-reconciliation'] });
      qc.invalidateQueries({ queryKey: ['sale-order-cmv'] });
      invalidateFinanceDerivedQueries(qc);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['financial-settlement-pending'] });
    },
  });

  return {
    ...mutation,
    pendingCommand: pendingQuery.data ?? null,
    pendingError: pendingQuery.error,
    loadingPending: authLoading || (!!user && pendingQuery.isPending),
    refetchPending: pendingQuery.refetch,
  };
}

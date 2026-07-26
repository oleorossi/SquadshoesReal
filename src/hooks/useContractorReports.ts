import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface ContractorMetric {
  contractor_id: string;
  contractor_name: string;
  service_type: string | null;
  active: boolean;
  total_orders: number;
  completed_orders: number;
  cancelled_orders: number;
  open_orders: number;
  on_time_count: number;
  late_count: number;
  open_overdue_count: number;
  avg_late_days: number;
  total_value_all: number;
  /** ⚠ Desde 2026-07-26 é DINHEIRO EFETIVAMENTE PAGO (accounts_payable quitadas).
   *  Antes somava OS concluídas — OS entregue e não paga contava como paga. */
  total_value_paid: number;
  total_value_open: number;
  total_quantity: number;
  last_order_at: string | null;
  /** Significado ANTIGO de total_value_paid: soma das OS concluídas (produção). */
  total_value_completed: number;
  /** Contas a pagar em aberto (o que ainda se deve ao prestador). */
  total_value_unpaid: number;
}

/** Estado de pagamento de uma OS — espelha o CASE da view v_contractor_os_financials. */
export type OsPaymentState =
  | 'paid'           // todas as contas a pagar da OS quitadas
  | 'partially_paid' // parte quitada — OS dispatch_tracked paga por RETORNO, gerando N contas
  | 'unpaid'         // há conta(s), nenhuma quitada
  | 'not_billed'     // OS ainda aberta, sem conta (normal: a conta nasce na finalização)
  | 'missing_ap';    // OS finalizada SEM conta a pagar (anomalia)

export interface OsFinancialRow {
  os_id: string;
  order_number: string | null;
  contractor_id: string | null;
  contractor_name: string;
  service_type: string | null;
  sector: string;
  description: string | null;
  is_avulsa: boolean;
  os_status: string;
  quantity: number;
  total_value: number | null;
  /** Quantas contas a pagar a OS tem (as dispatch_tracked geram uma por retorno). */
  ap_count: number;
  payment_method: string | null;
  amount_due: number | null;
  amount_paid_effective: number | null;
  service_date: string | null;
  due_date: string | null;
  payment_date: string | null;
  finished_at: string | null;
  payment_state: OsPaymentState;
  is_overdue: boolean;
  days_overdue: number;
}

/** Eixo de data pelo qual o período é filtrado (escolhido na tela). */
export type OsDateField = 'due' | 'service' | 'payment';

const DATE_COLUMN: Record<OsDateField, string> = {
  due: 'due_date',
  service: 'service_date',
  payment: 'payment_date',
};

export interface ContractorHistoryOrder {
  id: string;
  contractor_id: string;
  contractor_name: string;
  order_number: string | null;
  receipt_number: string | null;
  description: string | null;
  sector: string;
  service_date: string | null;
  quoted_deadline: string | null;
  finished_at: string | null;
  quantity: number;
  unit_price: number | null;
  total_value: number | null;
  status: string;
  punctuality: 'on_time' | 'late' | 'no_deadline';
  days_late: number;
  is_artisanal: boolean;
  materials_sent: Array<{ material: string; color: string; meters: number }>;
  signed_photo_url: string | null;
  created_at: string;
}

export function useContractorMetrics() {
  return useQuery({
    queryKey: ['v_contractor_metrics'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('v_contractor_metrics')
        .select('*')
        .order('total_value_all', { ascending: false });
      if (error) throw error;
      return (data || []) as ContractorMetric[];
    },
    staleTime: 60_000,
  });
}

export function useContractorHistory(filters?: {
  contractor_id?: string | null;
  period_start?: string | null;
  period_end?: string | null;
}) {
  return useQuery({
    queryKey: ['v_contractor_history_orders', filters?.contractor_id ?? '__all__', filters?.period_start ?? '', filters?.period_end ?? ''],
    queryFn: async () => {
      let q = (supabase as any)
        .from('v_contractor_history_orders')
        .select('*')
        .order('finished_at', { ascending: false });
      if (filters?.contractor_id) q = q.eq('contractor_id', filters.contractor_id);
      if (filters?.period_start) q = q.gte('finished_at', filters.period_start);
      if (filters?.period_end) q = q.lte('finished_at', filters.period_end + 'T23:59:59');
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as ContractorHistoryOrder[];
    },
    staleTime: 60_000,
  });
}

/**
 * Relatório financeiro de OS por prestador — pagas × não pagas.
 *
 * Lê `v_contractor_os_financials`, onde o estado de pagamento vem de
 * `accounts_payable` (a fonte de verdade do dinheiro), e não do status da OS.
 * O período é filtrado pelo eixo de data escolhido na tela (`date_field`),
 * por isso a view expõe as três datas como colunas.
 *
 * ⚠ Filtrar por 'payment' (data de pagamento) naturalmente exclui as não pagas —
 * elas não têm data de pagamento. A tela avisa o usuário quando isso acontece.
 */
export function useContractorOsFinancials(filters?: {
  contractor_id?: string | null;
  date_field?: OsDateField;
  period_start?: string | null;
  period_end?: string | null;
  payment_state?: 'all' | OsPaymentState | 'overdue';
}) {
  const dateField = filters?.date_field ?? 'service';
  const state = filters?.payment_state ?? 'all';
  return useQuery({
    queryKey: [
      'v_contractor_os_financials',
      filters?.contractor_id ?? '__all__',
      dateField,
      filters?.period_start ?? '',
      filters?.period_end ?? '',
      state,
    ],
    queryFn: async () => {
      const col = DATE_COLUMN[dateField];
      let q = (supabase as any)
        .from('v_contractor_os_financials')
        .select('*')
        .order(col, { ascending: false, nullsFirst: false });
      if (filters?.contractor_id) q = q.eq('contractor_id', filters.contractor_id);
      if (filters?.period_start) q = q.gte(col, filters.period_start);
      if (filters?.period_end) q = q.lte(col, filters.period_end);
      if (state === 'overdue') q = q.eq('is_overdue', true);
      else if (state !== 'all') q = q.eq('payment_state', state);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as OsFinancialRow[];
    },
    staleTime: 60_000,
  });
}

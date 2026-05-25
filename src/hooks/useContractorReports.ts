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
  total_value_paid: number;
  total_value_open: number;
  total_quantity: number;
  last_order_at: string | null;
}

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

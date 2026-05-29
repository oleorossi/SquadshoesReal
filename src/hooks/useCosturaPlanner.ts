import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface CosturaCapacityDay {
  day: string;
  dow: number;
  is_weekend: boolean;
  sum_pairs_internal: number;
  sum_pairs_outsourced: number;
  capacity_total: number;
  overflow_pairs: number;
  occupation_pct: number;
  status: 'ok' | 'warning' | 'overflow' | 'weekend';
}

export interface CosturaBacklogRow {
  order_id: string;
  sale_order_id: string | null;
  sale_order_number: string | null;
  sale_order_deadline: string | null;
  reference_id: string;
  color: string | null;
  quantity: number;
  wave_id: string | null;
  needed_date: string;
  material_ready: boolean;
  in_service_order: boolean;
}

export interface DispatchContributingOrder {
  order_id: string;
  order_number: string | null;
  sale_order_id: string | null;
  sale_order_number: string | null;
  sale_order_deadline: string | null;
  reference_id: string;
  sheet_name: string | null;
  color: string | null;
  quantity: number;
  needed_date: string;
  planned_delivery: string | null;
  material_ready: boolean;
  pairs_per_day: number | null;
}

export interface DispatchOverflowDay {
  day: string;
  week_iso: string;
  overflow_pairs: number;
  covered_pairs: number;
  contributing_orders: DispatchContributingOrder[];
}

export interface DispatchPlan {
  horizon_days: number;
  computed_at: string;
  overflow_days: DispatchOverflowDay[];
}

export function useCosturaCapacityPlan() {
  return useQuery({
    queryKey: ['costura_capacity_plan'],
    queryFn: async (): Promise<CosturaCapacityDay[]> => {
      const { data, error } = await (supabase as any)
        .from('v_costura_capacity_plan')
        .select('*')
        .order('day');
      if (error) throw error;
      return data || [];
    },
    staleTime: 60 * 1000,
  });
}

export function useCosturaBacklog() {
  return useQuery({
    queryKey: ['costura_backlog_30d'],
    queryFn: async (): Promise<CosturaBacklogRow[]> => {
      const { data, error } = await (supabase as any)
        .from('v_costura_backlog_30d')
        .select('*')
        .order('needed_date');
      if (error) throw error;
      return data || [];
    },
    staleTime: 60 * 1000,
  });
}

export function useCosturaDispatchPlan(horizonDays: number = 30) {
  return useQuery({
    queryKey: ['costura_dispatch_plan', horizonDays],
    queryFn: async (): Promise<DispatchPlan | null> => {
      const { data, error } = await (supabase as any).rpc('plan_costura_dispatch', {
        p_horizon_days: horizonDays,
      });
      if (error) throw error;
      return data as DispatchPlan;
    },
    staleTime: 60 * 1000,
  });
}

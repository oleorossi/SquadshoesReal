import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface DemandForecastRow {
  reference_id: string;
  color: string;
  reference_name: string;
  avg_last_3_months: number;
  sum_last_3_months: number;
  last_month_sales: number;
  prev_month_sales: number;
  months_with_sales: number;
  momentum_factor: number;
  projected_next_month: number;
  confidence: 'high' | 'medium' | 'low' | 'none';
}

export interface DemandHistoryRow {
  month: string;
  reference_id: string;
  color: string;
  reference_name: string;
  pairs_sold: number;
  orders_count: number;
}

export function useDemandForecast() {
  return useQuery({
    queryKey: ['v_demand_forecast'],
    queryFn: async (): Promise<DemandForecastRow[]> => {
      const { data, error } = await (supabase as any)
        .from('v_demand_forecast')
        .select('*')
        .limit(500);
      if (error) throw error;
      return data || [];
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useDemandHistory() {
  return useQuery({
    queryKey: ['v_demand_history_monthly'],
    queryFn: async (): Promise<DemandHistoryRow[]> => {
      const { data, error } = await (supabase as any)
        .from('v_demand_history_monthly')
        .select('*')
        .limit(2000);
      if (error) throw error;
      return data || [];
    },
    staleTime: 5 * 60 * 1000,
  });
}

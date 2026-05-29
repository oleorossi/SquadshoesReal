import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface MissingMaterial {
  product_id: string;
  product_name: string;
  color: string | null;
  needed_qty: number;
  stock_qty: number;
  shortage: number;
  supplier_name: string | null;
  supplier_lead_time_days: number | null;
  unit: string | null;
}

export interface PvDeadlineSuggestion {
  suggested_date: string | null;
  sale_order_total_pairs: number;
  capacity_per_day: number;
  current_costura_load_30d: number;
  overflow_days_30d: number;
  missing_materials_count: number;
  missing_materials: MissingMaterial[];
  warnings: string[];
  computed_at: string;
}

export function useSuggestPvDeadline(saleOrderId: string | null | undefined) {
  return useQuery({
    queryKey: ['suggest_pv_deadline', saleOrderId],
    enabled: !!saleOrderId,
    queryFn: async (): Promise<PvDeadlineSuggestion | null> => {
      if (!saleOrderId) return null;
      const { data, error } = await (supabase as any).rpc('suggest_pv_deadline', {
        p_sale_order_id: saleOrderId,
      });
      if (error) throw error;
      return data as PvDeadlineSuggestion;
    },
    staleTime: 60 * 1000,
  });
}

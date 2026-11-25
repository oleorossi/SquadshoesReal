import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { PurchaseOrderMotorPriority } from '@/lib/purchaseOrderMotorPriority';

/** Leitura da prioridade do motor (tabela só-leitura para o app). */
export function usePurchaseOrderMotorPriority() {
  return useQuery({
    queryKey: ['purchase-order-motor-priority'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('purchase_order_motor_priority' as never)
        .select('purchase_order_id, motor_rank, urgency, material_need_date, purchase_by_date, send_to_contractor_date, lead_days, billing_anchor, is_urgent_pv, purchase_week, week_cumulative_brl, over_weekly_cap, reason');
      if (error) throw error;
      const rows = (data ?? []) as unknown as PurchaseOrderMotorPriority[];
      return new Map(rows.map((r) => [r.purchase_order_id, r]));
    },
    staleTime: 30_000,
  });
}

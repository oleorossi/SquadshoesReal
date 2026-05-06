// Serviço de custos do pedido (Patch 4)
import { supabase } from "@/integrations/supabase/client";

export interface OrderCostResult {
  material_cost: number;
  labor_cost: number;
  overhead_cost: number;
  packaging_cost: number;
  total_cost: number;
  revenue: number;
  margin: number;
  margin_pct: number;
  breakdown: {
    materials: Array<{
      product_id: string;
      product_name: string;
      component: string;
      required: number;
      unit_price: number;
      subtotal: number;
    }>;
    labor: Array<{
      operation: string;
      hour_cost: number;
      minutes_per_unit: number;
      subtotal: number;
    }>;
    overhead_pct: number;
    packaging_per_pair: number;
  };
}

export async function calculateOrderCost(
  saleOrderId: string,
  saleOrderItemId?: string,
  persist = true,
): Promise<OrderCostResult> {
  const { data, error } = await supabase.rpc("calculate_order_cost" as any, {
    p_sale_order_id: saleOrderId,
    p_sale_order_item_id: saleOrderItemId ?? null,
    p_persist: persist,
  });
  if (error) throw error;
  return data as unknown as OrderCostResult;
}

export async function listProfitability(limit = 100) {
  const { data, error } = await supabase
    .from("v_order_profitability" as any)
    .select("*")
    .order("last_calculated_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

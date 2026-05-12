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
      /** Quantidade convertida pra unidade do produto. Pode estar ausente se SQL
       *  retornou NULL por unit mismatch (linha pulada com conversion_warning). */
      required_in_product_unit?: number;
      consumption_unit?: string;
      product_unit?: string;
      unit_price: number;
      subtotal: number;
      /** B3: marcado pelo SQL quando convert_to_product_unit retornou NULL
       *  por unidades incompatíveis (ex: kg → un). UI pode renderizar alerta. */
      conversion_warning?: string;
    }>;
    labor: Array<{
      operation: string;
      hour_cost: number;
      minutes_per_unit: number;
      subtotal: number;
    }>;
    /** B6: campo emitido pelo SQL desde Round 11. Antes a interface declarava
     *  overhead_pct (que não existia) e omitia este. */
    overhead_per_pair: number;
    packaging_per_pair: number;
    used_grade: boolean;
  };
  /** Quando p_sale_order_item_id=NULL e p_sale_order_id dado, o SQL retorna
   *  agregado com array de itens. Presença indica modo PV inteiro. */
  items?: OrderCostResult[];
  item_count?: number;
  total_quantity?: number;
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

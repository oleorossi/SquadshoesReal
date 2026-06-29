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
      /** Linha de SUCESSO: já escalada pelo `qty_multiplier` (= total da OP, na
       *  unidade do produto). Linha de unit_mismatch: valor CRU sem converter
       *  (na unidade de consumo), apenas pra exibição — `subtotal` vem 0. */
      required: number;
      /** Linha de sucesso: `required` por dúzia/grade base, antes de escalar pelo
       *  `qty_multiplier`. Renomeado de `required_in_product_unit` na auditoria do
       *  double-scaling (snapshot). Ausente na linha de unit_mismatch. */
      required_per_grade?: number;
      /** Multiplicador qty_real ÷ soma_grade (ou qty ÷ snapshot.quantity) aplicado
       *  a esta linha. Snapshot já vem escalado → ≈ 1. */
      qty_multiplier?: number;
      consumption_unit?: string;
      product_unit?: string;
      unit_price: number;
      subtotal: number;
      /** Marcado pelo SQL ('unit_mismatch') quando convert_to_product_unit
       *  retornou NULL por unidades incompatíveis (ex: kg → un) e o fallback A4
       *  (dm²→física pela largura da ficha) também não resolveu. Custo NÃO somado
       *  (subtotal=0); UI deve alertar erro de cadastro. */
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
    /** Multiplicador qty/grade aplicado ao item (espelha breakdown.materials[].qty_multiplier). */
    qty_multiplier?: number;
    /** 'snapshot' quando o consumo veio de technical_sheet_snapshots (custo
     *  congelado), 'computed' quando recalculado da ficha viva. */
    consumption_source?: string;
    used_grade: boolean;
  };
  /** Avisos do SQL na granularidade do item: 'no_active_cost_policy' (overhead/
   *  embalagem zerados), 'unit_mismatch:<produto>' (linha não convertida),
   *  'strap_color_not_registered:<cor>'. Vazio no caminho agregado de PV. */
  warnings?: string[];
  /** Soma da grade base do item (tipicamente ~12); 0 quando sem grade. */
  grade_sum?: number;
  /** qty_real ÷ grade_sum (ou qty ÷ snapshot.quantity). */
  qty_multiplier?: number;
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

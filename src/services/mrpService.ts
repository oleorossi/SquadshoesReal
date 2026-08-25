// Serviço de MRP (Patch 5)
import { supabase } from "@/integrations/supabase/client";
import { generatePurchaseOrdersFromMrpCommand } from "@/services/purchaseOrderCommandService";

export interface MrpNeed {
  product_id: string;
  product_name: string;
  sku: string;
  category: string;
  unit: string;
  unit_price: number;
  purchase_unit: string | null;
  purchase_order_unit: string | null;
  conversion_rate: number;
  min_order_quantity: number;
  lead_time_days: number;
  preferred_supplier_id: string | null;
  supplier_name: string | null;
  min_stock: number;
  on_hand: number;
  reserved: number;
  available_now: number;
  qty_in_po: number;
  projected_demand: number;
  earliest_deadline: string | null;
  orders_count: number | null;
  suggested_qty: number;
  order_by_date: string | null;
  /** true quando a linha é uma caixa (box_types), não um produto de estoque. A
   *  compra de embalagem é feita no módulo /embalagens — o MRP só mostra a
   *  necessidade; "Gerar OC" não gera PO pra estas linhas. */
  is_packaging?: boolean;
  /** true quando o produto é ARTESANAL (tira produzida internamente via OS a
   *  partir da base napa). O MRP só mostra a necessidade; a reposição correta é
   *  Ordem de Serviço (branch artesanal do trigger de estoque-mínimo) —
   *  generate_purchase_orders_from_mrp e o cron ROP pulam estas linhas (F3-2). */
  is_artisanal?: boolean;
}

export async function listMrpNeeds(): Promise<MrpNeed[]> {
  const { data, error } = await supabase
    .from("v_mrp_needs" as any)
    .select("*")
    .order("order_by_date", { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as unknown as MrpNeed[];
}

export async function generatePurchaseOrdersFromMrp(
  productIds?: string[],
): Promise<string[]> {
  const result = await generatePurchaseOrdersFromMrpCommand(productIds);
  return result.purchase_order_ids ?? [];
}

// Serviço de MRP (Patch 5)
import { supabase } from "@/integrations/supabase/client";

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
  const { data, error } = await supabase.rpc(
    "generate_purchase_orders_from_mrp" as any,
    { p_product_ids: productIds ?? null },
  );
  if (error) throw error;
  return (data ?? []) as string[];
}

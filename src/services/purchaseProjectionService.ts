import { supabase } from '@/integrations/supabase/client';

export type AbcClass = 'A' | 'B' | 'C';
export type Recommendation =
  | 'CRITICO_REPOR'
  | 'REPOR'
  | 'OK'
  | 'ESTOQUE_ALTO'
  | 'INATIVO';

export interface PurchaseProjectionRow {
  product_id: string;
  product_name: string;
  product_category: string | null;
  color: string;
  unit: string;
  is_artisanal: boolean;
  current_stock: number;
  reserved_stock: number;
  available_stock: number;
  total_purchased_qty: number;
  total_purchased_value: number;
  purchase_count: number;
  last_purchase_date: string | null;
  avg_unit_price: number | null;
  consumed_qty: number;
  avg_daily_consumption: number;
  days_of_cover: number | null;
  supplier_id: string | null;
  supplier_name: string | null;
  supplier_lead_time_days: number;
  abc_class: AbcClass;
  abc_cum_share: number | null;
  suggested_min_stock: number;
  suggested_reorder_qty: number;
  recommendation: Recommendation;
}

export interface PurchaseProjectionSummary {
  total_active_products: number;
  total_purchase_value: number;
  abc_a_count: number;
  abc_b_count: number;
  abc_c_count: number;
  critical_reorder_count: number;
  reorder_count: number;
  high_stock_count: number;
  inactive_count: number;
  ok_count: number;
  total_reorder_value: number;
  top_5_categories: Array<{ category: string; value: number; items: number }>;
  top_10_colors: Array<{ color: string; qty: number; items: number }>;
}

export async function getPurchaseProjection(days: number = 30): Promise<PurchaseProjectionRow[]> {
  const { data, error } = await supabase.rpc('get_purchase_projection' as any, { p_days: days });
  if (error) throw error;
  return ((data as any[]) ?? []).map((r) => ({
    ...r,
    current_stock: Number(r.current_stock ?? 0),
    reserved_stock: Number(r.reserved_stock ?? 0),
    available_stock: Number(r.available_stock ?? 0),
    total_purchased_qty: Number(r.total_purchased_qty ?? 0),
    total_purchased_value: Number(r.total_purchased_value ?? 0),
    purchase_count: Number(r.purchase_count ?? 0),
    avg_unit_price: r.avg_unit_price != null ? Number(r.avg_unit_price) : null,
    consumed_qty: Number(r.consumed_qty ?? 0),
    avg_daily_consumption: Number(r.avg_daily_consumption ?? 0),
    days_of_cover: r.days_of_cover != null ? Number(r.days_of_cover) : null,
    supplier_lead_time_days: Number(r.supplier_lead_time_days ?? 7),
    abc_cum_share: r.abc_cum_share != null ? Number(r.abc_cum_share) : null,
    suggested_min_stock: Number(r.suggested_min_stock ?? 0),
    suggested_reorder_qty: Number(r.suggested_reorder_qty ?? 0),
  })) as PurchaseProjectionRow[];
}

export async function getPurchaseProjectionSummary(days: number = 30): Promise<PurchaseProjectionSummary | null> {
  const { data, error } = await supabase.rpc('get_purchase_projection_summary' as any, { p_days: days });
  if (error) throw error;
  const row = (data as any[])?.[0];
  if (!row) return null;
  return {
    total_active_products: Number(row.total_active_products ?? 0),
    total_purchase_value: Number(row.total_purchase_value ?? 0),
    abc_a_count: Number(row.abc_a_count ?? 0),
    abc_b_count: Number(row.abc_b_count ?? 0),
    abc_c_count: Number(row.abc_c_count ?? 0),
    critical_reorder_count: Number(row.critical_reorder_count ?? 0),
    reorder_count: Number(row.reorder_count ?? 0),
    high_stock_count: Number(row.high_stock_count ?? 0),
    inactive_count: Number(row.inactive_count ?? 0),
    ok_count: Number(row.ok_count ?? 0),
    total_reorder_value: Number(row.total_reorder_value ?? 0),
    top_5_categories: (row.top_5_categories ?? []).map((c: any) => ({
      category: c.category, value: Number(c.value ?? 0), items: Number(c.items ?? 0),
    })),
    top_10_colors: (row.top_10_colors ?? []).map((c: any) => ({
      color: c.color, qty: Number(c.qty ?? 0), items: Number(c.items ?? 0),
    })),
  };
}

export const RECOMMENDATION_LABEL: Record<Recommendation, string> = {
  CRITICO_REPOR: 'Crítico — Repor já',
  REPOR:         'Repor em breve',
  OK:            'OK',
  ESTOQUE_ALTO:  'Estoque alto',
  INATIVO:       'Sem consumo',
};

export const RECOMMENDATION_CLASS: Record<Recommendation, string> = {
  CRITICO_REPOR: 'bg-red-500/10 text-red-700 border-red-500/30',
  REPOR:         'bg-amber-500/10 text-amber-700 border-amber-500/30',
  OK:            'bg-green-500/10 text-green-700 border-green-500/30',
  ESTOQUE_ALTO:  'bg-blue-500/10 text-blue-700 border-blue-500/30',
  INATIVO:       'bg-muted text-muted-foreground border-border',
};

export const ABC_CLASS_BG: Record<AbcClass, string> = {
  A: 'bg-primary text-primary-foreground',
  B: 'bg-secondary text-secondary-foreground',
  C: 'bg-muted text-muted-foreground',
};

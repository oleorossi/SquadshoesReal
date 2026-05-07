export interface SoleProduct {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  color: string | null;
  quantity: number;
  unit: string;
  min_stock: number;
  stock_grade: Record<string, any> | null;
  group_id: string | null;
  active: boolean;
}

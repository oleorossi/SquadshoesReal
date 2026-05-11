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
  /** Tipo do solado — controla quais seções de UI aparecem
   *  (Conjugações só pra 'conjugado'; coligação cor só pra 'palmilha_pronta') */
  sole_classification?: 'tradicional' | 'palmilha_pronta' | 'conjugado' | null;
}

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
  /** Fornecedor cadastrado (compras + lead time entram no cronograma reverso). */
  supplier_id?: string | null;
  /** Lead time do fornecedor em dias — usado pelo MRP/cronograma pra calcular
   *  data-limite de compra. */
  lead_time_days?: number | null;
  /** Grupo de material usado como fachete (quando is_fachetado=true). NULL = usa
   *  lining_material da ficha técnica (legacy). */
  fachete_material_group_id?: string | null;
  /** Toggle de salto fachetado. */
  is_fachetado?: boolean | null;
}

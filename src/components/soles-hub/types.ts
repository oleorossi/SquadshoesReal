export interface SoleProduct {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  color: string | null;
  quantity: number;
  unit: string;
  /** Custo de compra por par desta variante; alimenta estoque e custeio. */
  unit_price: number;
  min_stock: number;
  stock_grade: Record<string, any> | null;
  group_id: string | null;
  active: boolean;
  /** Tipo do solado — controla quais seções de UI aparecem
   *  (Conjugações só pra 'conjugado'; coligação cor só pra 'palmilha_pronta') */
  sole_classification?: 'tradicional' | 'palmilha_pronta' | 'conjugado' | null;
  /** Fornecedor cadastrado (compras + lead time entram no cronograma reverso). */
  supplier_id?: string | null;
  /** Lead time legado do produto (fallback sem wave). */
  lead_time_days?: number | null;
  /** Lead time canônico do fornecedor/material usado pelos motores de compra. */
  supplier_lead_time_days?: number | null;
  /** Quantidade mínima de compra exigida pelo fornecedor, em pares. */
  sole_moq?: number | null;
  /** Composto/material do solado (PVC, TR, PU, EVA, borracha...). */
  sole_material?: string | null;
  /** Altura nominal do salto em milímetros. */
  heel_height?: number | null;
  /** Acabamento, fôrma, aplicação e observações de engenharia. */
  sole_technical_notes?: string | null;
  /** Grupo de material usado como fachete (quando is_fachetado=true). NULL = usa
   *  lining_material da ficha técnica (legacy). */
  fachete_material_group_id?: string | null;
  /** Toggle de salto fachetado. */
  is_fachetado?: boolean | null;
  is_standard_sole_item?: boolean | null;
  insole_mode?: 'cortar' | 'pronta_na_cor' | null;
}

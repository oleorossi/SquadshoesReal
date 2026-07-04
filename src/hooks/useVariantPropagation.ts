/**
 * Fonte ÚNICA da propagação de campos entre variantes de cor de um produto.
 *
 * Variantes = linhas de `products` que compartilham `group_id` + nome-base e
 * diferem só na cor. Ao editar uma, alguns campos (preço, unidade, dimensões,
 * conversão…) normalmente valem pra TODAS as irmãs. Antes essa lista + o diff
 * viviam soltos no `ProductFormDialog`; aqui viram a fonte compartilhada
 * (o `MasterVariantDialog` usa um mecanismo próprio de overwrite total e não
 * redefine esta lista).
 */
import { supabase } from '@/integrations/supabase/client';
import type { Product } from '@/types/inventory';

/** Campos que, ao mudar numa variante, podem ser propagados às irmãs de cor. */
export const PROPAGABLE_FIELDS = [
  'unit_price', 'price_wholesale', 'price_retail',
  'unit', 'consumption_unit',
  'location',
  'dimensions_length', 'dimensions_width', 'dimensions_thickness', 'dimensions_unit',
  'yield_per_meter', 'yield_unit',
  'technical_name', 'category',
  'supplier_lead_time_days', 'lead_time_days',
  'min_stock',
  'supplier_id',
  'purchase_unit', 'production_unit', 'conversion_rate',
  'purchase_order_unit', 'min_order_quantity', 'purchase_multiple',
  'safety_stock',
  'calculation_method',
  'is_chemical',
] as const;

export type PropagableField = (typeof PROPAGABLE_FIELDS)[number];

export const PROPAGABLE_LABELS: Record<string, string> = {
  unit_price: 'Preço unitário',
  price_wholesale: 'Preço atacado',
  price_retail: 'Preço varejo',
  unit: 'Unidade',
  consumption_unit: 'Unidade de consumo',
  location: 'Localização',
  dimensions_length: 'Comprimento',
  dimensions_width: 'Largura',
  dimensions_thickness: 'Espessura',
  dimensions_unit: 'Unidade dimensional',
  yield_per_meter: 'Rendimento',
  yield_unit: 'Unidade de rendimento',
  technical_name: 'Nome técnico',
  category: 'Categoria',
  supplier_lead_time_days: 'Lead time fornecedor',
  lead_time_days: 'Lead time',
  min_stock: 'Estoque mínimo',
  supplier_id: 'Fornecedor',
  purchase_unit: 'Unidade de compra',
  production_unit: 'Unidade de produção',
  conversion_rate: 'Taxa de conversão',
  purchase_order_unit: 'Unidade de ordem de compra',
  min_order_quantity: 'Quantidade mínima',
  purchase_multiple: 'Múltiplo de compra',
  safety_stock: 'Estoque de segurança',
  calculation_method: 'Método de cálculo',
  is_chemical: 'Material químico',
};

/**
 * Diff dos campos propagáveis entre o produto original e o form editado.
 * Compara numéricos por valor e o resto por string, ignorando null/undefined.
 */
export function computePropagableDiff(
  original: Product,
  next: Record<string, any>,
): Record<string, any> {
  const diff: Record<string, any> = {};
  for (const f of PROPAGABLE_FIELDS) {
    const a = (original as any)[f];
    const b = (next as any)[f];
    const aN = a == null ? null : a;
    const bN = b == null ? null : b;
    if (typeof aN === 'number' || typeof bN === 'number') {
      if (Number(aN || 0) !== Number(bN || 0)) diff[f] = bN;
    } else if (String(aN ?? '') !== String(bN ?? '')) {
      diff[f] = bN;
    }
  }
  return diff;
}

/** Aplica um diff propagável a um conjunto de variantes irmãs (por id). */
export async function propagateToSiblings(
  diff: Record<string, any>,
  siblingIds: string[],
): Promise<void> {
  if (siblingIds.length === 0 || Object.keys(diff).length === 0) return;
  const { error } = await supabase.from('products').update(diff).in('id', siblingIds);
  if (error) throw error;
}

/** Hook fino — expõe a fonte única pra componentes de edição de variante. */
export function useVariantPropagation() {
  return { PROPAGABLE_FIELDS, PROPAGABLE_LABELS, computePropagableDiff, propagateToSiblings };
}

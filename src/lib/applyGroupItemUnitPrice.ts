import { supabase } from '@/integrations/supabase/client';

/**
 * Aplica unidade de estoque e/ou custo unitário a todos os itens de um grupo.
 *
 * Espelha o contrato da aba Em massa (`VariantBulkEditPanel`):
 * - `unit` também grava `consumption_unit` (estoque = consumo);
 * - quando a unidade de compra do item já é a nova unidade, trava `conversion_rate = 1`.
 *
 * Usado pela aba Geral do `GroupEditDialog` para unificar o ajuste rápido
 * (unidade + valor) com o padrão de confirmação "aplicar a todos os itens".
 */
export async function applyUnitAndPriceToGroupItems(opts: {
  productIds: string[];
  unit?: string | null;
  unitPrice?: number | null;
}): Promise<{ count: number }> {
  const { productIds, unit, unitPrice } = opts;
  if (productIds.length === 0) return { count: 0 };

  const payload: Record<string, string | number> = {};
  if (unit) {
    payload.unit = unit;
    payload.consumption_unit = unit;
  }
  if (unitPrice != null && Number.isFinite(unitPrice)) {
    payload.unit_price = unitPrice;
  }
  if (Object.keys(payload).length === 0) return { count: 0 };

  const { error } = await supabase
    .from('products')
    .update(payload)
    .in('id', productIds);
  if (error) throw new Error(error.message);

  // Compra == estoque ⇒ fator 1 (invariante canônica). Só toca quem já compra
  // na unidade nova — não inventa purchase_unit.
  if (unit) {
    const { error: convError } = await supabase
      .from('products')
      .update({ conversion_rate: 1 })
      .in('id', productIds)
      .eq('purchase_unit', unit);
    if (convError) throw new Error(convError.message);
  }

  return { count: productIds.length };
}

/** Valor homogêneo entre itens; `null` quando divergente ou lista vazia. */
export function commonProductField<T>(
  products: Array<Record<string, unknown>>,
  field: string,
  coerce: (raw: unknown) => T,
): T | null {
  if (products.length === 0) return null;
  const values = products.map((p) => coerce(p[field]));
  const first = values[0];
  return values.every((v) => Object.is(v, first)) ? first : null;
}

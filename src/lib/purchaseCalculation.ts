// `calcularOrdemCompra` foi REMOVIDO em 2026-07-08 (avaliação dos motores): era
// código morto (nenhum call site) e, se reativado, NÃO aplicava
// `purchase_multiple` — subarredondaria embalagens. Os caminhos VIVOS de cálculo
// de compra são `v_mrp_needs` (MRP), `materialAutoPO.ts`, `buildPerPvPurchaseOrders`
// (per-PV) e o helper `roundUpToPurchaseMultiple`.

interface SupplierShipping {
  min_free_shipping?: number | null;
  standard_shipping_cost?: number | null;
}

interface ProOrderResult {
  subtotal: number;
  shipping: number;
  total: number;
  alert: string;
}

/**
 * Generate purchase order totals with shipping logic.
 */
export function generateProOrder(
  items: { qty: number; price: number }[],
  supplier: SupplierShipping
): ProOrderResult {
  const subtotal = items.reduce((sum, i) => sum + i.qty * i.price, 0);
  const minFree = supplier.min_free_shipping ?? Infinity;
  const isFreeShipping = subtotal >= minFree;

  const alert =
    !isFreeShipping && supplier.min_free_shipping
      ? `Atenção: Faltam R$ ${(minFree - subtotal).toFixed(2)} para FRETE GRÁTIS.`
      : 'Condição de Frete: OK';

  const shipping = isFreeShipping ? 0 : (supplier.standard_shipping_cost || 0);

  return {
    subtotal,
    shipping,
    total: subtotal + shipping,
    alert,
  };
}

/**
 * Create installment schedule from a payment condition string like "30/60/90".
 */
export function createInstallments(total: number, condition = '30/60/90') {
  const parts = condition.split('/').map(Number).filter(n => !isNaN(n) && n > 0);
  if (parts.length === 0) return [{ vencimento: new Date(), valor: total }];
  
  const baseValue = Math.round((total / parts.length) * 100) / 100;
  const totalRounded = baseValue * parts.length;
  const remainder = Math.round((total - totalRounded) * 100) / 100;

  return parts.map((days, index) => ({
    vencimento: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
    valor: index === parts.length - 1 ? baseValue + remainder : baseValue,
  }));
}

/**
 * Analyze if the order is close to qualifying for free shipping
 * and suggest completing the order if within 20% threshold.
 */
export function analyzePurchaseForFreeShipping(
  orderItems: { qty: number; price: number }[],
  supplier: SupplierShipping
): { shouldAlert: boolean; missingValue?: number; message: string } | null {
  const totalOrderValue = orderItems.reduce((acc, item) => acc + item.qty * item.price, 0);

  if (!supplier.min_free_shipping) return null;

  if (totalOrderValue >= supplier.min_free_shipping) {
    return { shouldAlert: false, message: 'Pedido com Frete Grátis!' };
  }

  const diff = supplier.min_free_shipping - totalOrderValue;
  const threshold = supplier.min_free_shipping * 0.2;

  if (diff <= threshold) {
    return {
      shouldAlert: true,
      missingValue: diff,
      message: `Faltam apenas R$ ${diff.toFixed(2)} para o FRETE GRÁTIS. Vale a pena antecipar a compra de mais alguns metros?`,
    };
  }

  return { shouldAlert: false, message: `Frete será cobrado. Faltam R$ ${diff.toFixed(2)} para frete grátis.` };
}

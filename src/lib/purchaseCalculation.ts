import { resolveConversionFactors, isDiscretePurchaseUnit } from '@/lib/unitConversion';

interface PurchaseProduct {
  conversion_rate: number;
  min_order_quantity: number;
  purchase_order_unit: string;
  unit_price: number;
  unit?: string;
}

interface PurchaseResult {
  quantidade: number;
  unidade: string;
  totalEstimado: number;
}

export function calcularOrdemCompra(
  necessidadeFisica: number,
  product: PurchaseProduct,
  consumptionUnit?: string,
): PurchaseResult {
  const { stockToPurchaseDivisor } = resolveConversionFactors(
    consumptionUnit || product.unit || product.purchase_order_unit,
    product.unit || product.purchase_order_unit,
    product.purchase_order_unit,
    product.conversion_rate,
  );
  // necessidadeFisica is already in stock unit; convert to purchase_order_unit
  let quantidadeParaComprar = necessidadeFisica / stockToPurchaseDivisor;

  // Apply minimum order quantity
  if (quantidadeParaComprar < (product.min_order_quantity || 1)) {
    quantidadeParaComprar = product.min_order_quantity || 1;
  }

  // Round up for discrete units (lista canônica — antes faltava 'placa').
  if (isDiscretePurchaseUnit(product.purchase_order_unit)) {
    quantidadeParaComprar = Math.ceil(quantidadeParaComprar);
  }

  // unit_price is per stock unit; multiply by stockToPurchaseDivisor to get price per purchase_order_unit
  const pricePerPurchaseUnit = (product.unit_price || 0) * stockToPurchaseDivisor;

  return {
    quantidade: quantidadeParaComprar,
    unidade: product.purchase_order_unit || 'un',
    totalEstimado: quantidadeParaComprar * pricePerPurchaseUnit,
  };
}

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

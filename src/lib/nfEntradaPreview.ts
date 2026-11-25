/**
 * Prévia NF ↔ OC: quantidade, unidade/conversão e preço de cada item.
 * Usado pela tela única Entrada por NF.
 */
import {
  type OpenPoItem,
  matchNfItemToProduct,
  type MatchableProduct,
} from '@/lib/nfPoReceipt';
import {
  canonicalUnit,
  convertNfToStockUnit,
  toNfConversionProduct,
  type NfConversionResult,
} from '@/lib/nfUnitConversion';

export type NfPreviewSourceItem = {
  productName: string;
  productCode?: string | null;
  unit: string;
  quantity: number;
  unitPrice: number;
  totalPrice?: number;
};

export type NfPoPreviewStatus =
  | 'matched'
  | 'unmatched'
  | 'needs_conversion'
  | 'qty_diff'
  | 'price_diff';

export type NfPoPreviewLine = {
  nfIndex: number;
  productName: string;
  productCode: string | null;
  nfQty: number;
  nfUnit: string;
  nfUnitPrice: number;
  productId: string | null;
  productLabel: string | null;
  stockUnit: string | null;
  conversion: NfConversionResult | null;
  poItemId: string | null;
  poQty: number | null;
  poRemaining: number | null;
  poUnit: string | null;
  poUnitPrice: number | null;
  /** Quantidade da NF já na unidade de estoque, se converteu; senão a da NF. */
  stockQty: number;
  qtyDelta: number | null;
  priceDelta: number | null;
  status: NfPoPreviewStatus;
};

const PRICE_TOLERANCE = 0.009;
const QTY_TOLERANCE = 0.0001;

export function buildNfPoPreviewLines<T extends MatchableProduct>(
  nfItems: NfPreviewSourceItem[],
  products: T[],
  poItems: OpenPoItem[],
): NfPoPreviewLine[] {
  const usedPoItems = new Set<string>();
  return nfItems.map((item, nfIndex) => {
    const match = matchNfItemToProduct(products, item.productName, item.productCode);
    const product = match ?? null;
    const conversion = product
      ? convertNfToStockUnit(
          item.quantity,
          item.unit,
          item.unitPrice,
          toNfConversionProduct(product),
        )
      : null;
    const stockQty = conversion && !conversion.needsConfig ? conversion.qty : item.quantity;
    const stockUnit = (product as { unit?: string | null } | null)?.unit ?? null;

    let poItem: OpenPoItem | undefined;
    if (product) {
      poItem = poItems.find((po) => {
        if (usedPoItems.has(po.id)) return false;
        if (po.product_id !== product.id) return false;
        if (po.received_at) return false;
        const remaining = Number(po.quantity) - Number(po.received_quantity ?? 0);
        return remaining > QTY_TOLERANCE;
      });
      if (poItem) usedPoItems.add(poItem.id);
    }

    const poRemaining = poItem
      ? Number(poItem.quantity) - Number(poItem.received_quantity ?? 0)
      : null;
    const poUnitPrice = poItem?.unit_price != null ? Number(poItem.unit_price) : null;
    const comparePrice = conversion && !conversion.needsConfig ? conversion.unitPrice : item.unitPrice;
    const qtyDelta = poRemaining != null ? stockQty - poRemaining : null;
    const priceDelta = poUnitPrice != null ? comparePrice - poUnitPrice : null;

    let status: NfPoPreviewStatus = 'unmatched';
    if (!product) status = 'unmatched';
    else if (conversion?.needsConfig) status = 'needs_conversion';
    else if (qtyDelta != null && Math.abs(qtyDelta) > QTY_TOLERANCE) status = 'qty_diff';
    else if (priceDelta != null && Math.abs(priceDelta) > PRICE_TOLERANCE) status = 'price_diff';
    else status = 'matched';

    return {
      nfIndex,
      productName: item.productName,
      productCode: item.productCode ?? null,
      nfQty: item.quantity,
      nfUnit: item.unit,
      nfUnitPrice: item.unitPrice,
      productId: product?.id ?? null,
      productLabel: product ? product.name : null,
      stockUnit,
      conversion,
      poItemId: poItem?.id ?? null,
      poQty: poItem ? Number(poItem.quantity) : null,
      poRemaining,
      poUnit: poItem?.unit ?? (canonicalUnit(item.unit) || item.unit),
      poUnitPrice,
      stockQty,
      qtyDelta,
      priceDelta,
      status,
    };
  });
}

export function previewLineTone(status: NfPoPreviewStatus): 'ok' | 'warn' | 'bad' {
  if (status === 'matched') return 'ok';
  if (status === 'qty_diff' || status === 'price_diff') return 'warn';
  return 'bad';
}

export function previewStatusLabel(status: NfPoPreviewStatus): string {
  switch (status) {
    case 'matched':
      return 'Casado';
    case 'unmatched':
      return 'Sem cadastro';
    case 'needs_conversion':
      return 'Falta conversão';
    case 'qty_diff':
      return 'Qtd diferente da OC';
    case 'price_diff':
      return 'Preço diferente da OC';
  }
}

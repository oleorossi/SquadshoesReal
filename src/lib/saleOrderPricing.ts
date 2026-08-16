import {
  resolvePriceRule,
  type PriceLookup,
  type ResolvedPriceRule,
} from '@/lib/mobile/clientContext';

export type SaleOrderPriceSource =
  | 'table_color'
  | 'table_reference'
  | 'material_variant'
  | 'technical_sheet'
  | 'missing';

export interface SaleOrderPriceResolution {
  price: number;
  source: SaleOrderPriceSource;
  sourceLabel: string;
  tableRule?: ResolvedPriceRule;
}

interface ResolveSaleOrderItemPriceInput {
  lookup?: PriceLookup;
  referenceId?: string | null;
  color?: string | null;
  quantity?: number | null;
  variantPrice?: number | null;
  sheetPrice?: number | null;
}

/**
 * Fonte única da precificação automática do item do PV.
 *
 * A identidade comercial mais específica vence: tabela do cliente por
 * referência+cor+faixa, tabela default da referência, override da variação de
 * material e, por último, preço-base da ficha técnica.
 */
export function resolveSaleOrderItemPrice({
  lookup,
  referenceId,
  color,
  quantity,
  variantPrice,
  sheetPrice,
}: ResolveSaleOrderItemPriceInput): SaleOrderPriceResolution {
  const tableRule = lookup && referenceId
    ? resolvePriceRule(lookup, referenceId, color, Number(quantity) || 0)
    : undefined;

  if (tableRule?.price && tableRule.price > 0) {
    const byColor = tableRule.match === 'color';
    return {
      price: tableRule.price,
      source: byColor ? 'table_color' : 'table_reference',
      sourceLabel: byColor ? 'Tabela · cor' : 'Tabela · referência',
      tableRule,
    };
  }

  const normalizedVariant = Number(variantPrice) || 0;
  if (normalizedVariant > 0) {
    return {
      price: normalizedVariant,
      source: 'material_variant',
      sourceLabel: 'Variação de material',
    };
  }

  const normalizedSheet = Number(sheetPrice) || 0;
  if (normalizedSheet > 0) {
    return {
      price: normalizedSheet,
      source: 'technical_sheet',
      sourceLabel: 'Ficha técnica',
    };
  }

  return { price: 0, source: 'missing', sourceLabel: 'Sem preço-base' };
}

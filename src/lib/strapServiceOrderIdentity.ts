/**
 * Identidade de uma OS pertencente ao fluxo de Tiras.
 *
 * O cabeçalho legado ainda existe enquanto o cutover histórico não termina;
 * as OS novas são identificadas pelas linhas canônicas. Consumidores que já
 * resolveram essas linhas devem preencher `is_canonical_strap`.
 */
export interface StrapServiceOrderIdentity {
  service_order_domain?: 'generic' | 'strap' | null;
  artisanal_recipe_id?: string | null;
  canonical_strap_recipe_id?: string | null;
  artisanal_output_name?: string | null;
  artisanal_output_color?: string | null;
  artisanal_output_meters?: number | null;
  artisanal_for_order_meters?: number | null;
  artisanal_for_stock_meters?: number | null;
  artisanal_base_color?: string | null;
  artisanal_stock_entry_done?: boolean | null;
  is_canonical_strap?: boolean;
}

function hasText(value: string | null | undefined): boolean {
  return Boolean(value?.trim());
}

function hasQuantity(value: number | null | undefined): boolean {
  return Number.isFinite(Number(value)) && Math.abs(Number(value)) > 0.000001;
}

/**
 * Fonte única no cliente para impedir que uma OS de tira reapareça em listas,
 * KPIs, relatórios ou links do módulo genérico Terceirizados.
 */
export function isStrapServiceOrder(order: StrapServiceOrderIdentity | null | undefined): boolean {
  if (!order) return false;
  return Boolean(
    order.service_order_domain === 'strap'
    || order.is_canonical_strap
    || order.artisanal_recipe_id
    || order.canonical_strap_recipe_id
    || hasText(order.artisanal_output_name)
    || hasText(order.artisanal_output_color)
    || hasQuantity(order.artisanal_output_meters)
    || hasQuantity(order.artisanal_for_order_meters)
    || hasQuantity(order.artisanal_for_stock_meters)
    || hasText(order.artisanal_base_color)
    || order.artisanal_stock_entry_done,
  );
}

interface OfficialColorCatalog {
  colors: Array<{ id: string; name: string; active: boolean }>;
  official_products: Array<{
    base_group_id: string;
    color_id: string;
    official_product_id: string;
    status: string;
  }>;
  products: Array<{ id: string; active?: boolean }>;
  variants?: Array<{
    base_group_id: string;
    color_id: string;
    status: string;
    source_availability?: {
      finished_available_m?: number;
      buy_ready_purchase_allowed?: boolean;
    };
  }>;
}

/**
 * Cores com alguma fonte válida para a base exata. O vínculo oficial ativo
 * oferece produção interna mesmo com saldo zero; uma variante híbrida cuja
 * base/cor foi descontinuada continua aparecendo enquanto houver tira pronta
 * ou compra pronta comercialmente válida. Nenhum nome infere identidade.
 */
export function officialStrapColorsForBase(
  catalog: OfficialColorCatalog | null | undefined,
  baseGroupId: string | null | undefined,
) {
  if (!catalog || !baseGroupId) return [];
  const activeProducts = new Set(catalog.products
    .filter((product) => product.active !== false)
    .map((product) => product.id));
  const ids = new Set(catalog.official_products
    .filter((official) => official.status === 'active'
      && official.base_group_id === baseGroupId
      && activeProducts.has(official.official_product_id))
    .map((official) => official.color_id));
  const hybridIds = new Set((catalog.variants || [])
    .filter((variant) => variant.status === 'active'
      && variant.base_group_id === baseGroupId
      && (Number(variant.source_availability?.finished_available_m) > 0
        || variant.source_availability?.buy_ready_purchase_allowed === true))
    .map((variant) => variant.color_id));
  return catalog.colors
    .filter((color) => (color.active && ids.has(color.id)) || hybridIds.has(color.id))
    .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'));
}

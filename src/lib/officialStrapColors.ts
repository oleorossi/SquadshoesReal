interface OfficialColorCatalog {
  colors: Array<{ id: string; name: string; active: boolean }>;
  aliases?: Array<{
    canonical_color_id: string;
    alias: string;
    alias_norm?: string;
    status: string;
  }>;
  official_products: Array<{
    base_group_id: string;
    color_id: string;
    official_product_id: string;
    status: string;
  }>;
  products: Array<{
    id: string;
    group_id?: string | null;
    color?: string | null;
    active?: boolean;
  }>;
  variants?: Array<{
    finished_product_id?: string | null;
    base_group_id: string;
    identity_basis?: 'reference_base' | 'finished_product_group' | null;
    color_id: string;
    status: string;
    source_availability?: {
      finished_available_m?: number;
      buy_ready_purchase_allowed?: boolean;
    };
  }>;
}

const normalizeColor = (value: string | null | undefined) => (value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toUpperCase();

function canonicalIdsByLabel(catalog: OfficialColorCatalog) {
  const idsByLabel = new Map<string, Set<string>>();
  const add = (label: string | null | undefined, colorId: string) => {
    const key = normalizeColor(label);
    if (!key) return;
    const ids = idsByLabel.get(key) || new Set<string>();
    ids.add(colorId);
    idsByLabel.set(key, ids);
  };
  catalog.colors.forEach((color) => add(color.name, color.id));
  (catalog.aliases || [])
    .filter((alias) => alias.status === 'approved')
    .forEach((alias) => add(alias.alias_norm || alias.alias, alias.canonical_color_id));
  return idsByLabel;
}

export function canonicalStrapColorForProduct(
  catalog: OfficialColorCatalog | null | undefined,
  productId: string | null | undefined,
) {
  if (!catalog || !productId) return null;
  const product = catalog.products.find((entry) => entry.id === productId && entry.active !== false);
  if (!product) return null;
  const ids = canonicalIdsByLabel(catalog).get(normalizeColor(product.color));
  if (!ids || ids.size !== 1) return null;
  const colorId = [...ids][0];
  return catalog.colors.find((color) => color.id === colorId && color.active) || null;
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

/**
 * Cores da tira comprada pronta vêm dos produtos ativos do grupo acabado.
 * A passagem de `products.color` para a cor canônica usa somente o nome
 * canônico exato ou um alias aprovado; não tenta deduzir pelo nome do produto.
 */
export function purchasedReadyStrapColorsForGroup(
  catalog: OfficialColorCatalog | null | undefined,
  identityGroupId: string | null | undefined,
) {
  if (!catalog || !identityGroupId) return [];
  const activeProducts = catalog.products.filter((product) => (
    product.active !== false && product.group_id === identityGroupId
  ));
  const ids = new Set<string>();
  activeProducts.forEach((product) => {
    const color = canonicalStrapColorForProduct(catalog, product.id);
    if (color) ids.add(color.id);
  });

  return catalog.colors
    .filter((color) => color.active && ids.has(color.id))
    .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'));
}

export function strapColorsForIdentity(
  catalog: OfficialColorCatalog | null | undefined,
  identity: {
    identity_basis?: 'reference_base' | 'finished_product_group' | null;
    identity_group_id?: string | null;
  } | null | undefined,
  resolvedBaseGroupId?: string | null,
) {
  return identity?.identity_basis === 'finished_product_group'
    ? purchasedReadyStrapColorsForGroup(catalog, identity.identity_group_id)
    : officialStrapColorsForBase(catalog, resolvedBaseGroupId);
}

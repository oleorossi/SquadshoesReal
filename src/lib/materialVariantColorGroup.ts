export interface MaterialVariantColorIdentity {
  upper_material_product_id?: string | null;
  upper_material_group_id?: string | null;
  lining_material_product_id?: string | null;
  lining_material_group_id?: string | null;
  main_material_group_id?: string | null;
}

export interface MaterialVariantColorDrivers {
  variant_drives_upper?: boolean | null;
  variant_drives_lining?: boolean | null;
}

export interface MaterialVariantColorProduct {
  id: string;
  group_id?: string | null;
  color?: string | null;
  active?: boolean | null;
}

export interface MaterialVariantColorGroup {
  id: string;
  name: string;
}

/**
 * Resolve o único componente que governa a cor comercial da variante.
 *
 * A ordem espelha os resolvers estruturais: pino/grupo de cabedal primeiro;
 * o grupo principal só ocupa esse slot quando a ficha o delega. Se cabedal
 * não foi substituído pela variante, aplica a mesma ordem à forração. Nunca
 * une grupos, porque isso ofereceria cores que o débito não consegue resolver.
 */
export function resolveMaterialVariantColorGroup({
  variant,
  sheet,
  products,
  groups,
}: {
  variant: MaterialVariantColorIdentity | null | undefined;
  sheet: MaterialVariantColorDrivers | null | undefined;
  products: MaterialVariantColorProduct[];
  groups: MaterialVariantColorGroup[];
}): MaterialVariantColorGroup | null {
  if (!variant) return null;

  const groupFromProduct = (productId?: string | null) =>
    products.find((product) => product.id === productId)?.group_id || null;

  const groupId = groupFromProduct(variant.upper_material_product_id)
    || variant.upper_material_group_id
    || (sheet?.variant_drives_upper ? variant.main_material_group_id : null)
    || groupFromProduct(variant.lining_material_product_id)
    || variant.lining_material_group_id
    || (sheet?.variant_drives_lining ? variant.main_material_group_id : null);

  if (!groupId) return null;
  const group = groups.find((entry) => entry.id === groupId);
  return group ? { id: group.id, name: group.name } : null;
}

/** Produtos ativos e a coluna `products.color` são a fonte exata das opções. */
export function activeProductColorsForGroup(
  products: MaterialVariantColorProduct[],
  groupId: string | null | undefined,
): string[] {
  if (!groupId) return [];
  return Array.from(new Set(
    products
      .filter((product) => product.group_id === groupId && product.active === true)
      .map((product) => product.color?.trim().toUpperCase() || '')
      .filter(Boolean),
  )).sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

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

export interface SheetCommercialColorIdentity {
  upper_material_group_id?: string | null;
  upper_material?: string | null;
  lining_material?: string | null;
  has_straps?: boolean | null;
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

/**
 * Resolve uma única família para a cor comercial quando a referência ainda
 * não usa variantes explícitas.
 *
 * Cabedal vence forração. Em modelos de tiras sem cabedal, a napa-base é a
 * forração da ficha. Nunca procura a cor em todos os grupos: cor identifica o
 * SKU dentro da família, mas não pode escolher a família por conta própria.
 */
export function resolveSheetCommercialColorGroup({
  sheet,
  groups,
}: {
  sheet: SheetCommercialColorIdentity | null | undefined;
  groups: MaterialVariantColorGroup[];
}): MaterialVariantColorGroup | null {
  if (!sheet) return null;

  const normalize = (value?: string | null) => value?.trim().toLocaleLowerCase('pt-BR') || '';
  const byId = (id?: string | null) => id ? groups.find((group) => group.id === id) : undefined;
  const byName = (name?: string | null) => {
    const normalized = normalize(name);
    return normalized ? groups.find((group) => normalize(group.name) === normalized) : undefined;
  };

  const upper = byId(sheet.upper_material_group_id) || byName(sheet.upper_material);
  if (upper) return { id: upper.id, name: upper.name };

  const lining = byName(sheet.lining_material);
  if (lining) return { id: lining.id, name: lining.name };

  return null;
}

/** Produtos ativos e a coluna `products.color` são a fonte exata das opções.
 *  Nunca use paleta da ficha (`technical_sheets.colors`), CSV do grupo
 *  (`product_groups.colors`) nem a cartela `colors` — o PV só vende cor que
 *  existe como SKU no estoque. */
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

/** Lista de cores do item do PV. Sem grupo efetivo a lista fica vazia —
 *  nunca cai na paleta livre da ficha. */
export function saleOrderAvailableColors({
  materialVariantId,
  effectiveGroupId,
  baseCoveredByVariant,
  products,
}: {
  materialVariantId?: string | null;
  effectiveGroupId?: string | null;
  baseCoveredByVariant: boolean;
  products: MaterialVariantColorProduct[];
}): string[] {
  if (materialVariantId) {
    return effectiveGroupId ? activeProductColorsForGroup(products, effectiveGroupId) : [];
  }
  if (baseCoveredByVariant) return [];
  if (effectiveGroupId) return activeProductColorsForGroup(products, effectiveGroupId);
  return [];
}

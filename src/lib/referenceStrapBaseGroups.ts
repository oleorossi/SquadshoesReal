export interface ReferenceStrapBaseGroup {
  id: string;
  name: string;
  origins: string[];
  canonical: boolean;
}

interface GroupLike {
  id: string;
  name: string;
}

interface ProductLike {
  id: string;
  group_id?: string | null;
}

interface ReferenceSheetLike {
  id: string;
  upper_material?: string | null;
  upper_material_group_id?: string | null;
  upper_material_product_id?: string | null;
  /** Base de tira escolhida explicitamente na ficha. Entra na cascata do SQL
   *  (`resolve_strap_base_group_id`) logo depois do cabedal e ANTES do forro —
   *  ficava de fora daqui, sumindo da lista justamente nas fichas que decidiram
   *  a base à mão (4 das 33 com tira, medido em 21/08/2026). */
  strap_base_group_id?: string | null;
  lining_material?: string | null;
  lining_material_product_id?: string | null;
}

interface ReferenceVariantLike {
  reference_id: string;
  material_name?: string | null;
  active?: boolean | null;
  upper_material_group_id?: string | null;
  upper_material_product_id?: string | null;
  lining_material_group_id?: string | null;
  lining_material_product_id?: string | null;
  main_material_group_id?: string | null;
}

const normalizeName = (value?: string | null) =>
  value?.trim().toLocaleUpperCase('pt-BR') || '';

/**
 * Lista as napas que podem alimentar uma tira configurada como
 * `reference_base`.
 *
 * A precedência por variante espelha `resolve_strap_base_group_id` no banco.
 * O nome legado da ficha só entra como informação visual e é marcado como
 * não canônico: o motor operacional continua exigindo UUID de grupo/produto.
 */
export function referenceStrapBaseGroups({
  sheet,
  groups,
  products,
  variants,
}: {
  sheet: ReferenceSheetLike;
  groups: GroupLike[];
  products: ProductLike[];
  variants: ReferenceVariantLike[];
}): ReferenceStrapBaseGroup[] {
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  const groupsByName = new Map(groups.map((group) => [normalizeName(group.name), group]));
  const groupIdByProductId = new Map(products.map((product) => [product.id, product.group_id || null]));
  const resolved = new Map<string, ReferenceStrapBaseGroup>();

  const addGroup = (group: GroupLike | undefined, origin: string, canonical: boolean) => {
    if (!group) return;
    const existing = resolved.get(group.id);
    if (existing) {
      if (!existing.origins.includes(origin)) existing.origins.push(origin);
      existing.canonical = existing.canonical || canonical;
      return;
    }
    resolved.set(group.id, {
      id: group.id,
      name: group.name,
      origins: [origin],
      canonical,
    });
  };

  const groupFromProduct = (productId?: string | null) => {
    const groupId = productId ? groupIdByProductId.get(productId) : null;
    return groupId ? groupsById.get(groupId) : undefined;
  };

  // Ordem idêntica à do SQL `resolve_strap_base_group_id`: pino de PRODUTO do
  // cabedal, grupo de cabedal, base de tira explícita, pino de produto do forro.
  const sheetGroup = groupFromProduct(sheet.upper_material_product_id)
    || (sheet.upper_material_group_id ? groupsById.get(sheet.upper_material_group_id) : undefined)
    || (sheet.strap_base_group_id ? groupsById.get(sheet.strap_base_group_id) : undefined)
    || groupFromProduct(sheet.lining_material_product_id);

  if (sheetGroup) {
    addGroup(
      sheetGroup,
      sheet.strap_base_group_id && sheetGroup.id === sheet.strap_base_group_id
        ? 'Base de tira da ficha'
        : 'Material padrão da ficha',
      true,
    );
  } else {
    const legacySheetGroup = groupsByName.get(normalizeName(sheet.upper_material))
      || groupsByName.get(normalizeName(sheet.lining_material));
    addGroup(legacySheetGroup, 'Nome legado da ficha', false);
  }

  variants
    .filter((variant) => variant.reference_id === sheet.id && variant.active !== false)
    .forEach((variant) => {
      // ⚠ Pino de PRODUTO vence o grupo dentro do MESMO slot — é a ordem do
      // `resolve_strap_base_group_id`, que é o lado que debita. Aqui estava
      // invertido: com pino e grupo apontando famílias diferentes, a tela
      // mostrava uma napa e o estoque baixava outra. Sem linha divergente hoje
      // (medido 21/08/2026), mas a regra é que precisa bater.
      const groupId = groupIdByProductId.get(variant.upper_material_product_id || '')
        || variant.upper_material_group_id
        || groupIdByProductId.get(variant.lining_material_product_id || '')
        || variant.lining_material_group_id
        || variant.main_material_group_id
        || sheetGroup?.id
        || null;
      const group = groupId ? groupsById.get(groupId) : undefined;
      const variantName = variant.material_name?.trim();
      addGroup(group, variantName ? `Variante ${variantName}` : 'Variante da referência', true);
    });

  return Array.from(resolved.values())
    .map((group) => ({
      ...group,
      origins: [...group.origins].sort((left, right) => left.localeCompare(right, 'pt-BR')),
    }))
    .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'));
}

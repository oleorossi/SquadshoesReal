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

  // A ficha sem cabedal e com tiras usa a napa da forração como material-base.
  // Mantemos o fallback de forração também para fichas legadas sem a flag,
  // mas sempre como UM grupo exato — nunca como união de famílias.
  const lining = byName(sheet.lining_material);
  if (lining) return { id: lining.id, name: lining.name };

  return null;
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

// ── Cascata da variante: quais componentes seguem o MATERIAL PRINCIPAL ───────
// A variante que aponta só `main_material_group_id` NÃO troca material nenhum
// enquanto a ficha não liberar um slot em `technical_sheets.variant_drives_*`
// (mig 20261027120000) — os resolvers SQL e os motores TS só caem no principal
// depois de conferir essa trava. O resultado é um no-op SILENCIOSO: o PV mostra
// nome/SKU da variante, a lista de cores vem vazia e a produção corta o material
// da ficha. Foi o que aconteceu com SR02/GLOW METALIC em 20/08/2026.
//
// Estes helpers descrevem a decisão pra ela ser tomada onde a variante é
// cadastrada, em vez de ficar escondida numa caixa de seleção da aba Materiais.

/** Componente que pode seguir o material principal da variante. Palmilha fica
 *  de fora de propósito: aquele slot aponta a PLACA (EVA), não napa — a flag
 *  foi removida na mig 20261027120800. */
export type VariantCascadeSlotKey = 'upper' | 'lining';

export interface VariantCascadeSlot {
  key: VariantCascadeSlotKey;
  /** Rótulo do componente como a ficha o chama. */
  label: string;
  /** Material que a ficha usa hoje nesse componente. */
  sheetMaterial: string;
  /** Coluna da trava em `technical_sheets`. */
  drivesField: 'variant_drives_upper' | 'variant_drives_lining';
}

export interface VariantCascadeSheet {
  upper_material?: string | null;
  lining_material?: string | null;
  variant_drives_upper?: boolean | null;
  variant_drives_lining?: boolean | null;
  variant_drives_fachete?: boolean | null;
}

export type VariantCascadeSelection = Record<VariantCascadeSlotKey, boolean>;

export interface VariantCascadePins {
  upper_material_product_id?: string | null;
  upper_material_group_id?: string | null;
  lining_material_product_id?: string | null;
  lining_material_group_id?: string | null;
  insole_material_product_id?: string | null;
  insole_material_group_id?: string | null;
}

const SLOTS: ReadonlyArray<VariantCascadeSlot & { material: keyof VariantCascadeSheet }> = [
  { key: 'upper', label: 'Cabedal', sheetMaterial: '', drivesField: 'variant_drives_upper', material: 'upper_material' },
  { key: 'lining', label: 'Forração', sheetMaterial: '', drivesField: 'variant_drives_lining', material: 'lining_material' },
];

/**
 * Componentes que ESTA ficha realmente consome e que, por isso, podem seguir o
 * material principal da variante. Slot sem material cadastrado não entra: ligar
 * a trava nele não mudaria corte nenhum e só daria a impressão de configurado.
 */
export function listVariantCascadeSlots(
  sheet: VariantCascadeSheet | null | undefined,
): VariantCascadeSlot[] {
  if (!sheet) return [];
  return SLOTS
    .map((slot) => ({ ...slot, sheetMaterial: (sheet[slot.material] as string | null | undefined)?.trim() || '' }))
    .filter((slot) => !!slot.sheetMaterial)
    .map(({ key, label, sheetMaterial, drivesField }) => ({ key, label, sheetMaterial, drivesField }));
}

/**
 * Estado inicial das travas ao abrir o cadastro da variante.
 *
 * Ficha já configurada devolve o que está gravado — o valor é da FICHA e vale
 * pra todas as variantes dela, então não pode ser sobrescrito por palpite.
 * Ficha nunca configurada (as três travas desligadas) só ganha default quando
 * existe UM único componente possível: aí não há o que decidir. Com dois, a
 * escolha é do dono — é ela que protege material de identidade (a PALHA do
 * cabedal do DS21 não vira napa porque o PV vendeu GLOW METALIC).
 */
export function seedVariantCascade(
  sheet: VariantCascadeSheet | null | undefined,
): VariantCascadeSelection {
  const stored: VariantCascadeSelection = {
    upper: !!sheet?.variant_drives_upper,
    lining: !!sheet?.variant_drives_lining,
  };
  const configured = stored.upper || stored.lining || !!sheet?.variant_drives_fachete;
  if (configured) return stored;

  const slots = listVariantCascadeSlots(sheet);
  if (slots.length !== 1) return stored;
  return { ...stored, [slots[0].key]: true };
}

/** Exceção por componente já resolve o slot sozinha (vence o principal), então
 *  a variante não depende da trava da ficha pra trocar material. */
export function hasVariantComponentPin(variant: VariantCascadePins | null | undefined): boolean {
  if (!variant) return false;
  return !!(variant.upper_material_product_id
    || variant.upper_material_group_id
    || variant.lining_material_product_id
    || variant.lining_material_group_id
    || variant.insole_material_product_id
    || variant.insole_material_group_id);
}

/**
 * `true` quando salvar essa variante produziria o no-op silencioso: nenhum
 * componente muda de material, mesmo com material principal escolhido.
 */
export function variantDrivesNoComponent({
  variant, sheet, cascade,
}: {
  variant: VariantCascadePins | null | undefined;
  sheet: VariantCascadeSheet | null | undefined;
  cascade: VariantCascadeSelection;
}): boolean {
  if (hasVariantComponentPin(variant)) return false;
  if (sheet?.variant_drives_fachete) return false;
  return !listVariantCascadeSlots(sheet).some((slot) => cascade[slot.key]);
}

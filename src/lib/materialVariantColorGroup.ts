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

/** Produto pinado só participa da precedência enquanto continua ativo. */
export function findActiveMaterialVariantProduct(
  products: MaterialVariantColorProduct[],
  productId?: string | null,
): MaterialVariantColorProduct | null {
  return products.find((product) =>
    product.id === productId && product.active === true) || null;
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
    findActiveMaterialVariantProduct(products, productId)?.group_id || null;

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

/** Componente que pode seguir o material principal da variante.
 *
 *  Palmilha fica de fora de propósito: aquele slot aponta a PLACA (EVA), não
 *  napa — a flag foi removida na mig 20261027120800.
 *
 *  `fachete` entrou em 21/08/2026. Ele não sai de um campo `sheet.*_material`
 *  como os outros: a fonte é `products.fachete_material_group_id` do solado
 *  principal (fallback `technical_sheets.lining_material`) e só existe quando o
 *  solado é fachetado. Antes disso a trava dele vivia SÓ numa caixa escondida na
 *  aba Materiais — o mesmo no-op silencioso que este arquivo existe pra impedir,
 *  sobrevivendo na terceira perna. */
export type VariantCascadeSlotKey = 'upper' | 'lining' | 'fachete';

export interface VariantCascadeSlot {
  key: VariantCascadeSlotKey;
  /** Rótulo do componente como a ficha o chama. */
  label: string;
  /** Material que a ficha usa hoje nesse componente. */
  sheetMaterial: string;
  /** Coluna da trava em `technical_sheets`. */
  drivesField: 'variant_drives_upper' | 'variant_drives_lining' | 'variant_drives_fachete';
}

export interface VariantCascadeSheet {
  has_straps?: boolean | null;
  upper_material?: string | null;
  lining_material?: string | null;
  variant_drives_upper?: boolean | null;
  variant_drives_lining?: boolean | null;
  variant_drives_fachete?: boolean | null;
}

/** Contexto do solado principal — o fachete só existe quando ele é fachetado. */
export interface VariantCascadeSoleContext {
  soleIsFachetado?: boolean | null;
  /** `products.fachete_material_group_id` do solado; vazio cai no forro da ficha. */
  facheteGroupName?: string | null;
}

export type VariantCascadeSelection = Record<VariantCascadeSlotKey, boolean>;

export const EMPTY_VARIANT_CASCADE: VariantCascadeSelection = {
  upper: false, lining: false, fachete: false,
};

export interface VariantCascadePins {
  upper_material_product_id?: string | null;
  upper_material_group_id?: string | null;
  lining_material_product_id?: string | null;
  lining_material_group_id?: string | null;
  insole_material_product_id?: string | null;
  insole_material_group_id?: string | null;
}

/** Camada estrutural de um grupo composto de produto.
 *
 * A compatibilidade do Cabedal não usa setor nem nome do grupo. Esses campos
 * descrevem onde o cadastro aparece na UI, não a composição física. A fonte de
 * verdade é `product_group_layers`: a camada que fornece cor pode mudar; as
 * demais precisam continuar sendo o mesmo componente. */
export interface MaterialVariantGroupLayer {
  component_group_id?: string | null;
  component_label?: string | null;
  role?: string | null;
  is_color_source?: boolean | null;
}

export interface UpperMaterialStructureCompatibility {
  /** Qualquer linha em `product_group_layers` torna o grupo-base composto. */
  baseIsComposite: boolean;
  /** Override estrutural também precisa apontar para um grupo composto. */
  overrideIsComposite: boolean;
  /** `false` só quando há override explícito e sua parte fixa diverge. */
  compatible: boolean;
  baseSignature: string[];
  overrideSignature: string[];
}

/** Resolve o grupo efetivo de um slot com a mesma precedência dos motores:
 * produto pinado vence o grupo selecionado. */
export function resolvePinnedMaterialGroupId({
  productId,
  groupId,
  products,
}: {
  productId?: string | null;
  groupId?: string | null;
  products: MaterialVariantColorProduct[];
}): string | null {
  return findActiveMaterialVariantProduct(products, productId)?.group_id
    || groupId
    || null;
}

function normalizeLayerIdentity(value?: string | null): string {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('pt-BR');
}

/**
 * Assinatura multiconjunto das camadas que NÃO fornecem a cor.
 *
 * `component_group_id` é a identidade forte. Só quando o cadastro legado não
 * tem esse UUID usamos `component_label` normalizado + `role`; nunca setor ou
 * nome do grupo composto. A ordenação torna a comparação independente da ordem
 * visual das camadas, preservando duplicidades reais.
 */
export function nonColorSourceLayerSignature(
  layers: MaterialVariantGroupLayer[],
): string[] {
  return layers
    .filter((layer) => layer.is_color_source !== true)
    .map((layer) => {
      const componentGroupId = layer.component_group_id?.trim().toLocaleLowerCase('pt-BR');
      if (componentGroupId) return `group:${componentGroupId}`;
      return `fallback:${normalizeLayerIdentity(layer.component_label)}|${normalizeLayerIdentity(layer.role)}`;
    })
    .sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

/**
 * Decide se uma exceção explícita de Cabedal preserva a estrutura fixa da
 * ficha. Ficha simples continua livre. Cabedal composto sem override também é
 * válido (ele apenas mantém o grupo da ficha), mas NÃO pode usar a cascata
 * genérica `variant_drives_upper`; essa trava é aplicada pela UI chamadora.
 */
export function evaluateUpperMaterialStructureCompatibility({
  baseLayers,
  overrideLayers,
  hasExplicitOverride,
}: {
  baseLayers: MaterialVariantGroupLayer[];
  overrideLayers: MaterialVariantGroupLayer[];
  hasExplicitOverride: boolean;
}): UpperMaterialStructureCompatibility {
  const baseSignature = nonColorSourceLayerSignature(baseLayers);
  const overrideSignature = nonColorSourceLayerSignature(overrideLayers);
  const baseIsComposite = baseLayers.length > 0;
  const overrideIsComposite = overrideLayers.length > 0;
  const compatible = !baseIsComposite
    || !hasExplicitOverride
    || (overrideIsComposite
      && baseSignature.length === overrideSignature.length
      && baseSignature.every((entry, index) => entry === overrideSignature[index]));

  return {
    baseIsComposite,
    overrideIsComposite,
    compatible,
    baseSignature,
    overrideSignature,
  };
}

const MATERIAL_SLOTS: ReadonlyArray<VariantCascadeSlot & { material: keyof VariantCascadeSheet }> = [
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
  sole: VariantCascadeSoleContext | null | undefined = null,
): VariantCascadeSlot[] {
  if (!sheet) return [];
  const slots: VariantCascadeSlot[] = MATERIAL_SLOTS
    .map((slot) => ({ ...slot, sheetMaterial: (sheet[slot.material] as string | null | undefined)?.trim() || '' }))
    .filter((slot) => !!slot.sheetMaterial)
    .map(({ key, label, sheetMaterial, drivesField }) => ({ key, label, sheetMaterial, drivesField }));

  if (sole?.soleIsFachetado) {
    const facheteMaterial = sole.facheteGroupName?.trim()
      || sheet.lining_material?.trim()
      || '';
    if (facheteMaterial) {
      slots.push({
        key: 'fachete',
        label: 'Fachete (forração do salto)',
        sheetMaterial: facheteMaterial,
        drivesField: 'variant_drives_fachete',
      });
    }
  }
  return slots;
}

/**
 * Estado inicial das travas ao abrir o cadastro da variante.
 */
export function seedVariantCascade(
  sheet: VariantCascadeSheet | null | undefined,
  sole: VariantCascadeSoleContext | null | undefined = null,
): VariantCascadeSelection {
  const stored: VariantCascadeSelection = {
    upper: !!sheet?.variant_drives_upper,
    lining: !!sheet?.variant_drives_lining,
    fachete: !!sheet?.variant_drives_fachete,
  };
  if (stored.upper || stored.lining || stored.fachete) return stored;

  const slots = listVariantCascadeSlots(sheet, sole);
  if (slots.length !== 1) return stored;
  return { ...stored, [slots[0].key]: true };
}

export function hasVariantComponentPin(
  variant: VariantCascadePins | null | undefined,
  products: MaterialVariantColorProduct[],
): boolean {
  if (!variant) return false;
  return !!(findActiveMaterialVariantProduct(products, variant.upper_material_product_id)
    || variant.upper_material_group_id
    || findActiveMaterialVariantProduct(products, variant.lining_material_product_id)
    || variant.lining_material_group_id
    || findActiveMaterialVariantProduct(products, variant.insole_material_product_id)
    || variant.insole_material_group_id);
}

export function variantDrivesNoComponent({
  variant, sheet, sole, cascade, products,
}: {
  variant: VariantCascadePins | null | undefined;
  sheet: VariantCascadeSheet | null | undefined;
  sole?: VariantCascadeSoleContext | null;
  cascade: VariantCascadeSelection;
  products: MaterialVariantColorProduct[];
}): boolean {
  if (hasVariantComponentPin(variant, products)) return false;
  return !listVariantCascadeSlots(sheet, sole).some((slot) => cascade[slot.key]);
}

export interface StrapBaseReadout {
  groupId: string;
  origin: 'variant_upper' | 'variant_lining' | 'variant_main' | 'sheet';
  divergesFromLining: boolean;
}

export function resolveStrapBaseReadout({
  variant, sheet, cascade, products,
}: {
  variant: VariantCascadePins & { main_material_group_id?: string | null } | null | undefined;
  sheet: (VariantCascadeSheet & {
    upper_material_group_id?: string | null;
    upper_material_product_id?: string | null;
    strap_base_group_id?: string | null;
    lining_material_group_id?: string | null;
  }) | null | undefined;
  cascade: VariantCascadeSelection;
  products: MaterialVariantColorProduct[];
}): StrapBaseReadout | null {
  const pick = (groupId: string | null | undefined, origin: StrapBaseReadout['origin']) =>
    groupId ? { groupId, origin } : null;

  const variantUpperGroupId = resolvePinnedMaterialGroupId({
    productId: variant?.upper_material_product_id,
    groupId: variant?.upper_material_group_id,
    products,
  });
  const variantLiningGroupId = resolvePinnedMaterialGroupId({
    productId: variant?.lining_material_product_id,
    groupId: variant?.lining_material_group_id,
    products,
  });
  const sheetUpperPin = findActiveMaterialVariantProduct(
    products,
    sheet?.upper_material_product_id,
  );
  const sheetUpperGroupId = sheetUpperPin?.group_id || sheet?.upper_material_group_id;

  const strapsFollowLining = sheet?.has_straps === true
    && !sheet.upper_material?.trim()
    && !sheet.upper_material_group_id
    && !sheetUpperPin;

  const resolved = strapsFollowLining
    ? pick(variantLiningGroupId, 'variant_lining')
      || (cascade.lining ? pick(variant?.main_material_group_id, 'variant_main') : null)
      || pick(sheet?.lining_material_group_id, 'sheet')
      || pick(sheet?.strap_base_group_id, 'sheet')
    : pick(variantUpperGroupId, 'variant_upper')
      || pick(variantLiningGroupId, 'variant_lining')
      || pick(variant?.main_material_group_id, 'variant_main')
      || pick(sheetUpperGroupId, 'sheet')
      || pick(sheet?.strap_base_group_id, 'sheet')
      || pick(sheet?.lining_material_group_id, 'sheet');
  if (!resolved) return null;

  const liningGroupId = variantLiningGroupId
    || (cascade.lining ? variant?.main_material_group_id : null)
    || sheet?.lining_material_group_id
    || null;

  return {
    ...resolved,
    divergesFromLining: !!liningGroupId && liningGroupId !== resolved.groupId,
  };
}

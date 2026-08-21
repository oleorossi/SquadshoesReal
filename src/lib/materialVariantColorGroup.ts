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

  // O fachete existe pelo SOLADO, não pela ficha. Sem solado fachetado a trava
  // não muda corte nenhum, então o slot nem aparece.
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
 *
 * Ficha já configurada devolve o que está gravado — o valor é da FICHA e vale
 * pra todas as variantes dela, então não pode ser sobrescrito por palpite.
 * Ficha nunca configurada só ganha default quando existe UM único componente
 * possível: aí não há o que decidir. Com dois ou mais, a escolha é do dono — é
 * ela que protege material de identidade (a PALHA do cabedal do DS21 não vira
 * napa porque o PV vendeu GLOW METALIC).
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
 *
 * ⚠ `variant_drives_fachete` NÃO é mais escape-hatch. Antes bastava a flag estar
 * gravada na ficha pra este guard liberar o save, mesmo com cabedal e forração
 * desmarcados — e a caixa independente da aba Materiais tornava esse estado
 * alcançável. Agora o fachete é slot como os outros: conta pela SELEÇÃO.
 */
export function variantDrivesNoComponent({
  variant, sheet, sole, cascade,
}: {
  variant: VariantCascadePins | null | undefined;
  sheet: VariantCascadeSheet | null | undefined;
  sole?: VariantCascadeSoleContext | null;
  cascade: VariantCascadeSelection;
}): boolean {
  if (hasVariantComponentPin(variant)) return false;
  return !listVariantCascadeSlots(sheet, sole).some((slot) => cascade[slot.key]);
}

// ── Base da napa da TIRA artesanal ───────────────────────────────────────────

export interface StrapBaseReadout {
  /** Grupo do qual a tira sai de fato. */
  groupId: string;
  /** De onde veio na cascata — vira o rótulo "segue a Forração" etc. */
  origin: 'variant_upper' | 'variant_lining' | 'variant_main' | 'sheet';
  /** `true` quando a base da tira NÃO é a mesma napa da forração do modelo. */
  divergesFromLining: boolean;
}

/**
 * Espelha `resolve_strap_base_group_id` (SQL) para a variante em edição.
 *
 * ⚠ O resolver do banco **não** checa `variant_drives_*`: o passo do material
 * principal dispara mesmo com a trava da Forração desligada. Então uma variante
 * que só tem material principal, numa ficha com a forração NÃO liberada, faz a
 * tira sair da napa da variante enquanto a forração continua na napa da ficha —
 * duas napas para o mesmo modelo, em silêncio. `divergesFromLining` existe pra
 * tela poder dizer isso em vez de escrever "= Forração" e mentir.
 */
export function resolveStrapBaseReadout({
  variant, sheet, cascade,
}: {
  variant: VariantCascadePins & { main_material_group_id?: string | null } | null | undefined;
  sheet: (VariantCascadeSheet & {
    upper_material_group_id?: string | null;
    strap_base_group_id?: string | null;
    lining_material_group_id?: string | null;
  }) | null | undefined;
  cascade: VariantCascadeSelection;
}): StrapBaseReadout | null {
  const pick = (groupId: string | null | undefined, origin: StrapBaseReadout['origin']) =>
    groupId ? { groupId, origin } : null;

  const resolved = pick(variant?.upper_material_group_id, 'variant_upper')
    || pick(variant?.lining_material_group_id, 'variant_lining')
    || pick(variant?.main_material_group_id, 'variant_main')
    || pick(sheet?.upper_material_group_id, 'sheet')
    || pick(sheet?.strap_base_group_id, 'sheet')
    || pick(sheet?.lining_material_group_id, 'sheet');
  if (!resolved) return null;

  // De qual grupo a FORRAÇÃO sai — aí sim a trava conta, porque quem resolve o
  // forro é `resolve_lining_material_for_variant`, e esse checa `variant_drives`.
  const liningGroupId = variant?.lining_material_group_id
    || (cascade.lining ? variant?.main_material_group_id : null)
    || sheet?.lining_material_group_id
    || null;

  return {
    ...resolved,
    divergesFromLining: !!liningGroupId && liningGroupId !== resolved.groupId,
  };
}

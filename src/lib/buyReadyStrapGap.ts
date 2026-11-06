import { canonicalStrapColorForProduct } from '@/lib/officialStrapColors';
import { strapIdentityBasis, type StrapIdentityBasis } from '@/lib/strapIdentity';
import { isUuid } from '@/lib/technicalStrapLines';

/**
 * Lacuna de cadastro Hub (variante comercial) no item do PV.
 *
 * Spec `tira-comprar-pronto-so-registra` (D4/D8, mig 45600): strass
 * (`finished_product_group`) e napa em `sku_acabado` (45300) **não** exigem
 * mais variante Hub no save — o prepare acha/cria o SKU (strass) ou só
 * registra cor+metros (napa). `strapLineNeedsBuyReadyHubCadastro` fica
 * sempre falso; `listBuyReadyStrapGaps` permanece como utilitário de
 * diagnóstico (produto acabado / review) se algum fluxo legado o chamar.
 */
export interface BuyReadyStrapGapLine {
  id?: string | null;
  technical_strap_line_id?: string | null;
  identity_basis?: StrapIdentityBasis | null;
  identity_group_id?: string | null;
  group_id?: string | null;
  measure_id?: string | null;
  color_id?: string | null;
  label?: string | null;
  group_name?: string | null;
  pv_origem?: string | null;
}

interface GapCatalogVariant {
  measure_id: string;
  base_group_id: string;
  identity_basis?: StrapIdentityBasis | null;
  internal_production_enabled?: boolean | null;
  color_id: string;
  purchase_enabled?: boolean | null;
  status: string;
}

interface GapCatalogProduct {
  id: string;
  name?: string | null;
  group_id?: string | null;
  color?: string | null;
  unit?: string | null;
  active?: boolean;
}

export interface BuyReadyStrapGapCatalog {
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
  products: GapCatalogProduct[];
  variants: GapCatalogVariant[];
}

export interface BuyReadyStrapGapDiagnostic {
  issue_code: string;
  entity_id: string;
  details: Record<string, unknown>;
}

export interface BuyReadyStrapGap {
  /** UUID técnico da linha da ficha — a chave que o snapshot do PV congela. */
  lineId: string;
  label: string;
  groupName: string;
  measureId: string;
  identityGroupId: string;
  colorId: string;
  colorName: string;
  /** Produto acabado exato do grupo cuja cor canônica resolve para `colorId`. */
  finishedProductId: string | null;
  finishedProductName: string | null;
  /** Pendência de migração correspondente; destrava a escolha de cor no editor. */
  reviewId: string | null;
}

const str = (value: unknown): string => (value == null ? '' : String(value));

/**
 * Produto acabado ATIVO, em `m`, do grupo comprado pronto, cuja cor de cadastro
 * resolve para exatamente esta cor canônica. Ambiguidade devolve `null`: dois
 * produtos na mesma cor é erro de cadastro e não pode ser desempatado por nome.
 */
export function purchasedReadyStrapProductForColor(
  catalog: BuyReadyStrapGapCatalog | null | undefined,
  identityGroupId: string | null | undefined,
  colorId: string | null | undefined,
): GapCatalogProduct | null {
  if (!catalog || !identityGroupId || !colorId) return null;
  const matches = catalog.products.filter((product) => product.active !== false
    && product.group_id === identityGroupId
    && product.unit === 'm'
    && canonicalStrapColorForProduct(catalog, product.id)?.id === colorId);
  return matches.length === 1 ? matches[0] : null;
}

/**
 * Identidade acabada da ficha (STRASS / finished_product_group) — ainda
 * usada pela UI pra rotular/origem; NÃO trava o save (45600).
 */
export function strapLineWantsBuyReady(
  strap: BuyReadyStrapGapLine | null | undefined,
): boolean {
  return strapIdentityBasis(strap) === 'finished_product_group';
}

/**
 * Origem Comprar pronto escolhida no PV (`pv_origem = sku_acabado`) em linha
 * artesanal por napa. Spec `tira-comprar-pronto-so-registra` (mig 45300): só
 * registra napa · cor + metros — NÃO exige cadastro Hub / SKU.
 */
export function strapLineIsPvBuyReadyChoice(
  strap: BuyReadyStrapGapLine | null | undefined,
): boolean {
  return strap?.pv_origem === 'sku_acabado'
    && strapIdentityBasis(strap) !== 'finished_product_group';
}

/**
 * Linha que precisa de variante Hub antes do save.
 * Sempre falso desde 45600 (D4): strass resolve/cria SKU no servidor; napa
 * em sku_acabado só registra (45300). O parâmetro fica pra assinatura estável.
 */
export function strapLineNeedsBuyReadyHubCadastro(
  _strap?: BuyReadyStrapGapLine | null,
): boolean {
  return false;
}

/** Grupo acabado: pin da ficha, ou group_id legado quando o PV escolheu fornecedor. */
export function buyReadyIdentityGroupId(
  strap: BuyReadyStrapGapLine | null | undefined,
): string {
  const identityGroupId = str(strap?.identity_group_id);
  if (isUuid(identityGroupId)) return identityGroupId;
  if (strap?.pv_origem === 'sku_acabado') {
    const groupId = str(strap.group_id);
    if (isUuid(groupId)) return groupId;
  }
  return '';
}

/**
 * Lacunas Hub por linha — vazio desde 45600 (D4: save não exige variante).
 * Mantém a assinatura e o utilitário de produto/review para fluxos legados.
 */
export function listBuyReadyStrapGaps(
  straps: BuyReadyStrapGapLine[] | null | undefined,
  catalog: BuyReadyStrapGapCatalog | null | undefined,
  diagnostics?: BuyReadyStrapGapDiagnostic[] | null,
): BuyReadyStrapGap[] {
  void straps;
  void catalog;
  void diagnostics;
  // Portão único: NeedsBuyReadyHubCadastro sempre falso (D4/45600).
  return [];
}

export interface OrderBuyReadyStrapGap extends BuyReadyStrapGap {
  itemIndex: number;
  itemColor: string;
  itemLabel: string;
}

interface OrderBuyReadyGapItem {
  color?: string | null;
  reference_id?: string | null;
  strap_colors?: BuyReadyStrapGapLine[] | null;
}

/** Lacunas de compra pronta em TODOS os itens do PV (painel do Criar Pedido). */
export function listOrderBuyReadyStrapGaps(
  items: OrderBuyReadyGapItem[] | null | undefined,
  catalog: BuyReadyStrapGapCatalog | null | undefined,
  diagnostics?: BuyReadyStrapGapDiagnostic[] | null,
  referenceCodeById?: Map<string, string> | Record<string, string> | null,
): OrderBuyReadyStrapGap[] {
  if (!catalog || !Array.isArray(items)) return [];
  const codeOf = (referenceId: string | null | undefined): string => {
    if (!referenceId) return '';
    if (referenceCodeById instanceof Map) return referenceCodeById.get(referenceId) || '';
    if (referenceCodeById && typeof referenceCodeById === 'object') {
      return str((referenceCodeById as Record<string, string>)[referenceId]);
    }
    return '';
  };
  return items.flatMap((item, itemIndex) => {
    const gaps = listBuyReadyStrapGaps(item.strap_colors, catalog, diagnostics);
    const itemColor = str(item.color) || 'sem cor';
    const refCode = codeOf(item.reference_id);
    const itemLabel = refCode ? `${refCode} · ${itemColor}` : itemColor;
    return gaps.map((gap) => ({
      ...gap,
      itemIndex,
      itemColor,
      itemLabel,
    }));
  });
}

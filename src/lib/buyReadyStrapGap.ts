import { canonicalStrapColorForProduct } from '@/lib/officialStrapColors';
import { strapIdentityBasis, type StrapIdentityBasis } from '@/lib/strapIdentity';
import { isUuid, technicalStrapLineId } from '@/lib/technicalStrapLines';

/**
 * Lacuna EXATA que trava o salvamento do PV com
 * "Tira comprada pronta nao possui variante comercial ativa exata"
 * (`prepare_sale_order_item_internal_straps`).
 *
 * A regra do servidor exige uma `artisanal_strap_variants` ATIVA em
 * (medida, grupo acabado, cor canônica) com `purchase_enabled` e
 * `internal_production_enabled = false`. O PV congela essa variante; ele nunca
 * inventa produto, fornecedor ou valor da tira comprada pronta.
 *
 * Este módulo NÃO relaxa a regra: ele apenas identifica, no próprio item do PV,
 * QUAL tira está sem o cadastro — para o operador registrar só a tira que este
 * pedido usa, em vez de percorrer a lista inteira do hub.
 */
export interface BuyReadyStrapGapLine {
  id?: string | null;
  technical_strap_line_id?: string | null;
  identity_basis?: StrapIdentityBasis | null;
  identity_group_id?: string | null;
  measure_id?: string | null;
  color_id?: string | null;
  label?: string | null;
  group_name?: string | null;
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

function hasActiveBuyReadyVariant(
  catalog: BuyReadyStrapGapCatalog,
  measureId: string,
  identityGroupId: string,
  colorId: string,
): boolean {
  return catalog.variants.some((variant) => variant.status === 'active'
    && variant.identity_basis === 'finished_product_group'
    && variant.internal_production_enabled !== true
    && variant.purchase_enabled !== false
    && variant.measure_id === measureId
    && variant.base_group_id === identityGroupId
    && variant.color_id === colorId);
}

function reviewIdForProduct(
  diagnostics: BuyReadyStrapGapDiagnostic[] | null | undefined,
  finishedProductId: string | null,
): string | null {
  if (!diagnostics || !finishedProductId) return null;
  const match = diagnostics.find((issue) => {
    const details = issue.details || {};
    return str(details.entity_type) === 'buy_ready_strap_product'
      && str(details.action_required) === 'create_variant_with_bundle'
      && str(details.required_finished_product_id) === finishedProductId;
  });
  if (!match) return null;
  const reviewId = str(match.details?.review_id) || match.entity_id;
  return isUuid(reviewId) ? reviewId : null;
}

/**
 * Só reporta a lacuna quando a identidade já está completa (medida, grupo e cor
 * por UUID). Identidade incompleta tem mensagem própria na tela e um CTA de
 * cadastro comercial ali só empilharia dois avisos sobre a mesma linha.
 */
export function listBuyReadyStrapGaps(
  straps: BuyReadyStrapGapLine[] | null | undefined,
  catalog: BuyReadyStrapGapCatalog | null | undefined,
  diagnostics?: BuyReadyStrapGapDiagnostic[] | null,
): BuyReadyStrapGap[] {
  if (!catalog || !Array.isArray(straps)) return [];
  return straps.flatMap((strap, position) => {
    if (strapIdentityBasis(strap) !== 'finished_product_group') return [];
    const lineId = technicalStrapLineId(strap);
    const measureId = str(strap.measure_id);
    const identityGroupId = str(strap.identity_group_id);
    const colorId = str(strap.color_id);
    if (!lineId || !isUuid(measureId) || !isUuid(identityGroupId) || !isUuid(colorId)) return [];
    if (hasActiveBuyReadyVariant(catalog, measureId, identityGroupId, colorId)) return [];

    const product = purchasedReadyStrapProductForColor(catalog, identityGroupId, colorId);
    const color = catalog.colors.find((entry) => entry.id === colorId);
    return [{
      lineId,
      label: str(strap.label) || `Tira ${position + 1}`,
      groupName: str(strap.group_name),
      measureId,
      identityGroupId,
      colorId,
      colorName: color?.name || '',
      finishedProductId: product?.id || null,
      finishedProductName: product?.name ? str(product.name) : null,
      reviewId: reviewIdForProduct(diagnostics, product?.id || null),
    }];
  });
}

/**
 * Anotação de disponibilidade sobre o consumo canônico do PV.
 *
 * A identidade e a conversão de tiras vêm exclusivamente da preview RPC do
 * domínio artesanal. Este módulo não consulta receitas legadas, não resolve por
 * nome/cor e não refaz rendimento localmente.
 */
import type { MaterialConsumptionRow, ConsumptionContext } from '@/lib/orderConsumption';
import type { ArtisanalStrapCutRow } from '@/lib/strapRollCut';
import {
  canonicalStrapCutRows,
  replaceWithCanonicalStrapRows,
  type CanonicalStrapDemandPreview,
} from '@/lib/canonicalStrapDemandPreview';

export type ConsumptionRow = MaterialConsumptionRow & {
  /** Estoque líquido atual do produto exato ou do grupo/cor resolvido. */
  available?: number;
  /**
   * Metragem informativa calculada pela ficha quando a tira ainda não tem
   * identidade canônica suficiente para participar de estoque, falta ou OC.
   * `totalQuantity` permanece 0 nesse caso para manter o bloqueio operacional.
   */
  previewQuantity?: number;
  /** Solado: estoque por numeração do produto exato. */
  soleSizeStock?: Record<string, number>;
  /** Snapshot explicativo da conversão canônica da tira interna em napa. */
  artisanal?: { baseName: string; baseQty: number; yieldPerMeter: number; pending?: boolean };
  strapVariantId?: string | null;
  strapSourceMode?: 'internal' | 'buy_ready' | null;
  recipeId?: string | null;
  baseProductId?: string | null;
  technicalStrapLineIds?: string[];
};

/**
 * Preserva a quantidade calculada pela ficha como PRÉVIA quando a RPC canônica
 * ainda não devolveu nenhuma tira. As linhas continuam com quantidade
 * operacional zero e aviso, portanto não viram falta nem sugestão de compra.
 */
export function attachUnresolvedStrapQuantityPreview(
  canonicalRows: ConsumptionRow[],
  calculatedRows: MaterialConsumptionRow[],
  hasCanonicalPreview: boolean,
): ConsumptionRow[] {
  if (hasCanonicalPreview) return canonicalRows;

  const calculatedStraps = calculatedRows.filter((row) =>
    row.componentType === 'Tiras' && Number(row.totalQuantity) > 0);
  if (calculatedStraps.length === 0) return canonicalRows;

  const unresolvedWarning = canonicalRows.find((row) => row.componentType === 'Tiras')?.warning
    || 'A tira permanece bloqueada até resolver variante, base, cor e receita por ID.';
  const previewWarning = `${unresolvedWarning} A metragem exibida é somente uma prévia calculada pela ficha.`;

  return [
    ...canonicalRows.filter((row) => row.componentType !== 'Tiras'),
    ...calculatedStraps.map((row): ConsumptionRow => ({
      ...row,
      totalQuantity: 0,
      previewQuantity: Number(row.totalQuantity),
      productIds: [],
      warning: previewWarning,
    })),
  ];
}

export const COMPONENT_ORDER = ['Cabedal', 'Forração', 'Fachete', 'Palmilha', 'Forração Palmilha', 'Solado', 'Tiras', 'Químicos', 'Embalagem', 'Outros'] as const;

/** Normalização usada somente na apresentação/estoque de materiais não-tira. */
export const normTxt = (s: string) => (s || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .trim();

const netStock = (product: { quantity?: number | null; reserved_stock?: number | null } | undefined): number =>
  Math.max(0, (Number(product?.quantity) || 0) - (Number(product?.reserved_stock) || 0));

function extractStockGrade(product: any): Record<string, number> {
  const result: Record<string, number> = {};
  const grade = product?.stock_grade;
  if (!grade || typeof grade !== 'object') return result;
  for (const [size, value] of Object.entries(grade)) {
    if (size.startsWith('_')) continue;
    const quantity = Number(value);
    if (Number.isFinite(quantity)) result[size] = quantity;
  }
  return result;
}

/**
 * Anota disponibilidade e substitui as tiras agregadas por texto pelas linhas
 * canônicas resolvidas por UUID. O array de previews deve vir de
 * `preview_sale_order_strap_demand`. Sem snapshot canônico, linhas legadas de
 * tira nunca voltam a ser autoridade por nome/cor: uma pendência neutra continua
 * visível até o PV ser resolvido/reprocessado no hub.
 */
export async function annotateConsumptionAvailability(
  rows: MaterialConsumptionRow[],
  ctx: ConsumptionContext,
  strapPreviews: CanonicalStrapDemandPreview[] = [],
): Promise<{ rows: ConsumptionRow[]; artisanalStrapRows: ArtisanalStrapCutRow[] }> {
  const canonicalRows = attachUnresolvedStrapQuantityPreview(
    replaceWithCanonicalStrapRows(rows, ctx, strapPreviews) as ConsumptionRow[],
    rows,
    strapPreviews.length > 0,
  );

  const colorMatchesProduct = (product: any, color: string): boolean => {
    if (!color || color === '—') return true;
    const normalizedColor = normTxt(color);
    const productName = normTxt(product.name);
    const productColor = normTxt(product.color);
    if (productColor === normalizedColor || productName === normalizedColor) return true;
    const suffix = productName.includes(':')
      ? normTxt(productName.split(':').pop() || '')
      : productName.includes('-')
        ? normTxt(productName.split('-').pop() || '')
        : '';
    if (suffix && suffix === normalizedColor) return true;
    return productColor.length > 3
      && normalizedColor.length > 3
      && (normalizedColor.includes(productColor) || productColor.includes(normalizedColor));
  };

  const rowAvailable = (row: ConsumptionRow): number => {
    if (row.productIds && row.productIds.length > 0) {
      const wanted = new Set(row.productIds);
      return (ctx.allProducts || [])
        .filter((product: any) => wanted.has(product.id))
        .reduce((total: number, product: any) => total + netStock(product), 0);
    }
    const group = (ctx.productGroups || []).find((candidate: any) =>
      normTxt(candidate.name) === normTxt(row.groupName));
    return (ctx.allProducts || [])
      .filter((product: any) => {
        const belongs = group
          ? product.group_id === group.id
          : normTxt(product.name) === normTxt(row.groupName);
        return belongs && colorMatchesProduct(product, row.color);
      })
      .reduce((total: number, product: any) => total + netStock(product), 0);
  };

  const soleStock = (row: ConsumptionRow): Record<string, number> => {
    if (row.soleProductId) {
      return extractStockGrade((ctx.allProducts || []).find((product: any) => product.id === row.soleProductId));
    }
    const product = (ctx.allProducts || []).find((candidate: any) =>
      normTxt(candidate.name) === normTxt(row.groupName)
      && colorMatchesProduct(candidate, row.color))
      || (ctx.allProducts || []).find((candidate: any) =>
        normTxt(candidate.name) === normTxt(row.groupName));
    return extractStockGrade(product);
  };

  for (const row of canonicalRows) {
    if (row.componentType === 'Solado') row.soleSizeStock = soleStock(row);
    else if (row.available == null) row.available = rowAvailable(row);
  }

  const sortedRows = [...canonicalRows].sort((a, b) => {
    const typeDiff = COMPONENT_ORDER.indexOf(a.componentType as (typeof COMPONENT_ORDER)[number])
      - COMPONENT_ORDER.indexOf(b.componentType as (typeof COMPONENT_ORDER)[number]);
    if (typeDiff !== 0) return typeDiff;
    return a.groupName.localeCompare(b.groupName, 'pt-BR')
      || a.materialName.localeCompare(b.materialName, 'pt-BR')
      || a.color.localeCompare(b.color, 'pt-BR');
  });

  return {
    rows: sortedRows,
    artisanalStrapRows: canonicalStrapCutRows(strapPreviews),
  };
}

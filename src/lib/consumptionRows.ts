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
  /**
   * Preço unitário do produto/cor (ou caixa) resolvido para a linha.
   * Null quando não há SKU/caixa confiável ou o preço não veio no contexto.
   */
  unitPrice?: number | null;
  /** Snapshot explicativo da conversão canônica da tira interna em napa. */
  artisanal?: { baseName: string; baseQty: number; yieldPerMeter: number; pending?: boolean };
  strapVariantId?: string | null;
  strapSourceMode?: 'internal' | 'buy_ready' | null;
  recipeId?: string | null;
  baseProductId?: string | null;
  technicalStrapLineIds?: string[];
};

const normStrapLabel = (value: string) => (value || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim();

const strapCoveredByCanonical = (
  calculated: MaterialConsumptionRow,
  canonicalStraps: ConsumptionRow[],
): boolean => {
  const calculatedGroup = normStrapLabel(calculated.groupName || '');
  const calculatedFull = normStrapLabel(
    `${calculated.groupName || ''} ${calculated.materialName || ''}`,
  );
  if (!calculatedGroup && !calculatedFull) return false;

  return canonicalStraps.some((row) => {
    const canonicalGroup = normStrapLabel(row.groupName || '');
    const canonicalFull = normStrapLabel(
      `${row.groupName || ''} ${row.materialName || ''}`,
    );
    if (!canonicalGroup && !canonicalFull) return false;

    const calculatedStem = calculatedGroup.split(/\s*[·|]\s*/)[0]?.trim() || calculatedGroup;
    const canonicalStem = canonicalGroup.split(/\s*[·|]\s*/)[0]?.trim() || canonicalGroup;

    return (
      (calculatedStem && canonicalStem && (
        calculatedStem === canonicalStem
        || calculatedStem.includes(canonicalStem)
        || canonicalStem.includes(calculatedStem)
      ))
      || (calculatedFull && canonicalFull && (
        canonicalFull.includes(calculatedFull)
        || calculatedFull.includes(canonicalFull)
      ))
      || (/strass/i.test(calculatedFull) && /strass/i.test(canonicalFull))
    );
  });
};

/**
 * Preserva a quantidade calculada pela ficha como PRÉVIA quando a RPC canônica
 * ainda não devolveu nenhuma tira — ou quando devolveu só parte das linhas
 * (ex.: OVERLOCK na preview, STRASS só na ficha). As linhas órfãs ficam com
 * quantidade operacional zero e aviso, portanto não viram falta nem OC.
 */
export function attachUnresolvedStrapQuantityPreview(
  canonicalRows: ConsumptionRow[],
  calculatedRows: MaterialConsumptionRow[],
  hasCanonicalPreview: boolean,
): ConsumptionRow[] {
  const calculatedStraps = calculatedRows.filter((row) =>
    row.componentType === 'Tiras' && Number(row.totalQuantity) > 0);
  if (calculatedStraps.length === 0) return canonicalRows;

  const unresolvedWarning = canonicalRows.find((row) => row.componentType === 'Tiras')?.warning
    || 'A tira permanece bloqueada até resolver variante, base, cor e receita por ID.';
  const previewWarning = `${unresolvedWarning} A metragem exibida é somente uma prévia calculada pela ficha.`;

  const asPreview = (row: MaterialConsumptionRow): ConsumptionRow => ({
    ...row,
    totalQuantity: 0,
    previewQuantity: Number(row.totalQuantity),
    productIds: [],
    warning: previewWarning,
  });

  if (!hasCanonicalPreview) {
    return [
      ...canonicalRows.filter((row) => row.componentType !== 'Tiras'),
      ...calculatedStraps.map(asPreview),
    ];
  }

  // Preview parcial: não apagar STRASS (ou outra tira) calculada pela ficha
  // que a RPC omitiu porque o snapshot do item não tem o line_id.
  const canonicalStraps = canonicalRows.filter((row) => row.componentType === 'Tiras');
  const orphanCalculated = calculatedStraps.filter(
    (row) => !strapCoveredByCanonical(row, canonicalStraps),
  );
  if (orphanCalculated.length === 0) return canonicalRows;

  return [
    ...canonicalRows,
    ...orphanCalculated.map(asPreview),
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

const finiteNonNegativePrice = (value: unknown): number | null => {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

/**
 * Preço unitário do balde da linha (SKU pinado, solado, caixa ou grupo+cor).
 * Quando vários produtos/caixas batem, usa o primeiro preço finito em ordem
 * estável de id — divergência rara no mesmo balde; evita inventar média.
 */
export function resolveRowUnitPrice(
  row: Pick<ConsumptionRow, 'boxTypeIds' | 'productIds' | 'soleProductId' | 'groupName' | 'color' | 'colorMismatch'>,
  ctx: Pick<ConsumptionContext, 'allProducts' | 'productGroups' | 'boxTypes'>,
  colorMatchesProduct: (product: any, color: string) => boolean,
): number | null {
  if (row.colorMismatch) return null;

  if (row.boxTypeIds && row.boxTypeIds.length > 0) {
    const wanted = new Set(row.boxTypeIds);
    const boxes = (ctx.boxTypes || [])
      .filter((box) => wanted.has(box.id))
      .slice()
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
    for (const box of boxes) {
      const price = finiteNonNegativePrice(box.unit_price);
      if (price != null) return price;
    }
    return null;
  }

  if (row.soleProductId) {
    const product = (ctx.allProducts || []).find((entry: any) => entry.id === row.soleProductId);
    return finiteNonNegativePrice(product?.unit_price);
  }

  if (row.productIds && row.productIds.length > 0) {
    const wanted = new Set(row.productIds);
    const products = (ctx.allProducts || [])
      .filter((product: any) => wanted.has(product.id))
      .slice()
      .sort((a: any, b: any) => String(a.id).localeCompare(String(b.id)));
    for (const product of products) {
      const price = finiteNonNegativePrice(product.unit_price);
      if (price != null) return price;
    }
    return null;
  }

  const group = (ctx.productGroups || []).find((candidate: any) =>
    normTxt(candidate.name) === normTxt(row.groupName));
  const products = (ctx.allProducts || [])
    .filter((product: any) => {
      const belongs = group
        ? product.group_id === group.id
        : normTxt(product.name) === normTxt(row.groupName);
      return belongs && colorMatchesProduct(product, row.color);
    })
    .slice()
    .sort((a: any, b: any) => String(a.id).localeCompare(String(b.id)));
  for (const product of products) {
    const price = finiteNonNegativePrice(product.unit_price);
    if (price != null) return price;
  }
  return null;
}

/** Valor a gastar na linha = necessidade × preço unitário (null se sem preço). */
export function rowTotalCost(row: Pick<ConsumptionRow, 'totalQuantity' | 'unitPrice'>): number | null {
  const unit = row.unitPrice;
  if (unit == null || !Number.isFinite(unit)) return null;
  const qty = Number(row.totalQuantity) || 0;
  return qty * unit;
}

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
    if (row.colorMismatch) return 0;
    if (row.boxTypeIds && row.boxTypeIds.length > 0) {
      const wanted = new Set(row.boxTypeIds);
      return (ctx.boxTypes || [])
        .filter((box) => wanted.has(box.id))
        .reduce((total, box) => total + Math.max(0, Number(box.quantity) || 0), 0);
    }
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
    // Sem UUID canônico não existe balde de estoque confiável. Resolver pelo
    // texto podia escolher outro solado homônimo/cor e transformar pendência de
    // cadastro em uma falsa falta (ou falsa cobertura) na tela e na OC.
    return {};
  };

  for (const row of canonicalRows) {
    if (row.componentType === 'Solado') row.soleSizeStock = soleStock(row);
    else if (row.available == null) row.available = rowAvailable(row);
    if (row.unitPrice == null) {
      row.unitPrice = resolveRowUnitPrice(row, ctx, colorMatchesProduct);
    }
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

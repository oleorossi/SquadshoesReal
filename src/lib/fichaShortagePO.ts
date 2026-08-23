import { autoCreateMaterialPO, type MaterialAutoPOResult } from '@/lib/materialAutoPO';
import { qtyToBuyFromVariance, type VarianceLine } from '@/lib/fichaVariance';

export interface ShortagePOCandidate {
  productId: string;
  name: string;
  qty: number;
  unit?: string | null;
  reason: 'overage' | 'min_stock' | 'both';
}

export function shortageCandidatesFromVariance(
  lines: VarianceLine[],
  stockByProduct: Record<string, { stock: number; minStock: number; isArtisanal?: boolean }>,
): ShortagePOCandidate[] {
  const out: ShortagePOCandidate[] = [];
  for (const line of lines) {
    if (!line.productId) continue;
    const stock = stockByProduct[line.productId];
    if (!stock || stock.isArtisanal) continue;
    const qty = qtyToBuyFromVariance({
      theoretical: line.theoretical,
      actual: line.actual,
      stock: stock.stock,
      minStock: stock.minStock,
    });
    if (qty <= 0) continue;
    const overage = Math.max(0, line.actual - line.theoretical);
    const belowMin = Math.max(0, stock.minStock - stock.stock);
    out.push({
      productId: line.productId,
      name: line.name,
      qty,
      unit: line.unit,
      reason: overage > 0 && belowMin > 0 ? 'both' : overage > 0 ? 'overage' : 'min_stock',
    });
  }
  return out;
}

export async function createPOsFromVariance(params: {
  lines: VarianceLine[];
  stockByProduct: Record<string, { stock: number; minStock: number; isArtisanal?: boolean }>;
  orderRef: string;
}): Promise<MaterialAutoPOResult[]> {
  const candidates = shortageCandidatesFromVariance(params.lines, params.stockByProduct);
  const results: MaterialAutoPOResult[] = [];
  for (const c of candidates) {
    const po = await autoCreateMaterialPO({
      productId: c.productId,
      productName: c.name,
      shortageQty: c.qty,
      orderRef: params.orderRef,
      unit: c.unit || undefined,
    });
    if (po) results.push(po);
  }
  return results;
}

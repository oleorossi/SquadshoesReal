/**
 * Vínculo NF-e de entrada ↔ Ordem de Compra.
 *
 * Uma conferência: a NF casa com a OC escolhida, o estoque entra UMA vez
 * (via comando `receive` da OC) e o financeiro nasce da duplicata com
 * purchase_order_id + invoice_id. Sem OC selecionada a NF só cadastra —
 * não credita estoque.
 */

export const ALMOST_DELIVERED_WINDOW_DAYS = 7;
export const OPEN_PO_STATUSES = ['pending', 'approved', 'sent', 'parcial'] as const;

export type AlmostDeliveredPo = {
  id: string;
  order_number: string;
  status: string;
  promised_date: string | null;
  supplier_id?: string | null;
};

export function addDaysIso(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** OC aberta com prazo até hoje+7d (inclui atrasada). */
export function isAlmostDelivered(
  po: AlmostDeliveredPo,
  todayIso: string,
  windowDays = ALMOST_DELIVERED_WINDOW_DAYS,
): boolean {
  if (!OPEN_PO_STATUSES.includes(po.status as (typeof OPEN_PO_STATUSES)[number])) return false;
  if (!po.promised_date) return false;
  return po.promised_date <= addDaysIso(todayIso, windowDays);
}

export function filterAlmostDelivered<T extends AlmostDeliveredPo>(
  orders: T[],
  todayIso: string,
  windowDays = ALMOST_DELIVERED_WINDOW_DAYS,
): T[] {
  return orders
    .filter((po) => isAlmostDelivered(po, todayIso, windowDays))
    .sort((a, b) => (a.promised_date || '').localeCompare(b.promised_date || ''));
}

export type MatchableProduct = {
  id: string;
  name: string;
  sku: string | null;
  color?: string | null;
};

const norm = (s: string) =>
  s.trim().toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

const stripNoise = (s: string) => {
  let n = norm(s);
  n = n.replace(/^ONU\s+[\d]+[\s,]*/, '');
  n = n.replace(/\b(CONTENDO|LIQUIDO|INFLAMAVEL|CLASSE|SUBCLASSE|RISCO|SUBSIDIARIO)\b/g, '');
  n = n.replace(/\b\d+\s+\d+\s+(I{1,3}|IV|V)\b/g, '');
  n = n.replace(/\b(SACO|BALDE|LATA|FRASCO|GALAO|BISNAGA|TUBO|AMOSTRA)\b/g, '');
  n = n.replace(/\b\d+\s*(KG|GR|G|ML|L|LT|UN|PC|MT|M)\b/gi, '');
  return n.replace(/\s+/g, ' ').trim();
};

function disambiguateByColor<T extends MatchableProduct>(candidates: T[], nfName: string): T | undefined {
  if (candidates.length <= 1) return candidates[0] ?? undefined;
  const nfNorm = norm(nfName);
  const byColor = candidates.filter((p) => p.color && nfNorm.includes(norm(p.color)));
  return byColor.length === 1 ? byColor[0] : undefined;
}

/** Pipeline NF→produto (SKU → nome → NOME:COR → ruído → contains), desambiguado por cor. */
export function matchNfItemToProduct<T extends MatchableProduct>(
  products: T[],
  productName: string,
  productCode: string | null | undefined,
): T | undefined {
  let match = products.find((p) =>
    p.sku && productCode && p.sku.trim().toLowerCase() === productCode.trim().toLowerCase(),
  );
  if (!match) {
    const normName = norm(productName);
    match = disambiguateByColor(products.filter((p) => norm(p.name) === normName), productName);
  }
  if (!match) {
    const normName = norm(productName);
    match = products.find((p) => {
      const pName = norm(p.name);
      const colonIdx = pName.indexOf(':');
      if (colonIdx > 0) {
        const baseName = pName.slice(0, colonIdx).trim();
        const colorName = pName.slice(colonIdx + 1).trim();
        return normName === `${baseName} ${colorName}`;
      }
      return false;
    });
  }
  if (!match) {
    const stripped = stripNoise(productName);
    if (stripped.length >= 3) {
      const cands = products.filter((p) => {
        const pStripped = stripNoise(p.name);
        return pStripped.length >= 3 && (stripped.includes(pStripped) || pStripped.includes(stripped));
      });
      match = disambiguateByColor(cands, productName);
    }
  }
  if (!match) {
    const normName = norm(productName);
    const cands = products.filter((p) => {
      const pName = norm(p.name);
      return pName.length >= 4 && normName.length >= 4 && (normName.includes(pName) || pName.includes(normName));
    });
    match = disambiguateByColor(cands, productName);
  }
  return match;
}

export type OpenPoItem = {
  id: string;
  product_id: string | null;
  quantity: number;
  received_quantity?: number | null;
  received_at?: string | null;
};

export type OpenPoCandidate = AlmostDeliveredPo & {
  items: OpenPoItem[];
};

export type NfLineForMatch = {
  productName: string;
  productCode?: string | null;
};

export function overlappingOpenPos<T extends OpenPoCandidate>(
  orders: T[],
  matchedProductIds: Set<string>,
): T[] {
  return orders.filter((po) =>
    OPEN_PO_STATUSES.includes(po.status as (typeof OPEN_PO_STATUSES)[number]) &&
    po.items.some((item) =>
      !!item.product_id &&
      !item.received_at &&
      matchedProductIds.has(item.product_id) &&
      Number(item.quantity) - Number(item.received_quantity ?? 0) > 0.0001,
    ),
  );
}

/** Prefere quase entregue com overlap; senão overlap; senão quase entregue do fornecedor. */
export function pickDefaultPurchaseOrder<T extends OpenPoCandidate>(
  orders: T[],
  matchedProductIds: Set<string>,
  todayIso: string,
): T | null {
  if (orders.length === 0) return null;
  const almost = filterAlmostDelivered(orders, todayIso);
  const overlap = overlappingOpenPos(orders, matchedProductIds);
  const almostOverlap = overlap.filter((po) => almost.some((a) => a.id === po.id));
  if (almostOverlap.length > 0) return almostOverlap[0];
  if (overlap.length > 0) return overlap[0];
  if (almost.length > 0) return almost[0];
  return orders[0] ?? null;
}

export type ReceiveReceipt = {
  item_id: string;
  quantity: number;
  expected_received_quantity: number;
};

/** Recibos da OC para os produtos casados com a NF — quantidade = saldo em aberto. */
export function buildReceiveReceipts(
  poItems: OpenPoItem[],
  matchedProductIds: Set<string>,
): ReceiveReceipt[] {
  const receipts: ReceiveReceipt[] = [];
  for (const item of poItems) {
    if (!item.product_id || !matchedProductIds.has(item.product_id)) continue;
    if (item.received_at) continue;
    const already = Number(item.received_quantity ?? 0);
    const remaining = Number(item.quantity) - already;
    if (remaining <= 0.0001) continue;
    receipts.push({
      item_id: item.id,
      quantity: remaining,
      expected_received_quantity: already,
    });
  }
  return receipts;
}

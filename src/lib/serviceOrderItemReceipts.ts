export interface ServiceOrderReceiptItem {
  sale_order_item_id: string;
  sale_order_id: string;
  pv_number: string | null;
  op_number: string | null;
  reference_code: string | null;
  reference_name: string | null;
  color: string | null;
  contracted_qty: number;
  qty_good: number;
  qty_defect: number;
  qty_defect_scrapped: number;
  qty_loss: number;
  qty_settled: number;
  qty_remaining: number;
  unallocated_return_qty: number;
}

export interface ServiceOrderItemReceiptEntry {
  qtyGood: number;
  qtyDefect: number;
  qtyDefectScrapped: number;
  qtyLoss: number;
}

export type ServiceOrderItemReceiptField = keyof ServiceOrderItemReceiptEntry;

export interface ServiceOrderItemReceiptPayload {
  sale_order_item_id: string;
  qty_good: number;
  qty_defect: number;
  qty_defect_scrapped: number;
  qty_loss: number;
}

export const EMPTY_SERVICE_ORDER_ITEM_RECEIPT: ServiceOrderItemReceiptEntry = {
  qtyGood: 0,
  qtyDefect: 0,
  qtyDefectScrapped: 0,
  qtyLoss: 0,
};

const wholeNonNegative = (value: number) => Math.max(0, Math.trunc(Number(value) || 0));
const nullableText = (value: unknown) => typeof value === 'string' && value.length > 0 ? value : null;

export function normalizeServiceOrderReceiptItems(value: unknown): ServiceOrderReceiptItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(row => {
    if (!row || typeof row !== 'object') return [];
    const source = row as Record<string, unknown>;
    const itemId = nullableText(source.sale_order_item_id);
    const saleOrderId = nullableText(source.sale_order_id);
    if (!itemId || !saleOrderId) return [];
    return [{
      sale_order_item_id: itemId,
      sale_order_id: saleOrderId,
      pv_number: nullableText(source.pv_number),
      op_number: nullableText(source.op_number),
      reference_code: nullableText(source.reference_code),
      reference_name: nullableText(source.reference_name),
      color: nullableText(source.color),
      contracted_qty: Number(source.contracted_qty) || 0,
      qty_good: Number(source.qty_good) || 0,
      qty_defect: Number(source.qty_defect) || 0,
      qty_defect_scrapped: Number(source.qty_defect_scrapped) || 0,
      qty_loss: Number(source.qty_loss) || 0,
      qty_settled: Number(source.qty_settled) || 0,
      qty_remaining: Number(source.qty_remaining) || 0,
      unallocated_return_qty: Number(source.unallocated_return_qty) || 0,
    }];
  });
}

/** Quantidade física que voltou. Sucata é um destino do defeito, não uma soma extra. */
export function serviceOrderItemPhysicalTotal(entry: ServiceOrderItemReceiptEntry): number {
  return wholeNonNegative(entry.qtyGood)
    + wholeNonNegative(entry.qtyDefect)
    + wholeNonNegative(entry.qtyLoss);
}

/**
 * Mantém a linha dentro do saldo do item enquanto o operador digita.
 * O defeito sucateado nunca pode superar o total de defeituosos.
 */
export function updateServiceOrderItemReceiptEntry(
  current: ServiceOrderItemReceiptEntry,
  field: ServiceOrderItemReceiptField,
  value: number,
  remaining: number,
): ServiceOrderItemReceiptEntry {
  const next = { ...current };
  const limit = wholeNonNegative(remaining);
  const requested = wholeNonNegative(value);

  if (field === 'qtyDefectScrapped') {
    next.qtyDefectScrapped = Math.min(requested, wholeNonNegative(next.qtyDefect));
    return next;
  }

  const otherPhysical = (field === 'qtyGood' ? 0 : wholeNonNegative(next.qtyGood))
    + (field === 'qtyDefect' ? 0 : wholeNonNegative(next.qtyDefect))
    + (field === 'qtyLoss' ? 0 : wholeNonNegative(next.qtyLoss));
  next[field] = Math.min(requested, Math.max(0, limit - otherPhysical));

  if (field === 'qtyDefect') {
    next.qtyDefectScrapped = Math.min(
      wholeNonNegative(next.qtyDefectScrapped),
      wholeNonNegative(next.qtyDefect),
    );
  }
  return next;
}

export function summarizeServiceOrderItemReceipts(
  entries: Record<string, ServiceOrderItemReceiptEntry>,
): ServiceOrderItemReceiptEntry {
  return Object.values(entries).reduce<ServiceOrderItemReceiptEntry>((total, entry) => ({
    qtyGood: total.qtyGood + wholeNonNegative(entry.qtyGood),
    qtyDefect: total.qtyDefect + wholeNonNegative(entry.qtyDefect),
    qtyDefectScrapped: total.qtyDefectScrapped + Math.min(
      wholeNonNegative(entry.qtyDefectScrapped),
      wholeNonNegative(entry.qtyDefect),
    ),
    qtyLoss: total.qtyLoss + wholeNonNegative(entry.qtyLoss),
  }), { ...EMPTY_SERVICE_ORDER_ITEM_RECEIPT });
}

export function serviceOrderItemReceiptPayload(
  entries: Record<string, ServiceOrderItemReceiptEntry>,
): ServiceOrderItemReceiptPayload[] {
  return Object.entries(entries).flatMap(([saleOrderItemId, entry]) => {
    if (serviceOrderItemPhysicalTotal(entry) <= 0) return [];
    return [{
      sale_order_item_id: saleOrderItemId,
      qty_good: wholeNonNegative(entry.qtyGood),
      qty_defect: wholeNonNegative(entry.qtyDefect),
      qty_defect_scrapped: Math.min(
        wholeNonNegative(entry.qtyDefectScrapped),
        wholeNonNegative(entry.qtyDefect),
      ),
      qty_loss: wholeNonNegative(entry.qtyLoss),
    }];
  });
}

/**
 * O atalho de recebimento total só autoaloca quando o saldo por item fecha
 * exatamente com o saldo físico da OS. Em cadastro legado divergente, devolve
 * null para preservar o caminho agregado sem inventar qual item chegou.
 */
export function buildFullServiceOrderItemReceipt(
  rows: ServiceOrderReceiptItem[],
  inField: number,
): ServiceOrderItemReceiptPayload[] | null {
  if (rows.length === 0 || rows.some(row => wholeNonNegative(row.unallocated_return_qty) > 0)) {
    return null;
  }
  const openRows = rows.filter(row => wholeNonNegative(row.qty_remaining) > 0);
  const itemTotal = openRows.reduce((sum, row) => sum + wholeNonNegative(row.qty_remaining), 0);
  if (itemTotal !== wholeNonNegative(inField) || itemTotal <= 0) return null;

  return openRows.map(row => ({
    sale_order_item_id: row.sale_order_item_id,
    qty_good: wholeNonNegative(row.qty_remaining),
    qty_defect: 0,
    qty_defect_scrapped: 0,
    qty_loss: 0,
  }));
}

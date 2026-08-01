export interface SkuIndexEntry {
  id: string;
  isSole: boolean;
  active: boolean;
}

export interface PasteMatch {
  productId: string;
  sku: string;
  qty: number;
  line: number;
}

export interface PasteReject {
  line: number;
  sku: string;
  rawQty: string;
  reason: string;
}

export interface PasteResult {
  matched: PasteMatch[];
  rejected: PasteReject[];
  headerSkipped: boolean;
}

export function normalizeSku(raw: string): string {
  return raw.trim().toUpperCase();
}

export function parseQuantityBR(raw: string): number | null {
  const compact = raw.trim().replace(/[\s\u00a0]/g, "");
  if (!compact) return null;

  let normalized = compact;
  if (normalized.includes(",")) {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(normalized)) {
    normalized = normalized.replace(/\./g, "");
  }

  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return null;

  const parsed = parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseStockPaste(
  text: string,
  bySku: Map<string, SkuIndexEntry | "ambiguous">,
): PasteResult {
  const lines = text.replace(/\r/g, "").split("\n");
  const matchedBySku = new Map<string, PasteMatch>();
  const rejected: PasteReject[] = [];
  let headerSkipped = false;
  let sawFirstNonEmpty = false;

  lines.forEach((rawLine, index) => {
    if (rawLine.trim() === "") return;

    const line = index + 1;
    const hasQuantityColumn = rawLine.includes("\t");
    const cols = rawLine.split("\t");
    const rawSku = cols[0] ?? "";
    const rawQty = cols[1] ?? "";
    const sku = normalizeSku(rawSku);

    if (!sawFirstNonEmpty) {
      sawFirstNonEmpty = true;
      if (hasQuantityColumn && parseQuantityBR(rawQty) === null && !bySku.has(sku)) {
        headerSkipped = true;
        return;
      }
    }

    if (!hasQuantityColumn) {
      rejected.push({ line, sku, rawQty, reason: "linha sem coluna de quantidade" });
      return;
    }
    if (!sku) {
      rejected.push({ line, sku, rawQty, reason: "SKU vazio" });
      return;
    }

    const entry = bySku.get(sku);
    if (!entry) {
      rejected.push({ line, sku, rawQty, reason: "SKU não encontrado" });
      return;
    }
    if (entry === "ambiguous") {
      rejected.push({ line, sku, rawQty, reason: "SKU ambíguo (duplicado no cadastro)" });
      return;
    }
    if (!entry.active) {
      rejected.push({ line, sku, rawQty, reason: "produto inativo" });
      return;
    }
    if (entry.isSole) {
      rejected.push({
        line,
        sku,
        rawQty,
        reason: "solado exige quantidade por numeração — edite expandindo a linha",
      });
      return;
    }

    const qty = parseQuantityBR(rawQty);
    if (qty === null) {
      rejected.push({ line, sku, rawQty, reason: "quantidade inválida" });
      return;
    }
    if (qty < 0) {
      rejected.push({ line, sku, rawQty, reason: "quantidade negativa não permitida" });
      return;
    }

    matchedBySku.delete(sku);
    matchedBySku.set(sku, { productId: entry.id, sku, qty, line });
  });

  return {
    matched: Array.from(matchedBySku.values()),
    rejected,
    headerSkipped,
  };
}

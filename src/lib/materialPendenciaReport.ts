/**
 * Agregação do Relatório de Pendência — materiais com quantity_short
 * em PVs Aprovado / Em Produção.
 *
 * Fonte = mesmo selo "Falta material" (`list_sale_order_material_shortages`).
 * A página agrega por product_id; o drill-down lista PVs ordenados pela
 * semana de faturamento (mais próxima em cima).
 */

import {
  formatShortageGrade,
  formatShortageQuantity,
  shortageMaterialLabel,
  type MaterialShortageLine,
  type SaleOrderMaterialShortageInfo,
} from '@/hooks/useSaleOrderMaterialShortages';

export type PendenciaPvMeta = {
  id: string;
  orderNumber: string | null;
  clientName: string | null;
  billingWeek: string | null;
  deliveryDeadline: string | null;
  status: string | null;
};

export type PendenciaPvLine = {
  saleOrderId: string;
  orderNumber: string | null;
  clientName: string | null;
  billingWeek: string | null;
  deliveryDeadline: string | null;
  quantityShort: number;
  shortageGrade: Record<string, number> | null;
  unit: string | null;
};

export type PendenciaMaterialRow = {
  productId: string;
  productName: string;
  color: string | null;
  unit: string | null;
  quantityShort: number;
  shortageGrade: Record<string, number> | null;
  pvCount: number;
  pvs: PendenciaPvLine[];
  emCompra: number;
};

export type OcCoverageFilter = 'all' | 'sem_oc' | 'em_compra';

/** 1º dia útil da semana de faturamento (`2026-05-S4` / `2026-W16`) → ISO date, ou null. */
export function billingWeekSortKey(billingWeek: string | null | undefined): string {
  const raw = (billingWeek || '').trim();
  if (!raw) return '9999-99-99';
  // Já é data ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  // Formato squad: 2026-05-S4 (mês + semana do mês)
  const squad = raw.match(/^(\d{4})-(\d{2})-S(\d+)$/i);
  if (squad) {
    const year = Number(squad[1]);
    const month = Number(squad[2]);
    const week = Number(squad[3]);
    const day = Math.min(28, Math.max(1, (week - 1) * 7 + 1));
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  // ISO week: 2026-W16
  const iso = raw.match(/^(\d{4})-W(\d{1,2})$/i);
  if (iso) {
    const year = Number(iso[1]);
    const week = Number(iso[2]);
    // Segunda da semana ISO (aprox. suficiente pra ordenar)
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const day = jan4.getUTCDay() || 7;
    const monday = new Date(jan4);
    monday.setUTCDate(jan4.getUTCDate() - day + 1 + (week - 1) * 7);
    return monday.toISOString().slice(0, 10);
  }
  return raw;
}

export function comparePendenciaPv(a: PendenciaPvLine, b: PendenciaPvLine): number {
  const bk = billingWeekSortKey(a.billingWeek).localeCompare(billingWeekSortKey(b.billingWeek));
  if (bk !== 0) return bk;
  const dk = (a.deliveryDeadline || '9999-99-99').localeCompare(b.deliveryDeadline || '9999-99-99');
  if (dk !== 0) return dk;
  return (a.orderNumber || '').localeCompare(b.orderNumber || '', 'pt-BR', { numeric: true });
}

function mergeGrade(
  a: Record<string, number> | null,
  b: Record<string, number> | null,
): Record<string, number> | null {
  if (!a && !b) return null;
  const out: Record<string, number> = { ...(a || {}) };
  for (const [k, v] of Object.entries(b || {})) {
    if (k.startsWith('_')) continue;
    const n = Number(v) || 0;
    if (n <= 0) continue;
    out[k] = (out[k] || 0) + n;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Agrega o mapa de faltas por PV em linhas por product_id.
 * PVs sem product_id na linha são ignorados (não há o que comprar).
 */
export function aggregateMaterialPendencias(
  shortageByPv: ReadonlyMap<string, SaleOrderMaterialShortageInfo>,
  pvMetaById: ReadonlyMap<string, PendenciaPvMeta>,
  emCompraByProduct: ReadonlyMap<string, number> = new Map(),
): PendenciaMaterialRow[] {
  const byProduct = new Map<string, PendenciaMaterialRow>();

  for (const [saleOrderId, info] of shortageByPv) {
    const meta = pvMetaById.get(saleOrderId);
    for (const line of info.shortages) {
      if (!line.product_id || line.quantity_short <= 0) continue;
      let row = byProduct.get(line.product_id);
      if (!row) {
        row = {
          productId: line.product_id,
          productName: line.product_name,
          color: line.color,
          unit: line.unit,
          quantityShort: 0,
          shortageGrade: null,
          pvCount: 0,
          pvs: [],
          emCompra: emCompraByProduct.get(line.product_id) ?? 0,
        };
        byProduct.set(line.product_id, row);
      }
      row.quantityShort += line.quantity_short;
      row.shortageGrade = mergeGrade(row.shortageGrade, line.shortage_grade);
      row.pvs.push({
        saleOrderId,
        orderNumber: info.orderNumber ?? meta?.orderNumber ?? null,
        clientName: meta?.clientName ?? null,
        billingWeek: meta?.billingWeek ?? null,
        deliveryDeadline: meta?.deliveryDeadline ?? null,
        quantityShort: line.quantity_short,
        shortageGrade: line.shortage_grade,
        unit: line.unit,
      });
    }
  }

  const rows = [...byProduct.values()];
  for (const row of rows) {
    row.pvs.sort(comparePendenciaPv);
    row.pvCount = row.pvs.length;
    row.emCompra = emCompraByProduct.get(row.productId) ?? row.emCompra;
  }
  rows.sort((a, b) => b.quantityShort - a.quantityShort
    || pendenciaMaterialLabel(a).localeCompare(pendenciaMaterialLabel(b), 'pt-BR'));
  return rows;
}

export function filterPendenciaRows(
  rows: PendenciaMaterialRow[],
  opts: { search?: string; coverage?: OcCoverageFilter },
): PendenciaMaterialRow[] {
  const q = (opts.search || '').trim().toLowerCase();
  const coverage = opts.coverage || 'all';
  return rows.filter((row) => {
    if (coverage === 'sem_oc' && row.emCompra > 0.0001) return false;
    if (coverage === 'em_compra' && row.emCompra <= 0.0001) return false;
    if (!q) return true;
    const hay = [
      row.productName,
      row.color,
      row.unit,
      ...row.pvs.map((p) => p.orderNumber),
      ...row.pvs.map((p) => p.clientName),
    ].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(q);
  });
}

export function formatPendenciaQty(qty: number, unit: string | null | undefined): string {
  return formatShortageQuantity(qty, unit);
}

export function formatPendenciaGrade(grade: Record<string, number> | null | undefined): string | null {
  return formatShortageGrade(grade);
}

export function pendenciaMaterialLabel(row: Pick<PendenciaMaterialRow, 'productName' | 'color'>): string {
  return shortageMaterialLabel({ product_name: row.productName, color: row.color } as MaterialShortageLine);
}

/** Status comerciais com demanda ativa de material (selo + compras). */
export const PENDENCIA_ACTIVE_STATUSES = ['Aprovado', 'Em Produção'] as const;

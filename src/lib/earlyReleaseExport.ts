import { formatUnitLabel } from '@/lib/unitLabels';
import { normalizeKitComponentType, isStageKitComponent } from '@/lib/serviceOrderStageQueue';
import { safeFormatBR } from '@/lib/date';
import type { EarlyReleaseOp, EarlyReleaseRow } from '@/lib/earlyReleaseBoard';
import { uniqueLabels } from '@/lib/earlyReleaseBoard';

/** Kit do Aviamento (BOM + Componente Direto). Costura Cabedal entra Cabedal. */
const MATERIAL_TYPE_ORDER = ['Cabedal', 'BOM', 'Componente Direto', 'Tiras'] as const;

export function isAntecipacaoMaterialType(componentType: string | null | undefined): boolean {
  const t = normalizeKitComponentType(componentType);
  return isStageKitComponent('mesa', t) || isStageKitComponent('costura', t) || t === 'Tiras';
}

export function materialTypeRank(type: string): number {
  const i = MATERIAL_TYPE_ORDER.indexOf(type as (typeof MATERIAL_TYPE_ORDER)[number]);
  return i === -1 ? MATERIAL_TYPE_ORDER.length : i;
}

export interface AviamentoSummaryRow {
  reference_name: string;
  color: string;
  pairs: number;
  pvNumbers: string;
  clientOrderNumbers: string;
  opNumbers: string;
  aviamento: string;
  cabedal: string;
  cortes: string;
  daysAhead: number;
}

export interface AntecipacaoMaterialRow {
  reference_name: string;
  color: string;
  componentType: string;
  sale_order_number: string;
  client_order_number: string;
  materialName: string;
  materialColor: string;
  quantity: number;
  unit: string;
  opNumbers: string;
}

export interface EarlyMaterialFact {
  order_id: string;
  componentType: string;
  groupName: string;
  materialName: string;
  materialColor: string;
  quantity: number;
  unit: string;
}

function laneRange(row: EarlyReleaseRow, key: EarlyReleaseRow['lanes'][number]['key']): string {
  const lane = row.lanes.find((l) => l.key === key);
  if (!lane?.start) return '';
  const a = safeFormatBR(lane.start, '', 'dd/MM');
  const b = safeFormatBR(lane.end, '', 'dd/MM');
  return a && b ? `${a} → ${b}` : a || b;
}

function joinLabels(values: string[]): string {
  return values.join(', ');
}

/** Aba 1: só texto, quantidade por referência + cor (agrupamento do Aviamento). */
export function buildAviamentoSummaryRows(rows: EarlyReleaseRow[]): AviamentoSummaryRow[] {
  return rows.map((row) => ({
    reference_name: row.reference_name,
    color: row.color || '—',
    pairs: row.pairs,
    pvNumbers: joinLabels(row.pvNumbers),
    clientOrderNumbers: joinLabels(row.clientOrderNumbers),
    opNumbers: joinLabels(row.opNumbers),
    aviamento: laneRange(row, 'aviamento'),
    cabedal: laneRange(row, 'cabedal'),
    cortes: laneRange(row, 'cortes'),
    daysAhead: row.daysAhead,
  }));
}

/**
 * Aba 2: destrinchado pelos agrupamentos, independente do pedido.
 * 1º referência+cor · 2º tipo de material · 3º mesmo pedido.
 */
export function buildAntecipacaoMaterialRows(
  ops: EarlyReleaseOp[],
  facts: EarlyMaterialFact[],
): AntecipacaoMaterialRow[] {
  const opById = new Map(ops.map((o) => [o.order_id, o]));
  const agg = new Map<string, {
    reference_name: string;
    color: string;
    componentType: string;
    sale_order_number: string;
    client_order_number: string;
    materialName: string;
    materialColor: string;
    quantity: number;
    unit: string;
    opNumbers: string[];
  }>();

  for (const fact of facts) {
    if (!(fact.quantity > 0)) continue;
    const type = normalizeKitComponentType(fact.componentType);
    if (!isAntecipacaoMaterialType(type)) continue;
    const op = opById.get(fact.order_id);
    if (!op || !op.reference_id) continue;
    const color = (op.color || '').trim();
    const sale = (op.sale_order_number || '').trim();
    const client = (op.client_order_number || '').trim();
    const materialName = (fact.groupName || fact.materialName || '').trim();
    const materialColor = (fact.materialColor || '').trim();
    const unit = formatUnitLabel(fact.unit);
    const key = [
      op.reference_id,
      color.toUpperCase(),
      type,
      op.sale_order_id || sale,
      materialName.toUpperCase(),
      materialColor.toUpperCase(),
      unit,
    ].join('::');
    const existing = agg.get(key);
    if (existing) {
      existing.quantity += fact.quantity;
      if (op.order_number) existing.opNumbers.push(op.order_number);
      continue;
    }
    agg.set(key, {
      reference_name: op.reference_name || '',
      color,
      componentType: type,
      sale_order_number: sale,
      client_order_number: client,
      materialName,
      materialColor,
      quantity: fact.quantity,
      unit,
      opNumbers: op.order_number ? [op.order_number] : [],
    });
  }

  const rows = [...agg.values()].map((r) => ({
    reference_name: r.reference_name,
    color: r.color || '—',
    componentType: r.componentType,
    sale_order_number: r.sale_order_number,
    client_order_number: r.client_order_number,
    materialName: r.materialName,
    materialColor: r.materialColor,
    quantity: r.quantity,
    unit: r.unit,
    opNumbers: joinLabels(uniqueLabels(r.opNumbers)),
  }));

  rows.sort((a, b) =>
    a.reference_name.localeCompare(b.reference_name, 'pt-BR')
    || a.color.localeCompare(b.color, 'pt-BR')
    || materialTypeRank(a.componentType) - materialTypeRank(b.componentType)
    || a.componentType.localeCompare(b.componentType, 'pt-BR')
    || a.sale_order_number.localeCompare(b.sale_order_number, 'pt-BR')
    || a.materialName.localeCompare(b.materialName, 'pt-BR')
    || a.materialColor.localeCompare(b.materialColor, 'pt-BR'),
  );
  return rows;
}

export interface NestedMaterialOrder {
  sale_order_number: string;
  client_order_number: string;
  lines: AntecipacaoMaterialRow[];
}

export interface NestedMaterialType {
  componentType: string;
  orders: NestedMaterialOrder[];
}

export interface NestedMaterialGroup {
  reference_name: string;
  color: string;
  types: NestedMaterialType[];
}

/** Mesma hierarquia da aba 2: agrupamento → tipo de material → pedido. */
export function nestAntecipacaoMaterials(rows: AntecipacaoMaterialRow[]): NestedMaterialGroup[] {
  const groups: NestedMaterialGroup[] = [];
  for (const row of rows) {
    let group = groups.find((g) => g.reference_name === row.reference_name && g.color === row.color);
    if (!group) {
      group = { reference_name: row.reference_name, color: row.color, types: [] };
      groups.push(group);
    }
    let type = group.types.find((t) => t.componentType === row.componentType);
    if (!type) {
      type = { componentType: row.componentType, orders: [] };
      group.types.push(type);
    }
    let order = type.orders.find((o) =>
      o.sale_order_number === row.sale_order_number && o.client_order_number === row.client_order_number);
    if (!order) {
      order = {
        sale_order_number: row.sale_order_number,
        client_order_number: row.client_order_number,
        lines: [],
      };
      type.orders.push(order);
    }
    order.lines.push(row);
  }
  return groups;
}

export async function downloadAntecipacaoXlsx(input: {
  summary: AviamentoSummaryRow[];
  materials: AntecipacaoMaterialRow[];
}): Promise<void> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Squad Shoes';
  const stamp = new Date().toISOString().slice(0, 10);

  const ws1 = wb.addWorksheet('Aviamento');
  ws1.columns = [
    { header: 'Referência', key: 'reference_name', width: 18 },
    { header: 'Cor', key: 'color', width: 18 },
    { header: 'Pares', key: 'pairs', width: 10 },
    { header: 'Pedido sistema', key: 'pvNumbers', width: 22 },
    { header: 'Pedido cliente', key: 'clientOrderNumbers', width: 22 },
    { header: 'OPs', key: 'opNumbers', width: 28 },
    { header: 'Aviamento', key: 'aviamento', width: 16 },
    { header: 'Costura Cabedal', key: 'cabedal', width: 16 },
    { header: 'Cortes', key: 'cortes', width: 16 },
    { header: 'Dias na frente', key: 'daysAhead', width: 14 },
  ];
  input.summary.forEach((row) => ws1.addRow(row));

  const ws2 = wb.addWorksheet('Materiais');
  ws2.columns = [
    { header: 'Referência', key: 'reference_name', width: 18 },
    { header: 'Cor', key: 'color', width: 18 },
    { header: 'Tipo de material', key: 'componentType', width: 20 },
    { header: 'Pedido sistema', key: 'sale_order_number', width: 18 },
    { header: 'Pedido cliente', key: 'client_order_number', width: 18 },
    { header: 'Material', key: 'materialName', width: 28 },
    { header: 'Cor do material', key: 'materialColor', width: 18 },
    { header: 'Quantidade', key: 'quantity', width: 12 },
    { header: 'Unidade', key: 'unit', width: 10 },
    { header: 'OPs', key: 'opNumbers', width: 28 },
  ];
  input.materials.forEach((row) => ws2.addRow(row));

  for (const ws of [ws1, ws2]) {
    const header = ws.getRow(1);
    header.font = { bold: true };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: ws.columnCount },
    };
  }
  ws2.getColumn('quantity').numFmt = '#,##0.00';

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `antecipacao_${stamp}.xlsx`;
  a.click();
  window.URL.revokeObjectURL(url);
}

/**
 * Exports the same grouped sector report data that printCombinedSectorReport renders
 * as an XLSX file — one sheet per sector plus a "Resumo Geral" sheet.
 */

const SIZES = ['17','18','19','20','21','22','23','24','25','26','27','28','29','30','31','32','33','34','35','36','37','38','39','40','41','42','43','44','45'];

type OrderData = {
  id: string;
  order_number: string;
  reference_id: string;
  color: string;
  quantity: number;
  grade: Record<string, number> | null;
  status: string;
  sale_order_id?: string | null;
};

type ReferenceData = {
  id: string;
  code: string;
  name: string;
  shoe_category?: string;
};

type SaleOrderData = {
  id: string;
  order_number?: string;
  client_name?: string;
  client_order_number?: string;
};

function classifyCategory(shoeCategory: string | undefined): string {
  const cat = (shoeCategory || '').toLowerCase().trim();
  if (cat.includes('infantil') || cat.includes('kids') || cat.includes('criança') || cat.includes('bebe') || cat.includes('bebê')) return 'Infantil';
  if (cat.includes('adulto') || cat.includes('adult') || cat.includes('feminino') || cat.includes('masculino')) return 'Adulto';
  return 'Sem Categoria';
}

function deriveSoleType(color: string): string {
  const c = (color || '').toLowerCase().trim();
  if (c.includes('pret') || c.includes('black') || c === 'pb') return 'Solado Preto';
  return 'Solado Caramelo';
}

type GroupRow = {
  soleType: string;
  category: string;
  refCode: string;
  refName: string;
  color: string;
  strapsLabel: string;
  opNumbers: string;
  clients: string;
  sizes: Record<string, number>;
  totalPairs: number;
};

function buildGroupRows(
  sectorName: string,
  orders: OrderData[],
  references: ReferenceData[],
  getStrapsLabel?: (order: any) => string,
  saleOrders?: SaleOrderData[],
): GroupRow[] {
  const groupMap = new Map<string, {
    soleType: string; category: string; refCode: string; refName: string;
    color: string; strapsLabel: string; opNumbers: string[]; clients: Set<string>;
    sizes: Record<string, number>; totalPairs: number;
  }>();

  for (const order of orders) {
    const ref = references.find(r => r.id === order.reference_id);
    if (!ref) continue;
    const grade = order.grade || {};
    const gradeSum = Object.values(grade).reduce((s, v) => s + Number(v), 0);
    const totalPairs = order.quantity || gradeSum || 0;
    const multiplier = gradeSum > 0 ? totalPairs / gradeSum : 0;
    const color = order.color || '—';
    const category = classifyCategory(ref.shoe_category);
    const soleType = deriveSoleType(color);
    const strapsLabel = (() => { try { return getStrapsLabel?.(order) || ''; } catch { return ''; } })();
    const storeKey = sectorName === 'Acabamento' ? (order.sale_order_id || '__NO_SO__') : '__ALL__';
    const key = `${soleType}|${category}|${order.reference_id}|${color.toUpperCase()}|${strapsLabel}|${storeKey}`;

    if (!groupMap.has(key)) {
      groupMap.set(key, {
        soleType, category, refCode: ref.code || '', refName: ref.name || '',
        color, strapsLabel, opNumbers: [], clients: new Set(), sizes: {}, totalPairs: 0,
      });
    }
    const g = groupMap.get(key)!;
    g.opNumbers.push(order.order_number);
    g.totalPairs += totalPairs;
    if (saleOrders && order.sale_order_id) {
      const so = saleOrders.find(s => s.id === order.sale_order_id);
      if (so?.client_name) g.clients.add(so.client_name);
    }
    for (const s of SIZES) {
      const qty = Number(grade[s]) || 0;
      if (qty > 0) g.sizes[s] = (g.sizes[s] || 0) + Math.round(qty * multiplier);
    }
  }

  return Array.from(groupMap.values())
    .sort((a, b) => {
      const bySole = a.soleType.localeCompare(b.soleType, 'pt-BR');
      if (bySole !== 0) return bySole;
      const catOrder = (c: string) => c === 'Adulto' ? 0 : c === 'Infantil' ? 1 : 2;
      const byCat = catOrder(a.category) - catOrder(b.category);
      if (byCat !== 0) return byCat;
      return (a.refCode + a.refName).localeCompare(b.refCode + b.refName, 'pt-BR');
    })
    .map(g => ({
      ...g,
      opNumbers: g.opNumbers.join(', '),
      clients: Array.from(g.clients).join(', '),
    }));
}

function buildSolagemRows(orders: OrderData[]): { color: string; sizes: Record<string, number>; total: number }[] {
  const soleMap = new Map<string, { color: string; sizes: Record<string, number>; total: number }>();
  for (const order of orders) {
    const grade = order.grade || {};
    const gradeSum = Object.values(grade).reduce((s, v) => s + Number(v), 0);
    const totalPairs = order.quantity || gradeSum || 0;
    const multiplier = gradeSum > 0 ? totalPairs / gradeSum : 0;
    const soleColor = (() => {
      const c = (order.color || '').toLowerCase().trim();
      return c.includes('pret') || c.includes('black') || c === 'pb' ? 'Preto' : 'Caramelo';
    })();
    if (!soleMap.has(soleColor)) soleMap.set(soleColor, { color: soleColor, sizes: {}, total: 0 });
    const row = soleMap.get(soleColor)!;
    for (const [size, qty] of Object.entries(grade)) {
      const q = Math.round(Number(qty) * multiplier);
      if (q > 0) { row.sizes[size] = (row.sizes[size] || 0) + q; row.total += q; }
    }
  }
  return Array.from(soleMap.values()).filter(r => r.total > 0);
}

export async function exportCombinedReportXlsx(
  orders: OrderData[],
  references: ReferenceData[],
  saleOrders: SaleOrderData[],
  getStrapsLabel?: (order: any) => string,
  allStages?: any[],
  selectedSectors?: string[],
) {
  if (orders.length === 0) return;

  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Squad Shoes ERP';
  workbook.created = new Date();

  const allSectors = [
    'Corte', 'Forração', 'Aviamento', 'Silk', 'Colagem', 'Montagem', 'Acabamento',
  ];
  const sectors = selectedSectors && selectedSectors.length > 0
    ? allSectors.filter(s => selectedSectors.includes(s))
    : allSectors;
  const includeSolagem = !selectedSectors || selectedSectors.length === 0 || selectedSectors.includes('Solagem');

  const headerFill: any = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8E8D0' } };
  const totalFill: any = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD0D0B8' } };
  const borderThin: any = { style: 'thin', color: { argb: 'FF999999' } };
  const allBorders: any = { top: borderThin, left: borderThin, bottom: borderThin, right: borderThin };

  const activeSizes = SIZES.filter(s => orders.some(o => Number((o.grade || {})[s]) > 0));
  const sizeColumns = activeSizes.length > 0 ? activeSizes : SIZES.slice(13); // 34-45 if no grade data

  // One sheet per sector
  for (const sectorName of sectors) {
    const pendingOrders = allStages
      ? orders.filter(o => {
          const stage = allStages.find(s => s.order_id === o.id && s.stage_name === sectorName);
          return !stage || (stage.status !== 'concluido' && stage.status !== 'cancelado');
        })
      : orders;

    if (pendingOrders.length === 0) continue;

    const rows = buildGroupRows(sectorName, pendingOrders, references, getStrapsLabel, saleOrders);
    if (rows.length === 0) continue;

    const ws = workbook.addWorksheet(sectorName);
    const isAcabamento = sectorName === 'Acabamento';

    const fixedCols = ['Solado', 'Categoria', 'Código', 'Referência', 'Cor', 'Tiras', 'OPs', ...(isAcabamento ? ['Lojas'] : [])];
    const headers = [...fixedCols, ...sizeColumns, 'Total'];
    const headerRow = ws.addRow(headers);
    headerRow.font = { bold: true };
    headerRow.fill = headerFill;
    headerRow.eachCell(c => { c.border = allBorders; c.alignment = { horizontal: 'center', wrapText: false }; });

    // Column widths
    ws.getColumn(1).width = 16;
    ws.getColumn(2).width = 12;
    ws.getColumn(3).width = 10;
    ws.getColumn(4).width = 22;
    ws.getColumn(5).width = 14;
    ws.getColumn(6).width = 12;
    ws.getColumn(7).width = 20;
    if (isAcabamento) ws.getColumn(8).width = 22;
    const sizeStartCol = isAcabamento ? 9 : 8;
    for (let i = 0; i < sizeColumns.length; i++) ws.getColumn(sizeStartCol + i).width = 5;
    ws.getColumn(sizeStartCol + sizeColumns.length).width = 7;

    const sizeTotals: Record<string, number> = {};
    let grandTotal = 0;
    for (const row of rows) {
      const rowData: any[] = [
        row.soleType, row.category, row.refCode, row.refName, row.color,
        row.strapsLabel, row.opNumbers, ...(isAcabamento ? [row.clients] : []),
        ...sizeColumns.map(s => row.sizes[s] || 0),
        row.totalPairs,
      ];
      const exRow = ws.addRow(rowData);
      exRow.eachCell(c => { c.border = allBorders; });
      sizeColumns.forEach((s, i) => {
        const qty = row.sizes[s] || 0;
        sizeTotals[s] = (sizeTotals[s] || 0) + qty;
        const cell = exRow.getCell(sizeStartCol + i);
        cell.alignment = { horizontal: 'center' };
        if (qty === 0) cell.font = { color: { argb: 'FFCCCCCC' } };
      });
      exRow.getCell(sizeStartCol + sizeColumns.length).font = { bold: true };
      grandTotal += row.totalPairs;
    }

    const totalRow = ws.addRow([
      'TOTAL', '', '', '', '', '', '',
      ...(isAcabamento ? [''] : []),
      ...sizeColumns.map(s => sizeTotals[s] || 0),
      grandTotal,
    ]);
    totalRow.font = { bold: true };
    totalRow.fill = totalFill;
    totalRow.eachCell(c => { c.border = allBorders; c.alignment = { horizontal: 'center' }; });
    ws.getRow(1).height = 18;
  }

  // Solagem sheet
  if (includeSolagem) {
    const pendingSolagem = allStages
      ? orders.filter(o => {
          const stage = allStages.find(s => s.order_id === o.id && s.stage_name === 'Solagem');
          return !stage || (stage.status !== 'concluido' && stage.status !== 'cancelado');
        })
      : orders;

    if (pendingSolagem.length > 0) {
      const solagemRows = buildSolagemRows(pendingSolagem);
      if (solagemRows.length > 0) {
        const ws = workbook.addWorksheet('Solagem');
        const headers = ['Cor Solado', ...sizeColumns, 'Total'];
        const headerRow = ws.addRow(headers);
        headerRow.font = { bold: true };
        headerRow.fill = headerFill;
        headerRow.eachCell(c => { c.border = allBorders; c.alignment = { horizontal: 'center' }; });
        ws.getColumn(1).width = 16;
        for (let i = 0; i < sizeColumns.length; i++) ws.getColumn(2 + i).width = 5;
        ws.getColumn(2 + sizeColumns.length).width = 7;

        const sizeTotals: Record<string, number> = {};
        let grandTotal = 0;
        for (const row of solagemRows) {
          const exRow = ws.addRow([row.color, ...sizeColumns.map(s => row.sizes[s] || 0), row.total]);
          exRow.eachCell(c => { c.border = allBorders; });
          exRow.getCell(1).font = { bold: true };
          sizeColumns.forEach((s, i) => {
            const qty = row.sizes[s] || 0;
            sizeTotals[s] = (sizeTotals[s] || 0) + qty;
            const cell = exRow.getCell(2 + i);
            cell.alignment = { horizontal: 'center' };
            if (qty === 0) cell.font = { color: { argb: 'FFCCCCCC' } };
          });
          exRow.getCell(2 + sizeColumns.length).font = { bold: true };
          grandTotal += row.total;
        }
        const totalRow = ws.addRow(['TOTAL', ...sizeColumns.map(s => sizeTotals[s] || 0), grandTotal]);
        totalRow.font = { bold: true };
        totalRow.fill = totalFill;
        totalRow.eachCell(c => { c.border = allBorders; c.alignment = { horizontal: 'center' }; });
      }
    }
  }

  // Resumo Geral sheet (all sectors flat)
  const resumoWs = workbook.addWorksheet('Resumo Geral');
  const resumoHeaders = ['Setor', 'Solado', 'Categoria', 'Código', 'Referência', 'Cor', 'OPs', ...sizeColumns, 'Total'];
  const resumoHeader = resumoWs.addRow(resumoHeaders);
  resumoHeader.font = { bold: true };
  resumoHeader.fill = headerFill;
  resumoHeader.eachCell(c => { c.border = allBorders; c.alignment = { horizontal: 'center' }; });
  resumoWs.getColumn(1).width = 12;
  resumoWs.getColumn(2).width = 16;
  resumoWs.getColumn(3).width = 12;
  resumoWs.getColumn(4).width = 10;
  resumoWs.getColumn(5).width = 22;
  resumoWs.getColumn(6).width = 14;
  resumoWs.getColumn(7).width = 20;
  for (let i = 0; i < sizeColumns.length; i++) resumoWs.getColumn(8 + i).width = 5;
  resumoWs.getColumn(8 + sizeColumns.length).width = 7;

  for (const sectorName of [...sectors, ...(includeSolagem ? ['Solagem'] : [])]) {
    const pendingOrders = allStages
      ? orders.filter(o => {
          const stage = allStages.find(s => s.order_id === o.id && s.stage_name === sectorName);
          return !stage || (stage.status !== 'concluido' && stage.status !== 'cancelado');
        })
      : orders;
    if (pendingOrders.length === 0) continue;

    if (sectorName === 'Solagem') {
      const solagemRows = buildSolagemRows(pendingOrders);
      for (const row of solagemRows) {
        const exRow = resumoWs.addRow(['Solagem', row.color, '—', '—', '—', '—', '—', ...sizeColumns.map(s => row.sizes[s] || 0), row.total]);
        exRow.eachCell(c => { c.border = allBorders; });
        for (let i = 0; i < sizeColumns.length; i++) resumoWs.getRow(resumoWs.rowCount).getCell(8 + i).alignment = { horizontal: 'center' };
      }
    } else {
      const rows = buildGroupRows(sectorName, pendingOrders, references, getStrapsLabel, saleOrders);
      for (const row of rows) {
        const exRow = resumoWs.addRow([sectorName, row.soleType, row.category, row.refCode, row.refName, row.color, row.opNumbers, ...sizeColumns.map(s => row.sizes[s] || 0), row.totalPairs]);
        exRow.eachCell(c => { c.border = allBorders; });
        for (let i = 0; i < sizeColumns.length; i++) exRow.getCell(8 + i).alignment = { horizontal: 'center' };
        exRow.getCell(8 + sizeColumns.length).font = { bold: true };
      }
    }
  }

  // Download
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `relatorio_producao_${new Date().toISOString().slice(0, 10)}.xlsx`;
  anchor.click();
  window.URL.revokeObjectURL(url);
}

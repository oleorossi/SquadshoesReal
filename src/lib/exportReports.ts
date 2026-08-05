import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { parseDateOnly } from '@/lib/dateOnly';
import { isCancelledOrDraftOrder } from '@/lib/orderStatus';

export interface ReportData {
  saleOrders: any[];
  orders: any[];
  products: any[];
  clients: any[];
  payables: any[];
  receivables: any[];
}

const ts = () => format(new Date(), 'yyyy-MM-dd_HHmm');
const fmtBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtDate = (d?: string | null) => {
  if (!d) return '';
  try { return new Date(d).toLocaleDateString('pt-BR'); } catch { return d; }
};

// ─── XLSX helpers ──────────────────────────────────────────────────────────────

function downloadXlsx(wb: XLSX.WorkBook, filename: string) {
  XLSX.writeFile(wb, filename);
}

function sheet(rows: any[][], colWidths?: number[]) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  if (colWidths) {
    ws['!cols'] = colWidths.map(w => ({ wch: w }));
  }
  return ws;
}

// ─── PDF helpers ───────────────────────────────────────────────────────────────

function pdfHeader(doc: jsPDF, title: string, subtitle: string) {
  doc.setFontSize(14);
  doc.setTextColor(30, 30, 30);
  doc.text(title, 40, 38);
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(subtitle, 40, 52);
  return 64;
}

function pdfTable(doc: jsPDF, startY: number, head: string[], rows: (string | number)[][]) {
  autoTable(doc, {
    startY,
    head: [head],
    body: rows,
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [30, 41, 59], textColor: 255, fontSize: 8.5, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: 40, right: 40 },
  });
}

// ─── Sales Summary ─────────────────────────────────────────────────────────────

export function exportSalesSummaryExcel(data: ReportData) {
  const header = ['Pedido', 'Cliente', 'Data', 'Prazo Entrega', 'Total (R$)', 'Status'];
  const rows = data.saleOrders.map(s => [
    s.order_number || '',
    s.client_name || '',
    fmtDate(s.created_at),
    fmtDate(s.delivery_deadline),
    Number(s.total) || 0,
    s.status || '',
  ]);
  const totalRow = ['', '', '', 'TOTAL', rows.reduce((sum, r) => sum + (r[4] as number), 0), ''];
  const ws = sheet([header, ...rows, totalRow], [14, 30, 12, 14, 14, 16]);
  // Bold header
  const range = XLSX.utils.decode_range(ws['!ref']!);
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = ws[XLSX.utils.encode_cell({ r: 0, c })];
    if (cell) cell.s = { font: { bold: true } };
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Resumo Vendas');
  downloadXlsx(wb, `resumo_vendas_${ts()}.xlsx`);
}

export function exportSalesSummaryPDF(data: ReportData) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const y = pdfHeader(doc, 'Resumo de Vendas', `Total: ${data.saleOrders.length} pedidos  •  Gerado em ${new Date().toLocaleString('pt-BR')}`);
  pdfTable(doc, y, ['Pedido', 'Cliente', 'Data', 'Prazo', 'Total', 'Status'], data.saleOrders.map(s => [
    s.order_number || '', s.client_name || '', fmtDate(s.created_at),
    fmtDate(s.delivery_deadline), fmtBRL(Number(s.total) || 0), s.status || '',
  ]));
  doc.save(`resumo_vendas_${ts()}.pdf`);
}

// ─── Production Report ─────────────────────────────────────────────────────────

export function exportProductionReportExcel(data: ReportData) {
  const header = ['OP', 'Referência', 'Cor', 'Quantidade', 'Status', 'Prazo', 'Criado em'];
  const rows = data.orders.map(o => [
    o.order_number || o.op_number || '',
    (o as any).technical_sheets?.name || (o as any).reference_name || '',
    o.color || '',
    o.quantity || 0,
    o.status || '',
    fmtDate(o.due_date || o.delivery_deadline),
    fmtDate(o.created_at),
  ]);
  const ws = sheet([header, ...rows], [14, 24, 16, 12, 18, 14, 14]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Relatório Produção');
  downloadXlsx(wb, `relatorio_producao_${ts()}.xlsx`);
}

export function exportProductionReportPDF(data: ReportData) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const y = pdfHeader(doc, 'Relatório de Produção', `Total: ${data.orders.length} OPs  •  Gerado em ${new Date().toLocaleString('pt-BR')}`);
  pdfTable(doc, y, ['OP', 'Referência', 'Cor', 'Qtd', 'Status', 'Prazo'], data.orders.map(o => [
    o.order_number || o.op_number || '',
    (o as any).technical_sheets?.name || '',
    o.color || '', o.quantity || 0, o.status || '',
    fmtDate(o.due_date || o.delivery_deadline),
  ]));
  doc.save(`relatorio_producao_${ts()}.pdf`);
}

// ─── Stock Position ────────────────────────────────────────────────────────────

export function exportStockPositionExcel(data: ReportData) {
  const header = ['SKU', 'Nome', 'Grupo', 'Unidade', 'Estoque Atual', 'Estoque Mín.', 'Preço Unit. (R$)', 'Valor Total (R$)', 'Situação'];
  const rows = data.products
    .filter(p => p.active !== false)
    .map(p => {
      const qty = Number(p.quantity) || 0;
      const min = Number(p.min_stock) || 0;
      const price = Number(p.unit_price) || 0;
      const situation = qty === 0 ? 'SEM ESTOQUE' : qty <= min ? 'CRÍTICO' : qty <= min * 1.5 ? 'BAIXO' : 'OK';
      return [p.sku || '', p.name || '', (p as any).group_name || '', p.unit || '', qty, min, price, qty * price, situation];
    });
  const totalValue = rows.reduce((s, r) => s + (r[7] as number), 0);
  const totalRow = ['', '', '', 'TOTAL', '', '', '', totalValue, ''];
  const ws = sheet([header, ...rows, totalRow], [14, 30, 20, 8, 14, 14, 16, 16, 12]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Posição Estoque');
  downloadXlsx(wb, `posicao_estoque_${ts()}.xlsx`);
}

export function exportStockPositionPDF(data: ReportData) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const activeProducts = data.products.filter(p => p.active !== false);
  const y = pdfHeader(doc, 'Posição de Estoque', `${activeProducts.length} itens ativos  •  Gerado em ${new Date().toLocaleString('pt-BR')}`);
  pdfTable(doc, y, ['SKU', 'Nome', 'Unidade', 'Estoque', 'Mínimo', 'Preço Unit.', 'Valor Total', 'Situação'],
    activeProducts.map(p => {
      const qty = Number(p.quantity) || 0;
      const min = Number(p.min_stock) || 0;
      const situation = qty === 0 ? 'SEM ESTOQUE' : qty <= min ? 'CRÍTICO' : 'OK';
      return [p.sku || '', p.name || '', p.unit || '', qty, min, fmtBRL(Number(p.unit_price) || 0), fmtBRL(qty * (Number(p.unit_price) || 0)), situation];
    }));
  doc.save(`posicao_estoque_${ts()}.pdf`);
}

// ─── Financial Summary ────────────────────────────────────────────────────────

export function exportFinancialSummaryExcel(data: ReportData) {
  const wb = XLSX.utils.book_new();

  const payHeader = ['Descrição', 'Fornecedor', 'Vencimento', 'Valor (R$)', 'Status'];
  const payRows = data.payables.map(p => [p.description || '', (p as any).suppliers?.name || p.supplier_name || '', fmtDate(p.due_date), Number(p.amount) || 0, p.status || '']);
  const payTotal = ['', '', 'TOTAL', payRows.reduce((s, r) => s + (r[3] as number), 0), ''];
  XLSX.utils.book_append_sheet(wb, sheet([payHeader, ...payRows, payTotal], [30, 24, 14, 14, 14]), 'A Pagar');

  const recHeader = ['Descrição', 'Cliente', 'Vencimento', 'Valor (R$)', 'Status'];
  const recRows = data.receivables.map(r => [r.description || '', (r as any).sale_orders?.client_name || r.client_name || '', fmtDate(r.due_date), Number(r.amount) || 0, r.status || '']);
  const recTotal = ['', '', 'TOTAL', recRows.reduce((s, r) => s + (r[3] as number), 0), ''];
  XLSX.utils.book_append_sheet(wb, sheet([recHeader, ...recRows, recTotal], [30, 24, 14, 14, 14]), 'A Receber');

  downloadXlsx(wb, `resumo_financeiro_${ts()}.xlsx`);
}

// ─── Client Ranking ────────────────────────────────────────────────────────────

export function exportClientRankingExcel(data: ReportData) {
  const ranking: Record<string, { name: string; orders: number; total: number }> = {};
  for (const s of data.saleOrders) {
    // PV cancelado e rascunho NÃO são faturamento. Sem esta linha o ranking
    // somava os dois e divergia do "Ranking de Clientes" do Financeiro (que já
    // excluía cancelados) — dois relatórios de mesmo nome, números diferentes.
    if (isCancelledOrDraftOrder(s.status)) continue;
    const key = s.client_id || s.client_name || 'desconhecido';
    const name = s.client_name || 'Desconhecido';
    if (!ranking[key]) ranking[key] = { name, orders: 0, total: 0 };
    ranking[key].orders++;
    ranking[key].total += Number(s.total) || 0;
  }
  const rows = Object.values(ranking)
    .sort((a, b) => b.total - a.total)
    .map((r, i) => [i + 1, r.name, r.orders, r.total]);
  const header = ['#', 'Cliente', 'Pedidos', 'Faturamento (R$)'];
  const ws = sheet([header, ...rows], [6, 36, 12, 18]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Ranking Clientes');
  downloadXlsx(wb, `ranking_clientes_${ts()}.xlsx`);
}

// ─── Delayed Orders ────────────────────────────────────────────────────────────

export function exportDelayedOrdersExcel(data: ReportData) {
  const wb = XLSX.utils.book_new();
  // Prazos são colunas `date` ('YYYY-MM-DD'): `new Date(iso)` parseia UTC = 21h
  // da véspera em BRT, então o relatório listava como ATRASADO quem ainda estava
  // no prazo e inflava a contagem de dias em 1. Ambos os lados na meia-noite
  // LOCAL: atrasado só a partir de D+1, e o delta vira dias inteiros exatos.
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const delayedSales = data.saleOrders.filter(s => {
    const dead = s.delivery_deadline;
    if (!dead) return false;
    const done = ['concluído', 'concluída', 'completed', 'faturado', 'cancelado', 'cancelada'];
    if (done.includes((s.status || '').toLowerCase())) return false;
    return parseDateOnly(dead) < today;
  }).map(s => {
    const dead = parseDateOnly(s.delivery_deadline!);
    const days = Math.round((today.getTime() - dead.getTime()) / 86400000);
    return [s.order_number || '', s.client_name || '', fmtDate(s.delivery_deadline), days, s.status || ''];
  });

  const delayedOps = data.orders.filter(o => {
    const dead = o.due_date || o.delivery_deadline;
    if (!dead) return false;
    const done = ['concluído', 'concluída', 'completed', 'finalizado', 'cancelado'];
    if (done.includes((o.status || '').toLowerCase())) return false;
    return parseDateOnly(dead) < today;
  }).map(o => {
    const dead = parseDateOnly((o.due_date || o.delivery_deadline)!);
    const days = Math.round((today.getTime() - dead.getTime()) / 86400000);
    return [o.order_number || o.op_number || '', (o as any).technical_sheets?.name || '', o.color || '', o.quantity || 0, fmtDate(o.due_date || o.delivery_deadline), days, o.status || ''];
  });

  XLSX.utils.book_append_sheet(wb, sheet(
    [['Pedido', 'Cliente', 'Prazo', 'Dias Atraso', 'Status'], ...delayedSales], [14, 30, 14, 12, 16]
  ), 'PVs Atrasados');
  XLSX.utils.book_append_sheet(wb, sheet(
    [['OP', 'Referência', 'Cor', 'Qtd', 'Prazo', 'Dias Atraso', 'Status'], ...delayedOps], [14, 24, 16, 10, 14, 12, 16]
  ), 'OPs Atrasadas');

  downloadXlsx(wb, `pedidos_atrasados_${ts()}.xlsx`);
}

// ─── Full Dashboard Excel (all-in-one) ────────────────────────────────────────

export function exportDashboardExcel(data: ReportData) {
  const wb = XLSX.utils.book_new();

  // Sheet 1: Sales
  const salesRows = data.saleOrders.map(s => [
    s.order_number || '', s.client_name || '', fmtDate(s.created_at),
    fmtDate(s.delivery_deadline), Number(s.total) || 0, s.status || '',
  ]);
  XLSX.utils.book_append_sheet(wb, sheet(
    [['Pedido', 'Cliente', 'Data', 'Prazo', 'Total (R$)', 'Status'], ...salesRows], [14, 30, 12, 14, 14, 16]
  ), 'Pedidos de Venda');

  // Sheet 2: Production
  const opRows = data.orders.map(o => [
    o.order_number || o.op_number || '',
    (o as any).technical_sheets?.name || '',
    o.color || '', o.quantity || 0, o.status || '',
    fmtDate(o.due_date || o.delivery_deadline),
  ]);
  XLSX.utils.book_append_sheet(wb, sheet(
    [['OP', 'Referência', 'Cor', 'Qtd', 'Status', 'Prazo'], ...opRows], [14, 24, 16, 10, 18, 14]
  ), 'Ordens de Produção');

  // Sheet 3: Stock
  const stockRows = data.products.filter(p => p.active !== false).map(p => [
    p.sku || '', p.name || '', p.unit || '',
    Number(p.quantity) || 0, Number(p.min_stock) || 0,
    Number(p.unit_price) || 0,
    (Number(p.quantity) || 0) * (Number(p.unit_price) || 0),
  ]);
  XLSX.utils.book_append_sheet(wb, sheet(
    [['SKU', 'Nome', 'Unidade', 'Estoque', 'Mínimo', 'Preço Unit. (R$)', 'Valor Total (R$)'], ...stockRows], [14, 30, 8, 12, 12, 16, 16]
  ), 'Estoque');

  downloadXlsx(wb, `dashboard_completo_${ts()}.xlsx`);
}

// ─── Full Dashboard PDF ────────────────────────────────────────────────────────

export function exportDashboardPDF(data: ReportData, metrics: { ordersToday: number; revenueToday: number; conversionRate: number }) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });

  // Cover summary
  doc.setFontSize(18);
  doc.setTextColor(30, 41, 59);
  doc.text('Relatório Analítico — Squad Shoes', 40, 45);
  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(`Gerado em ${new Date().toLocaleString('pt-BR')}`, 40, 62);

  // KPIs box
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(40, 72, 515, 52, 4, 4, 'F');
  doc.setFontSize(9);
  doc.setTextColor(80);
  const kpiY = 90;
  doc.text(`Pedidos no Período: ${metrics.ordersToday}`, 55, kpiY);
  doc.text(`Faturamento: ${fmtBRL(metrics.revenueToday)}`, 210, kpiY);
  doc.text(`Taxa de Conclusão: ${metrics.conversionRate.toFixed(1)}%`, 380, kpiY);
  doc.setFontSize(8);
  doc.text(`Itens no Estoque: ${data.products.filter(p => p.active !== false).length}`, 55, kpiY + 16);
  doc.text(`OPs Registradas: ${data.orders.length}`, 210, kpiY + 16);
  doc.text(`Clientes Ativos: ${data.clients.length}`, 380, kpiY + 16);

  // Sales table (top 20)
  let y = 140;
  doc.setFontSize(11);
  doc.setTextColor(30, 41, 59);
  doc.text('Últimos Pedidos de Venda', 40, y);
  y += 8;
  pdfTable(doc, y, ['Pedido', 'Cliente', 'Data', 'Total', 'Status'],
    data.saleOrders.slice(0, 20).map(s => [
      s.order_number || '', s.client_name || '', fmtDate(s.created_at),
      fmtBRL(Number(s.total) || 0), s.status || '',
    ]));

  // Low stock on next page
  const lowStock = data.products.filter(p => p.active !== false && Number(p.quantity) <= Number(p.min_stock));
  if (lowStock.length > 0) {
    doc.addPage();
    doc.setFontSize(11);
    doc.setTextColor(30, 41, 59);
    doc.text('Alertas de Estoque Crítico', 40, 40);
    pdfTable(doc, 55, ['SKU', 'Nome', 'Unidade', 'Estoque', 'Mínimo', 'Situação'],
      lowStock.slice(0, 30).map(p => [
        p.sku || '', p.name || '', p.unit || '',
        Number(p.quantity) || 0, Number(p.min_stock) || 0,
        Number(p.quantity) === 0 ? 'SEM ESTOQUE' : 'CRÍTICO',
      ]));
  }

  doc.save(`relatorio_analitico_${ts()}.pdf`);
}

// ─── Map templateId → export function ────────────────────────────────────────

export function exportTemplateExcel(templateId: string, data: ReportData) {
  switch (templateId) {
    case 'sales-summary':       exportSalesSummaryExcel(data);    break;
    case 'production-report':   exportProductionReportExcel(data); break;
    case 'stock-position':      exportStockPositionExcel(data);   break;
    case 'financial-summary':   exportFinancialSummaryExcel(data); break;
    case 'client-ranking':      exportClientRankingExcel(data);   break;
    case 'delayed-orders':      exportDelayedOrdersExcel(data);   break;
    default:                    exportDashboardExcel(data);        break;
  }
}

export function exportTemplatePDF(templateId: string, data: ReportData) {
  switch (templateId) {
    case 'sales-summary':       exportSalesSummaryPDF(data);    break;
    case 'production-report':   exportProductionReportPDF(data); break;
    case 'stock-position':      exportStockPositionPDF(data);   break;
    default:                    exportStockPositionPDF(data);    break;
  }
}

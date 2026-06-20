import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import logoUrl from '@/assets/logo-squad-shoes.jpg';
import {
  CostReportKind,
  CostReportRow,
  DateBasis,
  summarizeRows,
  groupByProvider,
  groupByMonth,
  slugForFilename,
  CostSummary,
} from './costReport';

const fmtBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtDay = (d: string | null | undefined) => {
  if (!d) return '—';
  const day = d.length >= 10 ? d.slice(0, 10) : d;
  const [y, m, dd] = day.split('-');
  return y && m && dd ? `${dd}/${m}/${y}` : day;
};

/** Acima deste nº de linhas, o detalhamento é truncado (com aviso) pra não estourar. */
const DETAIL_CAP = 500;

export interface CostReportOptions {
  kind: CostReportKind;
  rows: CostReportRow[];
  period: { from: string | null; to: string | null };
  basis: DateBasis;
  /** Nome do prestador quando o filtro está fixo em um só (null = todos). */
  providerName: string | null;
  /** Usuário que gerou (rodapé). */
  generatedBy: string;
  /** Origem dos dados: filtro atual da tela ou apenas as linhas selecionadas. */
  scope: 'filtro' | 'selecao';
  /** Timestamp de geração (ISO). Injetado pra ser determinístico/testável. */
  generatedAt?: string;
}

export interface CostReportResult {
  filename: string;
  summary: CostSummary;
  doc: jsPDF;
}

const COLORS = {
  ink: [26, 26, 26] as [number, number, number],
  brand: [37, 99, 235] as [number, number, number],
  slate: [71, 85, 105] as [number, number, number],
  headFill: [30, 41, 59] as [number, number, number],
  zebra: [248, 250, 252] as [number, number, number],
  green: [22, 163, 74] as [number, number, number],
  amber: [180, 83, 9] as [number, number, number],
};

function kindLabel(kind: CostReportKind): { long: string; entity: string; providerLabel: string } {
  return kind === 'OC'
    ? { long: 'Ordens de Compra', entity: 'OC', providerLabel: 'Fornecedor' }
    : { long: 'Ordens de Serviço', entity: 'OS', providerLabel: 'Prestador' };
}

function lastY(doc: jsPDF, fallback: number): number {
  const y = (doc as any).lastAutoTable?.finalY;
  return typeof y === 'number' ? y : fallback;
}

/**
 * Monta o documento de forma SÍNCRONA (testável sem DOM). O logo é opcional —
 * `generateCostReportPdf` carrega o JPG e repassa o dataURL; testes podem omitir.
 */
export function buildCostReportDoc(opts: CostReportOptions, logoDataUrl?: string): CostReportResult {
  const { kind, rows, period, basis, providerName, generatedBy, scope } = opts;
  const lbl = kindLabel(kind);
  const summary = summarizeRows(rows);
  const generatedAtIso = opts.generatedAt || '1970-01-01T00:00:00.000Z';
  const generatedAt = new Date(generatedAtIso);

  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const left = 40;
  const right = pageW - 40;

  // ── Cabeçalho ──────────────────────────────────────────────────────────────
  if (logoDataUrl) {
    try {
      doc.addImage(logoDataUrl, 'JPEG', left, 26, 54, 54);
    } catch {
      /* logo opcional — segue sem */
    }
  }
  const titleX = logoDataUrl ? left + 66 : left;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(...COLORS.brand);
  doc.text(`Relatório de Custos — ${lbl.long}`, titleX, 44);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...COLORS.slate);
  const periodTxt = period.from || period.to
    ? `Período: ${fmtDay(period.from) } a ${fmtDay(period.to)} (${basis === 'vencimento' ? 'vencimento' : 'criação'})`
    : 'Período: todos';
  doc.text(periodTxt, titleX, 58);
  const provTxt = providerName ? `${lbl.providerLabel}: ${providerName}` : `${lbl.providerLabel}: todos`;
  doc.text(provTxt, titleX, 70);
  doc.text(
    `Gerado em ${format(generatedAt, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })} · ${scope === 'selecao' ? 'seleção' : 'filtro atual'}`,
    titleX,
    82,
  );

  // ── Resumo executivo ─────────────────────────────────────────────────────────
  let y = 98;
  doc.setDrawColor(226, 232, 240);
  doc.setFillColor(...COLORS.zebra);
  doc.roundedRect(left, y, right - left, 54, 4, 4, 'FD');
  const cellW = (right - left) / 4;
  const kpis: { label: string; value: string; color?: [number, number, number] }[] = [
    { label: 'TOTAL', value: fmtBRL(summary.total), color: COLORS.brand },
    { label: 'QTD', value: String(summary.count) },
    { label: 'TICKET MÉDIO', value: fmtBRL(summary.avgTicket) },
    { label: '% PAGO', value: `${summary.paidPct.toFixed(1)}%`, color: COLORS.green },
  ];
  kpis.forEach((k, i) => {
    const cx = left + cellW * i + 12;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100);
    doc.text(k.label, cx, y + 18);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(...(k.color || COLORS.ink));
    doc.text(k.value, cx, y + 36);
  });
  // Linha pago vs a pagar
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...COLORS.slate);
  doc.text(
    `Pago: ${fmtBRL(summary.paid)}   ·   A pagar: ${fmtBRL(summary.pending)}`,
    left + 12,
    y + 49,
  );
  y += 70;

  // ── Quebra por prestador (só quando filtro = todos e há >1) ──────────────────
  if (!providerName) {
    const byProvider = groupByProvider(rows);
    if (byProvider.length > 1) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(...COLORS.ink);
      doc.text(`Quebra por ${lbl.providerLabel}`, left, y);
      autoTable(doc, {
        startY: y + 6,
        head: [[lbl.providerLabel, 'Qtd', 'Total', 'Pago', 'A Pagar']],
        body: byProvider.map((g) => [g.provider, g.count, fmtBRL(g.total), fmtBRL(g.paid), fmtBRL(g.pending)]),
        styles: { fontSize: 8, cellPadding: 3 },
        headStyles: { fillColor: COLORS.headFill, textColor: 255, fontSize: 8, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: COLORS.zebra },
        columnStyles: {
          1: { halign: 'center' },
          2: { halign: 'right' },
          3: { halign: 'right' },
          4: { halign: 'right' },
        },
        margin: { left, right: 40 },
      });
      y = lastY(doc, y) + 18;
    }
  }

  // ── Quebra por mês ───────────────────────────────────────────────────────────
  const byMonth = groupByMonth(rows, basis);
  if (byMonth.length > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...COLORS.ink);
    doc.text('Quebra por Mês', left, y);
    autoTable(doc, {
      startY: y + 6,
      head: [['Mês', 'Qtd', 'Total', 'Pago', 'A Pagar']],
      body: byMonth.map((g) => [g.label, g.count, fmtBRL(g.total), fmtBRL(g.paid), fmtBRL(g.pending)]),
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: COLORS.headFill, textColor: 255, fontSize: 8, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: COLORS.zebra },
      columnStyles: {
        1: { halign: 'center' },
        2: { halign: 'right' },
        3: { halign: 'right' },
        4: { halign: 'right' },
      },
      margin: { left, right: 40 },
    });
    y = lastY(doc, y) + 18;
  }

  // ── Detalhamento ─────────────────────────────────────────────────────────────
  const detailRows = rows.length > DETAIL_CAP ? rows.slice(0, DETAIL_CAP) : rows;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...COLORS.ink);
  doc.text(`Detalhamento (${detailRows.length}${rows.length > DETAIL_CAP ? ` de ${rows.length}` : ''})`, left, y);
  autoTable(doc, {
    startY: y + 6,
    head: [['Nº', 'Data', lbl.providerLabel, 'Descrição', 'Valor', 'Vencimento', 'Pago?']],
    body: detailRows.map((r) => [
      r.number,
      fmtDay(r.date),
      r.provider,
      r.isCancelled ? `${r.description} (cancelada)` : r.description,
      fmtBRL(Number(r.total) || 0),
      fmtDay(r.dueDate),
      r.isCancelled ? '—' : r.isPaid ? 'Sim' : 'Não',
    ]),
    styles: { fontSize: 7.5, cellPadding: 2.5, overflow: 'ellipsize' },
    headStyles: { fillColor: COLORS.headFill, textColor: 255, fontSize: 7.5, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: COLORS.zebra },
    columnStyles: {
      0: { cellWidth: 58 },
      1: { cellWidth: 52, halign: 'center' },
      3: { cellWidth: 'auto' },
      4: { cellWidth: 64, halign: 'right' },
      5: { cellWidth: 56, halign: 'center' },
      6: { cellWidth: 34, halign: 'center' },
    },
    margin: { left, right: 40, bottom: 40 },
  });

  if (rows.length > DETAIL_CAP) {
    const ny = lastY(doc, y) + 12;
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.amber);
    doc.text(
      `Detalhamento limitado às primeiras ${DETAIL_CAP} linhas. Refine o período/prestador pra ver o restante.`,
      left,
      ny,
    );
  }

  // ── Rodapé (paginação + assinatura) em todas as páginas ──────────────────────
  const pageH = doc.internal.pageSize.getHeight();
  const totalPages = doc.getNumberOfPages();
  const footer = `Gerado em ${format(generatedAt, 'dd/MM/yyyy HH:mm', { locale: ptBR })} por ${generatedBy || 'sistema'}`;
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(150);
    doc.text(footer, left, pageH - 18);
    doc.text(`Página ${p} de ${totalPages}`, right, pageH - 18, { align: 'right' });
  }

  // ── Nome do arquivo ──────────────────────────────────────────────────────────
  const periodSlug = period.from || period.to
    ? `${(period.from || 'inicio').replace(/-/g, '')}-${(period.to || 'fim').replace(/-/g, '')}`
    : 'completo';
  const filename = `relatorio-${lbl.entity.toLowerCase()}-${slugForFilename(providerName || 'todos')}-${periodSlug}.pdf`;

  return { filename, summary, doc };
}

/** Carrega o logo (JPG do bundle) como dataURL pra embutir no PDF. */
async function loadLogoDataUrl(): Promise<string | undefined> {
  try {
    const res = await fetch(logoUrl);
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return undefined;
  }
}

/**
 * Gera e baixa o relatório de custos em PDF. Caminho usado pela UI — carrega o
 * logo e dispara o download. Retorna o resumo (útil pra feedback/telemetria).
 */
export async function generateCostReportPdf(opts: CostReportOptions): Promise<CostReportResult> {
  const logo = await loadLogoDataUrl();
  const stamped: CostReportOptions = { ...opts, generatedAt: opts.generatedAt || new Date().toISOString() };
  const result = buildCostReportDoc(stamped, logo);
  result.doc.save(result.filename);
  return result;
}

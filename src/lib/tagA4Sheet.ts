/**
 * Imposição compartilhada das Tags 40×60 mm em folha A4 (Epson/LaserJet + tesoura).
 *
 * Grade fixa 4×4 = 16 células por página, coladas, com hairline de corte.
 * Parsers e artes continuam por cliente (Objetiva / Nalin Tag / Ponto Mix);
 * este módulo só empacota e pagina.
 *
 * Quebra de página ao mudar (referência, cor) — não mistura produtos na mesma folha.
 */
import type { ClientOrderLine } from './clientLabelPattern';

export const TAG_A4_PAGE_WIDTH_MM = 210;
export const TAG_A4_PAGE_HEIGHT_MM = 297;
export const TAG_A4_CELL_WIDTH_MM = 40;
export const TAG_A4_CELL_HEIGHT_MM = 60;
export const TAG_A4_COLUMNS = 4;
export const TAG_A4_ROWS = 4;
export const TAG_A4_CELLS_PER_PAGE = TAG_A4_COLUMNS * TAG_A4_ROWS;
/** Hairline de corte — visível na laser P&B sem invadir a arte. */
export const TAG_A4_CUT_STROKE_MM = 0.12;
export const MAX_TAG_A4_LABELS = 20_000;

export type TagA4Origin = { x: number; y: number };

type PdfDoc = import('jspdf').jsPDF;

/** Chave de agrupamento: uma folha = um produto (ref + cor). */
export function tagA4GroupKey(row: Pick<ClientOrderLine, 'referencia' | 'cor'>): string {
  return `${(row.referencia ?? '').trim().toUpperCase()}||${(row.cor ?? '').trim().toUpperCase()}`;
}

/** Bloco 160×240 centrado na A4 retrato. */
export function tagA4BlockOrigin(): TagA4Origin {
  const blockW = TAG_A4_COLUMNS * TAG_A4_CELL_WIDTH_MM;
  const blockH = TAG_A4_ROWS * TAG_A4_CELL_HEIGHT_MM;
  return {
    x: (TAG_A4_PAGE_WIDTH_MM - blockW) / 2,
    y: (TAG_A4_PAGE_HEIGHT_MM - blockH) / 2,
  };
}

/** Origem da célula `indexOnPage` (0..15), esquerda→direita, cima→baixo. */
export function tagA4CellOrigin(indexOnPage: number): TagA4Origin {
  const col = indexOnPage % TAG_A4_COLUMNS;
  const row = Math.floor(indexOnPage / TAG_A4_COLUMNS);
  const block = tagA4BlockOrigin();
  return {
    x: block.x + col * TAG_A4_CELL_WIDTH_MM,
    y: block.y + row * TAG_A4_CELL_HEIGHT_MM,
  };
}

/**
 * Expande pela quantidade (ordem do arquivo) e pagina:
 * - no máx. 16 por folha;
 * - ao mudar (ref, cor), fecha a folha mesmo incompleta.
 */
export function expandAndPaginateTagA4(
  rows: ClientOrderLine[],
  repeatByQuantity: boolean,
): ClientOrderLine[][] {
  if (rows.length === 0) return [];

  const expanded: ClientOrderLine[] = [];
  for (const row of rows) {
    const n = repeatByQuantity ? Math.max(1, Math.trunc(row.quantidade) || 1) : 1;
    for (let i = 0; i < n; i++) expanded.push(row);
  }

  if (expanded.length > MAX_TAG_A4_LABELS) {
    throw new Error(
      `A geração A4 teria ${expanded.length.toLocaleString('pt-BR')} etiquetas. O limite seguro é ${MAX_TAG_A4_LABELS.toLocaleString('pt-BR')} por PDF.`,
    );
  }

  const pages: ClientOrderLine[][] = [];
  let page: ClientOrderLine[] = [];
  let pageKey: string | null = null;

  for (const row of expanded) {
    const key = tagA4GroupKey(row);
    if (pageKey !== null && key !== pageKey && page.length > 0) {
      pages.push(page);
      page = [];
    }
    if (page.length >= TAG_A4_CELLS_PER_PAGE) {
      pages.push(page);
      page = [];
    }
    pageKey = key;
    page.push(row);
  }
  if (page.length > 0) pages.push(page);
  return pages;
}

/** Grade hairline do bloco 4×4 (externa + internas). */
export function drawTagA4CutMarks(doc: PdfDoc): void {
  const o = tagA4BlockOrigin();
  const blockW = TAG_A4_COLUMNS * TAG_A4_CELL_WIDTH_MM;
  const blockH = TAG_A4_ROWS * TAG_A4_CELL_HEIGHT_MM;
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(TAG_A4_CUT_STROKE_MM);
  for (let c = 0; c <= TAG_A4_COLUMNS; c++) {
    const x = o.x + c * TAG_A4_CELL_WIDTH_MM;
    doc.line(x, o.y, x, o.y + blockH);
  }
  for (let r = 0; r <= TAG_A4_ROWS; r++) {
    const y = o.y + r * TAG_A4_CELL_HEIGHT_MM;
    doc.line(o.x, y, o.x + blockW, y);
  }
}

export interface BuildTagA4PdfOptions {
  title?: string;
  repeatByQuantity?: boolean;
  /** Desenha uma etiqueta 40×60 com origem na célula. */
  drawCell: (doc: PdfDoc, row: ClientOrderLine, origin: TagA4Origin) => void | Promise<void>;
  /** Fontes / setup antes da primeira página (ex.: Roboto Ponto Mix). */
  prepareDoc?: (doc: PdfDoc) => void | Promise<void>;
}

export async function buildTagA4Pdf(
  rows: ClientOrderLine[],
  options: BuildTagA4PdfOptions,
): Promise<PdfDoc> {
  if (rows.length === 0) throw new Error('Nada para gerar: nenhuma etiqueta selecionada.');

  const pages = expandAndPaginateTagA4(rows, options.repeatByQuantity ?? true);
  if (pages.length === 0) throw new Error('Nada para gerar: nenhuma etiqueta selecionada.');

  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({
    unit: 'mm',
    format: 'a4',
    orientation: 'portrait',
    compress: true,
  });
  doc.setProperties({ title: options.title ?? 'Etiquetas Tag A4' });
  if (options.prepareDoc) await options.prepareDoc(doc);

  for (let p = 0; p < pages.length; p++) {
    if (p > 0) doc.addPage('a4', 'portrait');
    const pageRows = pages[p]!;
    for (let i = 0; i < pageRows.length; i++) {
      const origin = tagA4CellOrigin(i);
      await options.drawCell(doc, pageRows[i]!, origin);
    }
    drawTagA4CutMarks(doc);
  }

  return doc;
}

export function tagA4PdfFilename(cliente: string, origem: string): string {
  const client = cliente.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'Tag';
  const base = origem.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return `Etiquetas_${client}_A4_${base || 'pedido'}.pdf`;
}

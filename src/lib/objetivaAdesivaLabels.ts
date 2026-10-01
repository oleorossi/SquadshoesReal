/**
 * Adesiva Objetiva — 1 etiqueta por página, 50 × 30 mm.
 *
 * Arte (foto/original do cliente): descrição · ref/cor/TAM · CODE128 do SKU ·
 * preço. Uma página = uma etiqueta física — o driver da térmica (Elgin/Bematech)
 * com mídia 50×30 2 colunas avança sozinho esquerda→direita→próxima carreira.
 *
 * Histórico: página 2-up 50 mm (células 25×30) truncava o texto; 2-up 106 mm
 * (células 50×30) batia na arte mas o driver em 50 mm espremia as duas colunas
 * numa só etiqueta (código/preço “no canto”, descrição sumia).
 *
 * Reusa o CSV/parse da Tag (`objetivaLabels`); saída PDF only. Sem ZPL.
 */
import { code128Bars, encodeCode128 } from './code128';
import {
  OBJETIVA_ADESIVA_DEFAULT_GEOMETRY,
  type ClientLabelGeometry,
  type ClientOrderLine,
} from './clientLabelPattern';
import { stripHangtagAccents } from './objetivaLabels';

/** Etiqueta física 50 × 30 mm — uma por página. */
export const OBJETIVA_ADESIVA_LABEL_WIDTH_MM = 50;
export const OBJETIVA_ADESIVA_LABEL_HEIGHT_MM = 30;
/** Compat: a mídia do rolo tem 2 colunas, mas o PDF é 1-up. */
export const OBJETIVA_ADESIVA_COLUMNS = 1;
export const OBJETIVA_ADESIVA_COLUMN_GAP_MM = 0;
export const OBJETIVA_ADESIVA_PAGE_WIDTH_MM = OBJETIVA_ADESIVA_LABEL_WIDTH_MM;
export const OBJETIVA_ADESIVA_PAGE_HEIGHT_MM = OBJETIVA_ADESIVA_LABEL_HEIGHT_MM;

/** Inset da arte dentro da etiqueta (1 mm pra dentro da faca). */
export const OBJETIVA_ADESIVA_INSET_MM = 1.0;
export const OBJETIVA_ADESIVA_ART_WIDTH_MM =
  OBJETIVA_ADESIVA_LABEL_WIDTH_MM - 2 * OBJETIVA_ADESIVA_INSET_MM;
export const OBJETIVA_ADESIVA_ART_HEIGHT_MM =
  OBJETIVA_ADESIVA_LABEL_HEIGHT_MM - 2 * OBJETIVA_ADESIVA_INSET_MM;

/** Quiet zone mínima nas laterais do CODE128. */
export const OBJETIVA_ADESIVA_QUIET_ZONE_MM = 2.5;
/** Módulo alvo — não esticar o código na célula inteira. */
export const OBJETIVA_ADESIVA_MODULE_MM = 0.28;

export const MAX_OBJETIVA_ADESIVA_PDF_LABELS = 20_000;
export const OBJETIVA_ADESIVA_MIN_FONT_PT = 5;

type PdfDoc = import('jspdf').jsPDF;

export interface ObjetivaAdesivaCopy {
  line1: string;
  line2: string;
  codigoBarra: string;
  priceText: string;
}

export interface ObjetivaAdesivaPdfOptions {
  geometry?: Partial<ClientLabelGeometry>;
  /** Produção repete pela quantidade; amostra gráfica = false. */
  repeatByQuantity?: boolean;
}

export interface ObjetivaAdesivaPlacement {
  pageIndex: number;
  column: number;
  xMm: number;
  yMm: number;
  row: ClientOrderLine;
}

function formatPriceText(valor: string | undefined): string {
  const raw = (valor ?? '').replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
  const n = Number(raw);
  if (!Number.isFinite(n)) return 'R$ 0,00';
  return `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Composição da original: L1 = descrição + " -"; L2 = `{ref?} {cor} - TAM.: {tam}`.
 * Ref omitida quando vazia.
 */
export function composeObjetivaAdesivaCopy(row: ClientOrderLine): ObjetivaAdesivaCopy {
  const descricao = stripHangtagAccents((row.descricao ?? '').trim().toUpperCase());
  const referencia = stripHangtagAccents((row.referencia ?? '').trim().toUpperCase());
  const cor = stripHangtagAccents((row.cor ?? '').trim().toUpperCase());
  const tamanho = ((row.tamanho ?? '').trim() || '-').toUpperCase();
  const codigoBarra = (row.codigoBarra || row.codProduto || '').trim();

  const line1Base = descricao || '—';
  const line1 = line1Base.endsWith('-') ? line1Base : `${line1Base} -`;

  const left = [referencia, cor].filter(Boolean).join(' ');
  const line2 = left
    ? `${left} - TAM.: ${tamanho}`
    : `TAM.: ${tamanho}`;

  return {
    line1,
    line2,
    codigoBarra,
    priceText: formatPriceText(row.valor),
  };
}

/** Maior corpo que couber; no piso corta com reticências (não invade a faca). */
export function fitObjetivaAdesivaText(
  doc: PdfDoc,
  texto: string,
  ideal: number,
  larguraMax: number,
): { pt: number; texto: string } {
  for (let pt = ideal; pt >= OBJETIVA_ADESIVA_MIN_FONT_PT; pt -= 0.5) {
    doc.setFontSize(pt);
    if (doc.getTextWidth(texto) <= larguraMax) return { pt, texto };
  }
  doc.setFontSize(OBJETIVA_ADESIVA_MIN_FONT_PT);
  let cortado = texto;
  while (cortado.length > 1 && doc.getTextWidth(`${cortado}…`) > larguraMax) {
    cortado = cortado.slice(0, -1);
  }
  return { pt: OBJETIVA_ADESIVA_MIN_FONT_PT, texto: `${cortado.trimEnd()}…` };
}

export function countObjetivaAdesivaLabels(
  rows: ClientOrderLine[],
  repeatByQuantity: boolean,
): number {
  if (!repeatByQuantity) return rows.length;
  return rows.reduce((sum, row) => sum + Math.max(1, Math.trunc(row.quantidade) || 1), 0);
}

/** Uma etiqueta = uma página. */
export function objetivaAdesivaPageCount(labelCount: number): number {
  return Math.max(0, Math.trunc(labelCount));
}

function expandLines(
  rows: ClientOrderLine[],
  repeatByQuantity: boolean,
): ClientOrderLine[] {
  if (!repeatByQuantity) return rows;
  const total = countObjetivaAdesivaLabels(rows, true);
  if (total > MAX_OBJETIVA_ADESIVA_PDF_LABELS) {
    throw new Error(
      `A geração teria ${total.toLocaleString('pt-BR')} etiquetas. O limite seguro é ${MAX_OBJETIVA_ADESIVA_PDF_LABELS.toLocaleString('pt-BR')} por PDF.`,
    );
  }
  return rows.flatMap(row =>
    Array.from({ length: Math.max(1, Math.trunc(row.quantidade) || 1) }, () => row),
  );
}

function resolveGeometry(partial?: Partial<ClientLabelGeometry>): ClientLabelGeometry {
  return {
    ...OBJETIVA_ADESIVA_DEFAULT_GEOMETRY,
    ...partial,
    // Mídia física travada — perfil antigo (25 mm / 2-up) não pode regredir.
    labelWidthMm: OBJETIVA_ADESIVA_LABEL_WIDTH_MM,
    labelHeightMm: OBJETIVA_ADESIVA_LABEL_HEIGHT_MM,
    columns: OBJETIVA_ADESIVA_COLUMNS,
    columnGapMm: OBJETIVA_ADESIVA_COLUMN_GAP_MM,
  };
}

/**
 * Uma etiqueta por página. `column` fica 0 por compatibilidade com a UI.
 */
export function planObjetivaAdesivaPlacements(
  rows: ClientOrderLine[],
  repeatByQuantity = true,
): ObjetivaAdesivaPlacement[] {
  const expanded = expandLines(rows, repeatByQuantity);
  return expanded.map((row, index) => ({
    pageIndex: index,
    column: 0,
    xMm: OBJETIVA_ADESIVA_INSET_MM,
    yMm: OBJETIVA_ADESIVA_INSET_MM,
    row,
  }));
}

function barcodeModuleMm(codigo: string, artWidthMm: number): { moduleMm: number; widthMm: number } {
  const { moduleCount } = encodeCode128(codigo);
  const maxWidth = Math.max(4, artWidthMm - 2 * OBJETIVA_ADESIVA_QUIET_ZONE_MM);
  const naturalWidth = moduleCount * OBJETIVA_ADESIVA_MODULE_MM;
  const widthMm = Math.min(naturalWidth, maxWidth);
  return { moduleMm: widthMm / moduleCount, widthMm };
}

function drawObjetivaAdesivaLabel(
  doc: PdfDoc,
  row: ClientOrderLine,
  placement: Pick<ObjetivaAdesivaPlacement, 'xMm' | 'yMm'>,
): void {
  const copy = composeObjetivaAdesivaCopy(row);
  const ox = placement.xMm;
  const oy = placement.yMm;
  const artW = OBJETIVA_ADESIVA_ART_WIDTH_MM;
  const artH = OBJETIVA_ADESIVA_ART_HEIGHT_MM;

  doc.setTextColor(0, 0, 0);
  doc.setFont('courier', 'normal');

  // L1 / L2 — topo, esquerda (original).
  const l1 = fitObjetivaAdesivaText(doc, copy.line1, 7.5, artW);
  doc.setFontSize(l1.pt);
  doc.text(l1.texto, ox, oy + 1.0, { baseline: 'top' });

  const l2 = fitObjetivaAdesivaText(doc, copy.line2, 7.5, artW);
  doc.setFontSize(l2.pt);
  doc.text(l2.texto, ox, oy + 4.6, { baseline: 'top' });

  if (!copy.codigoBarra) {
    throw new Error('SKU/código de barras vazio — não dá para gerar a adesiva Objetiva.');
  }

  // CODE128 centralizado + dígitos abaixo — módulo fixo, não estica na célula.
  const { moduleMm, widthMm } = barcodeModuleMm(copy.codigoBarra, artW);
  const barcodeH = 9.0;
  const barcodeTop = oy + 8.8;
  const x0 = ox + (artW - widthMm) / 2;
  doc.setFillColor(0, 0, 0);
  for (const barra of code128Bars(copy.codigoBarra)) {
    doc.rect(x0 + barra.start * moduleMm, barcodeTop, barra.width * moduleMm, barcodeH, 'F');
  }

  const sku = fitObjetivaAdesivaText(doc, copy.codigoBarra, 8, artW);
  doc.setFont('courier', 'normal');
  doc.setFontSize(sku.pt);
  doc.text(sku.texto, ox + artW / 2, barcodeTop + barcodeH + 0.7, {
    align: 'center',
    baseline: 'top',
  });

  // Preço grande no rodapé — folga na faca inferior.
  doc.setFont('helvetica', 'bold');
  const price = fitObjetivaAdesivaText(doc, copy.priceText, 14, artW);
  doc.setFontSize(price.pt);
  doc.text(price.texto, ox + artW / 2, oy + artH - 1.2, {
    align: 'center',
    baseline: 'bottom',
  });
}

export function objetivaAdesivaPdfFilename(origem: string): string {
  const base = origem
    .replace(/\.[^.]+$/, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  return `Etiquetas_Objetiva_Adesiva_${base || 'pedido'}.pdf`;
}

/** Monta o PDF 1-up 50×30 — uma etiqueta por página, para a térmica. */
export async function buildObjetivaAdesivaPdf(
  rows: ClientOrderLine[],
  options: ObjetivaAdesivaPdfOptions = {},
): Promise<PdfDoc> {
  if (rows.length === 0) throw new Error('Nada para gerar: nenhuma etiqueta selecionada.');

  resolveGeometry(options.geometry);
  const { jsPDF } = await import('jspdf');
  const pageW = OBJETIVA_ADESIVA_PAGE_WIDTH_MM;
  const pageH = OBJETIVA_ADESIVA_PAGE_HEIGHT_MM;

  const doc = new jsPDF({
    unit: 'mm',
    format: [pageW, pageH],
    orientation: 'landscape',
    compress: true,
  });
  doc.setProperties({
    title: `Etiquetas Objetiva adesiva ${OBJETIVA_ADESIVA_LABEL_WIDTH_MM}x${OBJETIVA_ADESIVA_LABEL_HEIGHT_MM}mm CODE128`,
  });

  const placements = planObjetivaAdesivaPlacements(
    rows,
    options.repeatByQuantity ?? true,
  );
  placements.forEach((placement, index) => {
    if (index > 0) {
      doc.addPage([pageW, pageH], 'landscape');
    }
    drawObjetivaAdesivaLabel(doc, placement.row, placement);
  });

  return doc;
}

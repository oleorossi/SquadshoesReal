/**
 * Tag hangtag do cliente Nalin — rolo 40×60 mm L42PRO 203 dpi.
 *
 * Entrada: mesmo CSV da adesiva (`Exp_Etiquetas_PedCompra_*`).
 * Arte calibrada pela foto física (cod. 900280 / TAM 37): wordmark, bloco
 * esquerdo (código/ref/descrição/cor), trilho curto + CODE128 vertical à
 * direita, TAM, texto de troca e preço (principal + secundário).
 */
import { code128Bars } from './code128';
import {
  NALIN_TAG_DEFAULT_BRANDING,
  NALIN_TAG_DEFAULT_GEOMETRY,
  type ClientLabelBranding,
  type ClientLabelGeometry,
  type ClientOrderLine,
} from './clientLabelPattern';

export const NALIN_TAG_DPI = 203;
export const MAX_NALIN_TAG_PDF_LABELS = 20_000;

/** Altura de caixa-alta ÷ em da Helvetica (capHeight 718 / upem 1000). */
const CAP_RATIO = 0.717;

type PdfDoc = import('jspdf').jsPDF;

export type NalinTagLogo = { dataUrl: string; width: number; height: number } | null;

export interface NalinTagPdfOptions {
  geometry?: Partial<ClientLabelGeometry>;
  branding?: Partial<ClientLabelBranding>;
  repeatByQuantity?: boolean;
  logo?: NalinTagLogo;
}

/**
 * Grade da arte em DOTS a 203 dpi — 40×60 mm = 320×480 dots.
 * Valores derivados da Tag física Nalin (foto de calibração).
 */
export const NALIN_TAG_ART_DOTS = {
  gridW: 320,
  gridH: 480,
  /** Wordmark "Nalin" no topo. */
  logo: { x: 14, y: 10, w: 150, h: 36 },
  /** Bloco esquerdo: código, ref, descrição, cor. */
  left: {
    x: 14,
    firstTop: 54,
    step: 16,
    capH: 11,
    descCapH: 10,
  },
  /** Trilho curto (tipo/categoria/grupo) à esquerda do código. */
  rail: { x: 210, firstTop: 54, step: 14, capH: 9 },
  /** Código de barras vertical na margem direita. */
  barcode: { x: 258, w: 48, top: 48, bottom: 250 },
  /** Dígitos do EAN/CODE128 sob o código (girados). */
  barcodeDigits: { baselineX: 252, bottom: 248, capH: 8 },
  /** "TAM.:" + número grande. */
  size: { labelX: 14, labelCapH: 11, valueX: 70, baseline: 288, valueCapH: 34 },
  /** Fios e texto de troca. */
  exchange: {
    line1Y: 302,
    line2Y: 360,
    textFirstTop: 312,
    step: 14,
    capH: 9,
    stroke: 1.5,
  },
  /** Preço principal R$ + valor com ponto decimal. */
  price: {
    currencyX: 14,
    currencyCapH: 12,
    rightX: 306,
    baseline: 408,
    mainCapH: 38,
    topLineY: 372,
    midLineY: 422,
  },
  /** Segunda linha de preço (parcela), quando o CSV trouxer. */
  secondary: { rightX: 306, baseline: 458, capH: 28 },
} as const;

function fontPtForCapHeight(capMm: number): number {
  return (capMm / CAP_RATIO) * (72 / 25.4);
}

function mmToDots(mm: number, dpi = NALIN_TAG_DPI): number {
  return Math.max(1, Math.round((mm / 25.4) * dpi));
}

function mergeGeometry(partial?: Partial<ClientLabelGeometry>): ClientLabelGeometry {
  return { ...NALIN_TAG_DEFAULT_GEOMETRY, ...partial };
}

function mergeBranding(partial?: Partial<ClientLabelBranding>): ClientLabelBranding {
  return { ...NALIN_TAG_DEFAULT_BRANDING, ...partial };
}

function expandLines(rows: ClientOrderLine[], repeatByQuantity: boolean): ClientOrderLine[] {
  if (!repeatByQuantity) return rows;
  const total = rows.reduce((sum, row) => sum + Math.max(1, Math.trunc(row.quantidade) || 1), 0);
  if (total > MAX_NALIN_TAG_PDF_LABELS) {
    throw new Error(
      `A geração teria ${total.toLocaleString('pt-BR')} etiquetas. O limite seguro é ${MAX_NALIN_TAG_PDF_LABELS.toLocaleString('pt-BR')} por PDF.`,
    );
  }
  return rows.flatMap(row =>
    Array.from({ length: Math.max(1, Math.trunc(row.quantidade) || 1) }, () => row),
  );
}

export function stripNalinTagAccents(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Aceita `89,99`, `89.99` e misturas com milhar (`1.234,56` / `1,234.56`). */
export function parseNalinTagMoney(valor: string | undefined): number | null {
  const s = (valor ?? '').replace(/[^\d,.-]/g, '').trim();
  if (!s) return null;
  let normalized = s;
  if (s.includes(',') && s.includes('.')) {
    normalized =
      s.lastIndexOf(',') > s.lastIndexOf('.')
        ? s.replace(/\./g, '').replace(',', '.')
        : s.replace(/,/g, '');
  } else if (s.includes(',')) {
    normalized = s.replace(',', '.');
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

/** Preço principal da Tag física usa ponto (89.99). */
export function formatNalinTagMainPrice(valor: string | undefined): string {
  const n = parseNalinTagMoney(valor);
  if (n == null) return '0.00';
  return n.toFixed(2);
}

/** Segunda linha (parcela) na foto usa vírgula (18,00). */
export function formatNalinTagSecondaryPrice(valor: string | undefined): string {
  const n = parseNalinTagMoney(valor);
  if (n == null) return '';
  return n.toFixed(2).replace('.', ',');
}

export function splitNalinExchangeLines(text: string): string[] {
  const words = text.trim().toUpperCase().split(/\s+/).filter(Boolean);
  if (words.length <= 1) return words;
  // Foto: "TROCA EM ATÉ 10 DIAS COM" / "ETIQUETA E CUPOM FISCAL"
  const comIdx = words.indexOf('COM');
  if (comIdx >= 0 && comIdx < words.length - 1) {
    return [words.slice(0, comIdx + 1).join(' '), words.slice(comIdx + 1).join(' ')];
  }
  const mid = Math.ceil(words.length / 2);
  return [words.slice(0, mid).join(' '), words.slice(mid).join(' ')];
}

export interface NalinTagLabelCopy {
  codProduto: string;
  referencia: string;
  descricao: string;
  cor: string;
  tamanho: string;
  codigoBarra: string;
  /** Trilho curto ao lado do código (tipo / categoria / grupo). */
  railCodes: string[];
  priceMain: string;
  priceSecondary: string;
  exchangeLines: string[];
}

/** Códigos curtos do trilho — a Tag física imprime abreviações (CR / FEM / JEA). */
export function nalinTagRailCodes(row: ClientOrderLine): string[] {
  return [row.tipo, row.categoria, row.grupo]
    .map(part => stripNalinTagAccents((part ?? '').trim().toUpperCase()))
    .filter(Boolean)
    .map(part => (part.length > 6 ? part.slice(0, 6) : part));
}

export function composeNalinTagLabelCopy(
  row: ClientOrderLine,
  branding: ClientLabelBranding,
): NalinTagLabelCopy {
  // `??` (não `||`): string vazia no lote omite a linha; só undefined/null usa default.
  const exchange = (branding.exchangeText ?? NALIN_TAG_DEFAULT_BRANDING.exchangeText).trim();
  return {
    codProduto: (row.codProduto || '').trim(),
    referencia: stripNalinTagAccents((row.referencia || '').trim().toUpperCase()),
    descricao: stripNalinTagAccents((row.descricao || '').trim().toUpperCase()),
    cor: stripNalinTagAccents((row.cor || '').trim().toUpperCase()),
    tamanho: (row.tamanho || '-').trim() || '-',
    codigoBarra: (row.codigoBarra || row.codProduto).trim(),
    railCodes: nalinTagRailCodes(row),
    priceMain: formatNalinTagMainPrice(row.valor),
    priceSecondary: formatNalinTagSecondaryPrice(row.valorSecundario),
    exchangeLines: splitNalinExchangeLines(exchange),
  };
}

function artSlots(
  geometry: ClientLabelGeometry,
  origin: { x?: number; y?: number } = {},
) {
  const D = NALIN_TAG_ART_DOTS;
  const w = geometry.labelWidthMm;
  const h = geometry.labelHeightMm;
  const sx = w / D.gridW;
  const sy = h / D.gridH;
  const ox = origin.x ?? 0;
  const oy = origin.y ?? 0;
  return {
    w,
    h,
    ox,
    oy,
    sx,
    sy,
    logo: {
      x: D.logo.x * sx + ox,
      y: D.logo.y * sy + oy,
      w: D.logo.w * sx,
      h: D.logo.h * sy,
    },
    left: {
      x: D.left.x * sx + ox,
      firstBaseline: (D.left.firstTop + D.left.capH) * sy + oy,
      step: D.left.step * sy,
      fontPt: fontPtForCapHeight(D.left.capH * sy),
      descFontPt: fontPtForCapHeight(D.left.descCapH * sy),
    },
    rail: {
      x: D.rail.x * sx + ox,
      firstBaseline: (D.rail.firstTop + D.rail.capH) * sy + oy,
      step: D.rail.step * sy,
      fontPt: fontPtForCapHeight(D.rail.capH * sy),
    },
    barcode: {
      x: D.barcode.x * sx + ox,
      w: D.barcode.w * sx,
      top: D.barcode.top * sy + oy,
      bottom: D.barcode.bottom * sy + oy,
    },
    barcodeDigits: {
      baselineX: D.barcodeDigits.baselineX * sx + ox,
      bottom: D.barcodeDigits.bottom * sy + oy,
      fontPt: fontPtForCapHeight(D.barcodeDigits.capH * sy),
    },
    size: {
      labelX: D.size.labelX * sx + ox,
      labelFontPt: fontPtForCapHeight(D.size.labelCapH * sy),
      valueX: D.size.valueX * sx + ox,
      baseline: D.size.baseline * sy + oy,
      valueFontPt: fontPtForCapHeight(D.size.valueCapH * sy),
    },
    exchange: {
      line1Y: D.exchange.line1Y * sy + oy,
      line2Y: D.exchange.line2Y * sy + oy,
      firstBaseline: (D.exchange.textFirstTop + D.exchange.capH) * sy + oy,
      step: D.exchange.step * sy,
      fontPt: fontPtForCapHeight(D.exchange.capH * sy),
      stroke: Math.max(0.15, D.exchange.stroke * sy),
    },
    price: {
      currencyX: D.price.currencyX * sx + ox,
      currencyFontPt: fontPtForCapHeight(D.price.currencyCapH * sy),
      rightX: D.price.rightX * sx + ox,
      baseline: D.price.baseline * sy + oy,
      mainFontPt: fontPtForCapHeight(D.price.mainCapH * sy),
      topLineY: D.price.topLineY * sy + oy,
      midLineY: D.price.midLineY * sy + oy,
    },
    secondary: {
      rightX: D.secondary.rightX * sx + ox,
      baseline: D.secondary.baseline * sy + oy,
      fontPt: fontPtForCapHeight(D.secondary.capH * sy),
    },
  };
}

function imageFormat(dataUrl: string): 'PNG' | 'JPEG' {
  return dataUrl.startsWith('data:image/jpeg') || dataUrl.startsWith('data:image/jpg')
    ? 'JPEG'
    : 'PNG';
}

/** Wordmark aproximado quando o cliente não enviou PNG da marca. */
function drawLogoFallback(doc: PdfDoc, x: number, y: number, boxW: number, boxH: number): void {
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'italic');
  const fontPt = Math.max(14, Math.min(22, boxH * 1.55));
  doc.setFontSize(fontPt);
  doc.text('Nalin', x, y + boxH * 0.78, { baseline: 'alphabetic' });
  // Evita unused — a caixa define o envelope da marca.
  void boxW;
}

function drawLogo(
  doc: PdfDoc,
  logo: NalinTagLogo,
  x: number,
  y: number,
  boxW: number,
  boxH: number,
): void {
  if (logo && logo.width > 0 && logo.height > 0) {
    const scale = Math.min(boxW / logo.width, boxH / logo.height);
    const drawW = logo.width * scale;
    const drawH = logo.height * scale;
    try {
      doc.addImage(logo.dataUrl, imageFormat(logo.dataUrl), x, y + (boxH - drawH) / 2, drawW, drawH);
      return;
    } catch {
      /* wordmark de fallback */
    }
  }
  drawLogoFallback(doc, x, y, boxW, boxH);
}

function drawRotatedLine(
  doc: PdfDoc,
  text: string,
  x: number,
  baselineY: number,
  sizePt: number,
  style: 'normal' | 'bold' = 'normal',
): void {
  if (!text) return;
  doc.setFont('helvetica', style);
  doc.setFontSize(sizePt);
  doc.text(text, x, baselineY, { angle: 90, align: 'left' });
}

function fitText(
  doc: PdfDoc,
  texto: string,
  ideal: number,
  larguraMax: number,
  minPt = 5.5,
): { pt: number; texto: string } {
  for (let pt = ideal; pt >= minPt; pt -= 0.5) {
    doc.setFontSize(pt);
    if (doc.getTextWidth(texto) <= larguraMax) return { pt, texto };
  }
  doc.setFontSize(minPt);
  let cortado = texto;
  while (cortado.length > 1 && doc.getTextWidth(`${cortado}…`) > larguraMax) {
    cortado = cortado.slice(0, -1);
  }
  return { pt: minPt, texto: `${cortado.trimEnd()}…` };
}

function drawNalinTagLabel(
  doc: PdfDoc,
  row: ClientOrderLine,
  geometry: ClientLabelGeometry,
  branding: ClientLabelBranding,
  logo: NalinTagLogo,
  origin: { x?: number; y?: number } = {},
): void {
  const copy = composeNalinTagLabelCopy(row, branding);
  const s = artSlots(geometry, origin);
  /** Espelho horizontal da margem esquerda (arte simétrica). */
  const innerRight = (x: number) => 2 * s.ox + s.w - x;
  const centerX = s.ox + s.w / 2;

  doc.setTextColor(0, 0, 0);
  doc.setDrawColor(0, 0, 0);

  drawLogo(doc, logo, s.logo.x, s.logo.y, s.logo.w, s.logo.h);

  // Bloco esquerdo — código, referência, descrição, cor.
  const leftMaxW = Math.max(8, s.rail.x - s.left.x - 2);
  const leftLines = [
    { text: copy.codProduto, bold: false, pt: s.left.fontPt },
    { text: copy.referencia, bold: false, pt: s.left.fontPt },
    { text: copy.descricao, bold: false, pt: s.left.descFontPt },
    { text: copy.cor, bold: false, pt: s.left.fontPt },
  ].filter(line => line.text.length > 0);

  leftLines.forEach((line, i) => {
    doc.setFont('helvetica', line.bold ? 'bold' : 'normal');
    const fitted = fitText(doc, line.text, line.pt, leftMaxW);
    doc.setFontSize(fitted.pt);
    doc.text(fitted.texto, s.left.x, s.left.firstBaseline + s.left.step * i, {
      baseline: 'alphabetic',
    });
  });

  // Trilho curto (CR / FEM / JEA) — horizontal, empilhado.
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(s.rail.fontPt);
  copy.railCodes.forEach((code, i) => {
    // A foto coloca o codProduto também no topo do trilho.
    doc.text(code, s.rail.x, s.rail.firstBaseline + s.rail.step * (i + 1), {
      baseline: 'alphabetic',
    });
  });
  if (copy.codProduto) {
    doc.text(copy.codProduto, s.rail.x, s.rail.firstBaseline, { baseline: 'alphabetic' });
  }

  // CODE128 vertical: barras no eixo Y, espessura em X.
  if (copy.codigoBarra) {
    const barH = Math.max(2, s.barcode.bottom - s.barcode.top);
    try {
      const bars = code128Bars(copy.codigoBarra);
      const moduleCount = bars.reduce((max, b) => Math.max(max, b.start + b.width), 0);
      const module = barH / Math.max(moduleCount, 1);
      doc.setFillColor(0, 0, 0);
      for (const barra of bars) {
        const segH = barra.width * module;
        const segY = s.barcode.bottom - (barra.start + barra.width) * module;
        doc.rect(s.barcode.x, segY, s.barcode.w, segH, 'F');
      }
    } catch {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(5);
      doc.text('(codigo invalido)', s.barcode.x, s.barcode.bottom, { angle: 90 });
    }
    drawRotatedLine(
      doc,
      copy.codigoBarra,
      s.barcodeDigits.baselineX,
      s.barcodeDigits.bottom,
      s.barcodeDigits.fontPt,
      'normal',
    );
  }

  // TAM.: + número grande.
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(s.size.labelFontPt);
  doc.text('TAM.:', s.size.labelX, s.size.baseline, { baseline: 'alphabetic' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(s.size.valueFontPt);
  doc.text(copy.tamanho, s.size.valueX, s.size.baseline, { baseline: 'alphabetic' });

  // Fios + política de troca (centralizada).
  doc.setLineWidth(s.exchange.stroke);
  doc.line(s.left.x, s.exchange.line1Y, innerRight(s.left.x), s.exchange.line1Y);
  doc.line(s.left.x, s.exchange.line2Y, innerRight(s.left.x), s.exchange.line2Y);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(s.exchange.fontPt);
  copy.exchangeLines.forEach((line, i) => {
    doc.text(line, centerX, s.exchange.firstBaseline + s.exchange.step * i, {
      align: 'center',
      baseline: 'alphabetic',
    });
  });

  // Preço principal.
  doc.setLineWidth(s.exchange.stroke);
  doc.line(s.left.x, s.price.topLineY, innerRight(s.left.x), s.price.topLineY);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(s.price.currencyFontPt);
  doc.text('R$', s.price.currencyX, s.price.baseline - s.price.mainFontPt * 0.22, {
    baseline: 'alphabetic',
  });
  doc.setFontSize(s.price.mainFontPt);
  doc.text(copy.priceMain, s.price.rightX, s.price.baseline, {
    align: 'right',
    baseline: 'alphabetic',
  });

  doc.setLineWidth(Math.max(0.12, s.exchange.stroke * 0.7));
  doc.line(s.left.x, s.price.midLineY, innerRight(s.left.x), s.price.midLineY);

  if (copy.priceSecondary) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(s.secondary.fontPt);
    doc.text(copy.priceSecondary, s.secondary.rightX, s.secondary.baseline, {
      align: 'right',
      baseline: 'alphabetic',
    });
  }
}

export async function buildNalinTagPdf(
  rows: ClientOrderLine[],
  options: NalinTagPdfOptions = {},
): Promise<PdfDoc> {
  if (rows.length === 0) throw new Error('Nada para gerar: nenhuma etiqueta selecionada.');

  const geometry = mergeGeometry(options.geometry);
  const branding = mergeBranding(options.branding);
  const expanded = expandLines(rows, options.repeatByQuantity ?? true);

  const { jsPDF } = await import('jspdf');
  const landscape = geometry.labelWidthMm >= geometry.labelHeightMm;
  const doc = new jsPDF({
    unit: 'mm',
    format: [geometry.labelWidthMm, geometry.labelHeightMm],
    orientation: landscape ? 'landscape' : 'portrait',
    compress: true,
  });
  doc.setProperties({ title: 'Etiquetas Nalin Tag' });

  expanded.forEach((row, index) => {
    if (index > 0) {
      doc.addPage(
        [geometry.labelWidthMm, geometry.labelHeightMm],
        landscape ? 'landscape' : 'portrait',
      );
    }
    drawNalinTagLabel(doc, row, geometry, branding, options.logo ?? null);
  });

  return doc;
}

/** Tag Nalin em folha A4 4×4 (tesoura / Epson·LaserJet). */
export async function buildNalinTagA4Pdf(
  rows: ClientOrderLine[],
  options: NalinTagPdfOptions = {},
): Promise<PdfDoc> {
  const { buildTagA4Pdf } = await import('./tagA4Sheet');
  const geometry = mergeGeometry(options.geometry);
  const branding = mergeBranding(options.branding);
  const logo = options.logo ?? null;
  return buildTagA4Pdf(rows, {
    title: 'Etiquetas Nalin Tag A4',
    repeatByQuantity: options.repeatByQuantity ?? true,
    drawCell: (doc, row, origin) => {
      drawNalinTagLabel(doc, row, geometry, branding, logo, origin);
    },
  });
}

export function nalinTagPdfFilename(origem: string): string {
  const base = origem.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return `Etiquetas_Nalin_Tag_${base || 'pedido'}.pdf`;
}

function zplField(text: string, maxLen: number): string {
  return text.replace(/[\^~]/g, ' ').slice(0, maxLen).trim();
}

/**
 * ZPL 203 dpi na L42PRO, rolo 40×60 mm — espelho da arte PDF.
 *
 * ⚠ Conferir com uma etiqueta de teste antes do lote.
 */
export function buildNalinTagZpl(
  rows: ClientOrderLine[],
  options: {
    geometry?: Partial<ClientLabelGeometry>;
    branding?: Partial<ClientLabelBranding>;
    repeatByQuantity?: boolean;
  } = {},
): string {
  const geometry = mergeGeometry(options.geometry);
  const branding = mergeBranding(options.branding);
  const expanded = expandLines(rows, options.repeatByQuantity ?? true);
  const D = NALIN_TAG_ART_DOTS;

  const W = mmToDots(geometry.labelWidthMm);
  const H = mmToDots(geometry.labelHeightMm);
  const kx = W / D.gridW;
  const ky = H / D.gridH;
  const dx = (v: number) => Math.round(v * kx);
  const dy = (v: number) => Math.round(v * ky);
  const fontFor = (capDots: number, min = 8) => Math.max(min, Math.round(capDots / CAP_RATIO));

  const blocks = expanded.map(row => {
    const copy = composeNalinTagLabelCopy(row, branding);
    const barcode = copy.codigoBarra.replace(/[^A-Za-z0-9 ._/-]/g, '').slice(0, 48);
    const leftFont = fontFor(dy(D.left.capH));
    const descFont = fontFor(dy(D.left.descCapH));
    const railFont = fontFor(dy(D.rail.capH));
    const sizeFont = fontFor(dy(D.size.valueCapH), 14);
    const sizeLabelFont = fontFor(dy(D.size.labelCapH));
    const exchangeFont = fontFor(dy(D.exchange.capH));
    const currencyFont = fontFor(dy(D.price.currencyCapH));
    const mainFont = fontFor(dy(D.price.mainCapH), 16);
    const secondaryFont = fontFor(dy(D.secondary.capH), 12);
    const logoFont = Math.max(14, Math.round(dy(D.logo.h) * 0.85));

    const leftLines = [
      { text: copy.codProduto, font: leftFont },
      { text: copy.referencia, font: leftFont },
      { text: copy.descricao, font: descFont },
      { text: copy.cor, font: leftFont },
    ].filter(line => line.text.length > 0);

    const leftCmds = leftLines.map(
      (line, i) =>
        `^FO${dx(D.left.x)},${dy(D.left.firstTop + D.left.step * i)}^A0N,${line.font},${line.font}^FD${zplField(line.text, 28)}^FS`,
    );

    const railCmds = [
      copy.codProduto
        ? `^FO${dx(D.rail.x)},${dy(D.rail.firstTop)}^A0N,${railFont},${railFont}^FD${zplField(copy.codProduto, 12)}^FS`
        : '',
      ...copy.railCodes.map(
        (code, i) =>
          `^FO${dx(D.rail.x)},${dy(D.rail.firstTop + D.rail.step * (i + 1))}^A0N,${railFont},${railFont}^FD${zplField(code, 8)}^FS`,
      ),
    ];

    let barcodeCmds: string[] = [];
    if (barcode) {
      const span = dy(D.barcode.bottom) - dy(D.barcode.top);
      let moduleCount = 0;
      try {
        const bars = code128Bars(barcode);
        moduleCount = bars.reduce((max, b) => Math.max(max, b.start + b.width), 0);
      } catch {
        moduleCount = 0;
      }
      const module = moduleCount > 0 ? Math.max(2, Math.floor(span / moduleCount)) : 2;
      const digitFont = fontFor(dy(D.barcodeDigits.capH));
      barcodeCmds = [
        `^BY${module},2.0,${dx(D.barcode.w)}`,
        `^FO${dx(D.barcode.x)},${dy(D.barcode.top)}`,
        `^BCB,${dx(D.barcode.w)},N,N,N`,
        `^FD${barcode}^FS`,
        `^FO${Math.max(0, dx(D.barcodeDigits.baselineX) - digitFont)},${Math.max(0, dy(D.barcodeDigits.bottom) - Math.round(digitFont * barcode.length * 0.55))}^A0B,${digitFont},${digitFont}^FD${zplField(barcode, 20)}^FS`,
      ];
    }

    const exchangeCmds = copy.exchangeLines.map((line, i) => {
      const y = dy(D.exchange.textFirstTop + D.exchange.step * i);
      return `^FO${dx(14)},${y}^A0N,${exchangeFont},${exchangeFont}^FB${W - dx(28)},1,0,C^FD${zplField(line, 36)}^FS`;
    });

    const priceBoxW = Math.round(mainFont * 0.62 * (copy.priceMain.length + 1));
    const priceBoxX = Math.max(dx(D.price.currencyX) + currencyFont * 2, dx(D.price.rightX) - priceBoxW);

    return [
      '^XA',
      `^PW${W}`,
      `^LL${H}`,
      '^LH0,0',
      '^CI28',
      `^FO${dx(D.logo.x)},${dy(D.logo.y) + Math.round(dy(D.logo.h) * 0.15)}^A0N,${logoFont},${logoFont}^FD${zplField('Nalin', 12)}^FS`,
      ...leftCmds,
      ...railCmds,
      ...barcodeCmds,
      `^FO${dx(D.size.labelX)},${dy(D.size.baseline) - sizeLabelFont}^A0N,${sizeLabelFont},${sizeLabelFont}^FD${zplField('TAM.:', 8)}^FS`,
      `^FO${dx(D.size.valueX)},${dy(D.size.baseline) - sizeFont}^A0N,${sizeFont},${sizeFont}^FD${zplField(copy.tamanho, 6)}^FS`,
      `^FO${dx(14)},${dy(D.exchange.line1Y)}^GB${W - dx(28)},${Math.max(1, dy(D.exchange.stroke))},${Math.max(1, dy(D.exchange.stroke))},B^FS`,
      ...exchangeCmds,
      `^FO${dx(14)},${dy(D.exchange.line2Y)}^GB${W - dx(28)},${Math.max(1, dy(D.exchange.stroke))},${Math.max(1, dy(D.exchange.stroke))},B^FS`,
      `^FO${dx(14)},${dy(D.price.topLineY)}^GB${W - dx(28)},${Math.max(1, dy(D.exchange.stroke))},${Math.max(1, dy(D.exchange.stroke))},B^FS`,
      `^FO${dx(D.price.currencyX)},${dy(D.price.baseline) - mainFont - Math.round(currencyFont * 0.2)}^A0N,${currencyFont},${currencyFont}^FD${zplField('R$', 4)}^FS`,
      `^FO${priceBoxX},${dy(D.price.baseline) - mainFont}^A0N,${mainFont},${mainFont}^FB${dx(D.price.rightX) - priceBoxX},1,0,R^FD${zplField(copy.priceMain, 12)}^FS`,
      `^FO${dx(14)},${dy(D.price.midLineY)}^GB${W - dx(28)},${Math.max(1, dy(D.exchange.stroke))},${Math.max(1, dy(D.exchange.stroke))},B^FS`,
      copy.priceSecondary
        ? `^FO${dx(D.secondary.rightX) - Math.round(secondaryFont * 0.62 * copy.priceSecondary.length)},${dy(D.secondary.baseline) - secondaryFont}^A0N,${secondaryFont},${secondaryFont}^FD${zplField(copy.priceSecondary, 12)}^FS`
        : '',
      '^XZ',
    ]
      .filter(Boolean)
      .join('\n');
  });

  return blocks.join('\n\n');
}

export function nalinTagZplFilename(origem: string): string {
  const base = origem.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return `Etiquetas_Nalin_Tag_${base || 'pedido'}_L42PRO.zpl`;
}

export function countNalinTagLabels(rows: ClientOrderLine[], repeatByQuantity: boolean): number {
  if (!repeatByQuantity) return rows.length;
  return rows.reduce((sum, row) => sum + Math.max(1, Math.trunc(row.quantidade) || 1), 0);
}

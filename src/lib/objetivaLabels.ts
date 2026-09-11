/**
 * Padrão de etiqueta hangtag do cliente Objetiva.
 *
 * Entrada: CSV do ERP (`PEDIDO;SKU;DESCRICAO;…`) — um SKU por arquivo no lote típico.
 * O CODE128 usa o SKU. Textos fixos (motto, troca, PU/SO) vêm do padrão editável.
 */
import { code128Bars } from './code128';
import { decodeOrderBytes } from './babyNalinLabels';
import {
  OBJETIVA_DEFAULT_BRANDING,
  OBJETIVA_DEFAULT_GEOMETRY,
  type ClientLabelBranding,
  type ClientLabelGeometry,
  type ClientOrderLine,
} from './clientLabelPattern';

export const OBJETIVA_MODULE_MM = 0.25;
export const MAX_OBJETIVA_PDF_LABELS = 20_000;

type PdfDoc = import('jspdf').jsPDF;

function normalizeHeader(raw: string): string {
  return raw
    .replace(/^\uFEFF/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function splitDelimited(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let atual = '';
  let emAspas = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (emAspas && line[i + 1] === '"') {
        atual += '"';
        i++;
      } else {
        emAspas = !emAspas;
      }
    } else if (ch === delimiter && !emAspas) {
      out.push(atual);
      atual = '';
    } else {
      atual += ch;
    }
  }
  out.push(atual);
  return out.map(c => c.trim());
}

const OBJETIVA_ALIASES: Record<string, string[]> = {
  pedido: ['pedido'],
  sku: ['sku'],
  descricao: ['descricao'],
  referencia: ['referencia', 'ref'],
  cor: ['cor'],
  grade: ['grade'],
  quantidade: ['quantidade pedido', 'qtd pedido', 'quantidade', 'qtd'],
  tamanho: ['tamanhos', 'tamanho', 'tam'],
  valor: ['valor'],
  dataFabricacao: ['data fabricacao'],
  semanaFabricacao: ['semana fabricacao', 'semana'],
  anoFabricacao: ['ano fabricacao', 'ano'],
  tipo: ['tipo'],
  categoria: ['categoria'],
  grupo: ['grupo'],
};

function indexOfAlias(headers: string[], key: string): number {
  for (const alias of OBJETIVA_ALIASES[key] ?? []) {
    const i = headers.indexOf(alias);
    if (i >= 0) return i;
  }
  return -1;
}

export function isObjetivaOrderHeader(headerCells: string[]): boolean {
  const normalized = headerCells.map(normalizeHeader);
  return indexOfAlias(normalized, 'sku') >= 0 && indexOfAlias(normalized, 'tamanho') >= 0;
}

function parseQuantity(raw: string): number {
  const cleaned = raw.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 1;
}

function buildObjetivaRows(header: string[], linhas: string[][], sourceFile?: string): ClientOrderLine[] {
  const normalized = header.map(normalizeHeader);
  if (indexOfAlias(normalized, 'sku') < 0) {
    throw new Error(
      'Não achei a coluna "SKU" no arquivo Objetiva. Use o CSV do pedido (PEDIDO;SKU;DESCRICAO;…).',
    );
  }

  const pick = (linha: string[], key: string) => {
    const i = indexOfAlias(normalized, key);
    return i >= 0 ? (linha[i] ?? '').trim() : '';
  };

  const rows: ClientOrderLine[] = [];
  for (const linha of linhas) {
    const sku = pick(linha, 'sku');
    if (!sku) continue;
    rows.push({
      tamanho: pick(linha, 'tamanho').toUpperCase(),
      cor: pick(linha, 'cor').toUpperCase(),
      referencia: pick(linha, 'referencia').toUpperCase(),
      codProduto: sku,
      codigoBarra: sku,
      quantidade: parseQuantity(pick(linha, 'quantidade')),
      descricao: pick(linha, 'descricao').toUpperCase(),
      valor: pick(linha, 'valor'),
      tipo: pick(linha, 'tipo').toUpperCase(),
      categoria: pick(linha, 'categoria').toUpperCase(),
      grupo: pick(linha, 'grupo').toUpperCase(),
      semanaFabricacao: pick(linha, 'semanaFabricacao'),
      anoFabricacao: pick(linha, 'anoFabricacao'),
      pedido: pick(linha, 'pedido'),
      sourceFile,
    });
  }
  if (rows.length === 0) throw new Error('Nenhuma linha com SKU preenchido no arquivo Objetiva.');
  return rows;
}

export function parseObjetivaOrderCsv(texto: string, sourceFile?: string): ClientOrderLine[] {
  const linhas = texto.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (linhas.length < 2) throw new Error('Arquivo Objetiva vazio ou sem linhas de dados.');

  const delimitador = (linhas[0].match(/;/g) ?? []).length >= (linhas[0].match(/,/g) ?? []).length ? ';' : ',';
  const header = splitDelimited(linhas[0], delimitador);
  if (!isObjetivaOrderHeader(header)) {
    throw new Error('Cabeçalho não parece exportação Objetiva (precisa de SKU e TAMANHOS).');
  }
  return buildObjetivaRows(
    header,
    linhas.slice(1).map(l => splitDelimited(l, delimitador)),
    sourceFile,
  );
}

export async function parseObjetivaOrderFile(file: File): Promise<ClientOrderLine[]> {
  const buffer = await file.arrayBuffer();
  const nome = file.name.toLowerCase();
  if (nome.endsWith('.xlsx') || nome.endsWith('.xls')) {
    const XLSX = await import('xlsx');
    const wb = XLSX.read(buffer, { type: 'array' });
    const aba = wb.Sheets[wb.SheetNames[0]];
    if (!aba) throw new Error('A planilha Objetiva não tem nenhuma aba.');
    const matriz = XLSX.utils.sheet_to_json<string[]>(aba, { header: 1, raw: false, defval: '' });
    const linhas = matriz.filter(l => l.some(c => String(c ?? '').trim().length > 0));
    if (linhas.length < 2) throw new Error('Planilha Objetiva vazia ou sem linhas de dados.');
    const header = linhas[0].map(String);
    if (!isObjetivaOrderHeader(header)) {
      throw new Error('Planilha não parece exportação Objetiva (precisa de SKU e TAMANHOS).');
    }
    return buildObjetivaRows(
      header,
      linhas.slice(1).map(l => l.map(c => String(c ?? ''))),
      file.name,
    );
  }
  return parseObjetivaOrderCsv(decodeOrderBytes(buffer), file.name);
}

function formatPrice(valor: string | undefined): { main: string; cents: string } {
  const raw = (valor ?? '').replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
  const n = Number(raw);
  if (!Number.isFinite(n)) return { main: '0', cents: '00' };
  const [reais, cents = '00'] = n.toFixed(2).split('.');
  return { main: Number(reais).toLocaleString('pt-BR'), cents };
}

function materialLine(prefix: string, cor: string): string {
  const p = (prefix.trim() || OBJETIVA_DEFAULT_BRANDING.materialPrefix).trim();
  const c = cor.trim();
  return c ? `${p} / ${c}` : p;
}

function categoryLine(grupo?: string, categoria?: string): string {
  const g = (grupo ?? '').trim();
  const c = (categoria ?? '').trim();
  if (g && c) return `${g}/${c}`;
  return g || c || '';
}

export interface ObjetivaPdfOptions {
  geometry?: Partial<ClientLabelGeometry>;
  branding?: Partial<ClientLabelBranding>;
  repeatByQuantity?: boolean;
}

function mergeGeometry(partial?: Partial<ClientLabelGeometry>): ClientLabelGeometry {
  return { ...OBJETIVA_DEFAULT_GEOMETRY, ...partial };
}

function mergeBranding(partial?: Partial<ClientLabelBranding>): ClientLabelBranding {
  return { ...OBJETIVA_DEFAULT_BRANDING, ...partial };
}

function expandLines(rows: ClientOrderLine[], repeatByQuantity: boolean): ClientOrderLine[] {
  if (!repeatByQuantity) return rows;
  const total = rows.reduce((sum, row) => sum + Math.max(1, Math.trunc(row.quantidade) || 1), 0);
  if (total > MAX_OBJETIVA_PDF_LABELS) {
    throw new Error(
      `A geração teria ${total.toLocaleString('pt-BR')} etiquetas. O limite seguro é ${MAX_OBJETIVA_PDF_LABELS.toLocaleString('pt-BR')} por PDF.`,
    );
  }
  return rows.flatMap(row =>
    Array.from({ length: Math.max(1, Math.trunc(row.quantidade) || 1) }, () => row),
  );
}

function drawObjetivaLabel(
  doc: PdfDoc,
  row: ClientOrderLine,
  geometry: ClientLabelGeometry,
  branding: ClientLabelBranding,
): void {
  const w = geometry.labelWidthMm;
  const h = geometry.labelHeightMm;
  const padL = geometry.leftMarginMm;
  const padR = geometry.rightMarginMm;
  const padT = geometry.topMarginMm;
  const padB = geometry.bottomMarginMm;
  const contentW = w - padL - padR;
  const contentH = h - padT - padB;

  doc.setTextColor(0, 0, 0);
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.2);

  const leftBand = Math.min(9, contentW * 0.22);
  doc.setFillColor(0, 0, 0);
  doc.rect(padL, padT, leftBand, 6, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.text('objetiva', padL + 0.8, padT + 3.8);

  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(4.5);
  doc.text(branding.motto || OBJETIVA_DEFAULT_BRANDING.motto, padL + leftBand + 0.6, padT + 2.8, {
    baseline: 'top',
  });

  doc.setFontSize(4);
  const exchange = (branding.exchangeText || OBJETIVA_DEFAULT_BRANDING.exchangeText).toUpperCase();
  doc.text(doc.splitTextToSize(exchange, leftBand - 0.6), padL + 0.4, padT + 7.2, { baseline: 'top' });

  if (row.descricao) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(5.5);
    doc.text(row.descricao, padL + leftBand * 0.55, padT + contentH - 2, {
      angle: 90,
      align: 'left',
    });
  }

  const mainX = padL + leftBand + 1.2;
  const mainW = Math.max(8, contentW - leftBand - 12);
  let y = padT + 8;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  if (row.tipo) {
    doc.text(row.tipo, mainX, y, { baseline: 'top' });
    y += 3.4;
  }
  doc.setFontSize(6.5);
  const cat = categoryLine(row.grupo, row.categoria);
  if (cat) {
    doc.text(cat, mainX, y, { baseline: 'top' });
    y += 3.1;
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6);
  doc.text(materialLine(branding.materialPrefix, row.cor), mainX, y, {
    baseline: 'top',
    maxWidth: mainW,
  });
  y += 3.1;
  doc.setFont('helvetica', 'bold');
  doc.text(`Ref.: ${row.referencia || row.codProduto}`, mainX, y, { baseline: 'top' });

  doc.setLineWidth(0.25);
  doc.line(mainX, padT + contentH - 14, mainX + mainW, padT + contentH - 14);

  const price = formatPrice(row.valor);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6);
  doc.text('TAM.:', mainX, padT + contentH - 11, { baseline: 'top' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(row.tamanho || '-', mainX + 8, padT + contentH - 12, { baseline: 'top' });

  doc.setFontSize(5);
  doc.setFont('helvetica', 'normal');
  doc.text('R$', mainX, h - padB - 1.2, { baseline: 'bottom' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(price.main, mainX + mainW - 4, h - padB - 1.5, { align: 'right', baseline: 'bottom' });
  doc.setFontSize(8);
  doc.text(`,${price.cents}`, mainX + mainW - 1, h - padB - 6.5, { align: 'right', baseline: 'bottom' });

  const rightX = w - padR - 8;
  const weekYear = [row.semanaFabricacao, row.anoFabricacao].filter(Boolean).join(' / ');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5);
  if (weekYear) {
    doc.text(weekYear, rightX + 2.2, padT + contentH - 18, { angle: 90 });
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6);
  doc.text(row.codigoBarra, rightX + 4.2, padT + contentH - 18, { angle: 90 });

  try {
    const bars = code128Bars(row.codigoBarra);
    const moduleCount = bars.reduce((max, b) => Math.max(max, b.start + b.width), 0);
    const barHeight = 4.2;
    const available = Math.max(10, contentH - 6);
    const module = Math.min(OBJETIVA_MODULE_MM, available / Math.max(moduleCount, 1));
    doc.setFillColor(0, 0, 0);
    const barcodeOriginY = padT + contentH - 2;
    for (const barra of bars) {
      const segH = barra.width * module;
      const segY = barcodeOriginY - (barra.start + barra.width) * module;
      doc.rect(rightX + 5.5, segY, barHeight, segH, 'F');
    }
  } catch {
    doc.setFontSize(5);
    doc.setFont('helvetica', 'normal');
    doc.text('(código inválido)', rightX + 6, padT + 20, { angle: 90 });
  }
}

export async function buildObjetivaPdf(
  rows: ClientOrderLine[],
  options: ObjetivaPdfOptions = {},
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
  doc.setProperties({ title: 'Etiquetas Objetiva' });

  expanded.forEach((row, index) => {
    if (index > 0) {
      doc.addPage(
        [geometry.labelWidthMm, geometry.labelHeightMm],
        landscape ? 'landscape' : 'portrait',
      );
    }
    drawObjetivaLabel(doc, row, geometry, branding);
  });

  return doc;
}

export function objetivaPdfFilename(origem: string): string {
  const base = origem.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return `Etiquetas_Objetiva_${base || 'pedido'}.pdf`;
}

export function countObjetivaLabels(rows: ClientOrderLine[], repeatByQuantity: boolean): number {
  if (!repeatByQuantity) return rows.length;
  return rows.reduce((sum, row) => sum + Math.max(1, Math.trunc(row.quantidade) || 1), 0);
}

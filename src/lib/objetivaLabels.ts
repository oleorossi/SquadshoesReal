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

export function stripHangtagAccents(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
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

function splitMottoLines(text: string): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1) return words;
  if (words.length === 2) return words;
  return [words[0]!, words.slice(1).join(' ')];
}

function splitExchangeLines(text: string): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1) return words;
  const mid = Math.ceil(words.length / 2);
  return [words.slice(0, mid).join(' '), words.slice(mid).join(' ')];
}

export interface ObjetivaLabelCopy {
  descricao: string;
  tipo: string;
  categoria: string;
  material: string;
  referencia: string;
  tamanho: string;
  priceMain: string;
  priceCents: string;
  semanaAno: string;
  codigoBarra: string;
  mottoLines: string[];
  exchangeLines: string[];
}

/** Textos da hangtag física — acentos só saem na impressão, o CSV permanece intacto. */
export function composeObjetivaLabelCopy(
  row: ClientOrderLine,
  branding: ClientLabelBranding,
): ObjetivaLabelCopy {
  const price = formatPrice(row.valor);
  const motto = (branding.motto || OBJETIVA_DEFAULT_BRANDING.motto).trim();
  const exchange = (branding.exchangeText || OBJETIVA_DEFAULT_BRANDING.exchangeText).trim().toUpperCase();
  return {
    descricao: stripHangtagAccents((row.descricao ?? '').trim()),
    tipo: stripHangtagAccents((row.tipo ?? '').trim()),
    categoria: stripHangtagAccents(categoryLine(row.grupo, row.categoria)),
    material: stripHangtagAccents(materialLine(branding.materialPrefix, row.cor)),
    referencia: `Ref.: ${stripHangtagAccents((row.referencia || row.codProduto).trim())}`,
    tamanho: (row.tamanho || '-').trim() || '-',
    priceMain: price.main,
    priceCents: price.cents,
    semanaAno: [row.semanaFabricacao, row.anoFabricacao].filter(Boolean).join('/'),
    codigoBarra: (row.codigoBarra || row.codProduto).trim(),
    mottoLines: splitMottoLines(motto),
    exchangeLines: splitExchangeLines(exchange),
  };
}

/**
 * Descrição da hangtag: no máximo 2 linhas, quebrando por palavra.
 * "SAND INFA RAST TIRAS NO" cabe numa; "SAND INFA PLAT TIRAS BRILHO" vira
 * TIRAS / BRILHO como na etiqueta física.
 */
export function wrapObjetivaDescricao(descricao: string, maxChars = 24): string[] {
  const text = descricao.trim();
  if (!text) return [];
  if (text.length <= maxChars) return [text];
  const words = text.split(/\s+/).filter(Boolean);
  let first = '';
  let index = 0;
  for (; index < words.length; index += 1) {
    const next = first ? `${first} ${words[index]}` : words[index]!;
    if (first && next.length > maxChars) break;
    first = next;
  }
  const second = words.slice(index).join(' ');
  return second ? [first, second] : [first];
}

/**
 * Linhas que realmente giram 90° na hangtag física:
 * descrição (faixa esquerda) + SKU + semana/ano (faixa direita).
 * O miolo (tipo/categoria/material/ref) é horizontal.
 */
export function objetivaRotatedRailLines(copy: ObjetivaLabelCopy): string[] {
  return [
    ...wrapObjetivaDescricao(copy.descricao),
    copy.codigoBarra,
    copy.semanaAno,
  ].filter(line => line.length > 0);
}

/** @deprecated Use objetivaRotatedRailLines — o miolo não gira mais. */
export function objetivaRotatedBodyLines(copy: ObjetivaLabelCopy): string[] {
  return objetivaRotatedRailLines(copy);
}

/** Linhas do miolo horizontal (topo → base), sem rotação. */
export function objetivaHorizontalMioloLines(copy: ObjetivaLabelCopy): string[] {
  return [copy.tipo, copy.categoria, copy.material, copy.referencia].filter(
    line => line.length > 0,
  );
}

export type ObjetivaLogo = { dataUrl: string; width: number; height: number } | null;

export interface ObjetivaPdfOptions {
  geometry?: Partial<ClientLabelGeometry>;
  branding?: Partial<ClientLabelBranding>;
  repeatByQuantity?: boolean;
  logo?: ObjetivaLogo;
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

function imageFormat(dataUrl: string): 'PNG' | 'JPEG' {
  return dataUrl.startsWith('data:image/jpeg') || dataUrl.startsWith('data:image/jpg') ? 'JPEG' : 'PNG';
}

function drawLogoFallback(doc: PdfDoc, x: number, y: number, boxW: number, boxH: number): void {
  doc.setFillColor(0, 0, 0);
  doc.rect(x, y, boxW, boxH, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(Math.max(5.5, Math.min(7.5, boxH * 0.95)));
  doc.text('objetiva', x + 0.7, y + boxH * 0.68);
  doc.setTextColor(0, 0, 0);
}

function drawLogo(
  doc: PdfDoc,
  logo: ObjetivaLogo,
  x: number,
  y: number,
  boxW: number,
  boxH: number,
): void {
  if (logo && logo.width > 0 && logo.height > 0) {
    const scale = Math.min(boxW / logo.width, boxH / logo.height);
    const drawW = logo.width * scale;
    const drawH = logo.height * scale;
    const ox = x;
    const oy = y + (boxH - drawH) / 2;
    try {
      doc.addImage(logo.dataUrl, imageFormat(logo.dataUrl), ox, oy, drawW, drawH);
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
  // Sem maxWidth: o clip horizontal (~23 mm) era o que cortava CALCADOS/INFANTI
  // e fazia o miolo parecer distorcido. O texto deita no eixo Y da peça.
  doc.text(text, x, baselineY, { angle: 90, align: 'left' });
}

function rotatedColumnStep(sizePt: number, extraMm = 0.55): number {
  return sizePt * 0.352778 * 1.12 + extraMm;
}

function drawObjetivaLabel(
  doc: PdfDoc,
  row: ClientOrderLine,
  geometry: ClientLabelGeometry,
  branding: ClientLabelBranding,
  logo: ObjetivaLogo,
): void {
  const copy = composeObjetivaLabelCopy(row, branding);
  const w = geometry.labelWidthMm;
  const h = geometry.labelHeightMm;
  const padL = geometry.leftMarginMm;
  const padR = geometry.rightMarginMm;
  const padT = geometry.topMarginMm;
  const padB = geometry.bottomMarginMm;
  const contentW = Math.max(12, w - padL - padR);
  const contentH = Math.max(20, h - padT - padB);

  doc.setTextColor(0, 0, 0);
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.25);

  const logoBoxW = Math.min(16.8, contentW * 0.44);
  const logoBoxH = Math.min(6.8, contentH * 0.115);
  const footerH = Math.min(14.5, contentH * 0.24);

  drawLogo(doc, logo, padL, padT, logoBoxW, logoBoxH);

  const mottoX = padL + logoBoxW + 1.0;
  const mottoMaxW = Math.max(8, contentW - logoBoxW - 1.2);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(4.0);
  let mottoY = padT + 1.1;
  for (const line of copy.mottoLines) {
    doc.text(line, mottoX, mottoY, { baseline: 'top', maxWidth: mottoMaxW });
    mottoY += 2.2;
  }

  let exchangeY = padT + logoBoxH + 0.85;
  doc.setFontSize(3.9);
  for (const line of copy.exchangeLines) {
    doc.text(line, padL, exchangeY, { baseline: 'top' });
    exchangeY += 2.15;
  }
  const headerBottom = Math.max(exchangeY, padT + logoBoxH + 1) + 0.45;
  const footerTop = h - padB - footerH;
  const runTop = headerBottom + 0.3;
  const runBottom = footerTop - 0.4;

  // Faixa esquerda: descrição vertical + divisor
  const descLines = wrapObjetivaDescricao(copy.descricao);
  const descSize = 5.2;
  let x = padL + 1.05;
  for (const line of descLines) {
    drawRotatedLine(doc, line, x, runBottom, descSize, 'bold');
    x += rotatedColumnStep(descSize, 0.3);
  }

  const dividerX = x + 0.5;
  doc.line(dividerX, headerBottom, dividerX, footerTop);

  // Faixa direita: CODE128 + SKU (topo) + semana/ano (base)
  const barStripW = Math.min(7.6, contentW * 0.185);
  const barX = w - padR - barStripW;
  const skuX = barX - 2.2;
  const weekX = skuX - 2.55;

  if (copy.codigoBarra) {
    try {
      const bars = code128Bars(copy.codigoBarra);
      const moduleCount = bars.reduce((max, b) => Math.max(max, b.start + b.width), 0);
      const runH = Math.max(8, runBottom - runTop);
      const module = Math.max(OBJETIVA_MODULE_MM, runH / Math.max(moduleCount, 1));
      doc.setFillColor(0, 0, 0);
      for (const barra of bars) {
        const segH = barra.width * module;
        const segY = runBottom - (barra.start + barra.width) * module;
        doc.rect(barX, segY, barStripW, segH, 'F');
      }
    } catch {
      doc.setFontSize(5);
      doc.setFont('helvetica', 'normal');
      doc.text('(código inválido)', barX + 1.2, runTop + 8, { angle: 90 });
    }
  }

  // SKU junto ao topo do código; semana/ano na base (ambos deitados)
  if (copy.codigoBarra) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.0);
    const skuLen = doc.getTextWidth(copy.codigoBarra);
    drawRotatedLine(doc, copy.codigoBarra, skuX, runTop + skuLen, 6.0, 'bold');
  }
  if (copy.semanaAno) {
    drawRotatedLine(doc, copy.semanaAno, weekX, runBottom, 4.8, 'normal');
  }

  // Miolo horizontal (tipo → categoria → material → ref), entre divisor e faixa do SKU.
  // Sem maxWidth: o clip reintroduzia CALCADOS/INFANTI + L em duas Tj (bug do miolo deitado).
  const mioloLeft = dividerX + 1.6;
  let mioloY = runTop + 0.4;
  const mioloLines: Array<{ text: string; size: number; style: 'normal' | 'bold'; gap: number }> = [
    { text: copy.tipo, size: 7.2, style: 'bold', gap: 3.55 },
    { text: copy.categoria, size: 5.6, style: 'bold', gap: 3.15 },
    { text: copy.material, size: 5.2, style: 'normal', gap: 3.0 },
    { text: copy.referencia, size: 5.2, style: 'bold', gap: 3.0 },
  ];
  for (const line of mioloLines) {
    if (!line.text) continue;
    doc.setFont('helvetica', line.style);
    doc.setFontSize(line.size);
    doc.text(line.text, mioloLeft, mioloY, { baseline: 'top' });
    mioloY += line.gap;
  }

  // Footer: TAM à esquerda; bloco R$ + main + cents à direita (R$ baseline com o main)
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5);
  doc.text('TAM.:', padL, footerTop + 1.2, { baseline: 'top' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15.5);
  doc.text(copy.tamanho, padL + 7.2, footerTop + 0.35, { baseline: 'top' });

  const priceRight = w - padR;
  const centsLabel = `,${copy.priceCents}`;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.2);
  const centsWidth = doc.getTextWidth(centsLabel);
  doc.setFontSize(15.5);
  const mainWidth = doc.getTextWidth(copy.priceMain);
  const mainTop = footerTop + 0.35;
  const mainBottom = mainTop + 15.5 * 0.352778;
  doc.setFontSize(8.5);
  const rsWidth = doc.getTextWidth('R$');
  const priceGap = 0.55;
  const blockWidth = rsWidth + priceGap + mainWidth + 0.25 + centsWidth;
  const blockLeft = priceRight - blockWidth;

  doc.setFontSize(8.5);
  doc.text('R$', blockLeft, mainBottom, { baseline: 'bottom' });
  doc.setFontSize(15.5);
  doc.text(copy.priceMain, blockLeft + rsWidth + priceGap, mainTop, {
    baseline: 'top',
  });
  doc.setFontSize(7.2);
  doc.text(centsLabel, blockLeft + rsWidth + priceGap + mainWidth + 0.25, mainTop, {
    baseline: 'top',
  });
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
    drawObjetivaLabel(doc, row, geometry, branding, options.logo ?? null);
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

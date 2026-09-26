/**
 * Padrão de etiqueta Tag (hangtag) do cliente Objetiva.
 *
 * Entrada: CSV do ERP (`PEDIDO;SKU;DESCRICAO;…`) — um SKU por arquivo no lote típico.
 * O CODE128 usa o SKU. Textos fixos (motto, troca, PU/SO) vêm do padrão editável.
 * A adesiva (`objetiva_adesiva`) reusa o mesmo CSV; a arte dela é outro gerador.
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
 * Faixa esquerda girada 90°: a descrição do produto, colada à margem, antes do
 * fio divisor. Lê de baixo para cima na etiqueta física.
 */
export function objetivaRotatedRailLines(copy: ObjetivaLabelCopy): string[] {
  return wrapObjetivaDescricao(copy.descricao);
}

/**
 * Miolo — tipo/categoria/material/referência. **Também gira 90°** na etiqueta
 * física: são colunas lado a lado à direita do fio, na mesma orientação da
 * descrição. Desenhar na horizontal (como ficou entre 08 e 09/2026) descola a
 * arte da etiqueta impressa pelo cliente.
 *
 * `emphasis` é do TIPO (SANDALIA destaca na foto), não da posição: CSV sem
 * TIPO/CATEGORIA não pode promover o material a título.
 */
export interface ObjetivaMioloColumn {
  text: string;
  emphasis: boolean;
}

export function objetivaMioloColumns(copy: ObjetivaLabelCopy): ObjetivaMioloColumn[] {
  return [
    { text: copy.tipo, emphasis: true },
    { text: copy.categoria, emphasis: false },
    { text: copy.material, emphasis: false },
    { text: copy.referencia, emphasis: false },
  ].filter(column => column.text.length > 0);
}

export function objetivaMioloLines(copy: ObjetivaLabelCopy): string[] {
  return objetivaMioloColumns(copy).map(column => column.text);
}

/** Coluna direita girada: SKU acima do código, semana/ano abaixo. */
export function objetivaBarcodeRailLines(copy: ObjetivaLabelCopy): string[] {
  return [copy.codigoBarra, copy.semanaAno].filter(line => line.length > 0);
}

export type ObjetivaLogo = { dataUrl: string; width: number; height: number } | null;

export interface ObjetivaPdfOptions {
  geometry?: Partial<ClientLabelGeometry>;
  branding?: Partial<ClientLabelBranding>;
  repeatByQuantity?: boolean;
  logo?: ObjetivaLogo;
}

/** Mesma mídia da Ponto Mix: rolo 40×60 mm na L42PRO a 203 dpi. */
export const OBJETIVA_DPI = 203;

/** Altura de caixa-alta ÷ em da Helvetica (capHeight 718 / upem 1000). */
const CAP_RATIO = 0.717;

/**
 * Grade da arte em DOTS a 203 dpi — 40×60 mm = 320×480 dots, igual à régua da
 * Ponto Mix. Os valores saíram da etiqueta física da Objetiva (foto de
 * calibração do SKU 112334 / TAM 25).
 *
 * Orientação: o bloco central inteiro (descrição, miolo, SKU, semana/ano e o
 * código de barras) gira 90°; só cabeçalho, TAM e preço ficam na horizontal.
 */
export const OBJETIVA_ART_DOTS = {
  gridW: 320,
  gridH: 480,
  /** Faixa preta da marca, no alto à esquerda. */
  logoBand: { x: 12, y: 15, w: 150, h: 27 },
  /** "DEUS / É FIEL" ao lado da faixa. */
  motto: { x: 170, firstTop: 16, step: 13, capH: 8 },
  /** "TROCA MANTER / ESTA ETIQUETA" sob a faixa. */
  exchange: { x: 12, firstTop: 50, step: 14, capH: 9 },
  /** Fio vertical que separa a descrição do miolo. */
  divider: { x: 78, top: 82, bottom: 352, stroke: 2 },
  /** Descrição girada: `baselineX` é a BORDA DIREITA (glifo cresce para -x). */
  rail: { baselineX: 70, bottom: 350, step: 19, capH: 13 },
  /** Colunas giradas do miolo, à direita do fio. */
  miolo: { firstBaselineX: 106, step: 22, bottom: 350, titleCapH: 15, capH: 11 },
  /** Dígitos do SKU, girados, acima do código. */
  sku: { baselineX: 248, bottom: 248, capH: 12 },
  /** Semana/ano, girado, abaixo do código. */
  week: { baselineX: 248, bottom: 374, capH: 10 },
  /** Código de barras girado: `w` é a espessura da faixa. */
  barcode: { x: 258, w: 52, top: 138, bottom: 376 },
  /** "TAM.:" + número grande. */
  size: { labelX: 30, labelCapH: 9, valueX: 70, baseline: 408, valueCapH: 30 },
  /** "R$" à esquerda, valor grande alinhado à direita, centavos sobrescritos. */
  price: { currencyX: 28, currencyCapH: 14, rightX: 296, baseline: 458, mainCapH: 36, centsCapH: 17 },
} as const;

/** Corpo em pt que entrega exatamente `capMm` de altura de caixa-alta. */
function fontPtForCapHeight(capMm: number): number {
  return (capMm / CAP_RATIO) * (72 / 25.4);
}

function mmToDots(mm: number, dpi = OBJETIVA_DPI): number {
  return Math.max(1, Math.round((mm / 25.4) * dpi));
}

/**
 * Converte a grade de dots para as medidas da etiqueta configurada. Em 40×60 mm
 * o fator é 0,125 mm/dot — a mídia da Ponto Mix.
 */
function artSlots(geometry: ClientLabelGeometry) {
  const D = OBJETIVA_ART_DOTS;
  const w = geometry.labelWidthMm;
  const h = geometry.labelHeightMm;
  const sx = w / D.gridW;
  const sy = h / D.gridH;
  return {
    w,
    h,
    sx,
    sy,
    logoBand: {
      x: D.logoBand.x * sx,
      y: D.logoBand.y * sy,
      w: D.logoBand.w * sx,
      h: D.logoBand.h * sy,
    },
    motto: {
      x: D.motto.x * sx,
      firstBaseline: (D.motto.firstTop + D.motto.capH) * sy,
      step: D.motto.step * sy,
      fontPt: fontPtForCapHeight(D.motto.capH * sy),
    },
    exchange: {
      x: D.exchange.x * sx,
      firstBaseline: (D.exchange.firstTop + D.exchange.capH) * sy,
      step: D.exchange.step * sy,
      fontPt: fontPtForCapHeight(D.exchange.capH * sy),
    },
    divider: {
      x: D.divider.x * sx,
      top: D.divider.top * sy,
      bottom: D.divider.bottom * sy,
      stroke: Math.max(0.12, D.divider.stroke * sx),
    },
    rail: {
      baselineX: D.rail.baselineX * sx,
      bottom: D.rail.bottom * sy,
      step: D.rail.step * sx,
      fontPt: fontPtForCapHeight(D.rail.capH * sy),
    },
    miolo: {
      firstBaselineX: D.miolo.firstBaselineX * sx,
      step: D.miolo.step * sx,
      bottom: D.miolo.bottom * sy,
      titleFontPt: fontPtForCapHeight(D.miolo.titleCapH * sy),
      fontPt: fontPtForCapHeight(D.miolo.capH * sy),
    },
    sku: {
      baselineX: D.sku.baselineX * sx,
      bottom: D.sku.bottom * sy,
      fontPt: fontPtForCapHeight(D.sku.capH * sy),
    },
    week: {
      baselineX: D.week.baselineX * sx,
      bottom: D.week.bottom * sy,
      fontPt: fontPtForCapHeight(D.week.capH * sy),
    },
    barcode: {
      x: D.barcode.x * sx,
      w: D.barcode.w * sx,
      top: D.barcode.top * sy,
      bottom: D.barcode.bottom * sy,
    },
    size: {
      labelX: D.size.labelX * sx,
      labelFontPt: fontPtForCapHeight(D.size.labelCapH * sy),
      valueX: D.size.valueX * sx,
      baseline: D.size.baseline * sy,
      valueFontPt: fontPtForCapHeight(D.size.valueCapH * sy),
    },
    price: {
      currencyX: D.price.currencyX * sx,
      currencyFontPt: fontPtForCapHeight(D.price.currencyCapH * sy),
      rightX: D.price.rightX * sx,
      baseline: D.price.baseline * sy,
      mainFontPt: fontPtForCapHeight(D.price.mainCapH * sy),
      centsFontPt: fontPtForCapHeight(D.price.centsCapH * sy),
      /** Centavos sobem até o topo da caixa-alta do valor cheio. */
      centsRise: (D.price.mainCapH - D.price.centsCapH) * sy,
    },
  };
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

/**
 * Fallback da logomarca Objetiva: caixa preta + wordmark branca + pino,
 * como na hangtag física. Quando o cliente envia PNG/JPG, drawLogo usa a arte.
 */
function drawLogoFallback(doc: PdfDoc, x: number, y: number, boxW: number, boxH: number): void {
  doc.setFillColor(0, 0, 0);
  doc.rect(x, y, boxW, boxH, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  const fontPt = Math.max(6.2, Math.min(8.4, boxH * 1.15));
  doc.setFontSize(fontPt);
  const textX = x + boxH * 0.18;
  const baseline = y + boxH * 0.70;
  doc.text('objetiva', textX, baseline);
  const textW = doc.getTextWidth('objetiva');
  const markR = Math.min(boxH * 0.28, 1.35);
  const cx = textX + textW + markR + 0.45;
  const cy = y + boxH * 0.50;
  if (cx + markR <= x + boxW - 0.35) {
    doc.setDrawColor(255, 255, 255);
    doc.setLineWidth(0.22);
    doc.circle(cx, cy, markR, 'S');
    doc.setLineWidth(0.15);
    doc.circle(cx, cy, markR * 0.40, 'S');
    doc.setDrawColor(0, 0, 0);
  }
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

/**
 * Texto girado 90° (lê de baixo para cima). O jsPDF gira anti-horário em torno
 * de `(x, baselineY)`: o texto avança para cima e os glifos crescem para -x, ou
 * seja, `x` é a BORDA DIREITA da coluna e `baselineY` a base do primeiro glifo.
 */
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
  // Sem maxWidth: o clip horizontal era o que cortava CALCADOS/INFANTIL.
  doc.text(text, x, baselineY, { angle: 90, align: 'left' });
}

function drawObjetivaLabel(
  doc: PdfDoc,
  row: ClientOrderLine,
  geometry: ClientLabelGeometry,
  branding: ClientLabelBranding,
  logo: ObjetivaLogo,
): void {
  const copy = composeObjetivaLabelCopy(row, branding);
  const s = artSlots(geometry);

  doc.setTextColor(0, 0, 0);
  doc.setDrawColor(0, 0, 0);

  drawLogo(doc, logo, s.logoBand.x, s.logoBand.y, s.logoBand.w, s.logoBand.h);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(s.motto.fontPt);
  copy.mottoLines.forEach((line, i) => {
    doc.text(line, s.motto.x, s.motto.firstBaseline + s.motto.step * i, {
      baseline: 'alphabetic',
    });
  });

  doc.setFontSize(s.exchange.fontPt);
  copy.exchangeLines.forEach((line, i) => {
    doc.text(line, s.exchange.x, s.exchange.firstBaseline + s.exchange.step * i, {
      baseline: 'alphabetic',
    });
  });

  doc.setLineWidth(s.divider.stroke);
  doc.line(s.divider.x, s.divider.top, s.divider.x, s.divider.bottom);

  // Descrição girada, colada à margem esquerda (antes do fio).
  objetivaRotatedRailLines(copy).forEach((line, i) => {
    drawRotatedLine(doc, line, s.rail.baselineX - s.rail.step * i, s.rail.bottom, s.rail.fontPt, 'bold');
  });

  // Miolo girado: colunas lado a lado à direita do fio, na mesma leitura.
  let mioloX = s.miolo.firstBaselineX;
  for (const column of objetivaMioloColumns(copy)) {
    const fontPt = column.emphasis ? s.miolo.titleFontPt : s.miolo.fontPt;
    drawRotatedLine(doc, column.text, mioloX, s.miolo.bottom, fontPt, 'bold');
    // Passo proporcional ao corpo: o título ocupa coluna mais larga.
    mioloX += column.emphasis ? s.miolo.step * 1.25 : s.miolo.step;
  }

  // Código de barras girado: barras correm no eixo Y, espessura fixa em X.
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
    drawRotatedLine(doc, copy.codigoBarra, s.sku.baselineX, s.sku.bottom, s.sku.fontPt, 'bold');
  }
  if (copy.semanaAno) {
    drawRotatedLine(doc, copy.semanaAno, s.week.baselineX, s.week.bottom, s.week.fontPt, 'normal');
  }

  // TAM.: rótulo pequeno + número grande, ambos na horizontal.
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(s.size.labelFontPt);
  doc.text('TAM.:', s.size.labelX, s.size.baseline, { baseline: 'alphabetic' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(s.size.valueFontPt);
  doc.text(copy.tamanho, s.size.valueX, s.size.baseline, { baseline: 'alphabetic' });

  // Preço: R$ na margem esquerda, valor alinhado à direita, centavos elevados.
  const centsLabel = `,${copy.priceCents}`;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(s.price.currencyFontPt);
  doc.text('R$', s.price.currencyX, s.price.baseline, { baseline: 'alphabetic' });

  doc.setFontSize(s.price.centsFontPt);
  const centsWidth = doc.getTextWidth(centsLabel);
  doc.setFontSize(s.price.mainFontPt);
  const mainWidth = doc.getTextWidth(copy.priceMain);
  const mainLeft = s.price.rightX - centsWidth - mainWidth;
  doc.text(copy.priceMain, mainLeft, s.price.baseline, { baseline: 'alphabetic' });
  doc.setFontSize(s.price.centsFontPt);
  doc.text(centsLabel, mainLeft + mainWidth, s.price.baseline - s.price.centsRise, {
    baseline: 'alphabetic',
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

function zplField(text: string, maxLen: number): string {
  return text.replace(/[\^~]/g, ' ').slice(0, maxLen).trim();
}

/**
 * ZPL 203 dpi na mesma mídia da Ponto Mix (L42PRO, rolo 40×60 mm).
 *
 * O bloco central usa orientação `B` (bottom-up) — a mesma leitura de baixo
 * para cima da etiqueta física. A marca é imagem: no ZPL textual sai o
 * wordmark aproximado dentro da faixa preta.
 *
 * ⚠ Não validado em impressora física ainda — conferir com uma etiqueta de
 * teste antes de rodar o lote.
 */
export function buildObjetivaZpl(
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
  const D = OBJETIVA_ART_DOTS;

  const W = mmToDots(geometry.labelWidthMm);
  const H = mmToDots(geometry.labelHeightMm);
  const kx = W / D.gridW;
  const ky = H / D.gridH;
  const dx = (v: number) => Math.round(v * kx);
  const dy = (v: number) => Math.round(v * ky);
  // ^A0 é medido pela ALTURA do caractere; caixa-alta ≈ 0,717 do corpo.
  const fontFor = (capDots: number, min = 8) => Math.max(min, Math.round(capDots / CAP_RATIO));

  const blocks = expanded.map(row => {
    const copy = composeObjetivaLabelCopy(row, branding);
    const barcode = copy.codigoBarra.replace(/[^A-Za-z0-9 ._/-]/g, '').slice(0, 48);

    const band = {
      x: dx(D.logoBand.x),
      y: dy(D.logoBand.y),
      w: dx(D.logoBand.w),
      h: dy(D.logoBand.h),
    };
    const railFont = fontFor(dy(D.rail.capH));
    const mioloFont = fontFor(dy(D.miolo.capH));
    const mioloTitleFont = fontFor(dy(D.miolo.titleCapH));

    // Coluna girada: ^FO no canto superior-esquerdo da caixa do campo.
    const rotated = (
      text: string,
      rightX: number,
      bottomY: number,
      capDots: number,
      font: number,
    ) =>
      text
        ? `^FO${Math.max(0, dx(rightX) - Math.round(capDots / CAP_RATIO))},${Math.max(0, dy(bottomY) - Math.round(font * text.length * 0.62))}^A0B,${font},${font}^FD${zplField(text, 48)}^FS`
        : '';

    const railCmds = objetivaRotatedRailLines(copy).map((line, i) =>
      rotated(line, D.rail.baselineX - D.rail.step * i, D.rail.bottom, dy(D.rail.capH), railFont),
    );

    let mioloX = D.miolo.firstBaselineX;
    const mioloCmds = objetivaMioloColumns(copy).map(column => {
      const font = column.emphasis ? mioloTitleFont : mioloFont;
      const capDots = column.emphasis ? dy(D.miolo.titleCapH) : dy(D.miolo.capH);
      const cmd = rotated(column.text, mioloX, D.miolo.bottom, capDots, font);
      mioloX += column.emphasis ? D.miolo.step * 1.25 : D.miolo.step;
      return cmd;
    });

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
      barcodeCmds = [
        `^BY${module},2.0,${dx(D.barcode.w)}`,
        `^FO${dx(D.barcode.x)},${dy(D.barcode.top)}`,
        `^BCB,${dx(D.barcode.w)},N,N,N`,
        `^FD${barcode}^FS`,
        rotated(barcode, D.sku.baselineX, D.sku.bottom, dy(D.sku.capH), fontFor(dy(D.sku.capH))),
      ];
    }

    const sizeFont = fontFor(dy(D.size.valueCapH), 14);
    const sizeLabelFont = fontFor(dy(D.size.labelCapH));
    const mottoFont = fontFor(dy(D.motto.capH));
    const exchangeFont = fontFor(dy(D.exchange.capH));
    const currencyFont = fontFor(dy(D.price.currencyCapH));
    const mainFont = fontFor(dy(D.price.mainCapH), 16);
    const centsFont = fontFor(dy(D.price.centsCapH));
    const mainText = zplField(copy.priceMain, 12);
    const centsText = zplField(`,${copy.priceCents}`, 6);
    // ^FB à direita: largura da caixa até a margem direita da arte.
    const priceBoxX = dx(D.price.rightX) - Math.round(mainFont * 0.62 * (mainText.length + 3));

    return [
      '^XA',
      `^PW${W}`,
      `^LL${H}`,
      '^LH0,0',
      '^CI28',
      `^FO${band.x},${band.y}^GB${band.w},${band.h},${band.h},B^FS`,
      `^FO${band.x + Math.round(band.w * 0.06)},${band.y + Math.round(band.h * 0.22)}^A0N,${Math.round(band.h * 0.56)},${Math.round(band.h * 0.56)}^FR^FD${zplField('objetiva', 16)}^FS`,
      ...copy.mottoLines.map(
        (line, i) =>
          `^FO${dx(D.motto.x)},${dy(D.motto.firstTop + D.motto.step * i)}^A0N,${mottoFont},${mottoFont}^FD${zplField(line, 16)}^FS`,
      ),
      ...copy.exchangeLines.map(
        (line, i) =>
          `^FO${dx(D.exchange.x)},${dy(D.exchange.firstTop + D.exchange.step * i)}^A0N,${exchangeFont},${exchangeFont}^FD${zplField(line, 24)}^FS`,
      ),
      `^FO${dx(D.divider.x)},${dy(D.divider.top)}^GB${Math.max(1, dx(D.divider.stroke))},${dy(D.divider.bottom) - dy(D.divider.top)},${Math.max(1, dx(D.divider.stroke))},B^FS`,
      ...railCmds,
      ...mioloCmds,
      ...barcodeCmds,
      copy.semanaAno
        ? rotated(copy.semanaAno, D.week.baselineX, D.week.bottom, dy(D.week.capH), fontFor(dy(D.week.capH)))
        : '',
      `^FO${dx(D.size.labelX)},${dy(D.size.baseline) - sizeLabelFont}^A0N,${sizeLabelFont},${sizeLabelFont}^FD${zplField('TAM.:', 8)}^FS`,
      `^FO${dx(D.size.valueX)},${dy(D.size.baseline) - sizeFont}^A0N,${sizeFont},${sizeFont}^FD${zplField(copy.tamanho, 6)}^FS`,
      `^FO${dx(D.price.currencyX)},${dy(D.price.baseline) - currencyFont}^A0N,${currencyFont},${currencyFont}^FD${zplField('R$', 4)}^FS`,
      `^FO${priceBoxX},${dy(D.price.baseline) - mainFont}^A0N,${mainFont},${mainFont}^FB${dx(D.price.rightX) - priceBoxX},1,0,R^FD${mainText}${centsText}^FS`,
      '^XZ',
    ]
      .filter(Boolean)
      .join('\n');
  });

  return blocks.join('\n\n');
}

export function objetivaZplFilename(origem: string): string {
  const base = origem.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return `Etiquetas_Objetiva_${base || 'pedido'}_L42PRO.zpl`;
}

export function countObjetivaLabels(rows: ClientOrderLine[], repeatByQuantity: boolean): number {
  if (!repeatByQuantity) return rows.length;
  return rows.reduce((sum, row) => sum + Math.max(1, Math.trunc(row.quantidade) || 1), 0);
}

/**
 * Esqueleto Ponto Mix — etiqueta preço varejo 40×60 mm (L42PRO FULL).
 *
 * Layout (retrato): faixa preta logo → 3 linhas texto → caixa tamanho →
 * CODE128 → faixa preta preço. Dados só do arquivo do cliente.
 */
import { code128Bars } from './code128';
import { decodeOrderBytes } from './babyNalinLabels';
import {
  PONTO_MIX_DEFAULT_GEOMETRY,
  PONTO_MIX_DEFAULT_PRICE_FORMAT,
  PONTO_MIX_DEFAULT_TEMPLATES,
  type ClientLabelFileMapping,
  type ClientLabelGeometry,
  type ClientLabelLineTemplates,
  type ClientLabelPriceFormat,
  type ClientOrderLine,
} from './clientLabelPattern';

export const PONTO_MIX_DPI = 203;
export const MAX_PONTO_MIX_PDF_LABELS = 20_000;

type PdfDoc = import('jspdf').jsPDF;

export type PontoMixLogo = { dataUrl: string; width: number; height: number } | null;

export interface PontoMixPdfOptions {
  geometry?: Partial<ClientLabelGeometry>;
  templates?: Partial<ClientLabelLineTemplates>;
  priceFormat?: Partial<ClientLabelPriceFormat>;
  repeatByQuantity?: boolean;
  logo?: PontoMixLogo;
}

const FIELD_ALIASES: Record<keyof ClientLabelFileMapping['columns'], string[]> = {
  descricao: [
    'descricao',
    'descricao produto',
    'descricao completa',
    'produto',
    'nome',
    'sandalia',
    'desc',
  ],
  referencia: ['referencia', 'ref', 'modelo', 'sku', 'referencia produto'],
  cor: ['cor', 'color', 'cores'],
  tamanho: ['tamanho', 'tam', 'size', 'numeracao', 'num', 'nro', 'numero', 'nr'],
  codigoBarra: [
    'codigo barra',
    'codigo de barras',
    'codigo barras',
    'codigobarras',
    'cod barras',
    'codbarra',
    'cod barra',
    'ean',
    'barcode',
    'barras',
    'gtin',
    'codigo',
  ],
  preco: [
    'preco',
    'preco venda',
    'preco varejo',
    'valor',
    'valor unitario',
    'vlr',
    'vlr unit',
    'unitario',
    'price',
    'rs',
  ],
  quantidade: ['quantidade', 'qtd', 'qty', 'qtde', 'qtde etiquetas', 'pares'],
  codProduto: ['cod produto', 'codigo produto', 'produto id', 'id', 'cod'],
};

/** Ordem posicional usada quando Padrao.txt/BarTender vem sem cabeçalho reconhecível. */
export const PONTO_MIX_POSITIONAL_COLUMNS: (keyof ClientLabelFileMapping['columns'])[] = [
  'descricao',
  'referencia',
  'cor',
  'tamanho',
  'codigoBarra',
  'preco',
  'quantidade',
];

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

/** Escolhe o delimitador mais frequente entre tab, pipe, ponto-e-vírgula e vírgula. */
export function detectPontoMixDelimiter(line: string): string {
  const counts: Array<{ delim: string; n: number }> = [
    { delim: '\t', n: (line.match(/\t/g) ?? []).length },
    { delim: '|', n: (line.match(/\|/g) ?? []).length },
    { delim: ';', n: (line.match(/;/g) ?? []).length },
    { delim: ',', n: (line.match(/,/g) ?? []).length },
  ];
  counts.sort((a, b) => b.n - a.n);
  return counts[0]!.n > 0 ? counts[0]!.delim : ';';
}

function isBartenderCommandLine(line: string): boolean {
  const t = line.trim().toUpperCase();
  return t.startsWith('%BTW%') || t.startsWith('%END%') || t.startsWith('%PAC%');
}

function looksLikeShoeSize(raw: string): boolean {
  const n = Number(String(raw).replace(',', '.').trim());
  return Number.isFinite(n) && n >= 15 && n <= 48 && Number.isInteger(n);
}

function looksLikePrice(raw: string): boolean {
  const t = String(raw).trim();
  if (!t) return false;
  if (/r\$/i.test(t)) return true;
  // Inteiro puro não é preço (bate com qtd/tamanho); exige decimal.
  if (/^\d+$/.test(t)) return false;
  const cleaned = t
    .replace(/r\$\s*/i, '')
    .replace(/\s/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 && n < 10_000;
}

function looksLikeBarcode(raw: string): boolean {
  const t = String(raw).trim();
  return /^\d{4,14}$/.test(t);
}

/**
 * Infere índices de coluna a partir das linhas de dados quando o cabeçalho
 * não casa com os aliases (caso típico do Padrao.txt do BarTender).
 */
export function inferPontoMixColumnIndexes(
  dataRows: string[][],
): Partial<Record<keyof ClientLabelFileMapping['columns'], number>> {
  if (dataRows.length === 0) return {};
  const width = Math.max(...dataRows.map(r => r.length));
  const result: Partial<Record<keyof ClientLabelFileMapping['columns'], number>> = {};
  const taken = new Set<number>();

  const score = (col: number, pred: (v: string) => boolean) =>
    dataRows.reduce((acc, row) => acc + (pred(row[col] ?? '') ? 1 : 0), 0);

  const pickBest = (
    field: keyof ClientLabelFileMapping['columns'],
    pred: (v: string) => boolean,
    minHits: number,
  ) => {
    let best = -1;
    let bestScore = 0;
    for (let c = 0; c < width; c++) {
      if (taken.has(c)) continue;
      const s = score(c, pred);
      if (s > bestScore) {
        bestScore = s;
        best = c;
      }
    }
    if (best >= 0 && bestScore >= minHits) {
      result[field] = best;
      taken.add(best);
    }
  };

  const minHits = Math.max(1, Math.ceil(dataRows.length * 0.5));
  pickBest('tamanho', looksLikeShoeSize, minHits);
  pickBest('codigoBarra', looksLikeBarcode, minHits);
  pickBest('preco', looksLikePrice, minHits);
  pickBest('quantidade', v => {
    const n = Number(String(v).replace(',', '.'));
    return Number.isFinite(n) && n > 0 && n <= 50_000 && !looksLikePrice(v);
  }, minHits);

  // Texto longo → descrição; próximo texto → referência/cor.
  const textScores = Array.from({ length: width }, (_, c) => {
    if (taken.has(c)) return { c, avg: 0 };
    const avg =
      dataRows.reduce((acc, row) => acc + String(row[c] ?? '').trim().length, 0) /
      dataRows.length;
    return { c, avg };
  })
    .filter(x => x.avg >= 2)
    .sort((a, b) => b.avg - a.avg);

  if (textScores[0] && result.descricao == null) {
    result.descricao = textScores[0].c;
    taken.add(textScores[0].c);
  }
  if (textScores[1] && result.referencia == null) {
    result.referencia = textScores[1].c;
    taken.add(textScores[1].c);
  }
  if (textScores[2] && result.cor == null) {
    result.cor = textScores[2].c;
    taken.add(textScores[2].c);
  }

  return result;
}

function indexOfMappedOrAlias(
  headers: string[],
  field: keyof ClientLabelFileMapping['columns'],
  mapping?: ClientLabelFileMapping,
): number {
  const configured = mapping?.columns?.[field]?.trim();
  if (configured) {
    const want = normalizeHeader(configured);
    const hit = headers.findIndex(h => h === want);
    if (hit >= 0) return hit;
  }
  for (const alias of FIELD_ALIASES[field] ?? []) {
    const i = headers.indexOf(alias);
    if (i >= 0) return i;
  }
  return -1;
}

export function isPontoMixOrderHeader(
  headerCells: string[],
  mapping?: ClientLabelFileMapping,
): boolean {
  const normalized = headerCells.map(normalizeHeader);
  const hasCode =
    indexOfMappedOrAlias(normalized, 'codigoBarra', mapping) >= 0 ||
    indexOfMappedOrAlias(normalized, 'codProduto', mapping) >= 0;
  const hasSize = indexOfMappedOrAlias(normalized, 'tamanho', mapping) >= 0;
  const hasPrice = indexOfMappedOrAlias(normalized, 'preco', mapping) >= 0;
  // Preço distingue do Nalin (Codigo Barra + Tamanho sem preço de etiqueta).
  return hasCode && hasSize && hasPrice;
}

function parseQuantity(raw: string): number {
  const cleaned = raw.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 1;
}

function buildRows(
  header: string[],
  linhas: string[][],
  mapping: ClientLabelFileMapping | undefined,
  sourceFile?: string,
  inferred?: Partial<Record<keyof ClientLabelFileMapping['columns'], number>>,
): ClientOrderLine[] {
  const normalized = header.map(normalizeHeader);
  const pick = (linha: string[], field: keyof ClientLabelFileMapping['columns']) => {
    const mapped = indexOfMappedOrAlias(normalized, field, mapping);
    if (mapped >= 0) return (linha[mapped] ?? '').trim();
    const inferredIdx = inferred?.[field];
    if (inferredIdx != null && inferredIdx >= 0) return (linha[inferredIdx] ?? '').trim();
    return '';
  };

  const rows: ClientOrderLine[] = [];
  for (const linha of linhas) {
    const codigoBarra = pick(linha, 'codigoBarra') || pick(linha, 'codProduto');
    const tamanho = pick(linha, 'tamanho').toUpperCase();
    if (!codigoBarra && !tamanho) continue;
    const referencia = (pick(linha, 'referencia') || pick(linha, 'codProduto') || codigoBarra).toUpperCase();
    rows.push({
      tamanho,
      cor: pick(linha, 'cor').toUpperCase(),
      referencia,
      codProduto: pick(linha, 'codProduto') || codigoBarra,
      codigoBarra: codigoBarra || referencia,
      quantidade: parseQuantity(pick(linha, 'quantidade')),
      descricao: pick(linha, 'descricao').toUpperCase(),
      valor: pick(linha, 'preco'),
      sourceFile,
    });
  }
  if (rows.length === 0) {
    throw new Error('Nenhuma linha válida no arquivo Ponto Mix (código/tamanho).');
  }
  return rows;
}

function buildRowsPositional(
  linhas: string[][],
  sourceFile?: string,
): ClientOrderLine[] {
  const inferred = inferPontoMixColumnIndexes(linhas);
  const hasUseful =
    inferred.codigoBarra != null || inferred.tamanho != null || inferred.preco != null;
  if (!hasUseful) {
    // Fallback: ordem canônica do esqueleto (arte Ponto Mix).
    const rows: ClientOrderLine[] = [];
    for (const linha of linhas) {
      const get = (field: keyof ClientLabelFileMapping['columns']) => {
        const i = PONTO_MIX_POSITIONAL_COLUMNS.indexOf(field);
        return i >= 0 ? (linha[i] ?? '').trim() : '';
      };
      const codigoBarra = get('codigoBarra') || get('codProduto');
      const tamanho = get('tamanho').toUpperCase();
      if (!codigoBarra && !tamanho) continue;
      rows.push({
        tamanho,
        cor: get('cor').toUpperCase(),
        referencia: (get('referencia') || codigoBarra).toUpperCase(),
        codProduto: get('codProduto') || codigoBarra,
        codigoBarra: codigoBarra || get('referencia'),
        quantidade: parseQuantity(get('quantidade')),
        descricao: get('descricao').toUpperCase(),
        valor: get('preco'),
        sourceFile,
      });
    }
    if (rows.length === 0) {
      throw new Error(
        'Não reconheci as colunas do Padrao.txt. Confira se há código, tamanho e preço (separados por ; , tab ou |).',
      );
    }
    return rows;
  }
  return buildRows([], linhas, undefined, sourceFile, inferred);
}

export function parsePontoMixOrderCsv(
  texto: string,
  mapping?: ClientLabelFileMapping,
  sourceFile?: string,
): ClientOrderLine[] {
  const linhasBrutas = texto
    .split(/\r?\n/)
    .map(l => l.replace(/^\uFEFF/, ''))
    .filter(l => l.trim().length > 0 && !isBartenderCommandLine(l));
  if (linhasBrutas.length === 0) {
    throw new Error('Arquivo Ponto Mix vazio ou sem linhas de dados.');
  }

  const delimitador = detectPontoMixDelimiter(linhasBrutas[0]!);
  const matriz = linhasBrutas.map(l => splitDelimited(l, delimitador));

  // Procura a primeira linha que pareça cabeçalho Ponto Mix (pula título "Padrao" etc.).
  let headerIdx = matriz.findIndex(cells => isPontoMixOrderHeader(cells, mapping));
  if (headerIdx >= 0) {
    return buildRows(matriz[headerIdx]!, matriz.slice(headerIdx + 1), mapping, sourceFile);
  }

  // Cabeçalho parcial (código+tamanho sem preço, ou só com mapping): ainda tenta.
  headerIdx = matriz.findIndex(cells => {
    const normalized = cells.map(normalizeHeader);
    const hasCode =
      indexOfMappedOrAlias(normalized, 'codigoBarra', mapping) >= 0 ||
      indexOfMappedOrAlias(normalized, 'codProduto', mapping) >= 0;
    const hasSize = indexOfMappedOrAlias(normalized, 'tamanho', mapping) >= 0;
    return hasCode && hasSize;
  });
  if (headerIdx >= 0) {
    const data = matriz.slice(headerIdx + 1);
    const inferred = inferPontoMixColumnIndexes(data);
    return buildRows(matriz[headerIdx]!, data, mapping, sourceFile, inferred);
  }

  // Padrao.txt / BarTender sem cabeçalho reconhecível → inferência pelas células.
  if (matriz.length >= 1 && matriz.some(r => r.length >= 2)) {
    const first = matriz[0]!;
    const firstLooksLikeData =
      first.some(looksLikeBarcode) || first.some(looksLikeShoeSize) || first.some(looksLikePrice);
    const dataOnly = firstLooksLikeData ? matriz : matriz.slice(1);
    if (dataOnly.length === 0) {
      throw new Error(
        'Arquivo Ponto Mix só tem cabeçalho — falta linha de dados (código/tamanho/preço).',
      );
    }
    return buildRowsPositional(dataOnly, sourceFile);
  }

  throw new Error(
    'Cabeçalho não parece pedido Ponto Mix (precisa de código, tamanho e preço — ou um Padrao.txt com esses dados).',
  );
}

/** Modelo BarTender (.btw) — é o layout da etiqueta, não o arquivo de pedido. */
export function isBartenderTemplateFile(file: File): boolean {
  return file.name.toLowerCase().endsWith('.btw');
}

export const BARTENDER_TEMPLATE_UPLOAD_MESSAGE =
  'Etiqueta_com_logo.btw é o modelo BarTender da arte (já recriado no esqueleto Ponto Mix). Para gerar etiquetas, envie o Padrao.txt ou a planilha/CSV do pedido.';

export async function parsePontoMixOrderFile(
  file: File,
  mapping?: ClientLabelFileMapping,
): Promise<ClientOrderLine[]> {
  if (isBartenderTemplateFile(file)) {
    throw new Error(BARTENDER_TEMPLATE_UPLOAD_MESSAGE);
  }
  const nome = file.name.toLowerCase();
  if (nome.endsWith('.xlsx') || nome.endsWith('.xls')) {
    const buffer = await file.arrayBuffer();
    const XLSX = await import('xlsx');
    const wb = XLSX.read(buffer, { type: 'array' });
    const aba = wb.Sheets[wb.SheetNames[0]!];
    if (!aba) throw new Error('Planilha Ponto Mix sem abas.');
    const matriz = XLSX.utils.sheet_to_json<string[]>(aba, {
      header: 1,
      raw: false,
      defval: '',
    });
    const headerRow = matriz.find(l => l.some(c => String(c ?? '').trim()));
    if (!headerRow) throw new Error('Planilha Ponto Mix sem cabeçalho.');
    const header = headerRow.map(String);
    const data = matriz
      .slice(matriz.indexOf(headerRow) + 1)
      .filter(l => l.some(c => String(c ?? '').trim()))
      .map(l => l.map(c => String(c ?? '')));
    if (isPontoMixOrderHeader(header, mapping)) {
      return buildRows(header, data, mapping, file.name);
    }
    const normalized = header.map(normalizeHeader);
    const hasCode =
      indexOfMappedOrAlias(normalized, 'codigoBarra', mapping) >= 0 ||
      indexOfMappedOrAlias(normalized, 'codProduto', mapping) >= 0;
    const hasSize = indexOfMappedOrAlias(normalized, 'tamanho', mapping) >= 0;
    if (hasCode && hasSize) {
      return buildRows(header, data, mapping, file.name, inferPontoMixColumnIndexes(data));
    }
    if (data.length > 0) {
      return buildRowsPositional(
        [header, ...data].filter(r => r.some(c => String(c).trim())),
        file.name,
      );
    }
    throw new Error(
      'Cabeçalho não parece pedido Ponto Mix (precisa de código, tamanho e preço).',
    );
  }
  const texto = decodeOrderBytes(await file.arrayBuffer());
  return parsePontoMixOrderCsv(texto, mapping, file.name);
}

/** Placeholders `{campo}` → valor da linha (vazio se ausente). */
export function renderPontoMixTemplate(template: string, row: ClientOrderLine): string {
  const values: Record<string, string> = {
    descricao: (row.descricao ?? '').trim(),
    referencia: (row.referencia ?? '').trim(),
    cor: (row.cor ?? '').trim(),
    tamanho: (row.tamanho ?? '').trim(),
    codigoBarra: (row.codigoBarra ?? '').trim(),
    codProduto: (row.codProduto ?? '').trim(),
    preco: (row.valor ?? '').trim(),
    quantidade: String(row.quantidade ?? ''),
    tipo: (row.tipo ?? '').trim(),
    categoria: (row.categoria ?? '').trim(),
    grupo: (row.grupo ?? '').trim(),
  };
  return template
    .replace(/\{([a-zA-Z_]+)\}/g, (_, key: string) => values[key] ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

export function isValidEan13(code: string): boolean {
  if (!/^\d{13}$/.test(code)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += Number(code[i]) * (i % 2 === 0 ? 1 : 3);
  }
  const check = (10 - (sum % 10)) % 10;
  return check === Number(code[12]);
}

/** Code 128 para o exemplo `105742`; EAN-13 só quando o valor já é EAN-13 válido. */
export function resolvePontoMixBarcodeSymbology(code: string): 'ean13' | 'code128' {
  return isValidEan13(code.trim()) ? 'ean13' : 'code128';
}

export function formatPontoMixPrice(
  raw: string | undefined,
  format: ClientLabelPriceFormat = PONTO_MIX_DEFAULT_PRICE_FORMAT,
): string {
  const cleaned = (raw ?? '').replace(/[^\d.,-]/g, '').trim();
  if (!cleaned) return `${format.prefix}0${format.decimalSeparator}00`;
  let n: number;
  if (cleaned.includes(',') && cleaned.includes('.')) {
    n = Number(cleaned.replace(/\./g, '').replace(',', '.'));
  } else if (cleaned.includes(',')) {
    n = Number(cleaned.replace(',', '.'));
  } else {
    n = Number(cleaned);
  }
  if (!Number.isFinite(n)) return `${format.prefix}${cleaned}`;
  const fixed = Math.abs(n).toFixed(2);
  const [intPart, dec] = fixed.split('.') as [string, string];
  return `${format.prefix}${intPart}${format.decimalSeparator}${dec}`;
}

export interface PontoMixLabelCopy {
  line1: string;
  line2: string;
  line3: string;
  tamanho: string;
  codigoBarra: string;
  priceText: string;
  barcodeSymbology: 'ean13' | 'code128';
}

export function composePontoMixLabelCopy(
  row: ClientOrderLine,
  templates: ClientLabelLineTemplates = PONTO_MIX_DEFAULT_TEMPLATES,
  priceFormat: ClientLabelPriceFormat = PONTO_MIX_DEFAULT_PRICE_FORMAT,
): PontoMixLabelCopy {
  const codigoBarra = (row.codigoBarra || row.codProduto).trim();
  return {
    line1: renderPontoMixTemplate(templates.line1, row),
    line2: renderPontoMixTemplate(templates.line2, row),
    line3: renderPontoMixTemplate(templates.line3, row),
    tamanho: (row.tamanho || '-').trim() || '-',
    codigoBarra,
    priceText: formatPontoMixPrice(row.valor, priceFormat),
    barcodeSymbology: resolvePontoMixBarcodeSymbology(codigoBarra),
  };
}

function mergeGeometry(partial?: Partial<ClientLabelGeometry>): ClientLabelGeometry {
  return { ...PONTO_MIX_DEFAULT_GEOMETRY, ...partial };
}

function mergeTemplates(partial?: Partial<ClientLabelLineTemplates>): ClientLabelLineTemplates {
  return { ...PONTO_MIX_DEFAULT_TEMPLATES, ...partial };
}

function mergePriceFormat(partial?: Partial<ClientLabelPriceFormat>): ClientLabelPriceFormat {
  return {
    ...PONTO_MIX_DEFAULT_PRICE_FORMAT,
    ...partial,
    decimalSeparator: partial?.decimalSeparator === ',' ? ',' : '.',
  };
}

function expandLines(rows: ClientOrderLine[], repeatByQuantity: boolean): ClientOrderLine[] {
  if (!repeatByQuantity) return rows;
  const total = rows.reduce((sum, row) => sum + Math.max(1, Math.trunc(row.quantidade) || 1), 0);
  if (total > MAX_PONTO_MIX_PDF_LABELS) {
    throw new Error(
      `A geração teria ${total.toLocaleString('pt-BR')} etiquetas. O limite seguro é ${MAX_PONTO_MIX_PDF_LABELS.toLocaleString('pt-BR')} por PDF.`,
    );
  }
  return rows.flatMap(row =>
    Array.from({ length: Math.max(1, Math.trunc(row.quantidade) || 1) }, () => row),
  );
}

function imageFormat(dataUrl: string): 'PNG' | 'JPEG' {
  return dataUrl.startsWith('data:image/jpeg') || dataUrl.startsWith('data:image/jpg')
    ? 'JPEG'
    : 'PNG';
}

function mmToDots(mm: number, dpi = PONTO_MIX_DPI): number {
  return Math.max(1, Math.round((mm / 25.4) * dpi));
}

function zplField(text: string, maxLen: number): string {
  return text
    .replace(/[\^~]/g, ' ')
    .slice(0, maxLen)
    .trim();
}

function drawLogoOnBlackBand(
  doc: PdfDoc,
  logo: PontoMixLogo,
  x: number,
  y: number,
  bandW: number,
  bandH: number,
): void {
  doc.setFillColor(0, 0, 0);
  doc.rect(x, y, bandW, bandH, 'F');
  const padX = 1.5;
  const padY = 0.8;
  const boxW = bandW - padX * 2;
  const boxH = bandH - padY * 2;
  if (logo && logo.width > 0 && logo.height > 0) {
    const scale = Math.min(boxW / logo.width, boxH / logo.height);
    const drawW = logo.width * scale;
    const drawH = logo.height * scale;
    const ox = x + (bandW - drawW) / 2;
    const oy = y + (bandH - drawH) / 2;
    try {
      doc.addImage(logo.dataUrl, imageFormat(logo.dataUrl), ox, oy, drawW, drawH);
      return;
    } catch {
      /* fallback texto */
    }
  }
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(Math.max(7, Math.min(11, bandH * 1.6)));
  doc.text('PONTO MIX', x + bandW / 2, y + bandH * 0.68, { align: 'center' });
  doc.setTextColor(0, 0, 0);
}

function drawPontoMixLabel(
  doc: PdfDoc,
  row: ClientOrderLine,
  geometry: ClientLabelGeometry,
  templates: ClientLabelLineTemplates,
  priceFormat: ClientLabelPriceFormat,
  logo: PontoMixLogo,
): void {
  const copy = composePontoMixLabelCopy(row, templates, priceFormat);
  const w = geometry.labelWidthMm;
  const h = geometry.labelHeightMm;
  const padL = geometry.leftMarginMm;
  const padR = geometry.rightMarginMm;

  const headerH = Math.min(9.5, h * 0.16);
  const footerH = Math.min(10.5, h * 0.175);
  const contentLeft = padL;
  const contentRight = w - padR;
  const contentW = contentRight - contentLeft;

  drawLogoOnBlackBand(doc, logo, 0, 0, w, headerH);

  let y = headerH + 2.2;
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'bold');
  const lineSize = 5.2;
  doc.setFontSize(lineSize);
  for (const line of [copy.line1, copy.line2, copy.line3]) {
    if (!line) continue;
    doc.text(line, contentLeft, y, {
      baseline: 'top',
      maxWidth: contentW,
    });
    y += lineSize * 0.42 + 1.15;
  }

  y += 1.2;
  const sizeBoxW = Math.min(18, contentW * 0.55);
  const sizeBoxH = 8.5;
  const sizeBoxX = (w - sizeBoxW) / 2;
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.35);
  doc.rect(sizeBoxX, y, sizeBoxW, sizeBoxH, 'S');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(copy.tamanho, w / 2, y + sizeBoxH * 0.72, { align: 'center' });

  y += sizeBoxH + 2.2;
  const barcodeH = Math.min(12, footerH > 0 ? h - footerH - y - 5 : 12);
  if (copy.codigoBarra) {
    try {
      const bars = code128Bars(copy.codigoBarra);
      const moduleCount = bars.reduce((max, b) => Math.max(max, b.start + b.width), 0);
      const maxBarW = contentW * 0.92;
      const module = Math.max(0.22, maxBarW / Math.max(moduleCount, 1));
      const totalW = moduleCount * module;
      const barX = (w - totalW) / 2;
      doc.setFillColor(0, 0, 0);
      for (const barra of bars) {
        doc.rect(barX + barra.start * module, y, barra.width * module, barcodeH, 'F');
      }
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.text(copy.codigoBarra, w / 2, y + barcodeH + 2.4, { align: 'center' });
    } catch {
      doc.setFontSize(6);
      doc.text('(código inválido)', w / 2, y + 4, { align: 'center' });
    }
  }

  const footerY = h - footerH;
  doc.setFillColor(0, 0, 0);
  doc.rect(0, footerY, w, footerH, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(Math.max(10, Math.min(14, footerH * 1.15)));
  doc.text(copy.priceText, w / 2, footerY + footerH * 0.68, { align: 'center' });
  doc.setTextColor(0, 0, 0);
}

export async function buildPontoMixPdf(
  rows: ClientOrderLine[],
  options: PontoMixPdfOptions = {},
): Promise<Blob> {
  const geometry = mergeGeometry(options.geometry);
  const templates = mergeTemplates(options.templates);
  const priceFormat = mergePriceFormat(options.priceFormat);
  const expanded = expandLines(rows, options.repeatByQuantity !== false);
  if (expanded.length === 0) throw new Error('Nenhuma etiqueta para gerar.');

  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: [geometry.labelWidthMm, geometry.labelHeightMm],
  });

  expanded.forEach((row, index) => {
    if (index > 0) doc.addPage([geometry.labelWidthMm, geometry.labelHeightMm], 'portrait');
    drawPontoMixLabel(doc, row, geometry, templates, priceFormat, options.logo ?? null);
  });

  return doc.output('blob');
}

export function pontoMixPdfFilename(mode: 'producao' | 'grafico' = 'producao'): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return mode === 'grafico'
    ? `ponto-mix-grafico-${stamp}.pdf`
    : `ponto-mix-producao-${stamp}.pdf`;
}

export function countPontoMixLabels(rows: ClientOrderLine[], repeatByQuantity: boolean): number {
  if (!repeatByQuantity) return rows.length;
  return rows.reduce((sum, row) => sum + Math.max(1, Math.trunc(row.quantidade) || 1), 0);
}

/**
 * ZPL 203 dpi — faixas pretas via ^GB, texto, caixa tamanho, ^BC (ou ^BE se EAN-13).
 * Logo: omitida no ZPL textual (cabe no PDF/preview); faixa usa wordmark.
 */
export function buildPontoMixZpl(
  rows: ClientOrderLine[],
  options: {
    geometry?: Partial<ClientLabelGeometry>;
    templates?: Partial<ClientLabelLineTemplates>;
    priceFormat?: Partial<ClientLabelPriceFormat>;
    repeatByQuantity?: boolean;
  } = {},
): string {
  const geometry = mergeGeometry(options.geometry);
  const templates = mergeTemplates(options.templates);
  const priceFormat = mergePriceFormat(options.priceFormat);
  const expanded = expandLines(rows, options.repeatByQuantity !== false);

  const W = mmToDots(geometry.labelWidthMm);
  const H = mmToDots(geometry.labelHeightMm);
  const padL = mmToDots(geometry.leftMarginMm);
  const headerH = mmToDots(Math.min(9.5, geometry.labelHeightMm * 0.16));
  const footerH = mmToDots(Math.min(10.5, geometry.labelHeightMm * 0.175));

  const blocks = expanded.map(row => {
    const copy = composePontoMixLabelCopy(row, templates, priceFormat);
    const line1 = zplField(copy.line1, 40);
    const line2 = zplField(copy.line2, 40);
    const line3 = zplField(copy.line3, 40);
    const sizeVal = zplField(copy.tamanho, 6);
    const barcode = copy.codigoBarra.replace(/[^A-Za-z0-9 ._/-]/g, '').slice(0, 50);
    const price = zplField(copy.priceText, 24);

    const textStartY = headerH + mmToDots(2.2);
    const lineStep = mmToDots(3.4);
    const sizeBoxW = mmToDots(18);
    const sizeBoxH = mmToDots(8.5);
    const sizeBoxX = Math.round((W - sizeBoxW) / 2);
    const sizeBoxY = textStartY + lineStep * 3 + mmToDots(1);
    const barcodeY = sizeBoxY + sizeBoxH + mmToDots(2);
    const barcodeH = Math.max(mmToDots(10), H - footerH - barcodeY - mmToDots(6));
    const footerY = H - footerH;

    const barcodeCmd =
      barcode && copy.barcodeSymbology === 'ean13'
        ? [`^FO${padL},${barcodeY}`, `^BEN,${barcodeH},Y,N`, `^FD${barcode}^FS`].join('\n')
        : barcode
          ? [`^FO${padL},${barcodeY}`, `^BCN,${barcodeH},Y,N,N`, `^FD${barcode}^FS`].join('\n')
          : '';

    return [
      '^XA',
      `^PW${W}`,
      `^LL${H}`,
      '^LH0,0',
      '^CI28',
      // Faixa topo
      `^FO0,0^GB${W},${headerH},${headerH},B^FS`,
      `^FO0,${Math.round(headerH * 0.28)}^A0N,28,28^FR^FD${zplField('PONTO MIX', 20)}^FS`,
      // Linhas
      line1 ? `^FO${padL},${textStartY}^A0N,22,22^FD${line1}^FS` : '',
      line2 ? `^FO${padL},${textStartY + lineStep}^A0N,22,22^FD${line2}^FS` : '',
      line3 ? `^FO${padL},${textStartY + lineStep * 2}^A0N,22,22^FD${line3}^FS` : '',
      // Caixa tamanho
      `^FO${sizeBoxX},${sizeBoxY}^GB${sizeBoxW},${sizeBoxH},2,B^FS`,
      `^FO${sizeBoxX},${sizeBoxY + mmToDots(1.5)}^A0N,48,48^FD${sizeVal}^FS`,
      barcodeCmd,
      // Faixa preço
      `^FO0,${footerY}^GB${W},${footerH},${footerH},B^FS`,
      `^FO0,${footerY + Math.round(footerH * 0.28)}^A0N,36,36^FR^FD${price}^FS`,
      '^XZ',
    ]
      .filter(Boolean)
      .join('\n');
  });

  return blocks.join('\n\n');
}

export function pontoMixZplFilename(): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return `ponto-mix-l42pro-${stamp}.zpl`;
}

/** Preview PNG data-URL da primeira etiqueta (canvas). */
export async function renderPontoMixPreviewDataUrl(
  row: ClientOrderLine,
  options: PontoMixPdfOptions = {},
): Promise<string> {
  const blob = await buildPontoMixPdf([row], { ...options, repeatByQuantity: false });
  // Usa o próprio PDF → bitmap via createImageBitmap não funciona em PDF.
  // Fallback: desenha no canvas espelhando o layout (sem depender de pdf.js).
  const geometry = mergeGeometry(options.geometry);
  const templates = mergeTemplates(options.templates);
  const priceFormat = mergePriceFormat(options.priceFormat);
  const copy = composePontoMixLabelCopy(row, templates, priceFormat);
  const scale = 8;
  const w = geometry.labelWidthMm * scale;
  const h = geometry.labelHeightMm * scale;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w);
  canvas.height = Math.round(h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas indisponível para preview.');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const headerH = Math.min(9.5, geometry.labelHeightMm * 0.16) * scale;
  const footerH = Math.min(10.5, geometry.labelHeightMm * 0.175) * scale;
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, canvas.width, headerH);

  if (options.logo?.dataUrl) {
    const img = await loadImage(options.logo.dataUrl);
    const pad = 1.5 * scale;
    const boxW = canvas.width - pad * 2;
    const boxH = headerH - pad * 0.8;
    const s = Math.min(boxW / img.width, boxH / img.height);
    const dw = img.width * s;
    const dh = img.height * s;
    ctx.drawImage(img, (canvas.width - dw) / 2, (headerH - dh) / 2, dw, dh);
  } else {
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.round(headerH * 0.45)}px Helvetica, Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('PONTO MIX', canvas.width / 2, headerH / 2);
  }

  ctx.fillStyle = '#000000';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const padL = geometry.leftMarginMm * scale;
  let y = headerH + 2.2 * scale;
  const fontPx = 5.2 * scale * 0.85;
  ctx.font = `bold ${Math.round(fontPx)}px Helvetica, Arial, sans-serif`;
  for (const line of [copy.line1, copy.line2, copy.line3]) {
    if (!line) continue;
    ctx.fillText(line, padL, y, canvas.width - padL * 2);
    y += fontPx + 1.1 * scale;
  }

  y += 1.2 * scale;
  const sizeBoxW = Math.min(18, geometry.labelWidthMm * 0.55) * scale;
  const sizeBoxH = 8.5 * scale;
  const sizeBoxX = (canvas.width - sizeBoxW) / 2;
  ctx.lineWidth = 0.35 * scale;
  ctx.strokeRect(sizeBoxX, y, sizeBoxW, sizeBoxH);
  ctx.font = `bold ${Math.round(16 * scale * 0.75)}px Helvetica, Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(copy.tamanho, canvas.width / 2, y + sizeBoxH / 2);

  y += sizeBoxH + 2.2 * scale;
  if (copy.codigoBarra) {
    try {
      const bars = code128Bars(copy.codigoBarra);
      const moduleCount = bars.reduce((max, b) => Math.max(max, b.start + b.width), 0);
      const barcodeH = 12 * scale;
      const maxBarW = (geometry.labelWidthMm * 0.92) * scale;
      const module = Math.max(1, maxBarW / Math.max(moduleCount, 1));
      const totalW = moduleCount * module;
      const barX = (canvas.width - totalW) / 2;
      for (const barra of bars) {
        ctx.fillRect(barX + barra.start * module, y, barra.width * module, barcodeH);
      }
      ctx.font = `${Math.round(6.5 * scale * 0.7)}px Helvetica, Arial, sans-serif`;
      ctx.fillText(copy.codigoBarra, canvas.width / 2, y + barcodeH + 2.2 * scale);
    } catch {
      /* ignore */
    }
  }

  ctx.fillStyle = '#000000';
  ctx.fillRect(0, canvas.height - footerH, canvas.width, footerH);
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${Math.round(footerH * 0.45)}px Helvetica, Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(copy.priceText, canvas.width / 2, canvas.height - footerH / 2);

  void blob; // PDF gerado garante paridade de opções; preview usa canvas fiel ao layout
  return canvas.toDataURL('image/png');
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Não consegui carregar a logomarca para o preview.'));
    img.src = src;
  });
}

export async function loadPontoMixLogoDataUrl(url: string | null | undefined): Promise<PontoMixLogo> {
  if (!url) return null;
  try {
    const img = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext('2d');
    if (!ctx || canvas.width <= 0 || canvas.height <= 0) return null;
    ctx.drawImage(img, 0, 0);
    return {
      dataUrl: canvas.toDataURL('image/png'),
      width: canvas.width,
      height: canvas.height,
    };
  } catch {
    return null;
  }
}

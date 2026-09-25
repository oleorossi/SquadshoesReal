/**
 * Esqueleto Ponto Mix — etiqueta preço varejo 40×60 mm (L42PRO FULL).
 *
 * Layout (retrato): faixa preta + logo → 3 linhas → caixa tamanho (traço fino) →
 * CODE128 + dígitos → faixa preta preço. Dados só do arquivo do cliente.
 * Fonte: Montserrat Bold embutida (PDF + preview).
 */
import pontoMixLogoWhite from '@/assets/ponto-mix/logo-ponto-mix-white.png';
import montserratBoldUrl from '@/assets/ponto-mix/fonts/Montserrat-Bold.ttf?url';
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

/**
 * Logo branco + alpha (fundo transparente) — vai direto na faixa preta.
 * Preferir este asset ao vermelho: branquear fundo opaco no canvas vira caixa branca.
 */
export const PONTO_MIX_BUNDLED_LOGO_URL = pontoMixLogoWhite as string;

/** Nome registrado no jsPDF (Montserrat Bold embutido). */
export const PONTO_MIX_PDF_FONT = 'PontoMixSans';

/**
 * Geometria calibrada na arte fotográfica 40×60 (com faixa de preço).
 * Unidades em mm; fontes em pt. Fonte única PDF / preview (Montserrat Bold).
 */
export const PONTO_MIX_ART_LAYOUT = {
  headerHMm: 8.0,
  textTopGapMm: 1.55,
  lineFontPt: 4.35,
  lineMinPt: 3.2,
  lineStepMm: 2.85,
  sizeTopGapMm: 1.7,
  sizeBoxWMm: 14.5,
  sizeBoxHMm: 6.2,
  /** ~0,2 mm — a caixa da arte é delgada, não grossa. */
  sizeStrokeMm: 0.2,
  sizeFontPt: 14,
  barcodeTopGapMm: 1.15,
  /** Altura fixa — não “encher” o restante (empurrava o preço para fora). */
  barcodeHMm: 7.4,
  barcodeHumanGapMm: 1.55,
  barcodeHumanPt: 5.5,
  footerHMm: 8.5,
  priceFontPt: 12,
  logoPadXMm: 2.0,
  logoPadYMm: 0.95,
} as const;

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

/**
 * SKU interno (ex.: `64841968-00-0000000`) — não é a linha comercial da arte
 * (`SQUARD SHOES SP201`). Se for parar em line2, a etiqueta diverge do PDF correto.
 */
export function isPontoMixInternalSku(value: string | undefined | null): boolean {
  const t = String(value ?? '').trim();
  if (!t) return false;
  const digits = (t.match(/\d/g) ?? []).length;
  const letters = (t.match(/[A-Za-zÀ-ÿ]/g) ?? []).length;
  if (digits >= 6 && letters <= 2) return true;
  if (/^\d{5,}[-/.\s]\d/.test(t) && letters <= 2) return true;
  return false;
}

const PONTO_MIX_CATEGORY_BREAK = new Set([
  'FEM',
  'MASC',
  'INF',
  'UNI',
  'FEMININO',
  'MASCULINO',
  'INFANTIL',
  'UNISSEX',
  'MENINA',
  'MENINO',
]);

/**
 * Parte descrição completa do pedido (muitas vezes 1 coluna com tudo) nas 3 linhas
 * da arte: categoria · modelo comercial · cor + tamanho×2.
 */
export function splitPontoMixDescricaoIntoArtLines(
  descricao: string,
  cor: string,
  tamanho: string,
): { line1: string; line2: string; line3: string } | null {
  const words = descricao
    .trim()
    .toUpperCase()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length < 3) return null;

  const corU = cor.trim().toUpperCase();
  const tamU = tamanho.trim().toUpperCase();
  const line3 = [corU, tamU, tamU].filter(Boolean).join(' ').trim();

  const remaining = [...words];
  // Remove cauda "COR TAM [TAM]" se a descrição já trouxe isso.
  if (tamU && remaining[remaining.length - 1] === tamU) {
    remaining.pop();
    if (remaining[remaining.length - 1] === tamU) remaining.pop();
  }
  if (corU && remaining[remaining.length - 1] === corU) remaining.pop();
  if (remaining.length < 2) return null;

  let breakAt = -1;
  for (let i = 0; i < remaining.length - 1; i++) {
    if (PONTO_MIX_CATEGORY_BREAK.has(remaining[i]!)) {
      breakAt = i;
      break;
    }
  }
  if (breakAt < 0) {
    // "SANDALIA CALCADOS FEM …" — 3 primeiras palavras; senão metade.
    breakAt = remaining.length >= 4 ? 2 : Math.max(0, Math.floor(remaining.length / 2) - 1);
  }

  const line1 = remaining.slice(0, breakAt + 1).join(' ').trim();
  const line2 = remaining.slice(breakAt + 1).join(' ').trim();
  if (!line1 || !line2) return null;
  return { line1, line2, line3: line3 || `${corU} ${tamU}`.trim() };
}

/**
 * Corrige o caso típico do Padrao/pedido errado: descrição completa + SKU interno
 * na referência → 4 linhas sobrepostas. Força o layout de 3 linhas da arte.
 */
export function normalizePontoMixArtLines(
  rendered: { line1: string; line2: string; line3: string },
  row: ClientOrderLine,
): { line1: string; line2: string; line3: string } {
  const desc = (row.descricao ?? '').trim();
  const cor = (row.cor ?? '').trim();
  const tamanho = (row.tamanho ?? '').trim();
  const refRaw = (row.referencia ?? '').trim();
  const line2IsSku = isPontoMixInternalSku(rendered.line2) || isPontoMixInternalSku(refRaw);
  const line1IsSku = isPontoMixInternalSku(rendered.line1);
  const line1WordCount = rendered.line1.split(/\s+/).filter(Boolean).length;
  const descWordCount = desc.split(/\s+/).filter(Boolean).length;
  const descHasCategory = desc
    .toUpperCase()
    .split(/\s+/)
    .some(w => PONTO_MIX_CATEGORY_BREAK.has(w));

  // Sempre que a descrição completa (arte) estiver no pedido e line2 for SKU —
  // ou a line1 engolir o dump inteiro — reconstrói as 3 linhas.
  const needsArtSplit =
    (line2IsSku && (line1WordCount >= 3 || descWordCount >= 4)) ||
    (line1IsSku && descWordCount >= 4) ||
    (descHasCategory && descWordCount >= 6 && (line2IsSku || line1WordCount >= 6)) ||
    (descWordCount >= 6 && line1WordCount >= 6 && line2IsSku);

  if (needsArtSplit && desc) {
    const split = splitPontoMixDescricaoIntoArtLines(desc, cor, tamanho);
    if (split) {
      return {
        line1: split.line1,
        line2: split.line2,
        line3:
          rendered.line3 && !isPontoMixInternalSku(rendered.line3)
            ? rendered.line3
            : split.line3,
      };
    }
  }

  // SKU interno sozinho na line2 sem split possível → some (não polui a arte).
  if (line2IsSku) {
    return { ...rendered, line2: '' };
  }
  if (line1IsSku) {
    return { ...rendered, line1: '' };
  }
  return rendered;
}

export function composePontoMixLabelCopy(
  row: ClientOrderLine,
  templates: ClientLabelLineTemplates = PONTO_MIX_DEFAULT_TEMPLATES,
  priceFormat: ClientLabelPriceFormat = PONTO_MIX_DEFAULT_PRICE_FORMAT,
): PontoMixLabelCopy {
  const codigoBarra = (row.codigoBarra || row.codProduto).trim();
  const rendered = normalizePontoMixArtLines(
    {
      line1: renderPontoMixTemplate(templates.line1, row),
      line2: renderPontoMixTemplate(templates.line2, row),
      line3: renderPontoMixTemplate(templates.line3, row),
    },
    row,
  );
  return {
    ...rendered,
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

/**
 * Texto em UMA linha: encolhe a fonte até caber; se ainda estourar, corta com ….
 * Nunca usa maxWidth do jsPDF — ele embrulha sem avançar Y (overlap da arte errada).
 */
function drawFittedSingleLine(
  doc: PdfDoc,
  text: string,
  x: number,
  y: number,
  maxWidthMm: number,
  fontSizePt: number,
  minSizePt = PONTO_MIX_ART_LAYOUT.lineMinPt,
  fontFamily = PONTO_MIX_PDF_FONT,
): void {
  const clean = text.trim();
  if (!clean) return;
  try {
    doc.setFont(fontFamily, 'bold');
  } catch {
    doc.setFont('helvetica', 'bold');
  }
  let size = fontSizePt;
  doc.setFontSize(size);
  while (size > minSizePt && doc.getTextWidth(clean) > maxWidthMm) {
    size -= 0.2;
    doc.setFontSize(size);
  }
  let drawn = clean;
  if (doc.getTextWidth(drawn) > maxWidthMm) {
    while (drawn.length > 1 && doc.getTextWidth(`${drawn}…`) > maxWidthMm) {
      drawn = drawn.slice(0, -1);
    }
    drawn = `${drawn}…`;
  }
  doc.text(drawn, x, y, { baseline: 'top' });
}

function setDocFont(doc: PdfDoc, style: 'normal' | 'bold' = 'bold'): void {
  try {
    doc.setFont(PONTO_MIX_PDF_FONT, style);
  } catch {
    doc.setFont('helvetica', style === 'normal' ? 'normal' : 'bold');
  }
}

let cachedFontBase64: string | null = null;

async function loadMontserratBoldBase64(): Promise<string> {
  if (cachedFontBase64) return cachedFontBase64;
  const res = await fetch(montserratBoldUrl);
  if (!res.ok) throw new Error(`Falha ao carregar fonte Ponto Mix (${res.status}).`);
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  cachedFontBase64 = btoa(binary);
  return cachedFontBase64;
}

/** Registra Montserrat Bold no doc (idempotente por instância). */
export async function ensurePontoMixPdfFont(doc: PdfDoc): Promise<void> {
  const fonts = doc.getFontList?.() ?? {};
  if (fonts[PONTO_MIX_PDF_FONT]) return;
  const base64 = await loadMontserratBoldBase64();
  doc.addFileToVFS('Montserrat-Bold.ttf', base64);
  doc.addFont('Montserrat-Bold.ttf', PONTO_MIX_PDF_FONT, 'normal');
  doc.addFont('Montserrat-Bold.ttf', PONTO_MIX_PDF_FONT, 'bold');
}

async function ensurePontoMixCanvasFont(): Promise<string> {
  const family = 'PontoMixSansCanvas';
  if (typeof document === 'undefined') return 'Helvetica, Arial, sans-serif';
  try {
    const face = new FontFace(family, `url(${montserratBoldUrl})`, { weight: '700' });
    await face.load();
    document.fonts.add(face);
    await document.fonts.load(`700 12px ${family}`);
    return family;
  } catch {
    return 'Helvetica, Arial, sans-serif';
  }
}

/** Fallback quando a imagem da logo falha: alvo à esquerda + PONTO MIX (como o PNG). */
function drawWordmarkFallback(
  doc: PdfDoc,
  x: number,
  y: number,
  bandW: number,
  bandH: number,
): void {
  const cy = y + bandH / 2;
  const markR = Math.min(bandH * 0.32, 2.6);
  doc.setTextColor(255, 255, 255);
  setDocFont(doc, 'bold');
  const fontPt = Math.max(6.5, Math.min(10, bandH * 1.05));
  doc.setFontSize(fontPt);
  const word = 'PONTO MIX';
  const markGap = markR * 0.85;
  const wordW = doc.getTextWidth(word);
  const totalW = markR * 2 + markGap + wordW;
  const startX = x + (bandW - totalW) / 2;
  const markCx = startX + markR;
  doc.setDrawColor(255, 255, 255);
  doc.setLineWidth(Math.max(0.18, markR * 0.22));
  doc.circle(markCx, cy, markR, 'S');
  doc.setLineWidth(Math.max(0.12, markR * 0.12));
  doc.circle(markCx, cy, markR * 0.55, 'S');
  doc.setFillColor(255, 255, 255);
  doc.circle(markCx, cy, markR * 0.22, 'F');
  doc.text(word, startX + markR * 2 + markGap, cy, { baseline: 'middle' });
  doc.setTextColor(0, 0, 0);
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
  const padX = PONTO_MIX_ART_LAYOUT.logoPadXMm;
  const padY = PONTO_MIX_ART_LAYOUT.logoPadYMm;
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
      /* fallback wordmark */
    }
  }
  drawWordmarkFallback(doc, x, y, bandW, bandH);
}

function artSlots(geometry: ClientLabelGeometry) {
  const L = PONTO_MIX_ART_LAYOUT;
  const w = geometry.labelWidthMm;
  const h = geometry.labelHeightMm;
  const headerH = Math.min(L.headerHMm, h * 0.15);
  const footerH = Math.min(L.footerHMm, h * 0.16);
  const padL = geometry.leftMarginMm;
  const padR = geometry.rightMarginMm;
  const contentW = w - padL - padR;
  const textY0 = headerH + L.textTopGapMm;
  const sizeY = textY0 + L.lineStepMm * 3 + L.sizeTopGapMm;
  const barcodeY = sizeY + L.sizeBoxHMm + L.barcodeTopGapMm;
  const footerY = h - footerH;
  // Invariante: barcode + HRI ficam acima do footer (não empurram o preço fora).
  const humanReserve = L.barcodeHumanGapMm + 2.4;
  const maxBarcodeH = Math.max(5.5, footerY - barcodeY - humanReserve);
  const barcodeH = Math.min(L.barcodeHMm, maxBarcodeH);
  return {
    w,
    h,
    headerH,
    footerH,
    footerY,
    padL,
    contentW,
    textY0,
    sizeY,
    sizeBoxW: Math.min(L.sizeBoxWMm, contentW * 0.48),
    sizeBoxH: L.sizeBoxHMm,
    barcodeY,
    barcodeH,
  };
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
  const L = PONTO_MIX_ART_LAYOUT;
  const slots = artSlots(geometry);

  drawLogoOnBlackBand(doc, logo, 0, 0, slots.w, slots.headerH);

  doc.setTextColor(0, 0, 0);
  let y = slots.textY0;
  for (const line of [copy.line1, copy.line2, copy.line3]) {
    if (line) {
      drawFittedSingleLine(doc, line, slots.padL, y, slots.contentW, L.lineFontPt, L.lineMinPt);
    }
    y += L.lineStepMm;
  }

  const sizeBoxX = (slots.w - slots.sizeBoxW) / 2;
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(L.sizeStrokeMm);
  doc.rect(sizeBoxX, slots.sizeY, slots.sizeBoxW, slots.sizeBoxH, 'S');
  setDocFont(doc, 'bold');
  doc.setFontSize(L.sizeFontPt);
  doc.text(copy.tamanho, slots.w / 2, slots.sizeY + slots.sizeBoxH * 0.72, {
    align: 'center',
  });

  if (copy.codigoBarra) {
    try {
      const bars = code128Bars(copy.codigoBarra);
      const moduleCount = bars.reduce((max, b) => Math.max(max, b.start + b.width), 0);
      const maxBarW = slots.contentW * 0.9;
      const module = Math.max(0.2, maxBarW / Math.max(moduleCount, 1));
      const totalW = moduleCount * module;
      const barX = (slots.w - totalW) / 2;
      doc.setFillColor(0, 0, 0);
      for (const barra of bars) {
        doc.rect(
          barX + barra.start * module,
          slots.barcodeY,
          barra.width * module,
          slots.barcodeH,
          'F',
        );
      }
      setDocFont(doc, 'normal');
      doc.setFontSize(L.barcodeHumanPt);
      doc.text(copy.codigoBarra, slots.w / 2, slots.barcodeY + slots.barcodeH + L.barcodeHumanGapMm, {
        align: 'center',
      });
    } catch {
      doc.setFontSize(6);
      doc.text('(código inválido)', slots.w / 2, slots.barcodeY + 4, { align: 'center' });
    }
  }

  // Faixa preço — obrigatória (arte da direita / foto de referência).
  doc.setFillColor(0, 0, 0);
  doc.rect(0, slots.footerY, slots.w, slots.footerH, 'F');
  doc.setTextColor(255, 255, 255);
  setDocFont(doc, 'bold');
  doc.setFontSize(Math.max(10, Math.min(L.priceFontPt, slots.footerH * 1.25)));
  doc.text(copy.priceText, slots.w / 2, slots.footerY + slots.footerH * 0.68, {
    align: 'center',
  });
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
  try {
    await ensurePontoMixPdfFont(doc);
  } catch {
    /* Helvetica fallback via setDocFont */
  }

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
 * ZPL 203 dpi — mesmas proporções do PDF (header + linhas + caixa + barcode + preço).
 * Logo PNG omitida no ZPL textual; wordmark aproximado no header.
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
  const L = PONTO_MIX_ART_LAYOUT;
  const slots = artSlots(geometry);

  const W = mmToDots(geometry.labelWidthMm);
  const H = mmToDots(geometry.labelHeightMm);
  const padL = mmToDots(slots.padL);
  const headerH = mmToDots(slots.headerH);

  const blocks = expanded.map(row => {
    const copy = composePontoMixLabelCopy(row, templates, priceFormat);
    const line1 = zplField(copy.line1, 40);
    const line2 = zplField(copy.line2, 40);
    const line3 = zplField(copy.line3, 40);
    const sizeVal = zplField(copy.tamanho, 6);
    const barcode = copy.codigoBarra.replace(/[^A-Za-z0-9 ._/-]/g, '').slice(0, 50);

    const textStartY = mmToDots(slots.textY0);
    const lineStep = mmToDots(L.lineStepMm);
    const sizeBoxW = mmToDots(slots.sizeBoxW);
    const sizeBoxH = mmToDots(slots.sizeBoxH);
    const sizeBoxX = Math.round((W - sizeBoxW) / 2);
    const sizeBoxY = mmToDots(slots.sizeY);
    const barcodeY = mmToDots(slots.barcodeY);
    const barcodeH = mmToDots(slots.barcodeH);
    const strokeDots = Math.max(1, mmToDots(L.sizeStrokeMm));

    const barcodeCmd =
      barcode && copy.barcodeSymbology === 'ean13'
        ? [`^FO${padL},${barcodeY}`, `^BEN,${barcodeH},Y,N`, `^FD${barcode}^FS`].join('\n')
        : barcode
          ? [`^FO${padL},${barcodeY}`, `^BCN,${barcodeH},Y,N,N`, `^FD${barcode}^FS`].join('\n')
          : '';

    // Wordmark ZPL aproximado: alvo (círculos) + PONTO MIX (logo PNG só no PDF).
    const markCx = Math.round(W * 0.18);
    const markCy = Math.round(headerH / 2);
    const markR = Math.round(headerH * 0.28);

    return [
      '^XA',
      `^PW${W}`,
      `^LL${H}`,
      '^LH0,0',
      '^CI28',
      `^FO0,0^GB${W},${headerH},${headerH},B^FS`,
      // Alvo concêntrico (aprox.)
      `^FO${markCx - markR},${markCy - markR}^GC${markR * 2},${Math.max(1, Math.round(markR * 0.18))},B^FS`,
      `^FO${markCx - Math.round(markR * 0.55)},${markCy - Math.round(markR * 0.55)}^GC${Math.round(markR * 1.1)},${Math.max(1, Math.round(markR * 0.1))},B^FS`,
      `^FO${Math.round(W * 0.28)},${Math.round(headerH * 0.28)}^A0N,26,26^FR^FD${zplField('PONTO MIX', 20)}^FS`,
      line1 ? `^FO${padL},${textStartY}^A0N,18,18^FD${line1}^FS` : '',
      line2 ? `^FO${padL},${textStartY + lineStep}^A0N,18,18^FD${line2}^FS` : '',
      line3 ? `^FO${padL},${textStartY + lineStep * 2}^A0N,18,18^FD${line3}^FS` : '',
      `^FO${sizeBoxX},${sizeBoxY}^GB${sizeBoxW},${sizeBoxH},${strokeDots},B^FS`,
      `^FO${sizeBoxX},${sizeBoxY + mmToDots(0.9)}^A0N,42,42^FD${sizeVal}^FS`,
      barcodeCmd,
      // Sem faixa de preço — decisão do dono.
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

/** Preview PNG data-URL da primeira etiqueta (canvas) — mesma geometria/fonte do PDF. */
export async function renderPontoMixPreviewDataUrl(
  row: ClientOrderLine,
  options: PontoMixPdfOptions = {},
): Promise<string> {
  const geometry = mergeGeometry(options.geometry);
  const templates = mergeTemplates(options.templates);
  const priceFormat = mergePriceFormat(options.priceFormat);
  const copy = composePontoMixLabelCopy(row, templates, priceFormat);
  const L = PONTO_MIX_ART_LAYOUT;
  const slots = artSlots(geometry);
  const fontFamily = await ensurePontoMixCanvasFont();
  const boldFont = (px: number) => `700 ${Math.round(px)}px ${fontFamily}, Helvetica, Arial, sans-serif`;
  const scale = 8;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(slots.w * scale);
  canvas.height = Math.round(slots.h * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas indisponível para preview.');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const headerH = slots.headerH * scale;
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, canvas.width, headerH);

  let logoDrawn = false;
  if (options.logo?.dataUrl) {
    try {
      const img = await loadImage(options.logo.dataUrl);
      const padX = L.logoPadXMm * scale;
      const padY = L.logoPadYMm * scale;
      const boxW = canvas.width - padX * 2;
      const boxH = headerH - padY * 2;
      const s = Math.min(boxW / img.width, boxH / img.height);
      const dw = img.width * s;
      const dh = img.height * s;
      ctx.drawImage(img, (canvas.width - dw) / 2, (headerH - dh) / 2, dw, dh);
      logoDrawn = true;
    } catch {
      logoDrawn = false;
    }
  }
  if (!logoDrawn) {
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const fontPxMark = Math.round(headerH * 0.38);
    ctx.font = boldFont(fontPxMark);
    const word = 'PONTO MIX';
    const markR = headerH * 0.28;
    const markGap = markR * 0.7;
    const wordW = ctx.measureText(word).width;
    const totalW = markR * 2 + markGap + wordW;
    const startX = (canvas.width - totalW) / 2;
    const cy = headerH / 2;
    const markCx = startX + markR;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1.5, markR * 0.22);
    ctx.beginPath();
    ctx.arc(markCx, cy, markR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = Math.max(1, markR * 0.12);
    ctx.beginPath();
    ctx.arc(markCx, cy, markR * 0.55, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(markCx, cy, markR * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillText(word, startX + markR * 2 + markGap, cy);
  }

  ctx.fillStyle = '#000000';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const padL = slots.padL * scale;
  const maxTextW = slots.contentW * scale;
  let y = slots.textY0 * scale;
  const lineStep = L.lineStepMm * scale;
  for (const line of [copy.line1, copy.line2, copy.line3]) {
    if (line) {
      let fontPx = L.lineFontPt * scale * 0.82;
      const minPx = L.lineMinPt * scale * 0.82;
      ctx.font = boldFont(fontPx);
      while (fontPx > minPx && ctx.measureText(line).width > maxTextW) {
        fontPx -= 0.4;
        ctx.font = boldFont(fontPx);
      }
      let drawn = line;
      if (ctx.measureText(drawn).width > maxTextW) {
        while (drawn.length > 1 && ctx.measureText(`${drawn}…`).width > maxTextW) {
          drawn = drawn.slice(0, -1);
        }
        drawn = `${drawn}…`;
      }
      ctx.fillText(drawn, padL, y);
    }
    y += lineStep;
  }

  const sizeBoxW = slots.sizeBoxW * scale;
  const sizeBoxH = slots.sizeBoxH * scale;
  const sizeBoxX = (canvas.width - sizeBoxW) / 2;
  const sizeY = slots.sizeY * scale;
  ctx.lineWidth = Math.max(1, L.sizeStrokeMm * scale);
  ctx.strokeRect(sizeBoxX, sizeY, sizeBoxW, sizeBoxH);
  ctx.font = boldFont(L.sizeFontPt * scale * 0.78);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(copy.tamanho, canvas.width / 2, sizeY + sizeBoxH / 2);

  const barcodeY = slots.barcodeY * scale;
  if (copy.codigoBarra) {
    try {
      const bars = code128Bars(copy.codigoBarra);
      const moduleCount = bars.reduce((max, b) => Math.max(max, b.start + b.width), 0);
      const barcodeH = slots.barcodeH * scale;
      const maxBarW = slots.contentW * 0.9 * scale;
      const module = Math.max(1, maxBarW / Math.max(moduleCount, 1));
      const totalW = moduleCount * module;
      const barX = (canvas.width - totalW) / 2;
      for (const barra of bars) {
        ctx.fillRect(barX + barra.start * module, barcodeY, barra.width * module, barcodeH);
      }
      ctx.font = boldFont(L.barcodeHumanPt * scale * 0.75);
      ctx.fillText(
        copy.codigoBarra,
        canvas.width / 2,
        barcodeY + barcodeH + L.barcodeHumanGapMm * scale,
      );
    } catch {
      /* ignore */
    }
  }

  // Sem faixa de preço — decisão do dono ("Sem preço").
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

/**
 * Converte logo colorida (vermelho) em branco + alpha na faixa preta.
 * Fundo claro/branco vira transparente — senão vira caixa branca sobre o preto.
 */
export function whitenLogoPixels(
  data: Uint8ClampedArray | Uint8Array,
): void {
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const a = data[i + 3]!;
    if (a < 8) continue;
    // Fundo claro / quase branco → transparente
    if (r >= 220 && g >= 220 && b >= 220) {
      data[i + 3] = 0;
      continue;
    }
    // Também trata cinza bem claro (anti-alias do fundo)
    if (r >= 200 && g >= 200 && b >= 200 && Math.abs(r - g) < 12 && Math.abs(g - b) < 12) {
      data[i + 3] = 0;
      continue;
    }
    data[i] = 255;
    data[i + 1] = 255;
    data[i + 2] = 255;
  }
}

/** Converte logo colorida (vermelho/preto) em branco + alpha — faixa preta da arte. */
async function whitenLogoForBlackBand(logo: NonNullable<PontoMixLogo>): Promise<PontoMixLogo> {
  try {
    const img = await loadImage(logo.dataUrl);
    const canvas = document.createElement('canvas');
    canvas.width = logo.width;
    canvas.height = logo.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return logo;
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    whitenLogoPixels(imageData.data);
    ctx.putImageData(imageData, 0, 0);
    return {
      dataUrl: canvas.toDataURL('image/png'),
      width: canvas.width,
      height: canvas.height,
    };
  } catch {
    return logo;
  }
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

function looksAlreadyWhiteOnTransparent(logo: NonNullable<PontoMixLogo>): boolean {
  // Asset empacotado branco: data URL ou path contendo white.
  return /logo-ponto-mix-white/i.test(logo.dataUrl) || logo.dataUrl.includes('ponto-mix-white');
}

/**
 * Sempre a logo empacotada branca (`logo-ponto-mix-white.png`).
 * Upload do cliente é ignorado — a arte Ponto Mix é fixa (decisão Q3-A).
 * Wordmark Helvetica só se o PNG falhar no carregamento.
 */
export async function resolvePontoMixLogo(_url?: string | null): Promise<PontoMixLogo> {
  void _url;
  const loaded = await loadPontoMixLogoDataUrl(PONTO_MIX_BUNDLED_LOGO_URL);
  if (!loaded) return null;
  if (looksAlreadyWhiteOnTransparent(loaded)) return loaded;
  return whitenLogoForBlackBand(loaded);
}
